// BCV: stage/cameraUse.js(入・切・絵を送る条件・勝手に止まった時)を、ブラウザなしの小さな偽の部品で確かめる。
// - 選んでいない(入口で人が押していない・知らせで入れていない)カメラでは、絵を送らない。自動で始める画面の click() は「選んだ」にならない
// - 入れる: 新しい顔の追従を先に動かし、動いてから前の入力を止める。失敗したら今の入力のまま・途中まで読んだ部品を捨てる
// - 切る: カメラなしの入力を動かしてから、カメラの流れを止める。勝手に止まった時も、切った形にそろえて知らせる
// - 近づいた合図の回は送らない。仮の頭脳の知らせは 1 回だけ
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(id) {
    this.id = id;
    this.hidden = true;
    this.listeners = {};
    this.attrs = {};
    this.textContent = '';
    this.disabled = false;
    this.kids = {};
    const set = new Set();
    this.classList = { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener() {}
  async fire(type, ev = {}) {
    for (const fn of this.listeners[type] ?? []) await fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev });
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  querySelector(sel) {
    return this.kids[sel] ?? null;
  }
  focus() {}
}

/** 偽のカメラの流れ(track の ended を外から起こせる) */
function fakeStream() {
  const track = new FakeEl('track');
  track.readyState = 'live';
  track.stop = () => (track.readyState = 'ended');
  return { track, stream: { getVideoTracks: () => [track], getTracks: () => [track] } };
}

function setup({ failStart = false, params = '' } = {}) {
  const els = {};
  for (const id of ['camBtn', 'tvCam', 'camAsk', 'startCam', 'startSim', 'stage']) els[id] = new FakeEl(id);
  for (const id of ['camAskText', 'camAskMock', 'camAskYes', 'camAskNo', 'camAskStatus', 'camAskBack']) els.camAsk.kids[`#${id}`] = new FakeEl(id);
  els.camBtn.kids['.cam-label'] = new FakeEl('label');
  globalThis.document = { documentElement: new FakeEl('html'), createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, clearRect() {} }), toDataURL: () => 'data:image/jpeg;base64,QUJDRA==' }) };
  globalThis.window = { isSecureContext: true, addEventListener() {}, removeEventListener() {} }; // カメラなしの入力(SimSource)が窓の pointermove を聞く
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia() {} }, configurable: true }); // カメラの口がある端末のまね
  const log = [];
  const sim = { kind: 'sim', stop: () => log.push('sim-stop') };
  const app = { mode: 'sim', source: sim };
  const notices = [];
  const dialogue = { onEvent: (ev) => log.push(`event:${ev.type}`) };
  let stream = null;
  class FakeMediapipe {
    constructor() {
      this.kind = 'mediapipe';
      this.tracker = {
        start: async (opts = {}) => {
          log.push(`face-start:${opts.facingMode ?? 'user'}`);
          if (failStart) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
          stream = fakeStream();
          this.tracker.stream = stream.stream;
        },
      };
      this.video = { readyState: 4, videoWidth: 640, videoHeight: 480 };
    }
    async start() {
      await this.tracker.start();
    }
    stop() {
      log.push('face-stop');
      stream?.track.stop();
    }
  }
  return import(`../src/stage/cameraUse.js?${Math.random()}`).then(({ createCameraUse, CAMERA_ENDED }) => {
    const use = createCameraUse({
      app,
      ui: { notice: (t) => notices.push(t) },
      dialogue,
      $: (id) => els[id] ?? null,
      params: new URLSearchParams(params),
      headset: false,
      touch: true,
      sourceOptions: () => ({ getFrame: () => ({}), gain: 2, hfovDeg: 65 }),
      inXr: () => false,
      updatePrivacy: () => use.sync(),
      isMock: () => true,
      loadFace: async () => ({ MediapipeSource: FakeMediapipe }),
    });
    use.setup();
    return { use, app, els, log, notices, dialogue, CAMERA_ENDED, getStream: () => stream };
  });
}

test('cameraUse: 選んでいないカメラでは絵を送らない。入口の人の押しで「選んだ」、自動の click() では選ばない', async () => {
  const t = await setup();
  t.app.mode = 'camera';
  t.app.source = { kind: 'mediapipe', video: { readyState: 4, videoWidth: 640, videoHeight: 480 } };
  assert.equal(t.dialogue.getImage({}), null, '選んでいない');
  await t.els.startCam.fire('click', { isTrusted: false });
  assert.equal(t.dialogue.getImage({}), null, '自動で始める画面の click() は人の押しではない');
  await t.els.startCam.fire('click', { isTrusted: true });
  assert.equal(t.dialogue.getImage({}).type, 'jpeg', '入口で人が押した = 選んだ');
  assert.equal(t.dialogue.getImage({ trigger: 'approach' }), null, '近づいた合図の回は送らない');
  await t.els.startSim.fire('click');
  assert.equal(t.dialogue.getImage({}), null, '「カメラなしで試す」で選んでいない形に戻る');
});

test('cameraUse: 入れる = 顔の追従を先に動かしてから前の入力を止める。切る = カメラなしを動かしてからカメラの流れを止める', async () => {
  const t = await setup();
  assert.equal(t.els.camBtn.hidden, false, '入力の列のボタンを出す');
  await t.els.camBtn.fire('click');
  await t.els.camAsk.kids['#camAskYes'].fire('click');
  assert.deepEqual(t.log.filter((l) => !l.startsWith('event')), ['face-start:user', 'sim-stop'], '先に動かし、後で止める');
  assert.equal(t.app.mode, 'camera');
  assert.ok(t.use.seeing());
  assert.equal(t.dialogue.getImage({}).data, 'QUJDRA==');
  assert.equal(t.els.camBtn.getAttribute('aria-pressed'), 'true');
  await t.els.camBtn.fire('click'); // 切る
  assert.equal(t.app.mode, 'sim');
  assert.ok(t.log.includes('face-stop'));
  assert.equal(t.getStream().track.readyState, 'ended', 'カメラの流れを止めた');
  assert.equal(t.dialogue.getImage({}), null, '切った後は送らない');
});

test('cameraUse: うしろのカメラは facingMode environment で始め、顔は追わない。注意書きも替わる', async () => {
  const t = await setup();
  await t.els.camBtn.fire('click');
  await t.els.camAsk.kids['#camAskBack'].fire('click');
  assert.ok(t.log.includes('face-start:environment'));
  assert.deepEqual(t.app.source.getPeople(), [], '顔を追わない');
  assert.match(t.use.privacy, /うしろのカメラ/);
});

test('cameraUse: 入れられなかった時は今の入力のまま(前の入力を止めない)・途中まで読んだ部品を捨てる', async () => {
  const t = await setup({ failStart: true });
  await t.els.camBtn.fire('click');
  await t.els.camAsk.kids['#camAskYes'].fire('click');
  assert.equal(t.app.mode, 'sim');
  assert.ok(!t.log.includes('sim-stop'), '前の入力は止めない');
  assert.ok(t.log.includes('face-stop'), '途中まで読んだ部品を捨てた');
  assert.match(t.els.camAsk.kids['#camAskStatus'].textContent, /ゆるす/);
});

test('cameraUse: 勝手に止まった(track の ended)時は、切った形にそろえて知らせる。仮の頭脳の知らせは 1 回だけ', async () => {
  const t = await setup();
  await t.els.camBtn.fire('click');
  await t.els.camAsk.kids['#camAskYes'].fire('click');
  t.dialogue.onEvent({ type: 'meta', camera: 'mock', cameraNotice: 'A' });
  t.dialogue.onEvent({ type: 'meta', camera: 'mock', cameraNotice: 'A' });
  t.dialogue.onEvent({ type: 'meta', camera: 'capped', cameraNotice: 'B' });
  assert.deepEqual(t.notices, ['A', 'B'], '仮の頭脳の知らせは 1 回・上限の知らせは毎回');
  await t.getStream().track.fire('ended');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.app.mode, 'sim');
  assert.equal(t.notices.at(-1), t.CAMERA_ENDED);
  assert.ok(t.log.includes('event:meta'), '前の onEvent も呼ばれている(記憶の札・仮の頭脳の知らせ)');
});

test('cameraUse: 入口の LED・自動で始める画面・外の位置の入口では、切り替えを出さない', async () => {
  for (const q of ['led=1', 'autostart=1', 'source=pose', 'source=bridge', 'perf=1']) {
    const t = await setup({ params: q });
    assert.equal(t.els.camBtn.hidden, true, q);
    assert.equal(t.use.ui, null, q);
  }
});
