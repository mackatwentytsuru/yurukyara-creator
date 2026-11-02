import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { detectXR, startXR, applyPresentation, OPTIONAL_FEATURES } from '../web/xr.js';
import { createNativeAR, hasNativeAR, floorYFor } from '../web/nativeAR.js';

// 偽の navigator.xr / renderer / session
function fakeNav({ ar = true, vr = true, enabled, throwOn } = {}) {
  const calls = [];
  const listeners = {};
  const session = {
    enabledFeatures: enabled,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    end: async () => listeners.end?.(),
  };
  return {
    calls,
    listeners,
    session,
    xr: {
      isSessionSupported: async (m) => {
        if (throwOn === m) throw new Error('boom');
        return m === 'immersive-ar' ? ar : vr;
      },
      requestSession: async (mode, init) => { calls.push({ mode, init }); return session; },
    },
  };
}
function fakeRenderer() {
  const log = [];
  return {
    log,
    xr: {
      setReferenceSpaceType: (t) => log.push(['space', t]),
      setSession: async () => log.push(['session']),
    },
    setClearAlpha: (a) => log.push(['alpha', a]),
  };
}
const fakePlace = () => ({ modes: [], setPresentation(m) { this.modes.push(m); } });

test('detectXR: navigator.xr が無い(iPhone の Safari)と ar も vr も false', async () => {
  const r = await detectXR({ nav: {}, win: {} });
  assert.deepEqual([r.screen, r.ar, r.vr, r.ar_kind], [true, false, false, null]);
  assert.match(r.reason, /WebXR/);
});

test('detectXR: 殻アプリの中(iPhone)では navigator.xr が無くても ar が使える', async () => {
  const win = { webkit: { messageHandlers: { arhost: { postMessage() {} } } } };
  assert.equal(hasNativeAR(win), true);
  const r = await detectXR({ nav: {}, win });
  assert.deepEqual([r.ar, r.vr, r.ar_kind], [true, false, 'native']);
});

test('detectXR: Quest のように両方使える。isSessionSupported が例外でも false 扱い', async () => {
  const r = await detectXR({ nav: fakeNav().xr ? { xr: fakeNav().xr } : {}, win: {} });
  assert.deepEqual([r.ar, r.vr, r.ar_kind, r.reason], [true, true, 'webxr', '']);
  const r2 = await detectXR({ nav: { xr: fakeNav({ throwOn: 'immersive-vr' }).xr }, win: {} });
  assert.equal(r2.vr, false);
});

test('startXR: 機能は全部 optional で、required は渡さない', async () => {
  const nav = fakeNav({ enabled: ['local-floor', 'hit-test'] });
  const r = await startXR({ renderer: fakeRenderer(), mode: 'ar', scene: new THREE.Scene(), place: fakePlace(), nav });
  assert.equal(nav.calls[0].mode, 'immersive-ar');
  assert.equal(nav.calls[0].init.requiredFeatures, undefined);
  assert.deepEqual(nav.calls[0].init.optionalFeatures, OPTIONAL_FEATURES.ar);
  assert.deepEqual(r.features, ['local-floor', 'hit-test']);
  assert.equal(r.floor, true);
});

test('startXR: local-floor が使えないときは local にして floor=false を返す', async () => {
  const nav = fakeNav({ enabled: ['hit-test'] });
  const renderer = fakeRenderer();
  const r = await startXR({ renderer, mode: 'vr', scene: new THREE.Scene(), place: fakePlace(), nav });
  assert.equal(r.floor, false);
  assert.deepEqual(renderer.log[0], ['space', 'local']);
});

test('startXR: AR では背景を外して透明に、終わったら元に戻る', async () => {
  const nav = fakeNav({ enabled: ['local-floor'] });
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x123456);
  scene.background = bg;
  const place = fakePlace();
  const renderer = fakeRenderer();
  const r = await startXR({ renderer, mode: 'ar', scene, place, background: bg, nav });
  assert.equal(scene.background, null);
  assert.deepEqual(place.modes, ['ar']);
  await r.end();
  assert.equal(scene.background, bg);
  assert.deepEqual(place.modes, ['ar', 'screen']);
  assert.deepEqual(renderer.log.filter((l) => l[0] === 'alpha'), [['alpha', 0], ['alpha', 1]]);
});

test('startXR: mode が違うと日本語で失敗', async () => {
  await assert.rejects(() => startXR({ renderer: fakeRenderer(), mode: 'xx', scene: new THREE.Scene(), nav: fakeNav() }), /ar か vr/);
});

test('applyPresentation: screen では背景を戻す', () => {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0xff0000);
  applyPresentation({ mode: 'screen', scene, renderer: fakeRenderer(), place: fakePlace(), background: bg });
  assert.equal(scene.background, bg);
});

test('nativeAR: 姿勢を three.js のカメラに写す(位置・向き・射影)', () => {
  const camera = new THREE.PerspectiveCamera();
  const ar = createNativeAR({ camera, win: {} });
  // カメラを (1, 1.5, 2) に置き、y 軸まわりに 90 度回した行列
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 1.5, 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    new THREE.Vector3(1, 1, 1),
  );
  const proj = new THREE.Matrix4().makePerspective(-0.5, 0.5, 0.5, -0.5, 0.1, 50);
  ar.host.onPose(m.toArray(), proj.toArray());
  assert.ok(camera.position.distanceTo(new THREE.Vector3(1, 1.5, 2)) < 1e-6);
  const front = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(front.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6, '90 度回すと -z の向きは -x');
  assert.ok(Math.abs(camera.projectionMatrix.elements[0] - proj.elements[0]) < 1e-9);
  const inv = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse);
  assert.ok(Math.abs(inv.elements[0] - 1) < 1e-6);
  assert.equal(ar.state.poses, 1);
});

test('nativeAR: 変な姿勢(16 個でない・数でない)は無視する', () => {
  const camera = new THREE.PerspectiveCamera();
  const ar = createNativeAR({ camera, win: {} });
  ar.host.onPose([1, 2, 3], new Array(16).fill(0));
  ar.host.onPose(new Array(16).fill(NaN), new Array(16).fill(0));
  assert.equal(ar.state.poses, 0);
});

test('nativeAR: start で ready を送り、raycast を殻に聞き、答えを受け取る', () => {
  const sent = [];
  const win = { webkit: { messageHandlers: { arhost: { postMessage: (m) => sent.push(m) } } } };
  const hits = [];
  const floors = [];
  const ar = createNativeAR({ camera: new THREE.PerspectiveCamera(), win, onHit: (p) => hits.push(p), onFloor: (y) => floors.push(y) });
  ar.start();
  assert.ok(win.__arhost);
  ar.raycast(0.5, 0.8);
  assert.deepEqual(sent, [{ type: 'ready' }, { type: 'raycast', x: 0.5, y: 0.8 }]);
  win.__arhost.onHit(1, -1.2, 3);
  win.__arhost.onHit(NaN, 0, 0);
  win.__arhost.onFloor(-1.25);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].toArray(), [1, -1.2, 3]);
  assert.deepEqual(floors, [-1.25]);
  ar.stop();
  assert.equal(win.__arhost, undefined);
});

test('floorYFor: 見つけた床 → タップした点 → カメラの 1.4 m 下 の順', () => {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.5, 0);
  assert.equal(floorYFor({ floorY: -0.1, hitY: 0.3 }, cam), -0.1);
  assert.equal(floorYFor({ hitY: 0.3 }, cam), 0.3);
  assert.ok(Math.abs(floorYFor({}, cam) - 0.1) < 1e-9);
});
