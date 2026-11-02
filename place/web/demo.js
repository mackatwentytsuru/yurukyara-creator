// 場所の柱だけで動かす試しのページ。web/ の本体ができるまでの確かめ用。
// ?place=<フォルダ名>  ?cam=entrance|top|side  ?height=<キャラの身長 m>
import * as THREE from 'three';
import { loadPlace } from './loadPlace.js';
import { detectXR, startXR, applyPresentation, headWorldPosition } from './xr.js';
import { createNativeAR, floorYFor } from './nativeAR.js';

const params = new URLSearchParams(location.search);
const placeId = params.get('place') ?? 'test_room';
const characterHeight = Number(params.get('height') ?? 1.2);

const info = document.getElementById('info');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const background = new THREE.Color(0x20232a);
scene.background = background;
scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(2, 4, 3);
scene.add(sun);

/** 仮の箱のキャラ。足元が原点、頭のてっぺんが height m。正面は +z(鼻の出っぱり)。 */
function boxCharacter(height) {
  const g = new THREE.Group();
  g.name = 'placeholder-character';
  const k = height / 1.2;
  const headSize = height * 0.3;
  const gap = height * 0.02;
  const bodyH = height - headSize - gap; // 頭のてっぺんがちょうど height になる
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34 * k, bodyH, 0.2 * k),
    new THREE.MeshStandardMaterial({ color: 0xe0527a }),
  );
  body.position.y = bodyH / 2;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(headSize, headSize, headSize),
    new THREE.MeshStandardMaterial({ color: 0xf2d3b3 }),
  );
  head.position.y = bodyH + gap + headSize / 2;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(headSize * 0.18, headSize * 0.18, headSize * 0.25),
    new THREE.MeshStandardMaterial({ color: 0x2d2d33 }),
  );
  nose.position.set(0, head.position.y, headSize / 2 + headSize * 0.1);
  g.add(body, head, nose);
  return g;
}

const place = await loadPlace(`/places/${placeId}/place.json`);
scene.add(place.object3d);
const character = boxCharacter(characterHeight);
place.placeCharacter(character);
scene.add(character);

const cams = {
  entrance: { pos: [1.0, 1.5, 1.9], look: [-0.2, 0.8, -0.8] },
  top: { pos: [0, 6.5, 0.01], look: [0, 0, 0] },
  side: { pos: [-4.5, 1.4, 1.5], look: [0, 0.9, -0.5] },
};
const camSpec = cams[params.get('cam') ?? 'entrance'] ?? cams.entrance;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 50);
camera.position.set(...camSpec.pos);
camera.lookAt(...camSpec.look);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
let nativeAR = null;
let nativeHit = null;
const head = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  if (nativeAR?.state.active || renderer.xr.isPresenting) faceViewer();
  renderer.render(scene, camera);
});

const xr = await detectXR();
/** iPhone の殻アプリの中の AR。殻が送る姿勢で camera を動かし、タップした床にキャラを立たせる。 */
function startNativeAR() {
  const restore = applyPresentation({ mode: 'ar', scene, renderer, place, background });
  document.documentElement.classList.add('ar');
  nativeAR = createNativeAR({
    camera,
    onHit: (p) => { nativeHit = p; character.position.copy(p); },
    onFloor: (y) => { character.position.y = y; },
  });
  nativeAR.start();
  renderer.domElement.addEventListener('pointerdown', (e) => {
    nativeAR.raycast(e.clientX / innerWidth, e.clientY / innerHeight);
  });
  return restore;
}

for (const mode of ['ar', 'vr']) {
  const btn = document.getElementById(`btn-${mode}`);
  btn.disabled = !xr[mode];
  btn.addEventListener('click', async () => {
    try {
      if (mode === 'ar' && xr.ar_kind === 'native') {
        startNativeAR();
      } else {
        const s = await startXR({ renderer, mode, scene, place, background });
        info.textContent = `${mode} に入った(床=${s.floor ? 'local-floor' : 'local'}、機能: ${s.features.join(', ') || 'なし'})`;
      }
    } catch (e) {
      info.textContent = String(e);
    }
  });
}

// キャラは、見ている人の頭(camera)のほうへ体を向ける(AR でも VR でも画面でも同じ)
function faceViewer() {
  headWorldPosition(camera, head);
  const dx = head.x - character.position.x;
  const dz = head.z - character.position.z;
  if (Math.hypot(dx, dz) > 0.05) character.rotation.y = Math.atan2(dx, dz);
}

const size = place.bounds.getSize(new THREE.Vector3());
const lines = place.describeLandmarks().map(
  (l) => `${l.name}: ${l.distance_m}m、正面から左へ ${l.left_deg}度`,
);
info.textContent =
  `${place.name}  ${size.x.toFixed(2)} x ${size.z.toFixed(2)} m、キャラ ${characterHeight} m\n` +
  `AR:${xr.ar ? '可' : '不可'} VR:${xr.vr ? '可' : '不可'}${xr.reason ? '(' + xr.reason + ')' : ''}\n` +
  lines.join('\n');

window.__place = {
  ready: true,
  get nativeHit() { return nativeHit?.toArray() ?? null; },
  get characterPosition() { return character.position.toArray(); },
  get characterYaw() { return character.rotation.y; },
  get nativePoses() { return nativeAR?.state.poses ?? 0; },
  size: size.toArray(),
  floorMinY: place.bounds.min.y,
  characterHeight: new THREE.Box3().setFromObject(character).getSize(new THREE.Vector3()).y,
  characterFootY: new THREE.Box3().setFromObject(character).min.y,
  landmarks: place.describeLandmarks(),
  xr,
};
