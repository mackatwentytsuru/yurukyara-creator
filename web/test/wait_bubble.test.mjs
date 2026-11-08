// 返事を待つ間の「…」の出し入れの決まり(CU)。タイマーを差し替えて、時間を進めずに確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_DELAY_MS, WAIT_MAX_MS, WAKE_BUSY, WAKE_FAILED, WAKE_HINT, WAKE_READY, createWaitBubble, thinkingText, wakeLoading } from '../src/ui/waitBubble.js';

/** 進められるタイマー */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    set(f, ms) {
      const id = next++;
      jobs.set(id, { at: now + ms, f });
      return id;
    },
    clear(id) {
      jobs.delete(id);
    },
    advance(ms) {
      const to = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        jobs.delete(due[0]);
        now = due[1].at;
        due[1].f();
      }
      now = to;
    },
  };
}

function setup(name = 'ノリー') {
  const timers = fakeTimers();
  const calls = [];
  const bubble = createWaitBubble({ render: (visible, text) => calls.push([visible, text]), nameOf: () => name, timers });
  return { timers, calls, bubble };
}

test('言葉は、子どもにも読めるひらがな多めで、キャラの名前が入る', () => {
  assert.equal(wakeLoading('ノリー'), 'ノリーが おきているよ…');
  assert.equal(thinkingText('みかんちゃん'), 'みかんちゃんが かんがえているよ');
  assert.match(WAKE_READY, /おしてね/);
  assert.ok(WAKE_BUSY.length > 0 && WAKE_HINT.length > 0);
  // 開発の言葉(読み込み・サーバー・API など)は出さない
  for (const t of [wakeLoading(), thinkingText(), WAKE_READY, WAKE_BUSY, WAKE_HINT, WAKE_FAILED]) assert.doesNotMatch(t, /サーバー|API|読み込み|ロード|エラー/);
  assert.match(WAKE_FAILED, /もう一度/, '読み込めなかった時は、動く点を止めて、次にすることを言う');
});

test('話しかけて 0.4 秒たっても文字が無ければ出す。すぐ来たら出さない(ちらつかせない)', () => {
  const { timers, calls, bubble } = setup();
  bubble.begin();
  timers.advance(WAIT_DELAY_MS - 1);
  assert.equal(bubble.shown, false);
  timers.advance(2);
  assert.deepEqual(calls, [[true, 'ノリーが かんがえているよ']]);
  bubble.end();
  assert.deepEqual(calls.at(-1), [false, '']);

  const quick = setup();
  quick.bubble.begin();
  quick.timers.advance(200);
  quick.bubble.end();
  quick.timers.advance(5000);
  assert.deepEqual(quick.calls, [], '0.2 秒で返事が来た時は、何も出さない');
});

test('最初の一言(押した直後)は、すぐ出す', () => {
  const { calls, bubble } = setup();
  bubble.begin({ immediate: true });
  assert.deepEqual(calls, [[true, 'ノリーが かんがえているよ']]);
  assert.equal(bubble.active, true);
});

test('出ている間の呼び直しは、消さずに出したまま。止める上限だけ数え直す', () => {
  const { timers, calls, bubble } = setup();
  bubble.begin({ immediate: true });
  timers.advance(WAIT_MAX_MS - 100);
  bubble.begin(); // 話しかけ直し
  timers.advance(WAIT_MAX_MS - 100);
  assert.equal(bubble.shown, true, '呼び直しで上限が数え直される');
  assert.equal(calls.filter(([v]) => !v).length, 0, '途中で消えて出し直す、はしない');
  timers.advance(200);
  assert.equal(bubble.shown, false, '上限を過ぎたら、消す知らせが来なくても消える');
});

test('消す知らせが来ない時も、ずっとは残さない(上限)。消した後の end は何もしない', () => {
  const { timers, calls, bubble } = setup();
  bubble.begin({ immediate: true });
  timers.advance(WAIT_MAX_MS + 1);
  assert.deepEqual(calls, [[true, 'ノリーが かんがえているよ'], [false, '']]);
  bubble.end();
  bubble.end();
  assert.equal(calls.length, 2, '消えた後の end で、また消す知らせを出さない');
});

test('出す前に end したら、あとで出さない', () => {
  const { timers, calls, bubble } = setup();
  bubble.begin();
  bubble.end();
  timers.advance(10000);
  assert.deepEqual(calls, []);
  assert.equal(bubble.active, false);
});

test('名前は、出す時に読む(読み込みの後で名前が分かった時も合う)', () => {
  let name = 'ノリー';
  const timers = fakeTimers();
  const calls = [];
  const bubble = createWaitBubble({ render: (v, t) => calls.push([v, t]), nameOf: () => name, timers });
  bubble.begin();
  name = 'ちょうちんくん';
  timers.advance(WAIT_DELAY_MS + 1);
  assert.equal(calls[0][1], 'ちょうちんくんが かんがえているよ');
});
