// LF3(11-08): つながり直して送り直す部品・送り直しの元になる失敗の見分け・先に送った回の記録の印・2D の引数(--trait=)の試験。
// 本物の頭脳・声のサービスは呼ばない(偽の物だけ)。時計とタイマーは作り物で進める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Dialogue, isOutage } from '../src/conversation/dialogue.js';
import { GIVE_UP_MS, RETRY_FRESH_MS, Reconnector, probeServer } from '../src/conversation/reconnect.js';
import { TO_2D_TIMEOUT_MS, build2dArgs } from '../server/draw.mjs';
import { sanitizeMetric } from '../server/validate.mjs';

/** 作り物の時計とタイマー */
function clockRig() {
  let t = 1_000_000;
  const timers = [];
  const setTimer = (fn, ms) => {
    const h = { fn, at: t + ms, live: true };
    timers.push(h);
    return h;
  };
  const clearTimer = (h) => {
    if (h) h.live = false;
  };
  const advance = async (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((h) => h.live && h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.live = false;
      next.fn();
      await new Promise((r) => setImmediate(r)); // probe の約束を片づける
    }
    t = end;
  };
  return { now: () => t, setTimer, clearTimer, advance };
}

function reconnectorRig(results) {
  const c = clockRig();
  const backs = [];
  let calls = 0;
  const r = new Reconnector({
    probe: async () => {
      const v = results[Math.min(calls, results.length - 1)];
      calls += 1;
      if (v === 'throw') throw new TypeError('Failed to fetch');
      return v;
    },
    onBack: (info) => backs.push(info),
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  return { r, c, backs, calls: () => calls };
}

test('Reconnector: 切れたあと、つながるまで調べ続け、つながったら止まった言葉と一緒に 1 回だけ知らせる', async () => {
  const { r, c, backs, calls } = reconnectorRig([false, 'throw', true]);
  r.begin({ text: 'こんにちは', at: c.now() });
  assert.equal(r.waiting, true);
  await c.advance(1400);
  assert.equal(calls(), 0, '最初の調べは 1.5 秒後');
  await c.advance(200);
  assert.equal(calls(), 1);
  await c.advance(3000); // 2 回目(届かない)
  assert.equal(calls(), 2);
  assert.equal(backs.length, 0);
  await c.advance(5000); // 3 回目(届いた)
  assert.equal(backs.length, 1);
  assert.equal(backs[0].pending.text, 'こんにちは');
  assert.equal(backs[0].fresh, true);
  assert.equal(r.waiting, false);
  await c.advance(60_000);
  assert.equal(backs.length, 1, '知らせたあとは、もう調べない');
  assert.equal(calls(), 3);
});

test('Reconnector: 古い言葉(90 秒より前)は、つながっても送り直さない(fresh: false)', async () => {
  const { r, c, backs } = reconnectorRig([...Array(12).fill(false), true]); // 間隔は 1.5・3・5・8 秒のあと 10 秒ずつ。12 回目までは届かず、そのあと届く
  r.begin({ text: 'さっきの', at: c.now() });
  await c.advance(RETRY_FRESH_MS + 60_000);
  assert.equal(backs.length, 1);
  assert.equal(backs[0].fresh, false);
  assert.equal(backs[0].pending.text, 'さっきの');
});

test('Reconnector: 新しい言葉を送る(supersede)と、止まった言葉は送り直さない。調べるのは続けて、つながったら知らせる', async () => {
  const { r, c, backs } = reconnectorRig([false, true]);
  r.begin({ text: '前の言葉', at: c.now() });
  r.supersede();
  await c.advance(10_000);
  assert.equal(backs.length, 1);
  assert.equal(backs[0].pending, null);
  assert.equal(backs[0].fresh, false);
});

test('Reconnector: また切れたら、いちばん新しい言葉だけを覚え、調べは 1 本のまま', async () => {
  const { r, c, backs, calls } = reconnectorRig([true]);
  r.begin({ text: 'いち', at: c.now() });
  r.begin({ text: 'に', at: c.now() });
  await c.advance(2000);
  assert.equal(calls(), 1, '調べは 1 本');
  assert.equal(backs.length, 1);
  assert.equal(backs[0].pending.text, 'に');
});

test('Reconnector: cancel で待ちも言葉も捨てる。nudge は待たずに今すぐ調べる。30 分で諦める', async () => {
  const a = reconnectorRig([true]);
  a.r.begin({ text: 'あ', at: a.c.now() });
  a.r.cancel();
  await a.c.advance(10_000);
  assert.equal(a.backs.length, 0);
  assert.equal(a.calls(), 0);

  const b = reconnectorRig([true]);
  b.r.begin({ text: 'い', at: b.c.now() });
  b.r.nudge(); // オンラインに戻った合図
  await new Promise((r) => setImmediate(r));
  assert.equal(b.backs.length, 1, '1.5 秒を待たずにつながり直しを知らせる');

  const c = reconnectorRig([false]);
  c.r.begin({ text: 'う', at: c.c.now() });
  await c.c.advance(GIVE_UP_MS + 20_000);
  assert.equal(c.r.waiting, false, '30 分たったら諦める');
  assert.equal(c.backs.length, 0);
  const calls = c.calls();
  await c.c.advance(60_000);
  assert.equal(c.calls(), calls, '諦めたあとは調べない');
});

test('probeServer: 何か返事が来れば(404 も)届いている。5xx と投げた時は届いていない。時間切れも届いていない', async () => {
  assert.equal(await probeServer(async () => ({ status: 200 })), true);
  assert.equal(await probeServer(async () => ({ status: 404 })), true, '公開の URL には /api/status が無い');
  assert.equal(await probeServer(async () => ({ status: 502 })), false, 'ゲートが返す 502(サーバーが再起動中)');
  assert.equal(await probeServer(async () => ({ status: 503 })), false);
  assert.equal(await probeServer(async () => { throw new TypeError('Failed to fetch'); }), false);
  assert.equal(await probeServer((url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))), 30), false);
});

test('isOutage: 通信が切れた(status なし)と 5xx は送り直す。413・429・400 などは送り直さない', () => {
  assert.equal(isOutage(new TypeError('Failed to fetch')), true);
  assert.equal(isOutage({ status: 502 }), true);
  assert.equal(isOutage({ status: 503 }), true);
  assert.equal(isOutage({ status: 413 }), false);
  assert.equal(isOutage({ status: 429 }), false);
  assert.equal(isOutage({ status: 400 }), false);
});

// ---- Dialogue と Reconnector をつなぐ(main.js と同じ向き) ----
function newDialogue({ onOffline, onMetric = () => {}, playAudio = false } = {}) {
  const log = { errors: [], captions: [] };
  const speaker = {
    speaking: false,
    pending: 0,
    capReached: false,
    setVoicePersona() {},
    playFiller: () => null,
    stop() {},
    enqueue: (text, o = {}) => {
      if (playAudio) o.onStart?.(performance.now(), {});
      return Promise.resolve();
    },
  };
  const d = new Dialogue({
    character: { expressions: ['neutral'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false },
    speaker,
    ui: { thought() {}, say() {}, userSaid() {}, caption: (t) => log.captions.push(t), error: (m) => log.errors.push(m), notice() {} },
    getContext: () => ({ scene: '', character: { name: 'ノリー', persona: '' }, place: {} }),
    setGaze: () => null,
    onMetric,
    onOffline,
  });
  return { d, log };
}
const okChat = () =>
  new Response(JSON.stringify({ brain: 'mock', events: [{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }], ms: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(init.body ? JSON.parse(init.body) : null);
    return handler(calls.length);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('Dialogue: 通信が切れて返事が 1 つも来なかった回は、onOffline に言葉を渡す(履歴には残さない)', async () => {
  const seen = [];
  const { d } = newDialogue({ onOffline: (info) => seen.push(info) });
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    await d.send({ text: 'こんにちは', mode: 'voice' });
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, 'こんにちは');
  assert.equal(typeof seen[0].at, 'number');
  assert.equal(d.history.length, 0);
});

test('Dialogue: 502(再起動中)は送り直しの元になる。413・近づいた合図・画面が止めた回は、ならない', async () => {
  const seen = [];
  const { d } = newDialogue({ onOffline: (info) => seen.push(info.text) });
  await withFetch(() => new Response('', { status: 502 }), async () => {
    await d.send({ text: 'にかいめ' });
  });
  assert.deepEqual(seen, ['にかいめ']);
  await withFetch(() => new Response('{}', { status: 413 }), async () => {
    await d.send({ text: 'ながい' });
  });
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    await d.send({ text: '', trigger: 'approach' });
  });
  assert.deepEqual(seen, ['にかいめ'], '413 と声かけの回は送り直さない');
  // 画面が止めた回(cancel)は、つながらなくても送り直さない
  await withFetch(() => new Promise((_, rej) => setTimeout(() => rej(new DOMException('', 'AbortError')), 5)), async () => {
    const p = d.send({ text: 'とめる' });
    d.cancel();
    await p;
  });
  assert.deepEqual(seen, ['にかいめ']);
});

test('つながり直したら、止まった言葉が 1 回だけ送り直され、履歴に残る(main.js の流れ)', async () => {
  const c = clockRig();
  let online = false;
  let dialogue;
  const resent = [];
  const reconnector = new Reconnector({
    probe: async () => online,
    onBack: ({ pending, fresh }) => {
      if (pending && fresh && !dialogue.busy) {
        resent.push(pending.text);
        void dialogue.send({ text: pending.text, mode: 'text' });
      }
    },
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  const made = newDialogue({ onOffline: (info) => reconnector.begin(info) });
  dialogue = made.d;
  await withFetch((n) => (online ? okChat() : (() => { throw new TypeError('Failed to fetch'); })()), async (calls) => {
    await dialogue.send({ text: 'ステージはどこ' });
    assert.equal(made.log.errors.length, 1);
    await c.advance(4000);
    assert.equal(resent.length, 0, 'まだ切れている間は送り直さない');
    online = true;
    await c.advance(10_000);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(resent, ['ステージはどこ']);
    assert.equal(calls.at(-1).text, 'ステージはどこ');
    assert.equal(dialogue.history.length, 2, '通った回は履歴に残る');
    await c.advance(60_000);
    assert.equal(resent.length, 1, '1 回だけ');
  });
});

test('Dialogue: 記録の via(先に送った回・置き換えた回)が、声の回の記録に入る。ふつうの回には入らない', async () => {
  const entries = [];
  const { d } = newDialogue({ onMetric: (e) => entries.push(e), playAudio: true });
  await withFetch(() => okChat(), async () => {
    await d.send({ text: 'いち', mode: 'voice', via: 'interim' });
    await d.send({ text: 'に', mode: 'voice', via: 'replace' });
    await d.send({ text: 'さん', mode: 'voice' });
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(entries.map((e) => e.via), ['interim', 'replace', undefined]);
});

test('sanitizeMetric: via は interim・replace だけ通す(ほかの値は書かない)', () => {
  assert.equal(sanitizeMetric({ mode: 'voice', via: 'interim' }).via, 'interim');
  assert.equal(sanitizeMetric({ mode: 'voice', via: 'replace' }).via, 'replace');
  assert.equal('via' in sanitizeMetric({ mode: 'voice', via: 'evil' }), false);
  assert.equal('via' in sanitizeMetric({ mode: 'voice' }), false);
});

// ---- 描く: 引数の形と待ちの長さ ----
test('build2dArgs: 名前・出力先・性格は --名前=値 の 1 つの形(性格が「-」で始まっても引数の読み取りが失敗しない)', () => {
  const args = build2dArgs({ script: 's.py', svgPath: 'a.svg', id: 'x1', name: 'ミミ', out: 'C:\\o', trait: '-のんびり' });
  assert.deepEqual(args, ['s.py', 'a.svg', 'x1', '--name=ミミ', '--out=C:\\o', '--trait=-のんびり']);
  assert.deepEqual(build2dArgs({ script: 's.py', svgPath: 'a.svg', id: 'x1', name: 'ミミ', out: 'o' }), ['s.py', 'a.svg', 'x1', '--name=ミミ', '--out=o'], '性格が無ければ、足さない');
});

test('2D にする待ちは 300 秒(重い機械で 90 秒を超えた)', () => {
  assert.equal(TO_2D_TIMEOUT_MS, 300_000);
});

test('to_2d.py: --trait=-まる の形は、引数の読み取りを通る(別々に渡す形は通らなかった)', () => {
  const script = fileURLToPath(new URL('../../creator/review/to_2d.py', import.meta.url));
  const args = build2dArgs({ script, svgPath: 'no_such_file.svg', id: 'x1', name: 'ミミ', out: 'no_such_out_dir', trait: '-まる' });
  const r = spawnSync(process.env.PYTHON || 'python', args, { encoding: 'utf8' });
  if (r.error) {
    assert.ok(true, `python が無いので飛ばした: ${r.error.message}`);
    return;
  }
  assert.doesNotMatch(r.stderr, /expected one argument|unrecognized arguments/, '引数の読み取りで止まらない');
  assert.match(r.stdout, /No such file|ok/, '読み取りを通って、絵が無いという本来の失敗まで進む');
});

test('to_2d.py の中で箱を測る Chrome を待つ長さは、外の待ち(300 秒)より短い 240 秒(中が先に切れて、外の知らせが空振りしない)', () => {
  const src = readFileSync(new URL('../../creator/review/to_2d.py', import.meta.url), 'utf8');
  const m = src.match(/^MEASURE_TIMEOUT_S = (\d+)/m);
  assert.ok(m, 'MEASURE_TIMEOUT_S がある');
  assert.equal(Number(m[1]), 240);
  assert.ok(Number(m[1]) * 1000 < TO_2D_TIMEOUT_MS);
  assert.match(src, /timeout=MEASURE_TIMEOUT_S/);
  assert.doesNotMatch(src, /timeout=90/);
});
