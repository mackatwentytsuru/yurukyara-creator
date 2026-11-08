// B13V(ハンズフリー): 「ハンズフリーでずっと会話ができる状態でないと最終的にはダメ」(11-08 本人)。
//  - ブラウザの聞き取りが end・no-speech・network で止まっても、自分で始め直す(2 本にならない・古い知らせは捨てる)
//  - 隠れている間は始めず、ページが前に戻った時に始める(マイクの流れが閉じていたら取り直す・取り直しは無限に繰り返さない)
//  - QA8 ③: 許可の窓が開いている間に「はなす」を 2 回押しても、マイクが開いたままにならない(listener.js)
//  - iPhone: 'play-and-record' を取った後・前に戻った時にそろえ直す。閉じたら 'playback'
// 偽のブラウザ(聞き取り・マイク・音の場)で、呼ばれた順と数を確かめる。実機の iPhone は試せていない(カードに書く)。
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Listener } from '../src/conversation/listener.js';
import { setServerSttCheck } from '../src/conversation/audioDevices.js';
import { PLAYBACK_TYPE, RECORD_TYPE, beginRecording, endRecording, getMicWithSession, isRecordingSession, reassertRecording, resetAudioSessionState } from '../src/conversation/audioSession.js';

const saved = {};
const keys = ['navigator', 'window', 'document', 'AudioWorkletNode', 'fetch'];
beforeEach(() => {
  resetAudioSessionState();
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
});
afterEach(() => {
  mock.timers.reset();
  setServerSttCheck(() => false);
  for (const k of keys) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});
const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeCtx {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
  }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} }; }
  async resume() { this.state = 'running'; }
  close() { this.state = 'closed'; }
}

/** 偽のブラウザ。gum: 'ok' | 'pending'(resolveGum で答える)。track.readyState は stream.end() で 'ended' にできる */
function setupBrowser({ gum = 'ok', visibility = 'visible' } = {}) {
  const made = [];
  class Rec {
    constructor() { made.push(this); this.aborted = false; this.stopped = false; }
    start() {}
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  const streams = [];
  const makeStream = () => {
    const handlers = {};
    const track = { readyState: 'live', stopped: 0, stop() { this.stopped += 1; }, addEventListener(n, f) { handlers[n] = f; } };
    const s = { getTracks: () => [track], track, end() { track.readyState = 'ended'; handlers.ended?.(); } };
    streams.push(s);
    return s;
  };
  let gumCalls = 0;
  const pending = [];
  setGlobal('navigator', {
    mediaDevices: {
      getUserMedia() {
        gumCalls += 1;
        if (gum === 'pending') return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(makeStream()), reject }));
        return Promise.resolve(makeStream());
      },
      async enumerateDevices() { return []; },
    },
  });
  const winListeners = {};
  setGlobal('window', { AudioContext: FakeCtx, webkitSpeechRecognition: Rec, addEventListener(n, f) { (winListeners[n] ??= new Set()).add(f); }, removeEventListener(n, f) { winListeners[n]?.delete(f); }, dispatchEvent() {} });
  const docListeners = {};
  const doc = {
    visibilityState: visibility,
    addEventListener(n, f) { (docListeners[n] ??= new Set()).add(f); },
    removeEventListener(n, f) { docListeners[n]?.delete(f); },
  };
  setGlobal('document', doc);
  setGlobal('AudioWorkletNode', class { constructor() { this.port = {}; } disconnect() {} });
  setGlobal('fetch', async () => ({ ok: true, json: async () => ({}) }));
  return {
    made,
    streams,
    pending,
    doc,
    gumCalls: () => gumCalls,
    show: async () => { doc.visibilityState = 'visible'; for (const f of [...(docListeners.visibilitychange ?? [])]) f(); await tick(5); },
    hide: () => { doc.visibilityState = 'hidden'; },
    docListenerCount: () => docListeners.visibilitychange?.size ?? 0,
    winListenerCount: () => winListeners.pageshow?.size ?? 0,
  };
}

function listenerWith(extra = {}) {
  const events = { notices: [], errors: [], stopped: 0, revived: 0 };
  const l = new Listener({
    onInterim() {}, onFinal() {}, onVoice() {},
    onError: (m) => events.errors.push(m),
    onNotice: (m) => events.notices.push(m),
    onStopped: () => { events.stopped += 1; },
    onRevived: () => { events.revived += 1; },
    ...extra,
  }, { provider: 'web' });
  return { l, events };
}

// ---- ブラウザの聞き取りの自動の始め直し ----

test('end: 聞き取りが終わったら 0.2 秒後に自分で始め直す(2 本にならない・終わった物の知らせは捨てる)', async () => {
  const env = setupBrowser();
  const { l } = listenerWith();
  await l.start();
  assert.equal(env.made.length, 1);
  const first = env.made[0];
  first.onend();
  first.onend(); // 同じ物の終わりが 2 回届いても、予約は 1 つ
  await tick(260);
  assert.equal(env.made.length, 2, '始め直した(1 本だけ)');
  first.onend?.(); // 古い物の知らせ(外れている)
  first.onresult?.({ resultIndex: 0, results: [] });
  await tick(260);
  assert.equal(env.made.length, 2, '古い物の終わりで増えない');
  l.stop();
});

test('no-speech と end が続いても、何も言わず(エラー・停止なし)聞き続ける', async () => {
  const env = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  for (let i = 0; i < 3; i++) {
    const rec = env.made.at(-1);
    rec.onerror({ error: 'no-speech' });
    rec.onend();
    await tick(i < 1 ? 260 : 900); // 始めてすぐ終わるのが続くと、待ちが少しずつ延びる
  }
  assert.ok(env.made.length >= 3, `始め直し続けた(${env.made.length})`);
  assert.equal(l.listening, true);
  assert.equal(events.errors.length, 0);
  assert.equal(events.stopped, 0);
  l.stop();
});

test('始めてすぐ終わるのが続く時は、待ちを延ばす(0.2 秒ごとの連打にならない)', async () => {
  const env = setupBrowser();
  const { l } = listenerWith();
  await l.start();
  for (let i = 0; i < 6; i++) env.made.at(-1).onend?.() ?? 0;
  mock.timers.enable({ apis: ['setTimeout'] });
  // 実時間は進まない = 毎回「すぐ終わった」。上限(3 秒)までに、始め直しの数が抑えられる
  const before = env.made.length;
  for (let i = 0; i < 6; i++) {
    env.made.at(-1).onend?.();
    mock.timers.tick(250);
  }
  assert.ok(env.made.length - before <= 4, `連打にならない(${env.made.length - before})`);
  mock.timers.reset();
  l.stop();
});

test('network: PC の聞き取りが無い時は、3 回まで少し待ってつなぎ直す(知らせは 1 回)・4 回続いたら止めて知らせる', async () => {
  setServerSttCheck(() => false);
  const env = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 1; n <= 3; n++) {
    const rec = env.made.at(-1);
    rec.onerror({ error: 'network' });
    rec.onend();
    mock.timers.tick(800 * n + 50);
    assert.equal(l.listening, true, `${n} 回目では止まらない`);
  }
  assert.equal(env.made.length, 4, '3 回つなぎ直した');
  assert.equal(events.notices.filter((t) => /つなぎ直し/.test(t)).length, 1, '一言は 1 回だけ');
  env.made.at(-1).onerror({ error: 'network' });
  await Promise.resolve();
  assert.equal(l.listening, false, '4 回続いたら止める');
  assert.equal(events.stopped, 1);
  assert.match(events.errors[0], /ネットワーク/);
});

test('network: 何か届いたら、失敗の数えは 0 に戻る', async () => {
  setServerSttCheck(() => false);
  const env = setupBrowser();
  const { l } = listenerWith();
  await l.start();
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let round = 0; round < 3; round++) {
    for (let n = 1; n <= 3; n++) {
      const rec = env.made.at(-1);
      rec.onerror({ error: 'network' });
      rec.onend();
      mock.timers.tick(800 * n + 50);
    }
    env.made.at(-1).onresult({ resultIndex: 0, results: [] }); // つながった
  }
  assert.equal(l.listening, true);
  l.stop();
});

// ---- ページが前に戻った時 ----

test('隠れている間は始め直さず、前に戻った時に 1 本だけ始める', async () => {
  const env = setupBrowser();
  const { l } = listenerWith();
  await l.start();
  env.hide();
  env.made[0].onend();
  await tick(300);
  assert.equal(env.made.length, 1, '隠れている間は始めない');
  await env.show();
  assert.equal(env.made.length, 2, '戻ったら始める');
  await env.show(); // 戻りの知らせが重なっても、動いていれば増やさない
  assert.equal(env.made.length, 2);
  l.stop();
});

test('前に戻った時: マイクの流れが閉じられていたら、取り直して聞き続ける(一言そえる)', async () => {
  const env = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  env.hide();
  env.streams[0].end(); // iPhone が裏でマイクを閉じた
  await tick(5);
  assert.equal(env.gumCalls(), 1, '隠れている間は取り直さない');
  await env.show();
  await tick(20);
  assert.equal(env.gumCalls(), 2, '戻ったら取り直す');
  assert.equal(l.listening, true);
  assert.ok(events.notices.some((t) => /マイクを取り直した/.test(t)));
  assert.equal(env.docListenerCount(), 1, '見張りは 1 つだけ(取り直しで増えない)');
  assert.equal(env.streams[0].track.stopped >= 1, true, '古い流れは閉じた');
  l.stop();
  assert.equal(env.docListenerCount(), 0, 'stop で見張りも外す');
  assert.equal(env.winListenerCount(), 0);
});

test('見ている前でマイクが閉じられた(ended)時も、取り直す', async () => {
  const env = setupBrowser();
  const { l } = listenerWith();
  await l.start();
  env.streams[0].end();
  await tick(20);
  assert.equal(env.gumCalls(), 2);
  assert.equal(l.listening, true);
  l.stop();
});

test('取り直しが 30 秒に 3 回を超えたら、繰り返さず止めて知らせる', async () => {
  const env = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  for (let i = 0; i < 3; i++) {
    env.streams.at(-1).end();
    await tick(20);
    assert.equal(l.listening, true, `${i + 1} 回目は取り直す`);
  }
  env.streams.at(-1).end();
  await tick(20);
  assert.equal(l.listening, false);
  assert.equal(events.stopped, 1);
  assert.equal(events.errors.length, 1);
  assert.equal(isRecordingSession(), false, '止めたらマイクの数えも 0');
});

test('戻った時: 止まっていた AudioContext を動かす', async () => {
  const env = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  l.ctx.state = 'suspended';
  await env.show();
  assert.equal(l.ctx.state, 'running');
  assert.ok(events.revived >= 1);
  l.stop();
});

// ---- QA8 ③: 許可の窓が開いている間の 2 回押し ----

test('QA8 ③: 許可の窓が開いている間に stop() (2 回目のタップ)→ 答えが来てもマイクは開いたままにならない', async () => {
  const env = setupBrowser({ gum: 'pending' });
  const { l, events } = listenerWith();
  const p = l.start();
  await tick(5);
  assert.equal(l.starting, true, '聞き始めの最中');
  assert.equal(isRecordingSession(), true);
  l.stop(); // 2 回目のタップ
  assert.equal(l.starting, true);
  env.pending[0].resolve(); // 許可された
  await p;
  assert.equal(l.starting, false);
  assert.equal(l.listening, false);
  assert.equal(env.streams[0].track.stopped, 1, '取れたマイクはすぐ閉じた');
  assert.equal(l.ctx, undefined, '音の場も作らない');
  assert.equal(isRecordingSession(), false, '音の使い方の数えも戻る');
  assert.equal(events.errors.length, 0);
  assert.equal(env.docListenerCount(), 0);
});

test('QA8 ③: 窓が開いている間に stop() して、許可を断られても、エラーにしない(誰も待っていない)', async () => {
  const env = setupBrowser({ gum: 'pending' });
  const { l, events } = listenerWith();
  const p = l.start();
  await tick(5);
  l.stop();
  env.pending[0].reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
  await p; // 投げない
  assert.equal(l.listening, false);
  assert.equal(events.errors.length, 0);
  assert.equal(isRecordingSession(), false);
});

test('start() を続けて 2 回呼んでも、マイクは 1 回だけ取る(同じ約束を返す)', async () => {
  const env = setupBrowser({ gum: 'pending' });
  const { l } = listenerWith();
  const a = l.start();
  const b = l.start();
  assert.equal(a, b);
  await tick(5);
  assert.equal(env.gumCalls(), 1);
  env.pending[0].resolve();
  await a;
  assert.equal(l.listening, true);
  await l.start(); // 聞いている時は何もしない
  assert.equal(env.gumCalls(), 1);
  l.stop();
  l.stop(); // 2 回止めても安全
  assert.equal(isRecordingSession(), false);
});

// ---- iPhone: 音の使い方 ----

/** 偽の audioSession(type・state・statechange) */
function fakeSession(log, initial = 'auto') {
  let type = initial;
  const handlers = [];
  return {
    state: 'active',
    get type() { return type; },
    set type(v) { type = v; log.push(`type=${v}`); },
    addEventListener(n, f) { if (n === 'statechange') handlers.push(f); },
    fire() { for (const f of handlers) f(); },
  };
}

test('iPhone: マイクを取る前は play-and-record・取り直し(auto)の後は端末に任せたまま(w/phonefix の決まりを変えない)・閉じたら playback', async () => {
  const log = [];
  const nav = { audioSession: fakeSession(log, 'playback') };
  beginRecording(nav);
  let n = 0;
  const stream = await getMicWithSession(async () => {
    n += 1;
    log.push('gum' + n + '@' + nav.audioSession.type);
    if (n === 1) throw Object.assign(new Error('x'), { name: 'InvalidStateError' });
    return 'stream';
  }, {}, nav);
  assert.equal(stream, 'stream');
  assert.deepEqual(log, ['type=play-and-record', 'gum1@play-and-record', 'type=auto', 'gum2@auto']);
  assert.equal(reassertRecording(nav), false, 'auto は端末に任せた状態。戻り時にも触らない');
  assert.equal(endRecording(nav), true);
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE, '閉じたら playback に戻す');
});

test('iPhone: 中断から戻った時(statechange)・前に戻った時に、playback になっていたら play-and-record に戻す', () => {
  const log = [];
  const nav = { audioSession: fakeSession(log, 'auto') };
  beginRecording(nav);
  nav.audioSession.type = PLAYBACK_TYPE; // 何かが戻してしまった
  nav.audioSession.fire();
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  nav.audioSession.type = PLAYBACK_TYPE;
  assert.equal(reassertRecording(nav), true);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  nav.audioSession.type = 'auto'; // 端末に任せた状態は、そのまま
  assert.equal(reassertRecording(nav), false);
  assert.equal(nav.audioSession.type, 'auto');
  endRecording(nav);
  assert.equal(reassertRecording(nav), false, '聞いていない時は何もしない');
  nav.audioSession.fire();
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE, '聞いていない時の中断では、種類を変えない');
});

test('iPhone: audioSession が無い端末では、何も起こらない', () => {
  assert.equal(reassertRecording({}), false);
  assert.equal(beginRecording({}), false);
  assert.equal(endRecording({}), false);
});
