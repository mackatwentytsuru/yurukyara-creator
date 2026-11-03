// 部屋のデモ: 画面(テレビやモニター)から、キャラが出てきて、床を歩き、画面に戻る。iPhone の殻(ARStage)の上で動く。
// 手順: 画面の左端の足元の床を 1 回、右端の足元の床を 1 回タップ → 画面の位置・幅・向きが決まる(床の 2 点から)。
//   画面の面より後ろは、色を書かない「面の壁」で隠す(キャラは画面の中から出てくるように見える)。
// ?vrm=<URL>(既定 /characters/sample_vrm/model.vrm)  ?width=<画面の横 m、既定は 2 点の距離>  ?height=<画面の縦 m、既定 0.6>  ?walk=<歩く距離 m、既定 1.2>
//   ?charheight=<キャラの背の高さ m、既定 0.6(画面の高さに収まる小さなキャラ。実物大にするなら 1.5)>
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createNativeAR, hasNativeAR, floorYFor } from './nativeAR.js';

const params = new URLSearchParams(location.search);
const vrmUrl = params.get('vrm') ?? '/characters/sample_vrm/model.vrm';
const walkDist = Number(params.get('walk') ?? 1.2);
const charHeightWanted = Number(params.get('charheight') ?? 0.6);
const screenH = Number(params.get('height') ?? 0.6);
const info = document.getElementById('info');
const native = hasNativeAR();
if (!native) document.documentElement.classList.add('desktop');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x998877, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.4, 2.5);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- キャラ(VRM)。足元が原点、正面が +z -------------------------------------------------
const holder = new THREE.Group();
holder.visible = false;
scene.add(holder);
let vrm = null;
let bones = null;
const rest = new Map();
try {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(vrmUrl);
  vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0?.(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  holder.add(vrm.scene);
  const h = vrm.humanoid;
  bones = {};
  for (const n of ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) {
    bones[n] = h.getNormalizedBoneNode(n);
    if (bones[n]) rest.set(n, { q: bones[n].quaternion.clone(), p: bones[n].position.clone() });
  }
  info.textContent = 'キャラを読み込んだ。';
} catch (e) {
  // 読めなければ箱のキャラで続ける(動きの確認はできる)
  const g = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.2), new THREE.MeshStandardMaterial({ color: 0xe0527a }));
  g.position.y = 0.6;
  holder.add(g);
  info.textContent = 'VRM を読めなかったので箱で試す: ' + (e?.message ?? e);
}
let charHeight = (() => { const b = new THREE.Box3().setFromObject(holder); return Number.isFinite(b.max.y - b.min.y) && b.max.y - b.min.y > 0.1 ? b.max.y - b.min.y : 1.5; })();

holder.scale.setScalar(charHeightWanted / charHeight);   // 画面から出てくる大きさにそろえる
charHeight = charHeightWanted;

// ---- 面の壁(色を書かず、奥行きだけ書く)------------------------------------------------
const mask = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide }),
);
mask.renderOrder = -10;
mask.visible = false;
scene.add(mask);
const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x00ffff }));
frame.visible = false;
scene.add(frame);

// ---- 画面の位置合わせ(床の 2 点)----------------------------------------------------------
const stage = { taps: [], ready: false, center: new THREE.Vector3(), along: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1), width: 1, floorY: 0, t0: 0 };

function setScreen(p1, p2) {
  const a = new THREE.Vector3(p2.x - p1.x, 0, p2.z - p1.z);
  const w = a.length();
  if (w < 0.2) throw new Error('2 点が近すぎる(20 cm 以上、画面の左端と右端の足元を)');
  a.normalize();
  // 画面の表(客席側)= along × up。見ている人(camera)のいる側に向ける
  let n = new THREE.Vector3().crossVectors(a, new THREE.Vector3(0, 1, 0));
  const mid = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
  if (n.dot(new THREE.Vector3(camera.position.x - mid.x, 0, camera.position.z - mid.z)) < 0) n.negate();
  Object.assign(stage, { center: mid, along: a, normal: n, width: Number(params.get('width') ?? w), floorY: mid.y, ready: true, t0: performance.now() / 1000 });
  const sw = stage.width;
  for (const m of [mask, frame]) {
    m.visible = true;
    m.position.set(mid.x, mid.y + screenH / 2 + 0.0, mid.z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, new THREE.Vector3(0, 1, 0), n));
  }
  frame.scale.set(sw, screenH, 1);
  // 壁は画面より広く・高く(画面の外に回り込んでも、後ろは見えない)
  mask.scale.set(Math.max(sw * 4, 4), Math.max(screenH * 6, 4), 1);
  mask.position.y = mid.y + mask.scale.y / 2 - 0.05;
  holder.visible = true;
  info.textContent = `画面の幅 ${sw.toFixed(2)} m。キャラが出てくる。やり直しは下のボタン。`;
}

// ---- 動き: 画面の中から出る → 歩く → 向きを変える → 画面へ戻る ---------------------------------
const TIMES = { wait: 1.0, out: 4.0, turn: 1.0, back: 4.0, turn2: 1.0 };
const CYCLE = Object.values(TIMES).reduce((a, b) => a + b, 0);
const BACK_OFFSET = 0.4; // 画面の壁の後ろに隠れる距離(m)
function pose(t) {
  const u = t % CYCLE;
  let s, yaw, walking = false;
  if (u < TIMES.wait) { s = -BACK_OFFSET; yaw = 0; }
  else if (u < TIMES.wait + TIMES.out) { const k = (u - TIMES.wait) / TIMES.out; s = -BACK_OFFSET + k * (walkDist + BACK_OFFSET); yaw = 0; walking = true; }
  else if (u < TIMES.wait + TIMES.out + TIMES.turn) { const k = (u - TIMES.wait - TIMES.out) / TIMES.turn; s = walkDist; yaw = Math.PI * k; }
  else if (u < TIMES.wait + TIMES.out + TIMES.turn + TIMES.back) { const k = (u - TIMES.wait - TIMES.out - TIMES.turn) / TIMES.back; s = walkDist - k * (walkDist + BACK_OFFSET); yaw = Math.PI; walking = true; }
  else { s = -BACK_OFFSET; yaw = Math.PI; }
  return { s, yaw, walking };
}

const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
function animate(t, walking) {
  if (!bones) return;
  const phase = t * Math.PI * 2 * 1.5; // 歩調 1.5 歩/秒の目安(片足の周期 1.5 Hz)
  const amp = walking ? 1 : 0;
  const set = (name, q) => { const b = bones[name]; if (b) b.quaternion.copy(rest.get(name).q).multiply(q); };
  const swing = Math.sin(phase) * 0.55 * amp;
  // VRM 1.0 の正規化の骨(正面 +z、T ポーズ)。脚は -x 回りで前、+x 回りで後ろ。腕は z 回りで下ろす
  set('leftUpperLeg', qx(-swing));
  set('rightUpperLeg', qx(swing));
  set('leftLowerLeg', qx(Math.max(0, Math.sin(phase + 1.2)) * 0.7 * amp));
  set('rightLowerLeg', qx(Math.max(0, Math.sin(phase + 1.2 + Math.PI)) * 0.7 * amp));
  set('leftUpperArm', qx(swing * 0.6).multiply(qz(-1.25)));
  set('rightUpperArm', qx(-swing * 0.6).multiply(qz(1.25)));
  set('leftLowerArm', qz(-0.15));
  set('rightLowerArm', qz(0.15));
  if (bones.hips) bones.hips.position.copy(rest.get('hips').p).y += Math.abs(Math.cos(phase)) * 0.02 * amp;
}

let last = performance.now() / 1000;
renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  const dt = Math.min(now - last, 0.1);
  last = now;
  if (stage.ready && holder.visible) {
    const t = now - stage.t0;
    const { s, yaw, walking } = pose(t);
    holder.position.copy(stage.center).addScaledVector(stage.normal, s);
    holder.position.y = stage.floorY;
    // 画面の表(normal)に向かって歩く。yaw=0 のとき normal の向き(正面 +z を normal に合わせる)
    const base = Math.atan2(stage.normal.x, stage.normal.z);
    holder.rotation.y = base + yaw;
    animate(t, walking);
    vrm?.update(dt);
    window.__roomDemo.phase = { t: Number(t.toFixed(2)), s: Number(s.toFixed(2)), yaw: Number(yaw.toFixed(2)), walking };
  }
  renderer.render(scene, camera);
});

// ---- 殻(ARKit)との接続 -----------------------------------------------------------------
let floorSeen = null;
const ar = createNativeAR({
  camera,
  onFloor: (y) => { floorSeen = y; },
  onHit: (p) => {
    if (stage.ready) return;
    stage.taps.push(p.clone());
    if (stage.taps.length === 1) { info.textContent = '次: 画面の右端の足元の床をタップ'; return; }
    try { setScreen(stage.taps[0], stage.taps[1]); } catch (e) { info.textContent = String(e.message ?? e); stage.taps = []; }
  },
});
if (native) {
  ar.start();
  info.textContent = '画面(テレビ・モニター)の左端の足元の床をタップ → 右端の足元の床をタップ';
  renderer.domElement.addEventListener('pointerdown', (e) => ar.raycast(e.clientX / innerWidth, e.clientY / innerHeight));
} else {
  info.textContent = '(殻なしの画面確認)2 点の既定で出す。';
  camera.position.set(0, 1.3, 3.2);
  camera.lookAt(0, 0.8, 0);
  setScreen(new THREE.Vector3(-0.6, 0, 0), new THREE.Vector3(0.6, 0, 0));
}
document.getElementById('reset').addEventListener('click', () => {
  stage.ready = false; stage.taps = []; holder.visible = false; mask.visible = false; frame.visible = false;
  info.textContent = '画面の左端の足元の床をタップ → 右端の足元の床をタップ';
});
document.getElementById('go').addEventListener('click', () => { stage.t0 = performance.now() / 1000; });

window.__roomDemo = {
  ready: true, native, charHeight,
  get stage() { return { ready: stage.ready, center: stage.center.toArray(), normal: stage.normal.toArray(), width: stage.width }; },
  get holder() { return holder.position.toArray(); },
  vrmLoaded: Boolean(vrm),
  phase: null,
  floorYFor: (hitY) => floorYFor({ floorY: floorSeen, hitY }, camera),
};
