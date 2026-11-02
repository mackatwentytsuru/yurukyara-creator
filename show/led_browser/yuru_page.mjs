// ゆるキャラのショーを 1 コマずつ描くページ。不透明の 5680×1240 に、背景と何体ものキャラを描く。
// 絵はコマ番号だけで決まる(動きは毎コマ、拍の番号から計算する。前のコマの状態を使わない)。
// URL の引数: fit(render_yuru.mjs の配置), stretch, run=measure|render, from, to, onlyshow
// 自動操作の道具はつながない。結果は /result へ、コマは /frame へ自分で送る。
import * as THREE from 'three';
import { loadCharacter } from '/web/src/character/index.js';
import { BACKGROUND_VERTEX, BACKGROUND_FRAGMENT, MAX_CHARACTERS, PALETTE_SIZE } from './yuru_background.mjs';
import { danceAt, kimeAgeBeats, BEATS_PER_BAR } from './yuru_choreo.mjs';
import { TenBitOutput } from './show_output.mjs';

const report = (message) => fetch('/result', { method: 'POST', body: JSON.stringify(message) });
window.addEventListener('error', (e) => report({ kind: 'error', text: `${e.message} ${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => report({ kind: 'error', text: String(e.reason?.stack ?? e.reason) }));

// three の内部(id 作りなど)が使う乱数を固定する
let randomState = 20261103;
Math.random = () => {
  randomState = (randomState + 0x6d2b79f5) | 0;
  let v = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
};

const W = 5680;
const H = 1240;
const SEAM_L = 1279;
const SEAM_R = 3039;
const CENTER_X = 2159;
const DIGIT = [640, 620, 90];
const SYNC_NUMBER_Y = 1000;
const SYNC_NUMBER_HEIGHT = 170;
const SYNC_FLASH_LEVEL = 0.7;
const MASK_SCALE = 0.25; // キャラの枠を測る絵の縮尺(1 ピクセルの誤差が 4 ピクセルに当たる)
const REF_HEIGHT_PX = 500; // 下調べのときのキャラの高さ
const ALPHA_MIN = 8;
const MEASURE_STEP = 2;
const FADE_IN_SEC = 0.25;
const FADE_OUT_SEC = 0.5;
const BLINK_SEC = 0.16;
const DISC_RATIO = 0.6; // 後ろの丸の半径(キャラの高さに対する割合)。枠の半分までに抑える

const q = new URLSearchParams(location.search);
const STRETCH = Number(q.get('stretch') ?? 1.48);
const MEASURE = q.get('run') === 'measure';
const FIT = JSON.parse(q.get('fit') ?? 'null');

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`読めません: ${url} (${res.status})`);
  return res.json();
};
const timeline = await fetchJson('/yuru-data/timeline.json');
const cast = await fetchJson('/yuru-data/cast.json');
const FPS = timeline.fps;
const showSection = timeline.sections.find((s) => s.id === 'show');
const showFirst = Math.round(showSection.start * FPS);
const showEnd = Math.round(showSection.end * FPS);
const beatSec = 60 / timeline.bpm;
const bars = timeline.downbeats.length;
const faceOf = Object.fromEntries(cast.characters.map((c, i) => [i, c.face]));

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('浮動小数の絵に描けません(EXT_color_buffer_float がありません)');

const hdrTarget = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
const maskW = Math.round(W * MASK_SCALE);
const maskH = Math.round(H * MASK_SCALE);
const maskTarget = new THREE.WebGLRenderTarget(maskW, maskH, { type: THREE.UnsignedByteType, depthBuffer: true });
const maskPixels = new Uint8Array(maskW * maskH * 4);
const output = new TenBitOutput(gl, W, H);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb8c4d8, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(0.4, 3, 3);
scene.add(key);

const srgb = (hex) => new THREE.Color(hex); // Color は線形へ直して持つ
const uniforms = {
  uRes: { value: new THREE.Vector2(W, H) },
  uCx: { value: CENTER_X },
  uStretch: { value: STRETCH },
  uSeamL: { value: SEAM_L },
  uSeamR: { value: SEAM_R },
  uBeat: { value: 0 },
  uPulse: { value: 0 },
  uDown: { value: 0 },
  uEnergy: { value: 0 },
  uKime: { value: 0 },
  uCount: { value: cast.characters.length },
  uDisc: { value: Array.from({ length: MAX_CHARACTERS }, () => new THREE.Vector4()) },
  uDiscColor: { value: Array.from({ length: MAX_CHARACTERS }, (_, i) => srgb(cast.characters[i]?.back ?? '#000000')) },
  uFoot: { value: Array.from({ length: MAX_CHARACTERS }, () => new THREE.Vector3()) },
  uPalette: { value: Array.from({ length: PALETTE_SIZE }, (_, i) => srgb(cast.palette[i])) },
};
const backgroundScene = new THREE.Scene();
const background = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ vertexShader: BACKGROUND_VERTEX, fragmentShader: BACKGROUND_FRAGMENT, uniforms, depthTest: false, depthWrite: false }),
);
background.frustumCulled = false;
backgroundScene.add(background);
const backgroundCamera = new THREE.Camera();

const worldZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const EMPTY_ACTIONS = new Map();

/** 1 体ぶんの読み込み。動きは名前の順に作り直し、全部を常に再生の状態にして、重みと時刻だけを毎コマ入れる */
async function loadActor(entry, index) {
  const character = await loadCharacter(`/yuru-chars/${entry.id}/character.json`);
  scene.add(character.object3d);
  character.object3d.visible = false;
  const clips = [...character.actions.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
  character.mixer.stopAllAction();
  character.mixer.uncacheRoot(character.mixer.getRoot());
  character.actions.clear();
  for (const [name, action] of clips) {
    const fresh = character.mixer.clipAction(action.getClip());
    fresh.setLoop(THREE.LoopRepeat, Infinity);
    fresh.setEffectiveWeight(0);
    fresh.play();
    character.actions.set(name, fresh);
  }
  character.object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(character.object3d);
  const bodyHeight = box.max.y - box.min.y;
  const bodyMidY = (box.max.y + box.min.y) / 2;
  const camera = new THREE.PerspectiveCamera(14, W / H, 0.05, 100);
  const fy = camera.projectionMatrix.elements[5];
  camera.position.set(0, bodyMidY, (fy * bodyHeight * H) / 2 / REF_HEIGHT_PX);
  camera.lookAt(0, bodyMidY, 0);
  camera.updateMatrixWorld(true);
  camera.baseE0 = camera.projectionMatrix.elements[0];
  camera.baseE5 = camera.projectionMatrix.elements[5];
  camera.updateProjectionMatrix = () => {}; // 手で入れた行列を上書きさせない
  const scene_ = character.gltf.scene;
  const arms = ['arm_L', 'arm_R'].map((name) => {
    const bone = scene_.getObjectByName(name);
    if (!bone) return null;
    const at = bone.getWorldPosition(new THREE.Vector3());
    return { bone, side: at.x >= 0 ? 1 : -1, base: bone.quaternion.clone() };
  });
  const stretch = faceOf[index] === 'B' ? STRETCH : 1;
  const fit = FIT?.characters?.[index] ?? null;
  if (fit) {
    const k = fit.scale;
    const e = camera.projectionMatrix.elements;
    e[0] = camera.baseE0 * k * stretch;
    e[5] = camera.baseE5 * k;
    e[8] = -((fit.cx - W / 2) / (W / 2));
    e[9] = (fit.floorY - H / 2 - k * (fit.refBottomY - H / 2)) / (H / 2);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  // 足元の絵の上の位置(止まっているときの原点)
  const foot = new THREE.Vector3(0, 0, 0).project(camera);
  const mid = new THREE.Vector3(0, bodyMidY, 0).project(camera);
  return { entry, index, character, camera, bodyHeight, arms, footPx: [(foot.x + 1) * 0.5 * W, (1 - foot.y) * 0.5 * H], midY: (1 - mid.y) * 0.5 * H, stretch, fit, hasJump: character.actions.has('jump') };
}

const actors = [];
for (let i = 0; i < cast.characters.length; i++) actors.push(await loadActor(cast.characters[i], i));

const CLIP_ALIASES = { wave: 'nod', jump: 'idle' };
const expr = new Map();

/** そのコマの姿勢を入れる。前のコマの値に頼らない */
function poseActor(actor, frame) {
  const { character, index } = actor;
  const b = (frame - showFirst) / FPS / beatSec;
  const d = danceAt(b, index, bars);
  const o = character.object3d;
  o.visible = d.visible;
  if (!d.visible) return d;
  const h = actor.bodyHeight;
  o.position.set(d.x * h, d.y * h, 0);
  o.rotation.set(0, THREE.MathUtils.degToRad(d.yawDeg), THREE.MathUtils.degToRad(d.swayDeg));
  o.scale.set(d.scale * (1 + d.squash * 0.6), d.scale * (1 - d.squash), d.scale * (1 + d.squash * 0.6));

  // 動き: 全部の重みを 0 にしてから、今の動きと idle を入れる
  for (const action of character.actions.values()) action.setEffectiveWeight(0);
  let total = 0;
  const setClip = (rawName, phase, weight) => {
    const name = character.actions.has(rawName) ? rawName : CLIP_ALIASES[rawName] ?? 'idle';
    const action = character.actions.get(name);
    if (!action) return;
    action.time = Math.min(phase, 0.9999) * action.getClip().duration;
    action.setEffectiveWeight(action.getEffectiveWeight() + weight);
    total += weight;
  };
  const jumpWeight = d.jump && actor.hasJump ? d.jump.weight : 0;
  if (jumpWeight > 0) setClip('jump', d.jump.phase, jumpWeight);
  for (const c of d.clips) if (c.name !== 'idle') setClip(c.name, c.phase, c.weight * (1 - jumpWeight));
  if (total < 1) setClip('idle', ((b / BEATS_PER_BAR) % 1 + 1) % 1, 1 - total);

  for (const arm of actor.arms) if (arm) arm.bone.quaternion.copy(arm.base);
  expr.clear();
  expr.set('happy', 1 - d.surprise);
  expr.set('surprised', d.surprise);
  const blinkEvery = 3.1 + index * 0.37;
  const blinkT = ((frame / FPS + index * 0.9) % blinkEvery) / BLINK_SEC;
  const blink = blinkT < 1 ? Math.sin(Math.PI * blinkT) : 0;
  const headYaw = THREE.MathUtils.degToRad(d.headYawDeg);
  const headPitch = THREE.MathUtils.degToRad(d.headPitchDeg);
  character.debug.wantYaw = headYaw * 0.6;
  character.debug.wantPitch = headPitch * 0.6;
  o.updateWorldMatrix(true, false);
  // rig の _apply は idle と talk の重みを書くので、この間だけ動きの表を隠す。ミキサーは dt 0 で、入れた時刻の姿勢を書く
  const actions = character.actions;
  character.actions = EMPTY_ACTIONS;
  character._apply({ dt: 0, headYaw, headPitch, expr, mouth: 0, blink });
  character.actions = actions;

  // 腕の手続きの上げ: 骨の動きの上に、キャラの向きの Z 軸まわりの回転を重ねる
  for (let i = 0; i < actor.arms.length; i++) {
    const arm = actor.arms[i];
    if (!arm) continue;
    arm.base.copy(arm.bone.quaternion);
    const angle = (i === 0 ? d.armL : d.armR) * arm.side;
    if (angle === 0) continue;
    o.updateWorldMatrix(true, true);
    _qc.setFromAxisAngle(worldZ, angle);
    o.getWorldQuaternion(_qa);
    arm.bone.parent.getWorldQuaternion(_qb);
    _qd.copy(_qb).invert().multiply(_qa).multiply(_qc).multiply(_qa.clone().invert()).multiply(_qb);
    arm.bone.quaternion.premultiply(_qd);
  }
  o.updateMatrixWorld(true);
  return d;
}

function setBackground(frame) {
  const t = (frame - showFirst) / FPS;
  const b = t / beatSec;
  const u = uniforms;
  const fb = ((b % 1) + 1) % 1;
  const fd = ((b / BEATS_PER_BAR) % 1 + 1) % 1;
  u.uBeat.value = b;
  u.uPulse.value = Math.exp(-fb * 5);
  u.uDown.value = Math.exp(-fd * 6);
  const energy = timeline.energy.slice(Math.max(0, frame - 15), frame + 1);
  u.uEnergy.value = energy.reduce((p, c) => p + c, 0) / energy.length;
  const age = kimeAgeBeats(b);
  u.uKime.value = age < 6 ? Math.exp(-age * 0.7) : 0;
  for (const actor of actors) {
    const d = danceAt(b, actor.index, bars);
    const height = (actor.fit?.scale ?? 1) * REF_HEIGHT_PX;
    const scale = d.visible ? d.scale : 0;
    const slotHalf = actor.fit ? (actor.fit.slot.right - actor.fit.slot.left) / 2 / actor.stretch - 36 : Infinity;
    u.uDisc.value[actor.index].set(actor.footPx[0], actor.midY, Math.min(height * DISC_RATIO, slotHalf) * scale, Math.exp(-(((b - actor.index * 0.2) % 1 + 1) % 1) * 5));
    u.uFoot.value[actor.index].set(actor.footPx[0], actor.footPx[1], d.visible ? d.y * 2 : 100);
  }
}

function setOnly(actor) {
  for (const a of actors) a.character.object3d.visible = a === actor;
}

/** 背景なしでキャラ 1 体だけを描き、外接の枠を測る(5680×1240 の座標で返す) */
function measureBox(actor) {
  setOnly(actor);
  renderer.setRenderTarget(maskTarget);
  renderer.clear();
  renderer.render(scene, actor.camera);
  renderer.readRenderTargetPixels(maskTarget, 0, 0, maskW, maskH, maskPixels);
  renderer.setRenderTarget(null);
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
  return [x0 / MASK_SCALE, (maskH - 1 - y1) / MASK_SCALE, (x1 + 1) / MASK_SCALE, (maskH - y0) / MASK_SCALE];
}

function syncState(frame) {
  const cfg = timeline.sync;
  for (const id of ['sync_head', 'sync_tail']) {
    const s = timeline.sections.find((x) => x.id === id);
    const first = Math.round(s.start * FPS);
    if (frame < first || frame >= Math.round(s.end * FPS)) continue;
    const width = Math.round(cfg.flash_sec * FPS);
    const flashing = cfg.flash_starts.some((sec) => {
      const at = first + Math.round(sec * FPS);
      return frame >= at && frame < at + width;
    });
    return { number: id === 'sync_head' ? frame : -1, flash: flashing ? SYNC_FLASH_LEVEL : 0 };
  }
  return { number: -1, flash: 0 };
}

function countdown(frame) {
  const s = timeline.sections.find((x) => x.id === 'preroll');
  const t = frame / FPS;
  return t < s.end ? Math.max(1, Math.ceil(s.end - t - 1e-6)) : 0;
}

function masterAt(frame) {
  if (frame < showFirst || frame >= showEnd) return 0;
  const fromStart = (frame - showFirst) / FPS / FADE_IN_SEC;
  const toEnd = (showEnd - 1 - frame) / FPS / FADE_OUT_SEC;
  return Math.min(1, fromStart, toEnd);
}

/** そのコマを描いて読む。ショーの外は黒に数字とフラッシュだけ */
function drawFrame(frame) {
  const inShow = frame >= showFirst && frame < showEnd;
  renderer.setRenderTarget(hdrTarget);
  renderer.clear();
  if (inShow) {
    setBackground(frame);
    background.visible = true;
    renderer.render(backgroundScene, backgroundCamera);
    for (const actor of actors) {
      const d = danceAt((frame - showFirst) / FPS / beatSec, actor.index, bars);
      if (!d.visible) continue;
      setOnly(actor);
      renderer.clearDepth();
      renderer.render(scene, actor.camera);
    }
  } else {
    background.visible = false;
    renderer.render(backgroundScene, backgroundCamera);
  }
  renderer.setRenderTarget(null);
  const source = renderer.properties.get(hdrTarget.texture).__webglTexture;
  const sync = syncState(frame);
  const params = { master: masterAt(frame), frame, count: countdown(frame), digit: DIGIT, frameNumber: sync.number, flash: sync.flash, numberBox: [CENTER_X, SYNC_NUMBER_Y, SYNC_NUMBER_HEIGHT, STRETCH] };
  const pixels = output.renderAndRead(source, params);
  renderer.resetState();
  return pixels;
}

window.yuruInfo = { W, H, gpuName, frames: timeline.frames, fps: FPS, bars, beatSec, cast: actors.map((a) => ({ id: a.entry.id, name: a.character.name, face: a.entry.face, bodyHeight: a.bodyHeight, motions: a.character.motionNames, fur: Boolean(a.character.json.fur) })) };

/** 下調べ: 伸ばしなし・基準の大きさで全部の踊りを流し、キャラごとの外接の枠と、止まったときの枠を返す */
window.yuruMeasure = () => {
  const boxes = actors.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let f = showFirst; f < showEnd; f += MEASURE_STEP) {
    for (const actor of actors) {
      const d = poseActor(actor, f);
      if (!d.visible) continue;
      const box = measureBox(actor);
      if (!box) continue;
      const out = boxes[actor.index];
      out[0] = Math.min(out[0], box[0]);
      out[1] = Math.min(out[1], box[1]);
      out[2] = Math.max(out[2], box[2]);
      out[3] = Math.max(out[3], box[3]);
    }
  }
  return { boxes, refCenterX: W / 2, refHeight: REF_HEIGHT_PX };
};

/** from〜to のコマを描いて、1 コマずつ /frame へ送る */
window.yuruRun = async (from, to) => {
  const ms = { pose: 0, draw: 0, box: 0, send: 0 };
  for (let f = from; f < to; f++) {
    const inShow = f >= showFirst && f < showEnd;
    let a = performance.now();
    if (inShow) for (const actor of actors) poseActor(actor, f);
    let b = performance.now();
    ms.pose += b - a;
    a = b;
    const pixels = drawFrame(f);
    b = performance.now();
    ms.draw += b - a;
    a = b;
    const boxes = {};
    if (inShow) {
      for (const actor of actors) {
        const d = danceAt((f - showFirst) / FPS / beatSec, actor.index, bars);
        if (d.visible) boxes[actor.index] = measureBox(actor);
      }
    }
    b = performance.now();
    ms.box += b - a;
    a = b;
    const res = await fetch(`/frame?f=${f}`, { method: 'POST', body: pixels, headers: { 'x-box': JSON.stringify({ boxes }), 'content-type': 'application/octet-stream' } });
    if (!res.ok) throw new Error(`コマ ${f} を送れません: ${res.status}`);
    ms.send += performance.now() - a;
  }
  return ms;
};

report({ kind: 'info', info: window.yuruInfo });
const job = q.get('run');
if (job === 'measure') report({ kind: 'done', measured: window.yuruMeasure() });
else if (job === 'render') report({ kind: 'done', ms: await window.yuruRun(Number(q.get('from') ?? 0), Number(q.get('to') ?? timeline.frames)) });
