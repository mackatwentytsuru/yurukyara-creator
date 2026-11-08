// ハンズフリー(接客モードの聞き取りの見張り)の試験。時計は偽物(時間を自分で進める)。
// - 止まった・始められなかった・マイクの線が切れた・時間切れのあと、自分で始め直す
// - 間が 1→2→4→8→16→30 秒と伸び、30 秒で止まる。うまく始まったら 1 秒に戻る
// - 画面が裏の間は始めない(戻ったら始める)。キャラが話している間は始めない
// - 抜けたら二度と始めない。始めている最中に抜けても、始め直さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_MS, WAIT_MS, WATCH_MS, createHandsFree, listenerAlive, streamAlive } from '../src/conversation/handsFree.js';

/** 偽の時計とタイマー */
function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    get now() {
      return now;
    },
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    /** ms 進める。その間に来たタイマーを順に動かし、動かした後の非同期も流す */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      now = end;
    },
    get pending() {
      return timers.size;
    },
  };
}

/** 偽の聞き取り: start で生きる(succeed が true の間)・kill で止まる */
function fakeMic() {
  const m = { alive: false, starts: 0, succeed: true, throws: false, busy: false, hidden: false };
  m.start = async () => {
    m.starts += 1;
    if (m.throws) throw new Error('マイクを開けない');
    if (m.succeed) m.alive = true;
  };
  return m;
}
const make = (m, c) =>
  createHandsFree({ alive: () => m.alive, start: m.start, isBusy: () => m.busy, isHidden: () => m.hidden, setTimer: c.setTimer, clearTimer: c.clearTimer });
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('間の長さ: 1→2→4→8→16→30 秒', () => {
  assert.deepEqual([...BACKOFF_MS], [1000, 2000, 4000, 8000, 16000, 30000]);
});

test('始まっていなければ、見張りを入れた時に始める。生きている間は何度も始めない', async () => {
  const c = clock();
  const m = fakeMic();
  const hf = make(m, c);
  hf.enable();
  await settle();
  assert.equal(m.starts, 1);
  await c.advance(WATCH_MS * 5);
  assert.equal(m.starts, 1, '生きている間は始め直さない');
});

test('止まった(聞き取りが自分で終わった・時間切れ)あとに、自分で始め直す', async () => {
  const c = clock();
  const m = fakeMic();
  const hf = make(m, c);
  hf.enable();
  await settle();
  m.alive = false; // ブラウザの聞き取りが 1 分ほどで終わった
  await c.advance(WATCH_MS + 10);
  assert.equal(m.starts, 2);
  assert.equal(m.alive, true);
  m.alive = false; // マイクの線が切れた(ended)も、生きていない扱い
  await c.advance(WATCH_MS + 10);
  assert.equal(m.starts, 3);
});

test('始められない(許可が出ていない・失敗)間は、間をあけて続ける。間が 1→2→4…と伸び、30 秒で止まる。始まったら戻る', async () => {
  const c = clock();
  const m = fakeMic();
  m.succeed = false;
  const hf = make(m, c);
  hf.enable();
  await settle();
  const startsAt = [0]; // 見張りを入れた時(0 秒)の 1 回目
  let last = m.starts;
  // 投げる失敗も、黙って始まらない失敗も同じ
  for (let t = 0; t < 120_000 && startsAt.length < 8; t += 100) {
    m.throws = startsAt.length % 2 === 1;
    await c.advance(100);
    if (m.starts !== last) {
      startsAt.push(c.now);
      last = m.starts;
    }
  }
  const gaps = startsAt.slice(1).map((t, i) => t - startsAt[i]);
  assert.deepEqual(gaps.slice(0, 6), [1000, 2000, 4000, 8000, 16000, 30000], '間が伸びる');
  assert.ok(gaps.length >= 7 && gaps.slice(5).every((g) => g === 30000), `30 秒より伸びない: ${gaps}`);
  // 始まったら、失敗の数えが戻る
  m.succeed = true;
  m.throws = false;
  await c.advance(31_000);
  assert.equal(m.alive, true);
  assert.equal(hf.failures, 0);
  m.alive = false;
  const before = m.starts;
  await c.advance(WATCH_MS + 10);
  assert.equal(m.starts, before + 1, '次の止まりは、また早く始め直す');
});

test('画面が裏の間は始めない。戻ったら始める(待たずに nudge でも)', async () => {
  const c = clock();
  const m = fakeMic();
  m.hidden = true;
  const hf = make(m, c);
  hf.enable();
  await c.advance(WAIT_MS * 20);
  assert.equal(m.starts, 0, '裏では始めない(許可を断られたり、音が鳴ったりしない)');
  assert.equal(hf.failures, 0, '裏の間は失敗に数えない(間が伸びない)');
  m.hidden = false;
  hf.nudge();
  await settle();
  assert.equal(m.starts, 1, '戻ったら、すぐ始める');
  // 裏に回って、マイクが切れた
  m.hidden = true;
  m.alive = false;
  await c.advance(WATCH_MS * 4);
  assert.equal(m.starts, 1);
  m.hidden = false;
  await c.advance(WAIT_MS + 10);
  assert.equal(m.starts, 2);
});

test('キャラが話している間は始めない。話し終わったら始める', async () => {
  const c = clock();
  const m = fakeMic();
  m.busy = true;
  const hf = make(m, c);
  hf.enable();
  await c.advance(10_000);
  assert.equal(m.starts, 0);
  assert.equal(hf.failures, 0);
  m.busy = false;
  await c.advance(WAIT_MS + 10);
  assert.equal(m.starts, 1);
});

test('抜けたら、二度と始めない(タイマーも残さない)。始めている最中に抜けても、始め直さない', async () => {
  const c = clock();
  const m = fakeMic();
  const hf = make(m, c);
  hf.enable();
  await settle();
  m.alive = false;
  hf.disable();
  assert.equal(hf.enabled, false);
  assert.equal(c.pending, 0, '見張りのタイマーが残らない');
  await c.advance(120_000);
  assert.equal(m.starts, 1, '抜けた後は始めない');
  hf.nudge();
  await settle();
  assert.equal(m.starts, 1, 'nudge も効かない');
  // 始めている最中に抜ける
  const m2 = fakeMic();
  let release;
  m2.start = () => new Promise((r) => (release = () => ((m2.alive = false), r())));
  const hf2 = createHandsFree({ alive: () => m2.alive, start: m2.start, setTimer: c.setTimer, clearTimer: c.clearTimer });
  hf2.enable();
  await settle();
  hf2.disable();
  release();
  await settle();
  assert.equal(c.pending, 0, '最中に抜けたら、あとからタイマーを足さない');
  // もう一度入れれば、また動く
  hf.enable();
  await settle();
  assert.equal(m.starts, 2);
});

test('streamAlive: すべての線が live の時だけ生きている。線が無い(ブラウザの聞き取りの一部)なら止まっていない扱い', () => {
  const tracks = (...states) => ({ getAudioTracks: () => states.map((readyState) => ({ readyState })) });
  assert.equal(streamAlive(tracks('live')), true);
  assert.equal(streamAlive(tracks('live', 'ended')), false);
  assert.equal(streamAlive(tracks('ended')), false);
  assert.equal(streamAlive(tracks()), false, '線が 0 本なら切れている');
  assert.equal(streamAlive(undefined), true);
  assert.equal(streamAlive({}), true);
});

test('listenerAlive: 接客の見張りは、マイクの取り直しの最中(starting)を生きている扱いにする(止めて作り直さない)', () => {
  const tracks = (...states) => ({ getAudioTracks: () => states.map((readyState) => ({ readyState })) });
  assert.equal(listenerAlive(null), false, '聞き取りが無い');
  assert.equal(listenerAlive({}), false, '動いていない');
  assert.equal(listenerAlive({ starting: true }), true, '取り直しの最中は生きている');
  assert.equal(listenerAlive({ starting: true, listening: false, stream: tracks('ended') }), true, 'starting なら線が切れていても待つ');
  assert.equal(listenerAlive({ listening: true, stream: tracks('live') }), true, '聞いていて線が生きている');
  assert.equal(listenerAlive({ listening: true, stream: tracks('ended') }), false, '聞いていても線が切れていたら止まりとして数える');
  assert.equal(listenerAlive({ listening: true }), true, '線が分からない聞き取りは止まっていない扱い');
});
