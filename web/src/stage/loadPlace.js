// 場所を読み込む。docs/共通の決まり.md の `loadPlace(url)` の実体。
//
// 座標の約束(ここで決めた。共通の決まりに無かった所):
//  - 単位 m、y が上、右手系。
//  - GLB の中身は scale_m 倍して m にし、床が y=0 になるよう floor_y だけ下げる
//    (floor_y = 元の GLB の座標で床の高さ)。
//  - spawn と landmarks の座標は、そうして整えたあとの座標(床 y=0)で書く。
//  - yaw_deg はキャラの object3d.rotation.y(度)。yaw 0 のキャラは +z を向く
//    (VRM と同じ)。正が左回り(上から見て)。
//  - AR では世界(起動した位置が原点)と部屋の座標がずれる。setAlignment で「部屋 → 世界」の変換を決めると、
//    object3d が動き、worldFromRoom / roomFromWorld / placeCharacter / describeLandmarksFromWorld がそれを使う。
//    spawn と landmarks は、いつでも部屋の座標のまま。
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
 * @param {{variant?: string}} [options] variant: place.json の variants の名前(例 'stylized'・'raw'・'photo')。無い名前なら model を読む。
 */
export async function loadPlace(url, { variant } = {}) {
  const base = new URL(url, globalThis.location?.href ?? 'file:///');
  const def = parsePlaceJson(await fetchJson(base));
  const file = (variant && def.variants[variant]) || def.model;
  const gltf = await loadGlb(new URL(file, base).href);

  const object3d = new THREE.Group();
  object3d.name = `place:${def.id}`;
  const model = gltf.scene;
  model.name = 'scan';
  model.scale.setScalar(def.scale_m);
  model.position.y = -def.floor_y * def.scale_m;
  object3d.add(model);

  const alignment = { yaw: 0, active: false };
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
    variants: Object.keys(def.variants),
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

    /** 部屋 → 世界の変換(既定は何もしない)。yaw はラジアン(rotation.y と同じ向き)、floorY は世界での床の高さ。 */
    setAlignment({ yaw, tx, tz, floorY = 0 }) {
      alignment.yaw = yaw;
      object3d.position.set(tx, floorY, tz);
      object3d.rotation.y = yaw;
      object3d.updateMatrix();
      object3d.updateMatrixWorld(true);
      alignment.active = true;
    },
    clearAlignment() {
      alignment.yaw = 0;
      alignment.active = false;
      object3d.position.set(0, 0, 0);
      object3d.rotation.y = 0;
      object3d.updateMatrixWorld(true);
    },
    get alignment() { return { ...alignment }; },
    worldFromRoom(p) {
      return (p.isVector3 ? p.clone() : toVec(p)).applyMatrix4(object3d.matrix);
    },
    roomFromWorld(p) {
      return (p.isVector3 ? p.clone() : toVec(p)).applyMatrix4(object3d.matrix.clone().invert());
    },

    /** キャラを spawn に立たせる(位置合わせをしていれば、世界の中の spawn に)。 */
    placeCharacter(character3d) {
      character3d.position.copy(this.worldFromRoom(spawn.position));
      character3d.quaternion.copy(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alignment.yaw).multiply(spawn.quaternion),
      );
    },

    /** 世界の中の位置と向き(rotation.y の度)から見た案内。位置合わせをしていれば、部屋の座標に直してから測る。 */
    describeLandmarksFromWorld(worldPosition, worldYawDeg) {
      const room = this.roomFromWorld(worldPosition);
      return this.describeLandmarks({ position: room, yaw_deg: worldYawDeg - THREE.MathUtils.radToDeg(alignment.yaw) });
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
