// BCV(11-08 本人「カメラは使う人が決める・カメラの中身にも答える」)の、画面の側の試験。ブラウザは使わず、小さな偽の部品で確かめる。
// - 絵の 1 枚(cameraFrame.js): 長い辺 512・縦横の比を保つ・JPEG 0.7・大きすぎたら画質を下げる・JPEG を作れない時は送らない・下書きを消す
// - 切り替えの決まり(cameraSwitch.js): どの入口で出すか・失敗の言葉は日本語だけ
// - 切り替えの部品: 押すと先に知らせ(本人の 1 行)・「カメラを つかう」で入る・入っている間は赤い点・押すと切る・失敗したら理由を出して切ったまま
// - 画面の形(index.html・style.css・main.js)を文字で見る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME_LONG_SIDE, FRAME_QUALITY, frameSize, takeFrame } from '../src/conversation/cameraFrame.js';
import { CAMERA_MOCK_NOTE, CAMERA_NOTICE, cameraFailureText, cameraSwitchPlan, mountCameraSwitch } from '../src/stage/cameraSwitch.js';

const WEB = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8');

test('絵の大きさ: 長い辺を 512 にして縦横の比を保つ(小さい絵は大きくしない)', () => {
  assert.equal(FRAME_LONG_SIDE, 512);
  assert.equal(FRAME_QUALITY, 0.7);
  assert.deepEqual(frameSize(640, 480), { width: 512, height: 384 });
  assert.deepEqual(frameSize(1280, 720), { width: 512, height: 288 });
  assert.deepEqual(frameSize(480, 640), { width: 384, height: 512 }, '縦長(スマホを縦に持った時)');
  assert.deepEqual(frameSize(320, 240), { width: 320, height: 240 }, '小さい絵は、そのまま');
});

/** 偽の canvas。toDataURL の答えを決められる */
function fakeCanvas(answer) {
  const calls = { draw: [], quality: [], cleared: 0 };
  const ctx = {
    drawImage: (...a) => calls.draw.push(a),
    clearRect: () => {
      calls.cleared += 1;
    },
  };
  return { calls, canvas: { width: 0, height: 0, getContext: () => ctx, toDataURL: (type, q) => (calls.quality.push(q), answer(type, q)) } };
}
const video = { readyState: 4, videoWidth: 640, videoHeight: 480 };

test('絵の 1 枚: JPEG 0.7 で 1 回作り、下書きを消す', () => {
  const { canvas, calls } = fakeCanvas(() => 'data:image/jpeg;base64,QUJD');
  const f = takeFrame(video, { canvas });
  assert.deepEqual(f, { type: 'jpeg', data: 'QUJD', width: 512, height: 384 });
  assert.deepEqual(calls.draw[0].slice(1), [0, 0, 512, 384], '長い辺 512 で描いた');
  assert.deepEqual(calls.quality, [0.7]);
  assert.equal(calls.draw.length, 1);
  assert.equal(calls.cleared, 1, '下書きの絵を消した');
  assert.deepEqual([canvas.width, canvas.height], [1, 1], '使った後は 1x1 に縮めて、下書きのメモリを手放す(iOS の Safari)');
});

test('絵の 1 枚: 大きすぎたら画質を下げて作り直す。それでも大きければ送らない', () => {
  const big = 'A'.repeat(200);
  const { canvas, calls } = fakeCanvas((t, q) => `data:image/jpeg;base64,${q >= 0.5 ? big : 'QUJD'}`);
  assert.equal(takeFrame(video, { canvas, maxBase64: 100 }).data, 'QUJD');
  assert.deepEqual(calls.quality, [0.7, 0.55, 0.4]);
  const always = fakeCanvas(() => `data:image/jpeg;base64,${big}`);
  assert.equal(takeFrame(video, { canvas: always.canvas, maxBase64: 100 }), null);
  assert.equal(always.calls.cleared, 1, '送らない時も下書きを消す');
});

test('絵の 1 枚: まだ映っていない・JPEG を作れないブラウザ・描けない時は null(送らない)', () => {
  assert.equal(takeFrame(null), null);
  assert.equal(takeFrame({ readyState: 1, videoWidth: 640, videoHeight: 480 }, { canvas: fakeCanvas(() => '').canvas }), null);
  assert.equal(takeFrame({ readyState: 4, videoWidth: 0, videoHeight: 0 }, { canvas: fakeCanvas(() => '').canvas }), null);
  assert.equal(takeFrame(video, { canvas: fakeCanvas(() => 'data:image/png;base64,QUJD').canvas }), null, 'PNG に落ちた時は送らない');
  const broken = fakeCanvas(() => {
    throw new Error('tainted');
  });
  assert.equal(takeFrame(video, { canvas: broken.canvas }), null);
});

test('切り替えを出す入口: ふつうの画面だけ。ヘッドセット・入口の LED・自動で始める画面・外の位置・重さの測りでは出さない', () => {
  assert.equal(cameraSwitchPlan({}).show, true);
  assert.equal(cameraSwitchPlan({ headset: true }).why, 'headset');
  assert.equal(cameraSwitchPlan({ led: true }).why, 'kiosk');
  assert.equal(cameraSwitchPlan({ autostart: true }).why, 'kiosk');
  assert.equal(cameraSwitchPlan({ source: 'pose' }).why, 'external');
  assert.equal(cameraSwitchPlan({ source: 'bridge' }).why, 'external');
  assert.equal(cameraSwitchPlan({ perf: true }).why, 'perf');
});

test('カメラを入れられなかった時の言葉は、やさしい日本語だけ(英語の err.message を出さない)', () => {
  const md = { getUserMedia() {} };
  const cases = [
    [new DOMException('Permission denied', 'NotAllowedError'), /ゆるす/],
    [new DOMException('Requested device not found', 'NotFoundError'), /みつかりませんでした/],
    [new DOMException('Could not start video source', 'NotReadableError'), /ほかの アプリ/],
    [new Error('weird failure'), /つかえませんでした/],
  ];
  for (const [err, re] of cases) {
    const t = cameraFailureText(err, { secure: true, mediaDevices: md });
    assert.match(t, re);
    assert.doesNotMatch(t, /[A-Za-z]{4,}/, `英語を出さない: ${t}`);
  }
  assert.match(cameraFailureText(new Error('x'), { secure: false, mediaDevices: md }), /https/);
  assert.match(cameraFailureText(new Error('x'), { secure: true, mediaDevices: null }), /この ブラウザでは/);
});

// ---- 切り替えの部品(偽の DOM) ----
class El {
  constructor(id = '') {
    this.id = id;
    this.attrs = {};
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.kids = {};
    this.focused = 0;
    const set = new Set();
    this.classList = { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  async fire(type, ev = {}) {
    for (const fn of this.listeners[type] ?? []) await fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev });
  }
  querySelector(sel) {
    return this.kids[sel] ?? null;
  }
  focus() {
    this.focused += 1;
  }
}

function mount({ turnOn = async () => {}, turnOff = async () => {}, isMock = () => false, backCamera = false } = {}) {
  globalThis.document = { documentElement: new El('html') };
  const button = new El('camBtn');
  const label = new El();
  button.kids['.cam-label'] = label;
  const tvButton = new El('tvCam');
  const ask = new El('camAsk');
  ask.hidden = true;
  for (const id of ['camAskText', 'camAskMock', 'camAskYes', 'camAskNo', 'camAskStatus', 'camAskBack']) ask.kids[`#${id}`] = new El(id);
  ask.kids['#camAskBack'].hidden = true;
  const log = [];
  const sw = mountCameraSwitch({
    button,
    tvButton,
    ask,
    backCamera,
    turnOn: async (facing) => {
      log.push(facing === 'environment' ? 'on-back' : 'on');
      await turnOn();
    },
    turnOff: async () => {
      log.push('off');
      await turnOff();
    },
    isMock,
    env: () => ({ secure: true, mediaDevices: { getUserMedia() {} } }),
  });
  return { sw, button, tvButton, ask, label, log, k: (id) => ask.kids[`#${id}`] };
}

test('切り替え: 押すと、入れる前に本人の 1 行の知らせ。「カメラを つかう」で入り、赤い点とラベル「カメラ オン」。押すと切る', async () => {
  const m = mount();
  assert.equal(m.k('camAskText').textContent, CAMERA_NOTICE);
  assert.equal(CAMERA_NOTICE, 'カメラの えは、こたえを つくるために Claude に おくられます(ほぞんしません)。つかうかは あなたが きめてね');
  assert.equal(m.button.getAttribute('aria-pressed'), 'false');
  await m.button.fire('click');
  assert.equal(m.ask.hidden, false, '知らせの窓が開く(まだ入れない)');
  assert.deepEqual(m.log, [], '知らせの前にカメラを入れない');
  assert.equal(m.k('camAskMock').hidden, true, '本物の頭脳の時は、仮の頭脳の 1 行を出さない');
  await m.k('camAskYes').fire('click');
  assert.deepEqual(m.log, ['on']);
  assert.equal(m.ask.hidden, true);
  assert.equal(m.sw.on, true);
  assert.equal(m.button.getAttribute('aria-pressed'), 'true');
  assert.ok(m.button.classList.contains('on') && m.tvButton.classList.contains('on'), '入力の列とテレビ表示の隅の両方に赤い点');
  assert.equal(m.label.textContent, 'カメラ オン');
  assert.ok(document.documentElement.classList.contains('cam-on'));
  await m.button.fire('click');
  assert.deepEqual(m.log, ['on', 'off'], '入っている時に押すと、知らせなしで切る');
  assert.equal(m.sw.on, false);
  assert.equal(m.label.textContent, 'カメラ');
  assert.ok(!document.documentElement.classList.contains('cam-on'));
});

test('切り替え: 「やめる」・外を押す・Escape では入れない。仮の頭脳の時は 1 行足す', async () => {
  const m = mount({ isMock: () => true });
  await m.tvButton.fire('click');
  assert.equal(m.ask.hidden, false, 'テレビ表示の隅からも開く');
  assert.equal(m.k('camAskMock').hidden, false);
  assert.equal(m.k('camAskMock').textContent, CAMERA_MOCK_NOTE);
  await m.k('camAskNo').fire('click');
  assert.equal(m.ask.hidden, true);
  await m.button.fire('click');
  await m.ask.fire('click', { target: m.ask });
  assert.equal(m.ask.hidden, true, '外を押すと閉じる');
  await m.button.fire('click');
  await m.ask.fire('keydown', { key: 'Escape' });
  assert.equal(m.ask.hidden, true, 'Escape で閉じる');
  assert.deepEqual(m.log, [], 'どれでも入れない');
});

test('切り替え: 指で触る端末だけ「うしろの カメラを つかう」(前の景色や看板を見せる)。PC では出さない', async () => {
  const pc = mount();
  assert.equal(pc.k('camAskBack').hidden, true, 'PC では出さない');
  const ph = mount({ backCamera: true });
  assert.equal(ph.k('camAskBack').hidden, false, 'スマホでは出す');
  await ph.button.fire('click');
  await ph.k('camAskBack').fire('click');
  assert.deepEqual(ph.log, ['on-back'], 'うしろのカメラで入れる');
  assert.equal(ph.sw.on, true);
  assert.equal(ph.ask.hidden, true);
  const use = read('src', 'stage', 'cameraUse.js');
  assert.match(use, /next\.start = \(\) => next\.tracker\.start\(\{ facingMode: 'environment' \}\);/, 'うしろのカメラも、顔の追従と同じ部品の流れ(絵も同じ video から)。始め直しても、うしろのまま');
  assert.match(use, /next\.stop\(\); \/\/ 途中まで読んだ顔の部品を捨てる/, '入れられなかった時は、途中まで読んだ顔の部品を捨てる');
  assert.match(use, /const watchedTracks = new WeakSet\(\);/, '勝手に止まった時の見張りは、流れ(track)ごと');
  assert.match(use, /next\.getPeople = \(\) => \[\];/, 'うしろのカメラでは顔の向きを追わない(写った人の逆を見ない)');
  assert.match(use, /backCamera: touch,/);
  assert.match(read('src', 'main.js'), /touch: TOUCH,/, 'main.js は指で触る端末かを渡すだけ');
});

test('切り替え: 入れられなかった時は、やさしい理由を出して切ったまま(もう一度押せる)', async () => {
  const m = mount({
    turnOn: async () => {
      throw new DOMException('denied', 'NotAllowedError');
    },
  });
  await m.button.fire('click');
  await m.k('camAskYes').fire('click');
  assert.equal(m.sw.on, false);
  assert.equal(m.ask.hidden, false, '窓は開いたまま、理由を読める');
  assert.match(m.k('camAskStatus').textContent, /ゆるす/);
  assert.equal(m.k('camAskYes').disabled, false, 'もう一度押せる');
  m.sw.set(true);
  assert.equal(m.button.getAttribute('aria-pressed'), 'true', '外で入った時(入口で選んだ・VR から戻った)は見た目だけ合わせる');
});

test('会話(Dialogue の本物): 話しかけた回だけ絵を 1 枚。近づいた合図の回は getImage を呼びもしない。履歴に絵を残さず、次の回にも送り直さない', async () => {
  const { Dialogue } = await import('../src/conversation/dialogue.js');
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    bodies.push(JSON.parse(init.body));
    const events = [{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }];
    return new Response(JSON.stringify({ brain: 'mock', events, ms: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const d = new Dialogue({
      character: { expressions: ['neutral'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false },
      speaker: { speaking: false, pending: 0, setVoicePersona() {}, playFiller: () => null, stop() {}, enqueue: () => Promise.resolve() },
      ui: { thought() {}, say() {}, userSaid() {}, caption() {}, notice() {}, error: (m) => assert.fail(m) },
      getContext: () => ({ scene: '', character: { name: 'ノリー', persona: '' }, place: undefined }),
      setGaze: () => null,
      onMetric() {},
    });
    const asked = [];
    d.getImage = (turn) => {
      asked.push(turn.trigger ?? null);
      return { type: 'jpeg', data: 'QUJDRA==', width: 512, height: 384 };
    };
    await d.send({ text: 'これなに?', mode: 'text' });
    await d.send({ trigger: 'approach', mode: 'text' });
    await d.send({ text: 'こんにちは', mode: 'voice' });
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies[0].image, { type: 'jpeg', data: 'QUJDRA==', width: 512, height: 384 }, '文字で話しかけた回は 1 枚');
    assert.equal(bodies[1].image, undefined, '近づいた合図の回は送らない');
    assert.deepEqual(asked, [null, null], '近づいた合図の回は getImage を呼ばない(2 回 = 文字と声の回だけ)');
    assert.equal(bodies[2].image.data, 'QUJDRA==', '声で話しかけた回も 1 枚(その回の新しい 1 枚)');
    assert.ok(!JSON.stringify(bodies[2].history).includes('QUJDRA=='), '前の回の絵を履歴で送り直さない');
    assert.ok(!JSON.stringify(d.history).includes('QUJDRA=='), '画面の履歴に絵を残さない');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('画面の形: 入力の列にカメラのボタン(最初は隠す)・テレビ表示の隅・知らせの窓・入口の文。印の札は高さ 500 未満でも残す', () => {
  const html = read('index.html');
  assert.match(html, /<button type="button" id="camBtn" class="cam" aria-pressed="false"[^>]* hidden>/);
  assert.ok(html.indexOf('id="micBtn"') < html.indexOf('id="camBtn"') && html.indexOf('id="camBtn"') < html.indexOf('id="textInput"'), '声 → カメラ → 文字 の順');
  assert.match(html, /<button type="button" id="tvCam" class="tv-cam" aria-pressed="false" hidden>/);
  assert.match(html, /<div id="camAsk" class="cam-ask" role="dialog" aria-modal="true"[^>]*hidden>/);
  const gate = html.slice(html.indexOf('<div id="gate"'), html.indexOf('<script'));
  assert.match(gate, /カメラの えは、こたえを つくるために Claude に おくられます\(ほぞんしません\)。つかうかは あなたが きめてね。/, '入口でも同じ 1 行(選ぶ前に読める)');
  assert.doesNotMatch(gate, /カメラの映像は端末の外に出ません/, '古い約束(外に出ない)を残さない');
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /\.cam\[hidden\], \.tv-cam\[hidden\] \{ display: none !important; \}/, 'hidden が display に負けない');
  assert.match(css, /\.chips:has\(\.chip\.cam-rec\) \{ display: flex; \}/, '高さ 500 未満でも印の札は残す');
  assert.match(css, /\.chips:has\(\.chip\.cam-rec\) \.chip:not\(\.cam-rec\) \{ display: none; \}/);
  assert.doesNotMatch(css, /\.chip\.rec\b/, '印の札の名前は cam-rec(.rec は注意書きの 8px の点。同じ名前だと札がつぶれた)');
  assert.match(css, /html\.tv-mode \.tv-cam \{/);
  const main = read('src', 'main.js');
  assert.match(main, /if \(app\.camera\?\.seeing\?\.\(\)\) chips\.unshift\(\['', 'カメラ オン', 'cam-rec'\]\);/, '絵を送るカメラの間は、上の札の先頭に赤い点の札');
  assert.match(main, /camera: app\.camera\?\.seeing\?\.\(\) \? app\.camera\.privacy :/, '下の注意書きも、絵を送る約束に替わる');
  assert.match(main, /app\.camera\.setup\(\); \/\/ BCV/);
});
