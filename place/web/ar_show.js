// AR モニター: 端末(iPhone)のカメラ映像の上に、見本のキャラ(VRM)を、ショーの動きと時刻に合わせて描く。撮影中に画角を決めるための、低画質の確認用。
// 殻(撮影記録アプリ)が毎コマ ARKit の姿勢を送る(window.__arhost.onPose)。キャラの位置は、LED の面 A の 4 隅の校正(殻が onCalibration で送る)から求める。
// ショーの時刻: LED の映像の頭の「合図のフラッシュ」を殻が検出して onFlash(ARFrame の時刻)で知らせる。手で押す「いま開始」でもよい。
// URL の引数:
//   vrm=<URL>                 既定 /characters/sample_vrm/model.vrm
//   track=<URL(拡張子なし)>   ショーの踊り(assemble_track の .json + .bin)。無ければ、歩く・立つだけの簡単な動き
//   stage=<URL>               既定 /show/show_stage.json(ar_path = [秒, x cm, y cm, yaw 度])
//   start_at=<秒>             フラッシュ(または「いま開始」)の時刻に、ショーの何秒を当てるか。既定 ar_path の最初の秒
//   scale=<倍率>              舞台の寸法の縮小(自宅の画面で試すとき。既定 1 = 実寸)
//   face_w, face_h            面 A の横・縦(m)。既定 5.12 × 4.96。自宅なら画面の寸法
//   led_bottom=<m>            LED の下端の床からの高さ(m)。既定 0.98
//   charheight=<m>            キャラの背の高さ(m)。既定はそのまま
//   demo=1                    校正なしで試す(熱・遅れの試験用): 最初の姿勢のカメラの 2 m 前の床を舞台の中心にして、客席(カメラ)向きで即座に始める
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createNativeAR, hasNativeAR } from './nativeAR.js';

const params = new URLSearchParams(location.search);
const vrmUrl = params.get('vrm') ?? '/characters/sample_vrm/model.vrm';
const trackBase = params.get('track');
const stageUrl = params.get('stage') ?? '/show/show_stage.json';
const posScale = Number(params.get('scale') ?? 1);
const faceW = Number(params.get('face_w') ?? 5.12);
const faceH = Number(params.get('face_h') ?? 4.96);
const ledBottom = Number(params.get('led_bottom') ?? 0.98);
const demoMode = params.get('demo') === '1';
let demoOrigin = null;     // demo: {p: Vector3, yaw}
const charHeightWanted = params.get('charheight') ? Number(params.get('charheight')) : null;
const A_X0 = -749.7, A_X1 = -237.7;      // 面 A の左右の端(舞台の座標 cm。show/ue/stage_layout.py)
const A_CX = (A_X0 + A_X1) / 2;
const hud = document.getElementById('hud');
const native = hasNativeAR();
if (!native) document.documentElement.classList.add('desktop');

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x998877, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 3, 2);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 80);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- ショーの位置(ar_path)----------------------------------------------------------------
const stage = await (await fetch(stageUrl, { cache: 'no-store' })).json();
const path = stage.ar_path;                              // [[t, x, y, yaw], ...]
const pathStart = path[0][0], pathEnd = path[path.length - 1][0];
const startAt = Number(params.get('start_at') ?? pathStart);
function pathAt(t) {
  if (t < pathStart || t > pathEnd) return null;
  let i = 0;
  while (i < path.length - 2 && path[i + 1][0] <= t) i++;
  const a = path[i], b = path[i + 1];
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  const yaw = a[3] + (b[3] - a[3]) * k;
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, yaw };
}

// ---- キャラ ------------------------------------------------------------------------------
const holder = new THREE.Group();
holder.visible = false;
scene.add(holder);
let vrm = null, bones = null;
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
  bones = {};
  for (const n of ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg']) {
    bones[n] = vrm.humanoid.getNormalizedBoneNode(n);
    if (bones[n]) rest.set(n, { q: bones[n].quaternion.clone(), p: bones[n].position.clone() });
  }
} catch (e) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.25), new THREE.MeshStandardMaterial({ color: 0xe0527a }));
  m.position.y = 0.8;
  holder.add(m);
  hud.textContent = 'VRM を読めなかったので箱で試す: ' + (e?.message ?? e);
}
const bbox = new THREE.Box3().setFromObject(holder);
const naturalHeight = Number.isFinite(bbox.max.y - bbox.min.y) && bbox.max.y - bbox.min.y > 0.2 ? bbox.max.y - bbox.min.y : 1.6;
holder.scale.setScalar(charHeightWanted ? charHeightWanted / naturalHeight : posScale);   // 実寸(scale=1)のときは等身大

// ---- ショーの踊り(任意)--------------------------------------------------------------------
let dance = null, danceFirst = 0, danceFps = 30;
if (trackBase && vrm) {
  try {
    const head = await (await fetch(`${trackBase}.json`)).json();
    const data = new Float32Array(await (await fetch(`${trackBase}.bin`)).arrayBuffer());
    const stride = 3 + 4 * head.bones.length;
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    const hipsRest = hips.position.clone();
    const nodes = head.bones.map((n) => vrm.humanoid.getNormalizedBoneNode(n));
    danceFirst = head.first ?? 0;
    danceFps = head.fps ?? 30;
    dance = {
      frames: head.frames,
      apply(frame) {
        const i = Math.min(Math.max(frame - danceFirst, 0), head.frames - 1);
        const at = i * stride;
        hips.position.set(hipsRest.x + data[at], hipsRest.y + data[at + 1], hipsRest.z + data[at + 2]);
        nodes.forEach((n, b) => { if (n) { const q = at + 3 + b * 4; n.quaternion.set(data[q], data[q + 1], data[q + 2], data[q + 3]); } });
      },
    };
  } catch (e) { hud.textContent = '踊りを読めなかった: ' + (e?.message ?? e); }
}

const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
function simpleMotion(t, walking) {         // 踊りが無いとき: 歩く・立つだけ
  if (!bones) return;
  const phase = t * Math.PI * 3, amp = walking ? 1 : 0;
  const set = (name, q) => { const b = bones[name]; if (b) b.quaternion.copy(rest.get(name).q).multiply(q); };
  const sw = Math.sin(phase) * 0.55 * amp;
  set('leftUpperLeg', qx(-sw)); set('rightUpperLeg', qx(sw));
  set('leftLowerLeg', qx(Math.max(0, Math.sin(phase + 1.2)) * 0.7 * amp)); set('rightLowerLeg', qx(Math.max(0, Math.sin(phase + 4.34)) * 0.7 * amp));
  set('leftUpperArm', qx(sw * 0.6).multiply(qz(-1.25))); set('rightUpperArm', qx(-sw * 0.6).multiply(qz(1.25)));
}

// ---- LED の面 A の位置合わせ(殻が送る 4 隅のレイから、世界 ← LED の変換を解く)-----------------------------
let T_world_from_led = null, alignInfo = '未校正';
function solveAlign(corners) {
  const pts = { tl: [0, faceH, 0], tr: [faceW, faceH, 0], br: [faceW, 0, 0], bl: [0, 0, 0] };
  const rays = corners.filter((c) => c.face === 'A' && pts[c.id]).map((c) => ({ p: pts[c.id], o: new THREE.Vector3(...c.origin), d: new THREE.Vector3(...c.direction).normalize() }));
  if (rays.length < 3) return null;
  const cost = (theta) => {
    const R = new THREE.Matrix4().makeRotationY(theta);
    const A = new THREE.Matrix3(), b = new THREE.Vector3();
    const Aa = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const bb = [0, 0, 0];
    const rp = rays.map((r) => new THREE.Vector3(...r.p).applyMatrix4(R));
    rays.forEach((r, i) => {
      // M = I - d d^T、t を未知として Σ |M (R p + t - o)|² を最小に
      const d = r.d;
      const M = [[1 - d.x * d.x, -d.x * d.y, -d.x * d.z], [-d.y * d.x, 1 - d.y * d.y, -d.y * d.z], [-d.z * d.x, -d.z * d.y, 1 - d.z * d.z]];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) Aa[a][c] += M[a][c];
      const diff = new THREE.Vector3().subVectors(r.o, rp[i]);
      for (let a = 0; a < 3; a++) bb[a] += M[a][0] * diff.x + M[a][1] * diff.y + M[a][2] * diff.z;
    });
    const m = new THREE.Matrix3().set(Aa[0][0], Aa[0][1], Aa[0][2], Aa[1][0], Aa[1][1], Aa[1][2], Aa[2][0], Aa[2][1], Aa[2][2]);
    const inv = m.clone().invert();
    const t = new THREE.Vector3(bb[0], bb[1], bb[2]).applyMatrix3(inv);
    let e = 0;
    rays.forEach((r, i) => {
      const P = rp[i].clone().add(t);
      const v = P.clone().sub(r.o);
      const along = v.dot(r.d);
      e += v.clone().addScaledVector(r.d, -along).lengthSq();
    });
    return { e, t };
  };
  let best = { e: Infinity, th: 0, t: null };
  for (let k = 0; k < 720; k++) { const th = -Math.PI + (k / 720) * 2 * Math.PI; const r = cost(th); if (r.e < best.e) best = { e: r.e, th, t: r.t }; }
  let lo = best.th - Math.PI / 360, hi = best.th + Math.PI / 360;
  for (let it = 0; it < 40; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (cost(m1).e < cost(m2).e) hi = m2; else lo = m1;
  }
  const th = (lo + hi) / 2, r = cost(th);
  const T = new THREE.Matrix4().makeRotationY(th);
  T.setPosition(r.t);
  return { T, rms_cm: Math.sqrt(r.e / rays.length) * 100, yaw_deg: th * 180 / Math.PI, n: rays.length };
}

// ---- 時刻 ------------------------------------------------------------------------------
let anchorTs = null;       // ショーの startAt 秒に当たる ARFrame の時刻
let lastTs = 0;
function showTime() { return anchorTs === null ? null : startAt + (lastTs - anchorTs); }

function stageToWorld(x, y) {
  if (demoOrigin) {
    const c = Math.cos(demoOrigin.yaw), s = Math.sin(demoOrigin.yaw);
    const lx = posScale * x / 100, lz = posScale * y / 100;
    return new THREE.Vector3(demoOrigin.p.x + lx * c + lz * s, demoOrigin.p.y, demoOrigin.p.z - lx * s + lz * c);
  }
  const lx = faceW / 2 + posScale * (x - A_CX) / 100, lz = posScale * y / 100, ly = -ledBottom;
  return new THREE.Vector3(lx, ly, lz).applyMatrix4(T_world_from_led);
}

// ---- 殻との接続 ---------------------------------------------------------------------------
let frames = 0;
const ar = createNativeAR({ camera });
const host = ar.host;
const origPose = host.onPose;
host.onPose = (w, p, ts) => {
  origPose(w, p);
  if (Number.isFinite(ts)) lastTs = ts;
  if (demoMode && !demoOrigin) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
    const p0 = camera.position.clone().addScaledVector(fwd, 2.0); p0.y = camera.position.y - 1.3;
    demoOrigin = { p: p0, yaw: Math.atan2(-fwd.x, -fwd.z) };   // 客席(= +z)がカメラのほう
    T_world_from_led = new THREE.Matrix4(); alignInfo = 'demo(校正なし)'; anchorTs = ts;
  }
  frames++;
  update();
  renderer.render(scene, camera);
};
host.onCalibration = (json) => {
  const corners = typeof json === 'string' ? JSON.parse(json) : json;
  const r = solveAlign(corners);
  if (r) { T_world_from_led = r.T; alignInfo = `面 A ${r.n} 隅 残差 ${r.rms_cm.toFixed(1)} cm yaw ${r.yaw_deg.toFixed(1)}°`; }
  else alignInfo = `校正が足りない(面 A の隅 ${corners.filter((c) => c.face === 'A').length}/4)`;
};
host.onFlash = (ts) => {
  if (anchorTs === null || (Number.isFinite(ts) && ts - anchorTs > 20)) { anchorTs = ts; info('フラッシュで開始'); }
};
let infoText = '';
function info(t) { infoText = t; }

function update() {
  const t = showTime();
  let shown = false;
  if (T_world_from_led && t !== null) {
    const p = pathAt(t);
    if (p) {
      const pos = stageToWorld(p.x, p.y);
      holder.position.copy(pos);
      // 向き: 客席(LED の +z)向き = yaw 0。LED の向きを世界へ
      const yawLed = demoOrigin ? demoOrigin.yaw : Math.atan2(T_world_from_led.elements[8], T_world_from_led.elements[10]);   // 世界での LED の +z の向きの回転(y 回り)
      holder.rotation.set(0, yawLed + (p.yaw * Math.PI) / 180, 0);
      shown = true;
      if (dance && vrm) { dance.apply(Math.round(t * danceFps)); vrm.update(1 / 30); }
      else simpleMotion(t, true);
    }
  }
  holder.visible = shown;
  if (frames % 15 === 0) {
    hud.textContent = `${alignInfo}  ${t === null ? '合図待ち(フラッシュか「いま開始」)' : `ショー ${t.toFixed(1)} 秒 ${shown ? 'キャラ表示' : '(舞台の出番の外)'}`}  ${infoText}`;
  }
}

if (native) {
  ar.start();
} else {
  // 殻なし(ブラウザで確認): 面 A の 4 隅を (0,1.2,0) の前に置いた仮のレイで校正し、フラッシュ代わりに開始する
  camera.position.set(2.5, 1.3, 5);
  camera.lookAt(2.5, 1.0, 0);
  camera.updateMatrixWorld();
  const o = camera.position.toArray();
  const pts = { tl: [0, faceH, 0], tr: [faceW, faceH, 0], br: [faceW, 0, 0], bl: [0, 0, 0] };
  const fake = Object.entries(pts).map(([id, p]) => ({ face: 'A', id, origin: o, direction: [p[0] - o[0], p[1] - ledBottom * 0 - o[1], p[2] - o[2]] }));
  host.onCalibration(fake);
  host.onFlash(0);
  const loop = () => { lastTs += 1 / 30; frames++; update(); renderer.render(scene, camera); setTimeout(loop, 33); };
  loop();
}
document.getElementById('start').addEventListener('click', () => { anchorTs = lastTs; info('手で開始'); });
document.getElementById('reset').addEventListener('click', () => { anchorTs = null; info(''); });

window.__arShow = {
  ready: true, native,
  get align() { return alignInfo; },
  get showTime() { return showTime(); },
  get visible() { return holder.visible; },
  get position() { return holder.position.toArray(); },
  startAt, pathStart, pathEnd, vrmLoaded: Boolean(vrm), dance: Boolean(dance),
};
