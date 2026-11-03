// ショーの全編を 1 コマずつ描くページ。不透明の 5680×1240 に、背景のシェーダーとキャラを描く。
// 時刻はコマ番号だけで決まる。乱数は固定の種。途中のコマから始めるときも、キャラの動きは 0 コマ目から計算し直す。
// URL の引数: character, stretch, cx, timeline(URL), motion(URL), fit("大きさ,縦のずれ"), measure=1, display=1, run=measure|render, from, to
// 自動操作の道具はつながない。結果は /result へ、コマは /frame へ自分で送る。
import * as THREE from 'three';
import { createStagePicture } from './show_stage.mjs';
import { loadCharacter, characterUrl } from '/web/src/character/index.js';
import { ShowTiming } from './show_timing.mjs';
import { BACKGROUND_VERTEX, BACKGROUND_FRAGMENT } from './show_background.mjs';
import { TenBitOutput } from './show_output.mjs';

const report = (message) => fetch('/result', { method: 'POST', body: JSON.stringify(message) });
window.addEventListener('error', (e) => report({ kind: 'error', text: `${e.message} ${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => report({ kind: 'error', text: String(e.reason?.stack ?? e.reason) }));

const RANDOM_SEED = 20261103;
let randomState = RANDOM_SEED;
const seededRandom = () => {
  randomState = (randomState + 0x6d2b79f5) | 0;
  let v = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
};
Math.random = seededRandom;

const W = 5680;
const H = 1240;
const SEAM_L = 1279;
const SEAM_R = 3039;
const FLOOR_Y = 1196; // 足元の高さ(中央の面は y 1218 まで映る)
const DIGIT = [640, 620, 90]; // カウントダウンの数字: A 面の真ん中、高さ 90
const SYNC_NUMBER_Y = 1000; // 同期の区間のコマ番号の高さ
const SYNC_NUMBER_HEIGHT = 170;
const MASK_SCALE = 0.5; // キャラの枠を測る絵の縮尺
const MEASURE_SCALE = 0.25; // 大きさを決める下調べの縮尺
const MEASURE_STEP = 2; // 下調べは 2 コマに 1 回
const REF_HEIGHT_PX = 500; // 下調べのときのキャラの高さ
const ALPHA_MIN = 8;
const RING_COUNT = 4;

const q = new URLSearchParams(location.search);
const STRETCH = Number(q.get('stretch') ?? 1.48);
const CENTER_X = Number(q.get('cx') ?? 2159);
const DISPLAY = q.get('display') === '1';
const MEASURE = q.get('measure') === '1';
const MEASURE_NO_DANCE = q.get('nodance') === '1'; // 踊りなしで確かめるとき
const DANCE_TRACK = q.get('dancetrack') === '1';
const STAGE = q.get('stage') === '1' ? await (await fetch('/show/show_stage.json')).json() : null; // LED の中の会場・等身大・左右のモニター
const RAW_EXPRESSIONS = q.get('rawexpr') === '1'; // 表情を読みかえない(VRM にその表情があるとき)
const NO_CHARACTER = q.get('nocharacter') === '1'; // キャラだけ描かない版。背景と時刻は同じ
const FIT = JSON.parse(q.get('fit') ?? 'null'); // render_show.mjs の computeFit の結果
const MOUTH_GAIN_OVERRIDE = q.get('mouthgain') ? Number(q.get('mouthgain')) : null;

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`読めません: ${url} (${res.status})`);
  return res.json();
};
const timeline = await fetchJson(q.get('timeline') ?? '/show-data/timeline.json');
const motion = await fetchJson(q.get('motion') ?? '/show/show_motion.json');
const timing = new ShowTiming(timeline, motion);
const FPS = timing.fps;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NoToneMapping;
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('浮動小数の絵に描けません(EXT_color_buffer_float がありません)');

const hdrTarget = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
const maskW = Math.round(W * (MEASURE ? MEASURE_SCALE : MASK_SCALE));
const maskH = Math.round(H * (MEASURE ? MEASURE_SCALE : MASK_SCALE));
const maskTarget = new THREE.WebGLRenderTarget(maskW, maskH, { type: THREE.UnsignedByteType, depthBuffer: true });
const maskPixels = new Uint8Array(maskW * maskH * 4);
const output = new TenBitOutput(gl, W, H);

const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xfff1e0, 0x2a2540, 1);
const key = new THREE.DirectionalLight(0xffffff, 1);
key.position.set(0.3, 3.2, 2.4);
const rimLeft = new THREE.DirectionalLight(0x38e6d8, 1);
rimLeft.position.set(-2.6, 1.2, -1.2);
const rimRight = new THREE.DirectionalLight(0xff3f90, 1);
rimRight.position.set(2.6, 1.2, -1.2);
scene.add(hemi, key, rimLeft, rimRight);

const uniforms = {
  uRes: { value: new THREE.Vector2(W, H) },
  uCx: { value: CENTER_X },
  uStretch: { value: STRETCH },
  uSeamL: { value: SEAM_L },
  uSeamR: { value: SEAM_R },
  uFloorY: { value: FLOOR_Y },
  uT: { value: 0 },
  uFlow: { value: 0 },
  uBeatPos: { value: 0 },
  uPulse: { value: 0 },
  uDown: { value: 0 },
  uEnergy: { value: 0 },
  uIgniteAge: { value: 1000 },
  uBeatSec: { value: timing.beatSec },
  uDrive: { value: 0 },
  uBarIndex: { value: 0 },
  uRingAge: { value: new Array(RING_COUNT).fill(1000) },
  uCone: { value: 0 },
  uConeDrop: { value: 0 },
  uPool: { value: 0 },
  uSong: { value: 0 },
  uEmber: { value: 0 },
  uWarm: { value: 0 },
  uWash: { value: 0 },
  uShadow: { value: 0 },
};
const background = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ vertexShader: BACKGROUND_VERTEX, fragmentShader: BACKGROUND_FRAGMENT, uniforms, depthTest: false, depthWrite: false }),
);
background.frustumCulled = false;
background.renderOrder = -1000;
scene.add(background);
const stagePicture = STAGE ? await createStagePicture({ THREE, renderer, stage: STAGE, W, H, FPS, CENTER_X, uniforms }) : null;

const character = await loadCharacter(characterUrl(q.get('character') ?? 'f_led'));
scene.add(character.object3d);
character.lookAt(null);
character.update(0);
const restBox = new THREE.Box3().setFromObject(character.object3d);
const bodyHeight = restBox.max.y - restBox.min.y;
const bodyMidY = (restBox.max.y + restBox.min.y) / 2;

// キャラ自身の明るさ(発光)を場面で変えるために、もとの値を覚える。顔は光る面なので触らない
const faceMaterial = character.face?.mesh?.material ?? null;
const liftMaterials = [];
character.object3d.traverse((o) => {
  const m = o.isMesh ? o.material : null;
  if (m && m !== faceMaterial && m.emissiveIntensity > 0) liftMaterials.push({ material: m, base: m.emissiveIntensity });
});

// カメラ: 下調べの基準(高さ REF_HEIGHT_PX、中心は絵の真ん中、伸ばしなし)に、大きさ・伸ばし・ずらしを掛ける
const camera = new THREE.PerspectiveCamera(14, W / H, 0.05, 100);
const fy = camera.projectionMatrix.elements[5];
const distance = (fy * bodyHeight * H) / 2 / REF_HEIGHT_PX;
camera.position.set(0, bodyMidY, distance);
camera.lookAt(0, bodyMidY, 0);
camera.updateMatrixWorld(true);
const projection = camera.projectionMatrix;
const baseE0 = projection.elements[0];
const baseE5 = projection.elements[5];

/** そのコマのカメラ。寄りの量に合わせて、大きさと縦の位置を変える。絵の座標の決まった点(anchor)が、決まった高さに来る */
function applyCamera(amount) {
  if (MEASURE || !FIT) return;
  const zoom = 1 + (FIT.zoom - 1) * amount;
  const anchorY = FIT.anchorFull + (FIT.anchorZoom - FIT.anchorFull) * amount;
  const k = FIT.scale * zoom;
  projection.elements[0] = baseE0 * k * STRETCH;
  projection.elements[5] = baseE5 * k;
  projection.elements[8] = -((CENTER_X - W / 2) / (W / 2));
  projection.elements[9] = (anchorY - H / 2 - k * (FIT.anchorRefY - H / 2)) / (H / 2);
}
applyCamera(0);
if (STAGE) uniforms.uFloorY.value = STAGE.life_size.foot_y;
camera.projectionMatrixInverse.copy(projection).invert();
camera.updateProjectionMatrix = () => {}; // 手で入れた行列を上書きさせない

// 動きは読み込みが終わった順に並ぶので、名前の順に作り直す(混ぜる順で値がわずかに変わるため)
if (character.mixer && character.actions) {
  const clips = [...character.actions.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
  character.mixer.stopAllAction();
  character.mixer.uncacheRoot(character.mixer.getRoot());
  character.actions.clear();
  for (const [name, action] of clips) {
    const fresh = character.mixer.clipAction(action.getClip());
    fresh.setEffectiveWeight(0);
    character.actions.set(name, fresh);
  }
  character._startLoop('idle', 1);
  character._startLoop('talk', 0);
}

let characterRandomState = RANDOM_SEED;
character.blinkTimer = 3;

const RISE_DISTANCE = bodyHeight * 1.2;
const IS_VRM = character.kind === 'vrm';
const vrmConfig = motion.vrm ?? {};
const mouthGain = MOUTH_GAIN_OVERRIDE ?? vrmConfig.mouth?.gain ?? 1;
const mouthPower = vrmConfig.mouth?.power ?? 1;
let hop = null; // VRM の jump の代わりの、体ごとの跳ね

// 踊りの部品。ファイルがあれば、VRM の骨の計算の直前に呼ぶ(無くても動く)。
// 踊りは体の向き・弾み・身ぶりも持つので、踊りがあるときは台本の play・bounce・turn_deg を使わない(表情と目線は使う)
let currentFrame = 0;
let dancing = false;
const STANDARD_EXPRESSIONS = new Set(['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'think']);

const SING = DANCE_TRACK ? await fetch('/show-data/dance_track_sing.json').then((r) => (r.ok ? r.json() : null)) : null;
const MOUTH_VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];
const MOOD_FADE = 12; // コマ

/** 歌詞の読みの母音で口を動かし、歌詞の気持ちで表情を決める。歌の間だけ */
function applySinging(manager) {
  const i = currentFrame - SING.first;
  if (i < 0 || i >= SING.frames) return false;
  for (const v of MOUTH_VOWELS) manager.setValue(v, SING.vowels[v][i]);
  const weights = new Map();
  for (const [a, b, name, w] of SING.moods) {
    if (currentFrame < a - MOOD_FADE || currentFrame > b + MOOD_FADE) continue;
    const k = Math.min(Math.min(1, (currentFrame - a + MOOD_FADE) / MOOD_FADE), Math.min(1, (b + MOOD_FADE - currentFrame) / MOOD_FADE));
    weights.set(name, Math.max(weights.get(name) ?? 0, w * k));
  }
  for (const key of character.emotionKeys) manager.setValue(key, weights.get(key) ?? 0);
  for (const [name, w] of weights) if (character.available.has(name)) manager.setValue(name, w);
  return true;
}

/** 標準でない表情(漫符など)と singBig を、VRM の表情へ渡す。キャラの土台は標準の表情しか渡さない */
function applyCustomExpressions() {
  const manager = character.vrm.expressionManager;
  if (!manager) return;
  for (const [name, value] of character.exprValue) {
    if (!STANDARD_EXPRESSIONS.has(name) && character.available.has(name)) manager.setValue(name, value);
  }
  if (SING && applySinging(manager)) return;
  const big = vrmConfig.sing_big;
  if (big && character.available.has('singBig')) {
    const input = timeline.mouth[currentFrame] ?? 0;
    const strong = Math.max(0, (input - big.from_input) / (1 - big.from_input));
    manager.setValue('singBig', timing.driveCurve[currentFrame] >= big.min_drive ? strong * big.max : 0);
  }
}

if (IS_VRM) {
  let dance = null;
  let danceInputOf = null;
  const danceFile = DANCE_TRACK ? './show_vrm_track.mjs' : './show_vrm_dance.mjs';
  if (!MEASURE_NO_DANCE && (await fetch(danceFile, { method: 'HEAD' })).ok) {
    const module = await import(danceFile);
    dance = module.createDance(character.vrm, timeline);
    danceInputOf = module.danceInput;
    dancing = true;
  }
  const updateVrm = character.vrm.update.bind(character.vrm);
  character.vrm.update = (dt) => {
    if (dance) dance.apply(danceInputOf(timeline, currentFrame));
    applyCustomExpressions();
    updateVrm(dt);
  };
}

const lastLook = { value: undefined };
let expressionBack = null; // 決まった秒だけ出す表情の、戻す先
const anchor = new THREE.Vector3();

// 土台の表情の強さは VRM だけに効かせる。パネルのキャラは表情の行を選ぶだけ
function setExpressionFor(name, weight, frame) {
  if (!IS_VRM) {
    character.setEmotion?.(name, 1);
    return;
  }
  const available = character.available?.has(name);
  const mapped = available ? null : vrmConfig.expression_map?.[name];
  character.setEmotion?.(mapped?.expr ?? name, mapped?.weight ?? weight ?? 1);
  if (lastLook.value) {
    const [x, y, z] = lastLook.value;
    character.lookAt([x, y - (mapped?.look_down_m ?? 0), z]);
  }
  const hold = available ? vrmConfig.expression_hold?.[name] : null;
  expressionBack = hold ? { frame: frame + Math.round(hold.sec * FPS), expr: hold.then, weight: hold.then_weight } : null;
}

function applyEvents(frame) {
  if (expressionBack && frame >= expressionBack.frame) {
    const back = expressionBack;
    expressionBack = null;
    setExpressionFor(back.expr, back.weight, frame);
  }
  for (const ev of timing.events.get(frame) ?? []) {
    if ('look' in ev && ev.look !== lastLook.value) {
      character.lookAt(ev.look);
      lastLook.value = ev.look;
    }
    if (ev.expr) setExpressionFor(ev.expr, ev.exprWeight, frame);
    if (dancing) continue;
    const sectionMap = vrmConfig.section_motion_map?.[timing.primary(frame / FPS).id];
    const name = ev.play && IS_VRM ? sectionMap?.[ev.play] ?? vrmConfig.motion_map?.[ev.play] ?? ev.play : ev.play;
    if (name === 'hop') {
      hop = { start: frame, frames: Math.round((ev.beats ?? 2) * timing.beatSec * FPS), height: (vrmConfig.hop_m ?? 0) * (ev.weight ?? 1) };
    } else if (name && character.play(name)) {
      const action = character.actions?.get(name);
      if (action) {
        action.timeScale = ev.beats ? action.getClip().duration / (ev.beats * timing.beatSec) : 1;
        action.weight = ev.weight ?? 1;
      }
    }
  }
}

function hopHeight(frame) {
  if (!hop || frame >= hop.start + hop.frames) return 0;
  return hop.height * Math.sin((Math.PI * (frame - hop.start)) / hop.frames);
}

/** キャラを 1 コマ進める。描かなくても毎コマ呼ぶ(動きの状態がつながるように) */
function stepCharacter(frame) {
  const t = frame / FPS;
  currentFrame = frame;
  applyEvents(frame);
  const rawMouth = timeline.mouth[frame] ?? 0;
  character.setMouth(IS_VRM ? mouthGain * rawMouth ** mouthPower : rawMouth);
  const o = character.object3d;
  const bounce = dancing ? { y: 0, sq: 0, sway: 0 } : timing.bounce(t);
  const rise = MEASURE ? 1 : timing.rise(t);
  o.visible = !NO_CHARACTER && timing.characterVisible(t) && (!stagePicture || stagePicture.characterOnLed(t));
  o.position.y = bounce.y + hopHeight(frame) + (rise - 1) * RISE_DISTANCE;
  // 手付けの踊りは向きも自分で持つ。既存の動きを並べた 1 本は、聞く・答える向きをここで足す
  o.rotation.y = dancing && !DANCE_TRACK ? 0 : THREE.MathUtils.degToRad(timing.turnDeg(t));
  o.rotation.z = THREE.MathUtils.degToRad(bounce.sway);
  const squash = IS_VRM ? 0 : bounce.sq; // 人型はつぶさない
  o.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
  // 描画の側(three の内部の id 作りなど)も Math.random を使うので、キャラの分だけ乱数の流れを分ける
  randomState = characterRandomState;
  character.update(1 / FPS);
  characterRandomState = randomState;
  // 描かないコマでも、描くコマと同じ状態にする(次のコマの計算が、前のコマの座標を読むので)
  scene.updateMatrixWorld();
}

function setScene(frame) {
  const t = frame / FPS;
  const look = timing.look(t);
  const beat = timing.beat(t);
  const u = uniforms;
  u.uDrive.value = timing.driveCurve[frame];
  u.uIgniteAge.value = timing.igniteAge(t);
  u.uT.value = t;
  u.uFlow.value = timing.flow[frame];
  u.uBeatPos.value = beat.pos;
  u.uPulse.value = beat.pulse;
  u.uDown.value = beat.down;
  u.uEnergy.value = timing.energySm[frame];
  u.uBarIndex.value = beat.bar;
  u.uRingAge.value = timing.ringAges(t, RING_COUNT);
  u.uCone.value = look.cone;
  u.uConeDrop.value = timing.coneDrop(t);
  u.uPool.value = look.pool;
  u.uSong.value = look.song;
  u.uEmber.value = look.ember;
  u.uWarm.value = look.warm;
  u.uWash.value = look.wash;
  u.uShadow.value = timing.characterVisible(t) && (!stagePicture || stagePicture.characterOnLed(t)) ? timing.rise(t) : 0;

  const lightGain = IS_VRM ? vrmConfig.light_gain ?? 1 : 1;
  const pulse = lightGain * (1 + 0.9 * beat.pulse + 0.8 * beat.down);
  key.intensity = look.key * lightGain;
  key.color.setRGB(1, 1 - 0.18 * look.warm, 1 - 0.42 * look.warm);
  rimLeft.intensity = look.rim * pulse;
  rimRight.intensity = look.rim * pulse;
  hemi.intensity = look.hemi * lightGain;
  applyCamera(IS_VRM ? timing.zoomAmount(t) : 0);
  if (stagePicture) stagePicture.setPlate(timing.primary(t), t, look.song);
  for (const item of liftMaterials) item.material.emissiveIntensity = item.base * look.lift;
}

/** 背景なしでキャラだけを描き、不透明な部分の外接の枠を測る(5680×1240 の座標で返す) */
function measureBox(scale) {
  background.visible = false;
  renderer.setRenderTarget(maskTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(maskTarget, 0, 0, maskW, maskH, maskPixels);
  renderer.setRenderTarget(null);
  background.visible = true;
  let x0 = maskW;
  let x1 = -1;
  let y0 = maskH;
  let y1 = -1;
  for (let y = 0; y < maskH; y++) {
    const row = y * maskW * 4;
    for (let x = 0; x < maskW; x++) {
      if (maskPixels[row + x * 4 + 3] > ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  // 読み出しの行は下から上。上からの座標へ直し、ピクセルの外側の端を返す
  return [x0 / scale, (maskH - 1 - y1) / scale, (x1 + 1) / scale, (maskH - y0) / scale].map((v) => Math.round(v * 10) / 10);
}

/** 足元(キャラの原点)の絵の上の位置。あとで舞台の 3D のキャラとつなぐときに使う */
function footPoint() {
  character.object3d.getWorldPosition(anchor);
  anchor.project(camera);
  return [Math.round((anchor.x + 1) * 0.5 * W * 10) / 10, Math.round((1 - anchor.y) * 0.5 * H * 10) / 10];
}

function drawFrame(frame) {
  setScene(frame);
  if (stagePicture) stagePicture.renderMonitors(frame, scene, character, background);
  renderer.setRenderTarget(hdrTarget);
  renderer.render(scene, camera);
  if (stagePicture) stagePicture.drawOver(frame, hdrTarget);
  renderer.setRenderTarget(null);
  const source = renderer.properties.get(hdrTarget.texture).__webglTexture;
  const t = frame / FPS;
  const sync = timing.sync(frame);
  const params = { master: timing.master(t), frame, count: timing.countdown(t), digit: DIGIT, frameNumber: sync.number, flash: sync.flash, numberBox: [CENTER_X, SYNC_NUMBER_Y, SYNC_NUMBER_HEIGHT, STRETCH] };
  const pixels = output.renderAndRead(source, params);
  if (DISPLAY) output.renderToCanvas(source, params);
  renderer.resetState();
  return pixels;
}

window.showInfo = { W, H, gpuName, frames: timing.frames, fps: FPS, stretch: STRETCH, cx: CENTER_X, bodyHeight, kind: character.kind, motions: character.motionNames ?? null };

/** 太ももの真ん中の、下調べの絵の上の高さ。VRM だけ */
function thighRefY() {
  const upper = character.vrm?.humanoid?.getNormalizedBoneNode('leftUpperLeg');
  const lower = character.vrm?.humanoid?.getNormalizedBoneNode('leftLowerLeg');
  if (!upper || !lower) return null;
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  return (1 - a.add(b).multiplyScalar(0.5).project(camera).y) * 0.5 * H;
}

const grow = (box, b) => {
  box[0] = Math.min(box[0], b[0]);
  box[1] = Math.min(box[1], b[1]);
  box[2] = Math.max(box[2], b[2]);
  box[3] = Math.max(box[3], b[3]);
};

/** 下調べ: 伸ばしなし・基準の大きさで全部の動きを流し、全身の場面と寄りの場面の外接の枠を返す。enter の上がる途中は数えない */
window.showMeasure = () => {
  const full = [Infinity, Infinity, -Infinity, -Infinity];
  const zoomed = [Infinity, Infinity, -Infinity, -Infinity];
  let thigh = null;
  for (let f = 0; f < timing.frames; f++) {
    stepCharacter(f);
    if (!character.object3d.visible || f % MEASURE_STEP !== 0) continue;
    const b = measureBox(MEASURE_SCALE);
    if (!b) continue;
    if (thigh === null) thigh = thighRefY();
    grow(IS_VRM && q.get('nozoom') !== '1' && timing.zoomAmount(f / FPS) > 0.01 ? zoomed : full, b);
  }
  return { box: full, zoomedBox: Number.isFinite(zoomed[0]) ? zoomed : null, thighRefY: thigh, refCenterX: W / 2, refCenterY: H / 2, isVrm: IS_VRM };
};

/** from〜to のコマを描いて、1 コマずつ /frame へ送る。キャラの動きは 0 コマ目から計算する */
window.showRun = async (from, to) => {
  const ms = { sim: 0, draw: 0, box: 0, send: 0 };
  for (let f = 0; f < from; f++) stepCharacter(f);
  for (let f = from; f < to; f++) {
    let a = performance.now();
    stepCharacter(f);
    let b = performance.now();
    ms.sim += b - a;
    a = b;
    const pixels = drawFrame(f);
    b = performance.now();
    ms.draw += b - a;
    a = b;
    const box = character.object3d.visible ? measureBox(MASK_SCALE) : null;
    const foot = box ? footPoint() : null;
    const zoomNow = IS_VRM ? timing.zoomAmount(f / FPS) : 0;
    b = performance.now();
    ms.box += b - a;
    a = b;
    const res = await fetch(`/frame?f=${f}`, { method: 'POST', body: pixels, headers: { 'x-box': JSON.stringify({ box, foot, zoom: zoomNow }), 'content-type': 'application/octet-stream' } });
    if (!res.ok) throw new Error(`コマ ${f} を送れません: ${res.status}`);
    ms.send += performance.now() - a;
  }
  return ms;
};

/** 描かずに、全部の骨の局所の位置と回転・顔の形の重みを 1 コマずつ送る。UE で同じ動きを再生するため */
window.showPose = async (from, to) => {
  const bones = [];
  let face = null;
  character.vrm.scene.traverse((node) => {
    if (node.isBone) bones.push(node);
    if (!face && node.isMesh && node.morphTargetInfluences?.length) face = node;
  });
  const names = Object.entries(face.morphTargetDictionary).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  await fetch('/pose-head', { method: 'POST', body: JSON.stringify({ first: from, bones: bones.map((b) => b.name), morphs: names }) });
  const size = 7 + bones.length * 7 + names.length;
  const CHUNK = 300;
  const buffer = new Float32Array(size * CHUNK);
  for (let f = 0; f < from; f++) stepCharacter(f);
  let used = 0;
  const flush = async () => {
    if (used) await fetch('/pose', { method: 'POST', body: buffer.slice(0, used * size) });
    used = 0;
  };
  for (let f = from; f < to; f++) {
    stepCharacter(f);
    let at = used * size;
    buffer[at++] = character.object3d.position.x;
    buffer[at++] = character.object3d.position.y;
    buffer[at++] = character.object3d.position.z;
    buffer[at++] = character.object3d.quaternion.x;
    buffer[at++] = character.object3d.quaternion.y;
    buffer[at++] = character.object3d.quaternion.z;
    buffer[at++] = character.object3d.quaternion.w;
    for (const b of bones) {
      buffer[at++] = b.position.x;
      buffer[at++] = b.position.y;
      buffer[at++] = b.position.z;
      buffer[at++] = b.quaternion.x;
      buffer[at++] = b.quaternion.y;
      buffer[at++] = b.quaternion.z;
      buffer[at++] = b.quaternion.w;
    }
    for (const w of face.morphTargetInfluences) buffer[at++] = w;
    if (++used === CHUNK) await flush();
  }
  await flush();
};

window.showInfo.dance = dancing;
report({ kind: 'info', info: window.showInfo });
const job = q.get('run');
if (job === 'measure') {
  report({ kind: 'done', measured: window.showMeasure() });
} else if (job === 'pose') {
  await window.showPose(Number(q.get('from') ?? 0), Number(q.get('to') ?? timing.frames));
  report({ kind: 'done' });
} else if (job === 'render') {
  const ms = await window.showRun(Number(q.get('from') ?? 0), Number(q.get('to') ?? timing.frames));
  report({ kind: 'done', ms });
}
