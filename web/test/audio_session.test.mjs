// iPhone で声が使えなかった原因(11-08 本人の iPhone): 声を出す側が navigator.audioSession.type を 'playback' にしたままだと、
// getUserMedia({audio}) が「InvalidStateError: AudioSession category is not compatible with audio capture」で断られる。
// 直し: マイクを開く前に 'play-and-record'・聞いている間はそのまま・マイクを閉じたら 'playback'・聞いている間は声を出す側が戻さない。
// ここでは偽の audioSession で、type の切りかえの順番と getUserMedia を呼んだ時点の type を記録して確かめる。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBACK_TYPE, RECORD_TYPE, beginRecording, endRecording, ensureRecordType, isRecordingSession, resetAudioSessionState, usePlayback } from '../src/conversation/audioSession.js';
import { Listener } from '../src/conversation/listener.js';

/** 偽の audioSession: type が変わるたびに log へ 'type=…' を足す */
function fakeSession(log, initial = 'auto') {
  let type = initial;
  return {
    get type() {
      return type;
    },
    set type(v) {
      type = v;
      log.push(`type=${v}`);
    },
  };
}

test('マイクを開く前に play-and-record・閉じたら playback(順番)', () => {
  resetAudioSessionState();
  const log = [];
  const nav = { audioSession: fakeSession(log, 'playback') };
  assert.equal(beginRecording(nav), true);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  assert.equal(isRecordingSession(), true);
  assert.equal(endRecording(nav), true);
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE);
  assert.deepEqual(log, ['type=play-and-record', 'type=playback']);
  assert.equal(isRecordingSession(), false);
});

test('聞いている間は、声を出す側(usePlayback)が playback へ戻さない', () => {
  resetAudioSessionState();
  const log = [];
  const nav = { audioSession: fakeSession(log, 'playback') };
  usePlayback(nav); // マイクが無い間は、これまでどおり playback(すでに playback なので、書き直さない)
  beginRecording(nav);
  assert.equal(usePlayback(nav), false);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  endRecording(nav);
  assert.equal(usePlayback(nav), true);
  assert.deepEqual(log, ['type=play-and-record', 'type=playback']);
});

test('マイクが 2 つ重なっても、最後が閉じるまで playback へ戻さない', () => {
  resetAudioSessionState();
  const nav = { audioSession: fakeSession([], 'playback') };
  beginRecording(nav);
  beginRecording(nav);
  endRecording(nav);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  endRecording(nav);
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE);
});

test('audioSession が無い端末・書き込みを断る端末でも、何も壊さない', () => {
  resetAudioSessionState();
  assert.equal(beginRecording({}), false);
  assert.equal(endRecording({}), false);
  assert.equal(ensureRecordType({}), false);
  const strict = { audioSession: { get type() { return 'auto'; }, set type(_v) { throw new Error('ng'); } } };
  assert.equal(beginRecording(strict), false);
  assert.equal(endRecording(strict), false);
  assert.equal(isRecordingSession(), false);
});

// ---- Listener を通して、getUserMedia を呼んだ時点の type を確かめる ----

const saved = {};
const keys = ['navigator', 'window', 'AudioWorkletNode', 'fetch'];
beforeEach(() => {
  resetAudioSessionState();
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
});
afterEach(() => {
  for (const k of keys) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

function setGlobal(k, v) {
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
}

class FakeCtx {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} };
  }
  async resume() {}
  close() {}
}

/** 偽の端末を立てる。getUserMedia は、呼ばれた時点の type を log へ残す。plan[i] が Error なら i 回目は失敗 */
function setup({ plan = [null], withSession = true, recognition = true } = {}) {
  const log = [];
  const audioSession = withSession ? fakeSession(log, 'playback') : undefined;
  let calls = 0;
  const stream = { getTracks: () => [{ stop: () => log.push('track.stop') }] };
  const nav = {
    audioSession,
    mediaDevices: {
      async getUserMedia() {
        const step = plan[Math.min(calls, plan.length - 1)];
        calls += 1;
        log.push(`getUserMedia(type=${audioSession?.type})`);
        if (step) throw step;
        return stream;
      },
      async enumerateDevices() {
        return [];
      },
    },
  };
  class Rec {
    start() {
      log.push('recognition.start');
    }
    stop() {}
    abort() {}
  }
  const win = { AudioContext: FakeCtx, ...(recognition ? { webkitSpeechRecognition: Rec } : {}), addEventListener() {}, dispatchEvent() {} };
  setGlobal('navigator', nav);
  setGlobal('window', win);
  setGlobal('AudioWorkletNode', class { constructor() { this.port = {}; } disconnect() {} });
  setGlobal('fetch', async () => ({ ok: true, json: async () => ({}) }));
  return { log, nav };
}

const cbs = (extra = {}) => ({ onInterim() {}, onFinal() {}, onVoice() {}, onError() {}, ...extra });
const domErr = (name, message = '') => Object.assign(new Error(message), { name });

test('Listener: 開く前に play-and-record → getUserMedia → 聞いている間そのまま → 止めたら playback', async () => {
  const { log, nav } = setup();
  const l = new Listener(cbs(), { provider: 'web' });
  await l.start();
  assert.deepEqual(log.slice(0, 2), ['type=play-and-record', 'getUserMedia(type=play-and-record)']);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  assert.equal(usePlayback(nav), false, '聞いている間は、声を出す側が戻さない');
  l.stop();
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE);
  assert.equal(log.at(-1), 'type=playback');
  // 止めた後に、もう一度聞き始めても同じ順番
  log.length = 0;
  await l.start();
  assert.deepEqual(log.slice(0, 2), ['type=play-and-record', 'getUserMedia(type=play-and-record)']);
  l.stop();
});

test('Listener: カメラが入っていて 1 回目が InvalidStateError でも、取り直しの前に play-and-record にそろえる', async () => {
  const { log } = setup({ plan: [domErr('InvalidStateError', 'AudioSession category is not compatible with audio capture'), null] });
  let held = 0;
  let released = 0;
  const l = new Listener(cbs({ cameraOn: () => true, holdCamera: () => (held++, () => void released++) }), { provider: 'web' });
  await l.start();
  const calls = log.filter((x) => x.startsWith('getUserMedia'));
  assert.deepEqual(calls, ['getUserMedia(type=play-and-record)', 'getUserMedia(type=play-and-record)']);
  assert.equal(held, 1);
  assert.equal(released, 1, '取り直しの後は、カメラの映像を戻す');
  l.stop();
});

test('Listener: マイクが開けなかったら、playback に戻し・どの段かを名前に添えて投げる(マイクの印を残さない)', async () => {
  const { log, nav } = setup({ plan: [domErr('NotAllowedError')] });
  const l = new Listener(cbs(), { provider: 'web' });
  await assert.rejects(() => l.start(), (err) => err.name === 'NotAllowedError' && err.stage === 'mic-open');
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE);
  assert.equal(isRecordingSession(), false);
  assert.equal(log.filter((x) => x.startsWith('getUserMedia')).length, 1, '断られた時は取り直さない');
});

test('Listener: audioSession が無い端末(PC・Android)でも、そのまま聞ける', async () => {
  const { log } = setup({ withSession: false });
  const l = new Listener(cbs(), { provider: 'web' });
  await l.start();
  assert.ok(log.includes('getUserMedia(type=undefined)'));
  l.stop();
});
