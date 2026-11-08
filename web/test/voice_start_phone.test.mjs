// 声の聞き取りの始め方の頑丈さ(11-08 本人の iPhone: 「カメラオンで試してるけど会話ができないよ」):
//  - カメラが入っている間にマイクを開けなかったら、1 回だけ取り直す(許可を断られた時は取り直さない)
//  - ブラウザの聞き取りが無い・始められない・許可されない・マイクを取れない・つながらない時は、PC の聞き取りへ自動で替えて、一言そえる
//  - 止まった原因の小さな報告(名前・短い message・提供元・カメラの入・https・ブラウザの短い分類だけ。音も話した文字も UA の全文も入れない)
//  - 知らない名前の失敗の時は、画面の文の最後に名前を括弧で添える
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RETRY_WAIT_MS, canRetryMic, openMicStream } from '../src/conversation/micStream.js';
import { FALLBACK_ERRORS, isFallbackError, shouldFallToServer } from '../src/conversation/sttFallback.js';
import { browserFamily, buildVoiceEvent, sendClientEvent, reportVoice } from '../src/conversation/clientEvents.js';
import { createClientEvents, sanitizeClientEvent, MAX_BODY_BYTES } from '../server/clientEvents.mjs';
import { micFailureText, recognitionErrorText } from '../src/stage/micNotice.js';
import { Listener } from '../src/conversation/listener.js';
import { setServerSttCheck } from '../src/conversation/audioDevices.js';
import { resetAudioSessionState } from '../src/conversation/audioSession.js';

const domErr = (name, message = '') => Object.assign(new Error(message), { name });

// ---- micStream: カメラが入っている時の取り直し ----

test('マイク: カメラが入っていて失敗したら、カメラを止めて少し待ち、1 回だけ取り直して、カメラを戻す', async () => {
  const log = [];
  let n = 0;
  const gum = async () => {
    n += 1;
    log.push(`gum${n}`);
    if (n === 1) throw domErr('InvalidStateError', 'x');
    return 'stream';
  };
  const stream = await openMicStream(gum, { audio: true }, {
    cameraOn: true,
    holdCamera: () => (log.push('hold'), () => log.push('release')),
    wait: async (ms) => log.push(`wait${ms}`),
    onRetry: () => log.push('retry'),
  });
  assert.equal(stream, 'stream');
  assert.deepEqual(log, ['gum1', 'hold', 'retry', `wait${RETRY_WAIT_MS}`, 'gum2', 'release']);
});

test('マイク: 取り直しも失敗したら、2 回目の失敗を投げ、カメラは戻す(取り直しは 1 回だけ)', async () => {
  let n = 0;
  let released = 0;
  await assert.rejects(
    () => openMicStream(async () => { n += 1; throw domErr('NotReadableError'); }, {}, { cameraOn: true, holdCamera: () => () => void released++, wait: async () => {} }),
    (e) => e.name === 'NotReadableError',
  );
  assert.equal(n, 2);
  assert.equal(released, 1);
});

test('マイク: カメラが無い時・断られた時は取り直さない', async () => {
  let n = 0;
  const fail = (name) => async () => { n += 1; throw domErr(name); };
  await assert.rejects(() => openMicStream(fail('InvalidStateError'), {}, { cameraOn: false, wait: async () => {} }));
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(() => openMicStream(fail('NotAllowedError'), {}, { cameraOn: true, wait: async () => {} }));
  assert.equal(n, 1);
  assert.equal(canRetryMic(domErr('NotAllowedError')), false);
  assert.equal(canRetryMic(domErr('SecurityError')), false);
  assert.equal(canRetryMic(domErr('InvalidStateError')), true);
});

test('マイク: カメラを止められなくても(holdCamera が投げても)待って取り直す', async () => {
  let n = 0;
  const s = await openMicStream(async () => { n += 1; if (n === 1) throw domErr('AbortError'); return 's'; }, {}, { cameraOn: true, holdCamera: () => { throw new Error('ng'); }, wait: async () => {} });
  assert.equal(s, 's');
});

// ---- 聞き取りの自動の切りかえの決まり ----

test('切りかえ: ブラウザの聞き取りで動いていて PC に聞き取りがあり、名前が当たる時だけ', () => {
  for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'start-failed']) {
    assert.equal(isFallbackError(code), true, code);
    assert.equal(shouldFallToServer({ provider: 'web', errorCode: code, serverOk: true }), true, code);
  }
  assert.equal(shouldFallToServer({ provider: 'web', errorCode: 'network', serverOk: false }), false, 'PC に無ければ替えない');
  assert.equal(shouldFallToServer({ provider: 'server', errorCode: 'network', serverOk: true }), false);
  assert.equal(shouldFallToServer({ provider: 'web', errorCode: 'no-speech', serverOk: true }), false);
  assert.equal(shouldFallToServer({ provider: 'web', errorCode: 'aborted', serverOk: true }), false);
  assert.deepEqual([...FALLBACK_ERRORS].sort(), ['audio-capture', 'network', 'not-allowed', 'service-not-allowed', 'start-failed']);
});

// ---- 画面の文: 名前を括弧で添える ----

test('micFailureText: 知らない名前の失敗は、文の最後に名前を括弧で添える(英語の message は出さない)', () => {
  const t = micFailureText(domErr('InvalidStateError', 'AudioSession category is not compatible with audio capture'));
  assert.match(t, /声で話せませんでした\[InvalidStateError\]。/);
  assert.doesNotMatch(t, /AudioSession/);
  assert.equal(micFailureText(undefined).includes('['), false, '名前が無ければ括弧は付けない');
  assert.match(micFailureText(new Error('x')), /\[Error\]/);
  assert.match(micFailureText(domErr('Weird<script>Name')), /\[WeirdscriptName\]/, '使える文字だけ');
  assert.match(micFailureText(domErr('A'.repeat(80))), /\[A{24}\]/, '24 字まで');
});

test('recognitionErrorText: 何も言わなくてよい物は null・知らない名前も括弧つき', () => {
  assert.equal(recognitionErrorText('no-speech'), null);
  assert.equal(recognitionErrorText('aborted'), null);
  assert.match(recognitionErrorText('not-allowed'), /許可されていません\[not-allowed\]/);
  assert.match(recognitionErrorText('audio-capture'), /マイクの音を取れませんでした\[audio-capture\]/);
  assert.match(recognitionErrorText('network'), /ネットワーク.*\[network\]/);
  assert.match(recognitionErrorText('zzz'), /\[zzz\]/);
});

// ---- 報告(画面の側) ----

test('報告: ブラウザの短い分類だけ(UA の全文は出さない)', () => {
  const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1';
  assert.equal(browserFamily(iosChrome), 'ios-chrome');
  assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'ios-safari');
  assert.equal(browserFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'), 'android-chrome');
  assert.equal(browserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130'), 'edge');
  assert.equal(browserFamily('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36'), 'chrome');
  assert.equal(browserFamily(''), 'other');
  assert.equal(browserFamily('OculusBrowser/30 Chrome/120 Mobile VR'), 'quest');
});

test('報告: 送る欄は決まった物だけ。名前・message は長さを切り、UA・音・話した文字は入らない', () => {
  const ev = buildVoiceEvent({
    error: domErr('InvalidStateError', `AudioSession category is not compatible\nwith capture ${'x'.repeat(300)}`),
    provider: 'server',
    cameraOn: true,
    secure: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130 Mobile/15E148',
    stage: 'mic-open',
    transcript: 'ひみつの話', // 渡されても出さない
  });
  assert.deepEqual(Object.keys(ev).sort(), ['browser', 'camera', 'fellBack', 'kind', 'message', 'name', 'provider', 'secure', 'stage']);
  assert.equal(ev.name, 'InvalidStateError');
  assert.equal(ev.message.length <= 120, true);
  assert.equal(ev.message.includes('\n'), false);
  assert.equal(ev.provider, 'server');
  assert.equal(ev.camera, true);
  assert.equal(ev.secure, true);
  assert.equal(ev.browser, 'ios-chrome');
  const json = JSON.stringify(ev);
  assert.equal(json.includes('Mozilla'), false);
  assert.equal(json.includes('ひみつ'), false);
});

test('報告: 送れなくても何も起こさない・本文は JSON で POST', async () => {
  const calls = [];
  const ok = await sendClientEvent({ kind: 'voice-start-failed' }, { fetchFn: async (url, init) => (calls.push({ url, init }), { ok: true }) });
  assert.equal(ok, true);
  assert.equal(calls[0].url, '/api/client-event');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(await sendClientEvent({}, { fetchFn: async () => { throw new Error('offline'); } }), false);
  assert.equal(await sendClientEvent({}, { fetchFn: async () => ({ ok: false }) }), false);
  assert.equal(await sendClientEvent({}, { fetchFn: null }), false);
  assert.equal(typeof reportVoice, 'function');
});

// ---- 報告(手元のサーバーの側) ----

function tmpLog() {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  return { dir, file: join(dir, 'logs', 'client_events.jsonl') };
}
const good = { kind: 'voice-start-failed', name: 'InvalidStateError', message: 'AudioSession category is not compatible with audio capture', stage: 'mic-open', provider: 'web', camera: true, secure: true, browser: 'ios-chrome', fellBack: false };

test('サーバーの報告: 決まった欄だけを 1 行で記録に足す(接続元の住所・UA・余分な欄は書かない)', () => {
  const { dir, file } = tmpLog();
  try {
    const ce = createClientEvents({ file, now: () => Date.parse('2026-11-08T01:00:00Z') });
    const r = ce.accept({ ...good, ua: 'Mozilla/5.0 secret', transcript: 'ひみつ', ip: '1.2.3.4' }, '203.0.113.9');
    assert.equal(r.status, 200);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(row).sort(), ['browser', 'camera', 'date', 'fellBack', 'kind', 'message', 'name', 'provider', 'secure', 'stage']);
    assert.equal(row.date, '2026-11-08T01:00:00.000Z');
    for (const bad of ['Mozilla', 'ひみつ', '1.2.3.4', '203.0.113.9']) assert.equal(lines[0].includes(bad), false, bad);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('サーバーの報告: 形の違う本文は断る・使えない文字は落とす・鍵の形は伏せる', () => {
  assert.throws(() => sanitizeClientEvent(null));
  assert.throws(() => sanitizeClientEvent([]));
  assert.throws(() => sanitizeClientEvent({ kind: 'other' }));
  const fakeKey = ['sk', 'ant', 'api03', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].join('-'); // 鍵の形は、その場で組み立てる(点検に引っかからないように)
  const s = sanitizeClientEvent({ ...good, name: 'In<b>valid\nState', browser: 'my-own-browser', provider: 'x', message: `${fakeKey} ng` });
  assert.equal(s.name, 'InbvalidState');
  assert.equal(s.browser, 'other');
  assert.equal(s.provider, 'web');
  assert.equal(s.message.includes('sk-ant'), false);
});

test('サーバーの報告: 1 分の回数・記録の大きさに上限がある(超えたら 429 / 書かない)', () => {
  const { dir, file } = tmpLog();
  try {
    let t = 1_000_000;
    const ce = createClientEvents({ file, now: () => t, perMinute: 3 });
    for (let i = 0; i < 3; i++) assert.equal(ce.accept(good, 'a').status, 200);
    assert.equal(ce.accept(good, 'a').status, 429);
    assert.equal(ce.accept(good, 'b').status, 200, '別の接続元は別に数える');
    t += 61_000;
    assert.equal(ce.accept(good, 'a').status, 200, '1 分たてば受ける');
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 5);
    // 記録が上限に達したら、書かずに ok を返す
    const full = createClientEvents({ file, now: () => t, maxLogBytes: 10 });
    const r = full.accept(good, 'c');
    assert.equal(r.status, 200);
    assert.equal(r.json.kept, false);
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(MAX_BODY_BYTES <= 4096, true);
});

test('サーバーの報告: 記録の場所が書けなくても、画面には何も起こさない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  try {
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'x');
    const ce = createClientEvents({ file: join(blocker, 'sub', 'a.jsonl') }); // 親がファイルなので作れない
    const r = ce.accept(good, 'a');
    assert.equal(r.status, 200);
    assert.equal(r.json.kept, false);
    assert.equal(existsSync(join(dir, 'file', 'sub')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Listener: 自動の切りかえ ----

const saved = {};
const keys = ['navigator', 'window', 'AudioWorkletNode', 'fetch'];
beforeEach(() => {
  resetAudioSessionState();
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
});
afterEach(() => {
  setServerSttCheck(() => false);
  for (const k of keys) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});
const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

class FakeCtx {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
  }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} }; }
  async resume() {}
  close() {}
}

function setupBrowser({ recognition = 'ok' } = {}) {
  const made = [];
  class Rec {
    constructor() { made.push(this); this.aborted = false; }
    start() { if (recognition === 'throws') throw new Error('start ng'); }
    stop() {}
    abort() { this.aborted = true; }
  }
  const stream = { getTracks: () => [{ stop() {} }] };
  setGlobal('navigator', { mediaDevices: { async getUserMedia() { return stream; }, async enumerateDevices() { return []; } } });
  setGlobal('window', { AudioContext: FakeCtx, ...(recognition === 'missing' ? {} : { webkitSpeechRecognition: Rec }), addEventListener() {}, dispatchEvent() {} });
  setGlobal('AudioWorkletNode', class { constructor() { this.port = {}; } disconnect() {} });
  const fetched = [];
  setGlobal('fetch', async (url) => (fetched.push(url), { ok: true, json: async () => ({}) }));
  return { made, fetched };
}

function listenerWith(extra = {}) {
  const events = { notices: [], errors: [], reports: [], providers: [], stopped: 0 };
  const l = new Listener({
    onInterim() {}, onFinal() {}, onVoice() {},
    onError: (m) => events.errors.push(m),
    onNotice: (m) => events.notices.push(m),
    onProvider: (p) => events.providers.push(p),
    onStopped: () => { events.stopped += 1; },
    report: (e) => events.reports.push(e),
    ...extra,
  }, { provider: 'web' });
  return { l, events };
}

for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network']) {
  test(`Listener: ブラウザの聞き取りが ${code} で止まったら、PC に聞き取りがあれば自動で PC の聞き取りへ替えて一言そえる`, async () => {
    setServerSttCheck(() => true);
    const { made, fetched } = setupBrowser();
    const { l, events } = listenerWith();
    await l.start();
    assert.equal(l.provider, 'web');
    made[0].onerror({ error: code });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(l.provider, 'server');
    assert.equal(l.listening, true, '聞き続ける');
    assert.deepEqual(events.providers, ['server']);
    assert.equal(events.notices.length, 1);
    assert.match(events.notices[0], /PC の聞き取り/);
    assert.equal(events.errors.length, 0);
    assert.equal(events.reports[0].kind, 'voice-fallback');
    assert.equal(events.reports[0].error.name, code);
    assert.equal(events.reports[0].fellBack, true);
    assert.ok(fetched.includes('/api/stt/warm'));
    assert.equal(made[0].aborted, true, 'ブラウザの聞き取りは、作り直さずに閉じる');
    l.stop();
  });
}

test('Listener: PC に聞き取りが無い時は、やさしい一言を出して止まる(同じ失敗を繰り返さない)', async () => {
  setServerSttCheck(() => false);
  const { made } = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  made[0].onerror({ error: 'not-allowed' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(l.listening, false);
  assert.equal(events.stopped, 1);
  assert.equal(events.errors.length, 1);
  assert.match(events.errors[0], /許可されていません\[not-allowed\]/);
  assert.equal(events.reports[0].kind, 'voice-start-failed');
  assert.equal(events.reports[0].fellBack, false);
  assert.equal(made.length, 1, '作り直さない');
});

test('Listener: 聞き取りの始めで例外が出ても(start-failed)、PC の聞き取りがあれば替える', async () => {
  setServerSttCheck(() => true);
  setupBrowser({ recognition: 'throws' });
  const { l, events } = listenerWith();
  await l.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(l.provider, 'server');
  assert.equal(events.reports[0].error.name, 'start-failed');
  l.stop();
});

test('Listener: ブラウザに聞き取りが無い時は、PC に聞き取りがあれば最初から PC の聞き取りで聞いて一言そえる・無ければ従来どおり投げる', async () => {
  setServerSttCheck(() => true);
  setupBrowser({ recognition: 'missing' });
  const a = listenerWith();
  await a.l.start();
  assert.equal(a.l.provider, 'server');
  assert.match(a.events.notices[0], /PC の聞き取り/);
  a.l.stop();
  setServerSttCheck(() => false);
  const b = listenerWith();
  await assert.rejects(() => b.l.start(), /対応していません/);
});

test('Listener: no-speech と aborted は、何もしない(聞き続ける)', async () => {
  setServerSttCheck(() => true);
  const { made } = setupBrowser();
  const { l, events } = listenerWith();
  await l.start();
  made[0].onerror({ error: 'no-speech' });
  made[0].onerror({ error: 'aborted' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(l.provider, 'web');
  assert.equal(events.errors.length, 0);
  assert.equal(events.reports.length, 0);
  l.stop();
});
