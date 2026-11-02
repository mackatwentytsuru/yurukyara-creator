// 場所を読み込む。docs/共通の決まり.md の `loadPlace(url)` の実体。
//
// 座標の約束(ここで決めた。共通の決まりに無かった所):
//  - 単位 m、y が上、右手系。
//  - GLB の中身は scale_m 倍して m にし、床が y=0 になるよう floor_y だけ下げる
//    (floor_y = 元の GLB の座標で床の高さ)。
//  - spawn と landmarks の座標は、そうして整えたあとの座標(床 y=0)で書く。
//  - yaw_deg はキャラの object3d.rotation.y(度)。yaw 0 のキャラは +z を向く
//    (VRM と同じ)。正が左回り(上から見て)。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parsePlaceJson, bearingFrom } from './placeSchema.js';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`place.json を読めない (${res.status}): ${url}`);
  return res.json();
}

function loadGlb(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, (e) =>
      reject(new Error(`GLB を読めない: ${url} (${e?.message ?? e})`)),
    );
  });
}

// AR では本物の部屋が見えているので、撮った部屋は「見えないが奥行きだけ書く」物にする。
// 家具の陰にキャラが入るときに隠れる。
const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

/**
 * @param {string} url place.json の URL(model はそこからの相対で読む)
 */
export async function loadPlace(url) {
  const base = new URL(url, globalThis.location?.href ?? 'http://localhost/');
  const def = parsePlaceJson(await fetchJson(base));
  const gltf = await loadGlb(new URL(def.model, base).href);

  const object3d = new THREE.Group();
  object3d.name = `place:${def.id}`;
  const model = gltf.scene;
  model.name = 'scan';
  model.scale.setScalar(def.scale_m);
  model.position.y = -def.floor_y * def.scale_m;
  object3d.add(model);

  const originalMaterials = new Map();
  model.traverse((o) => {
    if (o.isMesh) originalMaterials.set(o, o.material);
  });

  const toVec = (p) => new THREE.Vector3(...p);
  const spawn = {
    position: toVec(def.spawn.position),
    yaw_deg: def.spawn.yaw_deg,
    quaternion: new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(def.spawn.yaw_deg),
    ),
  };
  const landmarks = def.landmarks.map((lm) => ({
    name: lm.name,
    position: toVec(lm.position),
    note: lm.note,
  }));

  object3d.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object3d);

  return {
    id: def.id,
    name: def.name,
    object3d,
    spawn,
    landmarks,
    bounds,

    /** 'screen' | 'ar' | 'vr'。ar のときだけ、撮った部屋を見えない遮蔽物にする。 */
    setPresentation(mode) {
      for (const [mesh, mat] of originalMaterials) {
        mesh.material = mode === 'ar' ? occluderMaterial : mat;
      }
    },

    /** キャラを spawn に立たせる。 */
    placeCharacter(character3d) {
      character3d.position.copy(spawn.position);
      character3d.quaternion.copy(spawn.quaternion);
    },

    /** Claude に渡す案内用の文。from は位置と向き(既定は spawn)。 */
    describeLandmarks(from = { position: spawn.position, yaw_deg: spawn.yaw_deg }) {
      const here = [from.position.x, from.position.y, from.position.z];
      return landmarks.map((lm) => {
        const b = bearingFrom(here, from.yaw_deg, [lm.position.x, lm.position.y, lm.position.z]);
        return {
          name: lm.name,
          note: lm.note,
          distance_m: Math.round(b.distance_m * 10) / 10,
          left_deg: Math.round(b.left_deg),
        };
      });
    },

    dispose() {
      object3d.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const m = originalMaterials.get(o);
        if (m) {
          for (const v of Object.values(m)) v?.isTexture && v.dispose();
          m.dispose();
        }
      });
    },
  };
}
