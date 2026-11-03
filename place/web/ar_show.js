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
//   fps=<数>                  描く fps の上限(既定 30。熱を下げるなら 15)。殻にも伝えて、姿勢を送る頻度を下げる
//   pr=<数>                   描画の解像度の倍率(既定 1。0.5 で縦横半分。熱を下げる)
//   test_center=1             自宅の画面で試すとき: キャラを面 A の正面の中央(前へ test_z m、既定 0.25)に立たせ、ショーの時刻を ar_path の範囲で繰り返す(本番では使わない)
//   show_led=1                殻が解いた LED の面と校正の点を、線と点で重ねて見せる(位置が合っているかを目で確かめる)
//   dots=led3                 会場の 3 面の点の校正(make_led_dots_video.py の 33 点)。省略は自宅のモニターの 5×3(rehearsal/dot_calib.html)
//   dot_rms=<cm>              点の校正の解を採る残差の上限(既定 1.5。会場は 4)
//   殻の点の自動校正: LED に点を順に光らせると、殻が点ごとのレイ {face:'A', dot:番号, origin, direction} を送る。4 隅の手の校正の代わり
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
const demoMode = params.get('demo') === '1' || params.get('demo') === '2';
let demoOrigin = null;     // demo: {p: Vector3, yaw}
const testCenter = params.get('test_center') === '1';
const showLed = params.get('show_led') === '1';
const testZ = Number(params.get('test_z') ?? 0.25);
// 点の校正の格子(殻の DotCalibrator と rehearsal/dot_calib.html と同じ決まり。番号 = 行 * 5 + 列。面 A の中の割合)
const DOT_COLS = 5, DOT_ROWS = 3;
const dotMode = params.get('dots') ?? 'grid';
const dotRms = Number(params.get('dot_rms') ?? 1.5);
// 会場の 3 面の点(make_led_dots_video.py と同じ決まり)。番号順に A 3×3、B 5×3、C 3×3。p は LED の座標(m。x = 面 A の左端から右、y = LED の下端から上、z = 客席のほう)
const LED3 = (() => {
  const out = [];
  const add = (face, cols, rows, rx, ry, rw, rh, toStage) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const px = rx + (0.1 + 0.8 * c / (cols - 1)) * rw, py = ry + (0.15 + 0.7 * r / (rows - 1)) * rh;
      const [X, Y, Z] = toStage(px, py);
      out.push({ face, px, py, p: [(X + 749.7) / 100, (Z - 98) / 100, Y / 100] });
    }
  };
  add('A', 3, 3, 0, 0, 956, 1240, (px, py) => [-749.7 + px * 0.4, 0, 594 - py * 0.4]);
  add('B', 5, 3, 1280, 85, 1759, 1133, (px, py) => [-352 + (px - 957) * (704 / 2388), -140, 594 - (py - 85) * (496 / 1133)]);
  add('C', 3, 3, 3346, 0, 943, 1240, (px, py) => [236.7 + (px - 3039) * 0.4, 0, 594 - py * 0.4]);
  return out;
})();
const dotTotal = dotMode === 'led3' ? LED3.length : DOT_COLS * DOT_ROWS;
const dotFrac = (k) => { const c = k % DOT_COLS, r = Math.floor(k / DOT_COLS); return [0.1 + 0.8 * c / (DOT_COLS - 1), 0.15 + 0.7 * r / (DOT_ROWS - 1)]; };   // [x の割合(左→右), y の割合(上→下)]
const charHeightWanted = params.get('charheight') ? Number(params.get('charheight')) : null;
const A_X0 = -749.7, A_X1 = -237.7;      // 面 A の左右の端(舞台の座標 cm。show/ue/stage_layout.py)
const A_CX = (A_X0 + A_X1) / 2;
const hud = document.getElementById('hud');
const native = hasNativeAR();
if (!native) document.documentElement.classList.add('desktop');
else document.getElementById('bar')?.style.setProperty('display', 'none');

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' });
renderer.setPixelRatio(Number(params.get('pr') ?? 1));
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
    const head0 = await (await fetch(`${trackBase}.json`)).json();
    const head = head0.head ?? head0;   // ショーの形は fps・first・frames・bones が直下(古い形は head の下)
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
// 点の校正: 外れたレイを除きながら解く。良い解(10 点以上・残差 1.5 cm 以下)だけを採り、悪い解で上書きしない(動かしている間に崩れないように)
let lastGoodDots = null;
function solveDots(corners) {
  let use = corners.slice(), r = null;
  for (let it = 0; it < 4; it++) {
    r = solveAlign(use);
    if (!r || !r.errs) return null;
    const med = [...r.errs].sort((a, b) => a - b)[Math.floor(r.errs.length / 2)];
    const lim = Math.max(1.5, 2.5 * med);        // cm
    const kept = use.filter((_, i) => r.errs[i] <= lim);
    if (kept.length === use.length || kept.length < 6) break;
    use = kept;
  }
  r.nDots = new Set(use.map((c) => c.dot)).size;
  r.nAll = corners.length;
  if (dotMode === 'led3') {     // 面ごとの残差(図面と実物の差を見る)
    // 除く前の全部のレイで出す(面が図面からずれていると、その面のレイは外れとして除かれるので、除いた後の残差には出ない)
    const sum = {};
    corners.forEach((c) => {
      const q = LED3[c.dot];
      if (!q) return;
      const P = new THREE.Vector3(...q.p).applyMatrix4(r.T), o = new THREE.Vector3(...c.origin), d = new THREE.Vector3(...c.direction).normalize();
      const v = P.sub(o);
      (sum[q.face] ??= []).push(v.addScaledVector(d, -v.dot(d)).length() * 100);
    });
    r.faces = Object.fromEntries(Object.entries(sum).map(([f, e]) => [f, [...e].sort((x, y) => x - y)[Math.floor(e.length / 2)]]));   // 面ごとの中央値(cm)
  }
  return r;
}
function solveAlign(corners) {
  const pts = { tl: [0, faceH, 0], tr: [faceW, faceH, 0], br: [faceW, 0, 0], bl: [0, 0, 0] };
  const pointOf = (c) => {
    if (c.dot !== undefined) {   // 点: LED の座標(x 右、y 上、原点は左下)
      if (dotMode === 'led3') return LED3[c.dot]?.p;
      const [fx, fy] = dotFrac(c.dot); return [fx * faceW, (1 - fy) * faceH, 0];
    }
    return pts[c.id];
  };
  const rays = corners.filter((c) => c.face === 'A' && pointOf(c)).map((c) => ({ p: pointOf(c), o: new THREE.Vector3(...c.origin), d: new THREE.Vector3(...c.direction).normalize() }));
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
  for (let k = 0; k < 180; k++) { const th = -Math.PI + (k / 180) * 2 * Math.PI; const r = cost(th); if (r.e < best.e) best = { e: r.e, th, t: r.t }; }
  let lo = best.th - Math.PI / 90, hi = best.th + Math.PI / 90;
  for (let it = 0; it < 40; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (cost(m1).e < cost(m2).e) hi = m2; else lo = m1;
  }
  const th = (lo + hi) / 2, r = cost(th);
  const T = new THREE.Matrix4().makeRotationY(th);
  T.setPosition(r.t);
  const errs = rays.map((q, i) => { const P = new THREE.Vector3(...q.p).applyMatrix4(T); const v = P.sub(q.o); const along = v.dot(q.d); return v.addScaledVector(q.d, -along).length() * 100; });
  return { T, rms_cm: Math.sqrt(r.e / rays.length) * 100, yaw_deg: th * 180 / Math.PI, n: rays.length, errs };
}

// ---- LED の面と校正の点を重ねて見せる(show_led=1)-------------------------------------------------
const ledViz = new THREE.Group();
ledViz.matrixAutoUpdate = false;
ledViz.visible = false;
if (showLed) {
  const rectAt = (x0, x1, z) => new THREE.BufferGeometry().setFromPoints([[x0, 0, z], [x1, 0, z], [x1, faceH, z], [x0, faceH, z], [x0, 0, z]].map((p) => new THREE.Vector3(...p)));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
  if (dotMode === 'led3') {
    ledViz.add(new THREE.Line(rectAt(0, 5.12, 0), lineMat));                                   // 面 A
    ledViz.add(new THREE.Line(rectAt((-352 + 749.7) / 100, (352 + 749.7) / 100, -1.4), lineMat));   // 面 B
    ledViz.add(new THREE.Line(rectAt((236.7 + 749.7) / 100, (736.7 + 749.7) / 100, 0), lineMat));   // 面 C の平らな部分
  } else {
    ledViz.add(new THREE.Line(rectAt(0, faceW, 0), lineMat));
  }
  const dotGeo = new THREE.SphereGeometry(dotMode === 'led3' ? 0.08 : 0.008, 10, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
  for (let k = 0; k < dotTotal; k++) {
    const m = new THREE.Mesh(dotGeo, dotMat);
    if (dotMode === 'led3') m.position.set(...LED3[k].p);
    else { const [fx, fy] = dotFrac(k); m.position.set(fx * faceW, (1 - fy) * faceH, 0); }
    ledViz.add(m);
  }
  const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(faceW / 2, faceH / 2, 0), new THREE.Vector3(faceW / 2, faceH / 2, 0.3)]);   // 客席のほう(+z)へ 30 cm
  ledViz.add(new THREE.Line(axis, new THREE.LineBasicMaterial({ color: 0xff3366 })));
  const floor = new THREE.BufferGeometry().setFromPoints([[0, -ledBottom, 0], [faceW, -ledBottom, 0], [faceW, -ledBottom, 0.4], [0, -ledBottom, 0.4], [0, -ledBottom, 0]].map((p) => new THREE.Vector3(...p)));   // 机(会場の床)の面
  ledViz.add(new THREE.Line(floor, new THREE.LineBasicMaterial({ color: 0x33aaff })));
  scene.add(ledViz);
}
function updateLedViz() {
  if (!showLed || !T_world_from_led) return;
  ledViz.matrix.copy(T_world_from_led);
  ledViz.matrixWorldNeedsUpdate = true;
  ledViz.visible = true;
}

// ---- 時刻 ------------------------------------------------------------------------------
let anchorByFlash = false;  // 時刻をフラッシュで始めたか(手で始めた時刻は取り消さない)
let anchorTs = null;       // ショーの startAt 秒に当たる ARFrame の時刻
let lastTs = 0;
function showTime() {
  if (anchorTs === null) return null;
  const t = startAt + (lastTs - anchorTs);
  if (!testCenter || t < pathEnd) return t;
  return pathStart + ((t - pathStart) % (pathEnd - pathStart));
}

function stageToWorld(x, y) {
  if (demoOrigin) {
    const c = Math.cos(demoOrigin.yaw), s = Math.sin(demoOrigin.yaw);
    const lx = posScale * x / 100, lz = posScale * y / 100;
    return new THREE.Vector3(demoOrigin.p.x + lx * c + lz * s, demoOrigin.p.y, demoOrigin.p.z - lx * s + lz * c);
  }
  if (testCenter) return new THREE.Vector3(faceW / 2, -ledBottom, testZ).applyMatrix4(T_world_from_led);
  const lx = faceW / 2 + posScale * (x - A_CX) / 100, lz = posScale * y / 100, ly = -ledBottom;
  return new THREE.Vector3(lx, ly, lz).applyMatrix4(T_world_from_led);
}

// ---- 殻との接続 ---------------------------------------------------------------------------
let frames = 0;
const ar = createNativeAR({ camera });
const host = ar.host;
const origPose = host.onPose;
const targetFps = Number(params.get('fps') ?? 30);
let lastRender = 0;
host.onPose = (w, p, ts) => {
  origPose(w, p);
  if (Number.isFinite(ts)) lastTs = ts;
  if (demoMode && !demoOrigin) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
    const p0 = camera.position.clone().addScaledVector(fwd, 2.0); p0.y = camera.position.y - 1.3;
    demoOrigin = { p: p0, yaw: Math.atan2(-fwd.x, -fwd.z) };   // 客席(= +z)がカメラのほう
    T_world_from_led = new THREE.Matrix4(); alignInfo = 'demo(校正なし)'; if (params.get('demo') !== '2') anchorTs = ts;   // demo=2 は、フラッシュを待って始める
  }
  frames++;
  const nowMs = performance.now();
  if (nowMs - lastRender < 1000 / targetFps - 4) return;   // 描くのを間引く(熱を下げる)
  lastRender = nowMs;
  update();
  renderer.render(scene, camera);
};
host.onCalibration = (json) => {
  const corners = typeof json === 'string' ? JSON.parse(json) : json;
  const isDots = corners.some((c) => c.dot !== undefined);
  if (isDots) {
    if (anchorByFlash) { anchorTs = null; anchorByFlash = false; info(''); }   // 点の映像の緑の合図で始まってしまった分を取り消す(本物のフラッシュは点のあと)
    const r = solveDots(corners);
    const all = new Set(corners.map((c) => c.dot)).size, total = dotTotal;
    if (r && r.nDots >= 10 && r.rms_cm <= dotRms) {
      lastGoodDots = r;
      T_world_from_led = r.T;
      const perFace = r.faces ? ` [${Object.entries(r.faces).map(([f, v]) => `${f} ${v.toFixed(1)}`).join(' ')}]` : '';
      alignInfo = `点 ${r.nDots}/${total}(レイ ${r.n}/${r.nAll}) 残差 ${r.rms_cm.toFixed(1)} cm${perFace} yaw ${r.yaw_deg.toFixed(1)}°`;
      updateLedViz();
      if (testCenter && anchorTs === null) anchorTs = lastTs;   // 自宅のテスト: 校正ができたらすぐ出す
    } else if (lastGoodDots) {
      alignInfo = `前の校正を保持(点 ${lastGoodDots.nDots}/${total} 残差 ${lastGoodDots.rms_cm.toFixed(1)} cm)。今は 点 ${r ? r.nDots : all} 残差 ${r ? r.rms_cm.toFixed(1) : '-'} cm`;
    } else {
      alignInfo = `校正中(点 ${all}/${total}${r ? ` 残差 ${r.rms_cm.toFixed(1)} cm` : ''})`;
    }
    return;
  }
  const r = solveAlign(corners);
  if (r) { T_world_from_led = r.T; alignInfo = `面 A ${r.n} 隅 残差 ${r.rms_cm.toFixed(1)} cm yaw ${r.yaw_deg.toFixed(1)}°`; updateLedViz(); }
  else alignInfo = `校正が足りない(面 A の隅 ${corners.filter((c) => c.face === 'A').length}/4)`;
};
host.onManualStart = () => { anchorTs = lastTs; info('手で開始'); };
host.onFlash = (ts) => {
  if (anchorTs === null) { anchorTs = ts; anchorByFlash = true; info('フラッシュで開始'); }   // 最初の 1 回だけ(同期用の後のフラッシュでずらさない。やり直しは「やり直し」ボタン)
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
      holder.rotation.set(0, yawLed - (testCenter ? 0 : (p.yaw * Math.PI) / 180), 0);   // ショーの yaw: 前の向き (x, y) = (-sin yaw, cos yaw)(客席 +y が yaw 0)
      shown = true;
      if (dance && vrm) { dance.apply(Math.round(t * danceFps)); vrm.update(1 / 30); }
      else simpleMotion(t, true);
    }
  }
  holder.visible = shown;
  if (frames % 60 === 0 && window.webkit?.messageHandlers?.arhost) window.webkit.messageHandlers.arhost.postMessage({ type: 'status', frames, visible: shown, showT: t, align: alignInfo, dance: Boolean(dance), vrm: Boolean(vrm), pos: holder.position.toArray().map((v) => Math.round(v * 100) / 100) });
  if (frames % 15 === 0) {
    hud.textContent = `${alignInfo}  ${t === null ? '合図待ち(フラッシュか「いま開始」)' : `ショー ${t.toFixed(1)} 秒 ${shown ? 'キャラ表示' : '(舞台の出番の外)'}`}  ${infoText}`;
  }
}

if (native) {
  ar.start();
  window.webkit?.messageHandlers?.arhost?.postMessage({ type: 'config', fps: targetFps });
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
  startAt, pathStart, pathEnd, vrmLoaded: Boolean(vrm), dance: Boolean(dance), led3: LED3,
  get T() { return T_world_from_led ? Array.from(T_world_from_led.elements) : null; },
  host,
};
