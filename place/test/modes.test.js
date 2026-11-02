import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPresentation } from '../web/modes.js';

function fakeDoc() {
  const classes = new Set();
  const appended = [];
  return {
    appended,
    getElementById: (id) => appended.find((el) => el.id === id) ?? null,
    createElement: () => ({}),
    head: { appendChild: (el) => appended.push(el) },
    documentElement: {
      dataset: {},
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
    },
  };
}
function fakeRenderer() {
  const log = [];
  return { log, xr: { setReferenceSpaceType() {}, setSession: async () => log.push('session') }, setClearAlpha: (a) => log.push(['alpha', a]) };
}
function webxrNav({ enabled = ['local-floor'] } = {}) {
  const listeners = {};
  const session = { enabledFeatures: enabled, addEventListener: (t, f) => { listeners[t] = f; }, end: async () => listeners.end?.() };
  return { listeners, session, xr: { isSessionSupported: async () => true, requestSession: async () => session } };
}
const shellWin = () => ({ document: fakeDoc(), webkit: { messageHandlers: { arhost: { postMessage() {} } } } });

function setup({ nav = {}, win = { document: fakeDoc() }, ...extra } = {}) {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x112233);
  scene.background = bg;
  const camera = new THREE.PerspectiveCamera();
  const place = { modes: [], setPresentation(m) { this.modes.push(m); } };
  const renderer = fakeRenderer();
  return { scene, bg, camera, place, renderer, nav, win, ...extra };
}

test('Safari(WebXR も殻も無い): ar も vr も入れない。理由が日本語の例外で出る', async () => {
  const s = setup();
  const m = await createPresentation({ ...s, background: s.bg });
  assert.equal(m.available.ar, false);
  assert.equal(m.mode, 'screen');
  await assert.rejects(() => m.enter('ar'), /WebXR/);
  assert.equal(s.win.document.documentElement.dataset.presentation, 'screen');
});

test('殻(iPhone): ar に入ると背景が透明になり、html に data-presentation=ar が付く。見ている人が毎フレーム届く', async () => {
  const win = shellWin();
  const s = setup({ win });
  const viewers = [];
  const changes = [];
  const m = await createPresentation({ ...s, background: s.bg, onViewer: (c) => viewers.push(c.position.toArray()), onChange: (x) => changes.push(x) });
  assert.equal(m.available.ar_kind, 'native');
  await m.enter('ar');
  assert.equal(m.mode, 'ar');
  assert.equal(s.scene.background, null);
  assert.equal(win.document.documentElement.dataset.presentation, 'ar');
  assert.ok(win.document.documentElement.classList.has('presentation-ar'));
  assert.equal(win.document.appended.length, 1, '背景を消す style を 1 回だけ足す');
  // 殻が姿勢を送る → onViewer
  const world = new THREE.Matrix4().makeTranslation(0.5, 1.5, 2).toArray();
  win.__arhost.onPose(world, new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 0.1, 50).toArray());
  assert.deepEqual(viewers, [[0.5, 1.5, 2]]);
  assert.deepEqual(m.viewerPeople(), [{ id: 'viewer', position: [0.5, 1.5, 2] }]);
  await m.exit();
  assert.equal(m.mode, 'screen');
  assert.equal(s.scene.background, s.bg);
  assert.equal(win.__arhost, undefined);
  assert.equal(win.document.documentElement.dataset.presentation, 'screen');
  assert.deepEqual(changes, ['ar', 'screen']);
});

test('Quest(WebXR): vr に入り、ヘッドセット側で終わらせると画面に戻る', async () => {
  const nav = webxrNav();
  const s = setup({ nav });
  const changes = [];
  const m = await createPresentation({ ...s, background: s.bg, onChange: (x) => changes.push(x) });
  assert.equal(m.available.ar_kind, 'webxr');
  await m.enter('vr');
  assert.equal(m.mode, 'vr');
  assert.deepEqual(s.place.modes, ['vr']);
  nav.listeners.end(); // ヘッドセットのメニューから終了
  assert.equal(m.mode, 'screen');
  assert.deepEqual(changes, ['vr', 'screen']);
});

test('モードを切りかえると、いまの物を先に終わらせる(ar → vr)', async () => {
  const nav = webxrNav();
  const s = setup({ nav });
  const m = await createPresentation({ ...s, background: s.bg });
  await m.enter('ar');
  assert.equal(s.scene.background, null);
  await m.enter('vr');
  assert.equal(m.mode, 'vr');
  assert.equal(s.scene.background, s.bg);
});

test('mode の名前が違うと日本語で失敗。WebXR のとき frame() で onViewer が呼ばれる', async () => {
  const nav = webxrNav();
  const s = setup({ nav });
  const seen = [];
  const m = await createPresentation({ ...s, background: s.bg, onViewer: () => seen.push(1) });
  await assert.rejects(() => m.enter('xx'), /screen・ar・vr/);
  m.frame();
  assert.equal(seen.length, 0, 'session が無いときは呼ばない');
  await m.enter('ar');
  m.frame();
  assert.equal(seen.length, 1);
});

import { mountModeButtons } from '../web/modeButtons.js';

function fakeButtonDoc() {
  const make = () => ({ dataset: {}, listeners: {}, hidden: false, addEventListener(t, f) { this.listeners[t] = f; } });
  return { createElement: make };
}

test('mountModeButtons: 使えるモードのボタンだけ出し、押すと入る。入ったボタンは隠れ、戻るが出る', async () => {
  const nav = webxrNav();
  const s = setup({ nav });
  const m = await createPresentation({ ...s, background: s.bg });
  const children = [];
  const container = { appendChild: (c) => children.push(c) };
  const errors = [];
  const { buttons } = mountModeButtons({ modes: m, container, doc: fakeButtonDoc(), onError: (e) => errors.push(e) });
  assert.deepEqual(Object.keys(buttons), ['ar', 'vr', 'screen']);
  assert.equal(buttons.screen.hidden, true, 'screen の間は戻るを隠す');
  await buttons.vr.listeners.click();
  assert.equal(m.mode, 'vr');
  assert.equal(buttons.vr.hidden, true);
  assert.equal(buttons.screen.hidden, false);
  assert.equal(errors.length, 0);
});

test('mountModeButtons: Safari では ar・vr のボタンを出さない', async () => {
  const s = setup();
  const m = await createPresentation({ ...s, background: s.bg });
  const { buttons } = mountModeButtons({ modes: m, container: { appendChild() {} }, doc: fakeButtonDoc() });
  assert.deepEqual(Object.keys(buttons), ['screen']);
});

test('mountModeButtons: modes.enter を直に呼んで(自動で AR に入って)も、ボタンの表示が今のモードに合う', async () => {
  const nav = webxrNav();
  const s = setup({ nav });
  const m = await createPresentation({ ...s, background: s.bg });
  const { buttons } = mountModeButtons({ modes: m, container: { appendChild() {} }, doc: fakeButtonDoc() });
  await m.enter('ar'); // ボタンを押さずに入る
  assert.equal(buttons.ar.hidden, true);
  assert.equal(buttons.screen.hidden, false);
  await m.exit();
  assert.equal(buttons.ar.hidden, false);
  assert.equal(buttons.screen.hidden, true);
});
