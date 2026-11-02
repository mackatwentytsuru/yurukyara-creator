// 場所の柱だけで動かす試しのページ。web/ の本体ができるまでの確かめ用。
// ?place=<フォルダ名>  ?variant=<見た目の名前>  ?cam=entrance|top|side  ?height=<キャラの身長 m>
import * as THREE from 'three';
import { loadPlace } from './loadPlace.js';
import { headWorldPosition } from './xr.js';
import { createPresentation } from './modes.js';
import { createAlignFlow } from './alignFlow.js';

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

const place = await loadPlace(`/places/${placeId}/place.json`, { variant: params.get('variant') ?? undefined });
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
let nativeHit = null;
let floorSeen = null; // 殻が見つけた床の高さ
let modes = null; // createPresentation が終わるまでは null(その間に最初のフレームが来ても落ちないように)
const head = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  if (modes && modes.mode !== 'screen') faceViewer();
  renderer.render(scene, camera);
});

// 画面 / AR / VR の切りかえは modes.js に任せる(iPhone の殻・Quest・画面で同じ呼び方)
let flow = null; // 殻の AR に入ったとき、撮った部屋を現実に重ねる手順(床を 2 回タップ)
modes = await createPresentation({
  renderer, scene, camera, place, background,
  onHit: (p) => {
    if (flow && !flow.done) {
      try {
        flow.submit(p);
      } catch (e) {
        info.textContent = String(e.message ?? e);
        flow.reset();
        return;
      }
      info.textContent = flow.prompt;
      if (flow.done) place.placeCharacter(character); // 重ねたあと、部屋の spawn に立たせる
      return;
    }
    nativeHit = p;
    character.position.copy(p);
  },
  onFloor: (y) => { floorSeen = y; },
  onChange: (m) => {
    info.dataset.mode = m;
    if (m === 'ar' && modes?.nativeAR) {
      flow = createAlignFlow({ place, floorY: floorSeen });
      info.textContent = flow.prompt;
    } else {
      flow = null;
    }
  },
});
const xr = modes.available;

for (const mode of ['ar', 'vr']) {
  const btn = document.getElementById(`btn-${mode}`);
  btn.disabled = !xr[mode];
  btn.addEventListener('click', async () => {
    try {
      await modes.enter(mode);
      if (modes.session) info.textContent = `${mode} に入った(機能: ${modes.session.features.join(', ') || 'なし'})`;
    } catch (e) {
      info.textContent = String(e.message ?? e);
    }
  });
}
// 殻の中では、画面のタップで床を殻に聞く(キャラをそこに立たせる)
renderer.domElement.addEventListener('pointerdown', (e) => {
  modes.nativeAR?.raycast(e.clientX / innerWidth, e.clientY / innerHeight);
});

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
  get align() { return flow ? { targets: flow.targets.map((t) => ({ name: t.name, room: [t.position[0], t.position[2]] })), done: flow.done, ok: flow.ok, result: flow.result, prompt: flow.prompt } : null; },
  worldOfRoom: (name) => { const l = place.landmarks.find((x) => x.name === name); return l ? place.worldFromRoom(l.position).toArray() : null; },
  get roomYaw() { return place.object3d.rotation.y; },
  get nativeHit() { return nativeHit?.toArray() ?? null; },
  get characterPosition() { return character.position.toArray(); },
  get characterYaw() { return character.rotation.y; },
  get nativePoses() { return modes.nativeAR?.state.poses ?? 0; },
  size: size.toArray(),
  floorMinY: place.bounds.min.y,
  characterHeight: new THREE.Box3().setFromObject(character).getSize(new THREE.Vector3()).y,
  characterFootY: new THREE.Box3().setFromObject(character).min.y,
  landmarks: place.describeLandmarks(),
  xr,
};
