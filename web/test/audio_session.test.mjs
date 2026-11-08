// iPhone で声が使えなかった原因(11-08 本人の iPhone): 声を出す側が navigator.audioSession.type を 'playback' にしたままだと、
// getUserMedia({audio}) が「InvalidStateError: AudioSession category is not compatible with audio capture」で断られる。
// 直し: マイクを開く前に 'play-and-record'・聞いている間はそのまま・マイクを閉じたら 'playback'・聞いている間は声を出す側が戻さない。
// ここでは偽の audioSession で、type の切りかえの順番と getUserMedia を呼んだ時点の type を記録して確かめる。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYBACK_TYPE, RECORD_TYPE, beginRecording, createRecordingHold, endRecording, ensureRecordType, getMicWithSession, isRecordingSession, resetAudioSessionState, usePlayback } from '../src/conversation/audioSession.js';
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

test('Listener: play-and-record でも InvalidStateError なら、auto にして 1 回だけ取り直す(カメラ無し)', async () => {
  const { log, nav } = setup({ plan: [domErr('InvalidStateError', 'AudioSession category is not compatible with audio capture'), null] });
  const l = new Listener(cbs(), { provider: 'web' });
  await l.start();
  assert.deepEqual(log.filter((x) => x.startsWith('getUserMedia')), ['getUserMedia(type=play-and-record)', 'getUserMedia(type=auto)']);
  assert.equal(nav.audioSession.type, 'auto', '聞いている間は、声を出す側が playback へ戻さない');
  assert.equal(usePlayback(nav), false);
  l.stop();
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE, '閉じたら playback へ戻す');
});

test('Listener: カメラが入っていて 2 回とも InvalidStateError なら、カメラの映像を止めた取り直しでも play-and-record にそろえる', async () => {
  const bad = domErr('InvalidStateError', 'AudioSession category is not compatible with audio capture');
  const { log } = setup({ plan: [bad, bad, null] });
  let held = 0;
  let released = 0;
  const l = new Listener(cbs({ cameraOn: () => true, holdCamera: () => (held++, () => void released++) }), { provider: 'web' });
  await l.start();
  const calls = log.filter((x) => x.startsWith('getUserMedia'));
  assert.deepEqual(calls, ['getUserMedia(type=play-and-record)', 'getUserMedia(type=auto)', 'getUserMedia(type=play-and-record)']);
  assert.equal(held, 1);
  assert.equal(released, 1, '取り直しの後は、カメラの映像を戻す');
  l.stop();
});

test('getMicWithSession: InvalidStateError 以外の失敗は、auto にせずそのまま投げる(断られた時は取り直さない)', async () => {
  const log = [];
  const nav = { audioSession: fakeSession(log, 'playback') };
  let calls = 0;
  await assert.rejects(() => getMicWithSession(async () => { calls += 1; throw domErr('NotAllowedError'); }, { audio: true }, nav), /./);
  assert.equal(calls, 1);
  assert.deepEqual(log, ['type=play-and-record']);
  // audioSession が無い端末は、InvalidStateError でも取り直さない
  calls = 0;
  await assert.rejects(() => getMicWithSession(async () => { calls += 1; throw domErr('InvalidStateError'); }, { audio: true }, {}), /./);
  assert.equal(calls, 1);
});

test('createRecordingHold: begin を何度呼んでも数えは 1・end は持っている時だけ(メーターを開き直しても数えが狂わない)', () => {
  resetAudioSessionState();
  const log = [];
  const nav = { audioSession: fakeSession(log, 'playback') };
  const hold = createRecordingHold(nav);
  hold.end(); // 持っていない時は何もしない
  assert.deepEqual(log, []);
  hold.begin();
  hold.begin();
  assert.equal(hold.held, true);
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  // 会話のマイクと同時: 先にメーターが閉じても、会話のマイクが開いている間は playback へ戻さない
  beginRecording(nav);
  hold.end();
  assert.equal(nav.audioSession.type, RECORD_TYPE);
  endRecording(nav);
  assert.equal(nav.audioSession.type, PLAYBACK_TYPE);
  hold.end();
  assert.equal(isRecordingSession(), false);
});

test('歯車の窓(audioPanel)は、getUserMedia を音の使い方の切りかえ(getMicWithSession)を通してだけ呼ぶ', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'audioPanel.js'), 'utf8');
  const raw = src.match(/getUserMedia\(/g) ?? [];
  assert.equal(raw.length, 1, '生の getUserMedia は openMic の中の 1 か所だけ');
  assert.match(src, /const openMic = \(audio\) => getMicWithSession\(\(c\) => navigator\.mediaDevices\.getUserMedia\(c\), \{ audio \}\)/);
  assert.match(src, /meterHold\.begin\(\)|meterBegin\(\)/);
  assert.match(src, /allowBtn\.addEventListener\('click'[\s\S]*?beginRecording\(\)[\s\S]*?openMic\(true\)[\s\S]*?finally \{\s*endRecording\(\)/);
});

test('main.js: 報告は手元のサーバーがある時だけ・触る端末ではステレオのマイクを始めない', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'main.js'), 'utf8');
  assert.equal((src.match(/\breportVoice\(/g) ?? []).length, 1, '報告の呼び出しは、門(reportVoiceLocal)の中の 1 か所だけ');
  assert.match(src, /function reportVoiceLocal\(fields\) \{\s*if \(!app\.status\) return;\s*void reportVoice\(fields\);/);
  assert.match(src, /if \(!IS_HEADSET && !TOUCH\) void startStereoMic\(\);/);
});

test('同じ判定・同じ一覧を 1 か所にそろえた(拡大の判定・ブラウザの分類)', async () => {
  const { isZoomed } = await import('../src/ui/keyboardInset.js');
  const { isPinchZoomed } = await import('../src/ui/noPinchZoom.js');
  assert.equal(isPinchZoomed, isZoomed);
  const server = await import('../server/clientEvents.mjs');
  const { BROWSER_FAMILIES } = await import('../src/conversation/clientEvents.js');
  assert.equal(server.BROWSERS, BROWSER_FAMILIES);
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
