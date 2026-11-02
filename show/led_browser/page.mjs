// キャラだけを透明な背景で描く専用ページ。会話・頭脳・声・カメラは使わない。
// 固定の 1/30 秒で update(dt) を進め、window.ledStep(n) で n コマ進めて PNG(アルファ付き)を返す。
import * as THREE from 'three';
import { loadCharacter, characterUrl } from '/web/src/character/index.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 2840);
const H = Number(q.get('h') ?? 620);
const SCALE = W / 5680; // 5680×1240 に対する倍率
const STRETCH = Number(q.get('stretch') ?? 1.48); // 中央の面は横につぶれて見えるので、横に伸ばして描く
const CENTER_X = Number(q.get('cx') ?? 2159) * SCALE; // B 面の中心
const TOP = Number(q.get('top') ?? 135) * SCALE;
const BOTTOM = Number(q.get('bottom') ?? 1170) * SCALE;
const FPS = 30;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a2540, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.7);
key.position.set(1.2, 2.4, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
rim.position.set(-2, 1.6, -1.5);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(28, W / H, 0.05, 60);
const character = await loadCharacter(characterUrl(q.get('character') ?? 'f_led'));
scene.add(character.object3d);
// 録画では視線の目標を与えないので、体を視線へ回す処理は切る(?look=1 で戻す)。
if (q.get('look') !== '1') character.lookBone = null;
character.update(0);
const box = new THREE.Box3().setFromObject(character.object3d);
const h = box.max.y - box.min.y;
const cy = (box.max.y + box.min.y) / 2;

// キャラの箱の縦が、画の TOP〜BOTTOM に入るようにカメラを置く。横の伸ばしと中心の移動は、射影行列に直接入れる。
camera.position.set(0, cy, 0);
camera.updateProjectionMatrix();
const e5 = camera.projectionMatrix.elements[5];
const frac = (BOTTOM - TOP) / H; // 画の高さのうちキャラが占める割合
const dist = (e5 * h) / 2 / frac;
camera.position.set(0, cy, dist);
camera.lookAt(0, cy, 0);
camera.updateMatrixWorld(true);
const m = camera.projectionMatrix;
m.elements[0] *= STRETCH;
m.elements[8] = -((CENTER_X - W / 2) / (W / 2)); // 横の中心を CENTER_X へ
m.elements[9] = ((H / 2 - (TOP + BOTTOM) / 2) / (H / 2)) * -1; // 縦の中心を (TOP+BOTTOM)/2 へ
camera.projectionMatrixInverse.copy(m).invert();
camera.updateProjectionMatrix = () => {}; // 手で入れた行列を上書きさせない

const motion = q.get('motion') ?? 'wave';
if (q.get('expr')) character.setEmotion?.(q.get('expr'), 1);
character.play(motion);

let frame = 0;
function render() {
  renderer.render(scene, camera);
}
window.ledInfo = { W, H, h, dist, motions: character.motionNames ?? null, kind: character.kind };
window.ledStep = () => {
  character.update(1 / FPS);
  render();
  frame += 1;
  return canvas.toDataURL('image/png');
};
window.ledFrame = () => frame;
window.ledReady = true;

// 診断用: root / body / object3d の向き(度, YXZ)と視線の値
window.ledDump = () => {
  const deg = (o) => { const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ'); return [e.x, e.y, e.z].map((v) => +(v * 180 / Math.PI).toFixed(1)); };
  const out = { frame, object3d: deg(character.object3d), debug: character.debug, lookBone: character.lookBone?.name, maxYaw: character.maxYaw };
  character.gltf?.scene.traverse((o) => { if (o.isBone && ['root', 'body'].includes(o.name)) out[o.name] = deg(o); });
  return out;
};
