// LF4(11-08): 返事の最初の音の前に、言い直し・割り込みで止められた回を、1 行だけ記録に残す試験。
// 止められた回は、いちばん待たせた回のことがある(今までは記録から消えていた)。ふだんの数字(valid)には混ぜない。
// 本物の頭脳・声のサービスは呼ばない(偽の物だけ)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dialogue } from '../src/conversation/dialogue.js';
import { sanitizeMetric } from '../server/validate.mjs';

function newDialogue({ onMetric = () => {}, onInterrupted, playAudio = false } = {}) {
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
  return new Dialogue({
    character: { expressions: ['neutral'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false },
    speaker,
    ui: { thought() {}, say() {}, userSaid() {}, caption() {}, error() {}, notice() {} },
    getContext: () => ({ scene: '', character: { name: 'ノリー', persona: '' }, place: {} }),
    setGaze: () => null,
    onMetric,
    onInterrupted,
  });
}

const okChat = () =>
  new Response(JSON.stringify({ brain: 'mock', events: [{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }], ms: 1 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** 返事がなかなか来ない偽の通信(止められたら AbortError で終わる) */
const hangingFetch = (init) =>
  new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('', 'AbortError'))));

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => handler(init);
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('言い直し: 返事の前に次の言葉を送ると、前の回が interrupted の印つきで 1 行だけ残る(onMetric には出ない)', async () => {
  const interrupted = [];
  const metrics = [];
  const d = newDialogue({ onInterrupted: (e) => interrupted.push(e), onMetric: (e) => metrics.push(e) });
  let n = 0;
  await withFetch((init) => (++n === 1 ? hangingFetch(init) : okChat()), async () => {
    const t0 = performance.now() - 2500; // 話し終わってから 2.5 秒たっている
    const first = d.send({ text: 'いち', mode: 'voice', t0, via: 'interim' });
    await new Promise((r) => setTimeout(r, 20));
    await d.send({ text: 'に', mode: 'voice' }); // 言い直し
    await first;
  });
  assert.equal(interrupted.length, 1);
  const e = interrupted[0];
  assert.equal(e.interrupted, true);
  assert.equal(e.valid, false);
  assert.equal(e.mode, 'voice');
  assert.equal(e.via, 'interim');
  assert.ok(e.waitedMs >= 2500 && e.waitedMs < 5000, `待たせた長さ ${e.waitedMs}`);
  assert.equal(e.totalMs, null, '最初の音は出ていない');
  assert.ok(!metrics.some((m) => m.interrupted), 'ふだんの記録(onMetric)には混ぜない');
});

test('割り込み(cancel): 返事が来ている途中で止めても 1 回だけ残る。続けて cancel しても増えない', async () => {
  const interrupted = [];
  const d = newDialogue({ onInterrupted: (e) => interrupted.push(e) });
  await withFetch((init) => hangingFetch(init), async () => {
    const p = d.send({ text: 'あ', mode: 'text' });
    await new Promise((r) => setTimeout(r, 10));
    d.cancel();
    d.cancel();
    await p;
  });
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].mode, 'text');
});

test('残さない回: 声かけ(approach)・通信の失敗・何も送っていない cancel・最後まで返事が出た回', async () => {
  const interrupted = [];
  const metrics = [];
  const d = newDialogue({ onInterrupted: (e) => interrupted.push(e), onMetric: (e) => metrics.push(e), playAudio: true });
  d.cancel(); // 何も送っていない
  await withFetch((init) => hangingFetch(init), async () => {
    const p = d.send({ text: '', trigger: 'approach' });
    await new Promise((r) => setTimeout(r, 10));
    d.cancel(); // 近づいた合図の回
    await p;
  });
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    await d.send({ text: 'つながらない' });
  });
  d.cancel(); // 失敗した回のあと
  await withFetch(() => okChat(), async () => {
    await d.send({ text: 'こんにちは', mode: 'voice' });
    await new Promise((r) => setTimeout(r, 80));
  });
  d.cancel(); // 返事が出たあと
  assert.deepEqual(interrupted, []);
  assert.equal(metrics.length, 1, '最後まで出た回は、いつもどおり onMetric に 1 回');
});

test('sanitizeMetric: interrupted は印と待たせた長さだけを受け、valid は必ず false。ふつうの回は変わらない', () => {
  const e = sanitizeMetric({ mode: 'voice', brain: 'haiku', tts: 'eleven', valid: true, interrupted: true, waitedMs: 3210.4, totalMs: null });
  assert.equal(e.interrupted, true);
  assert.equal(e.valid, false);
  assert.equal(e.waitedMs, 3210);
  assert.equal(sanitizeMetric({ interrupted: true, waitedMs: -5 }).waitedMs, null);
  assert.equal(sanitizeMetric({ interrupted: true, waitedMs: 'x' }).waitedMs, null);
  const plain = sanitizeMetric({ mode: 'voice', brain: 'haiku', tts: 'eleven', valid: true, totalMs: 1200 });
  assert.equal(plain.valid, true);
  assert.ok(!('interrupted' in plain) && !('waitedMs' in plain));
  assert.ok(!('interrupted' in sanitizeMetric({ interrupted: 'yes', waitedMs: 5 })));
});
