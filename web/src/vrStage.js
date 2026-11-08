// VR(Quest 3)の立ち位置と背景。
// キャラは場所が決めた位置に立ったままで、見ている人のほうを、キャラの正面の少し先へ連れていく(座標の原点をずらす)。
// こうすると、撮った部屋の立ち位置・視線の計算・目印の方向を、VR のために変えなくてよい。
import * as THREE from 'three';
import { getTheme, readVrColors } from './theme.js';

export const AHEAD_M = 1.6; // はじめに立つ、キャラからの距離
const STICK_SPEED = 1.2; // スティックで歩く速さ(m/秒)
const STICK_DEAD = 0.2;
const NO_FLOOR_HEAD_M = 1.5; // 床が分からない端末で、頭を置く高さ

/**
 * 実際の頭の位置 → 世界の位置、の変換(y 軸まわりの回転 + 平行移動)を求める。
 * 変換後に、頭がキャラの正面 ahead m の所へ来て、顔がキャラのほうを向く。床の高さは floorY にそろえる。
 * @param {{head:number[], forward:number[], charPos:number[], charForward:number[], ahead?:number, floorY?:number}} a  head・forward は変換前の値
 * @returns {{yaw:number, x:number, y:number, z:number}}
 */
export function computeRig({ head, forward, charPos, charForward, ahead = AHEAD_M, floorY = 0 }) {
  const targetX = charPos[0] + charForward[0] * ahead;
  const targetZ = charPos[2] + charForward[2] * ahead;
  // 顔の向き forward を、キャラへ向かう向き(-charForward)へ回す角度。three の y 軸回転は x' = x cos + z sin, z' = -x sin + z cos
  const yaw = Math.atan2(forward[0], forward[2]) - Math.atan2(-charForward[0], -charForward[2]);
  const rig = { yaw: -yaw, x: 0, y: floorY, z: 0 };
  const [hx, hz] = rotateXZ(head[0], head[2], rig.yaw);
  rig.x = targetX - hx;
  rig.z = targetZ - hz;
  return rig;
}

export function rotateXZ(x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** 実際 → 世界 の変換を、WebXR の「ずらした原点」の位置と向きにする(世界の点 = 変換 × 実際の点、なので逆行列) */
export function rigToOffset(rig) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(rig.x, rig.y, rig.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rig.yaw),
    new THREE.Vector3(1, 1, 1),
  ).invert();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  m.decompose(position, orientation, new THREE.Vector3());
  return { position, orientation };
}

/** 撮った部屋が無いときの背景。暗闇に浮かないよう、空の色と床だけを置く(画像ファイルは使わない) */
function makeBackdrop() {
  const vr = readVrColors(); // 空・床・輪の色は「いろ」で替わる(theme.js)
  const group = new THREE.Group();
  group.name = 'vrBackdrop';
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  [0, 0.42, 0.5, 0.53, 1].forEach((at, i) => sky.addColorStop(at, vr.sky[i]));
  g.fillStyle = sky;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  group.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshBasicMaterial({ color: vr.floor, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  // 床の距離感のための輪(1m ごと)
  const rings = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: vr.ring, toneMapped: false });
  for (let r = 1; r <= 8; r++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r + 0.006, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    rings.add(ring);
  }
  group.add(rings);
  return group;
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {()=>THREE.Object3D} o.getCharacterObject
 */
export function createVrStage({ renderer, scene, getCharacterObject }) {
  let backdrop = null;
  let backdropTheme = '';
  let base = null; // ずらす前の参照空間
  let rig = null;
  let floorY = 0;
  let noFloorLift = 0;
  const q = new THREE.Quaternion();
  const fwd = new THREE.Vector3();
  const charFwd = new THREE.Vector3();
  const charPos = new THREE.Vector3();

  function applyRig() {
    const { position, orientation } = rigToOffset({ ...rig, y: rig.y + noFloorLift });
    const offset = new XRRigidTransform(
      { x: position.x, y: position.y, z: position.z },
      { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
    );
    renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(offset));
  }

  return {
    get rig() {
      return rig;
    },
    /** VR に入った直後に呼ぶ */
    start({ floor = true, showBackdrop = true } = {}) {
      base = renderer.xr.getReferenceSpace();
      rig = null;
      noFloorLift = floor ? 0 : NO_FLOOR_HEAD_M;
      if (showBackdrop) {
        if (backdrop && backdropTheme !== getTheme()) {
          // 入る前に「いろ」を替えた時は、空を作り直す(前の色の空を使い回さない)
          backdrop.traverse((o) => {
            o.geometry?.dispose?.();
            o.material?.map?.dispose?.();
            o.material?.dispose?.();
          });
          backdrop = null;
        }
        if (!backdrop) {
          backdrop = makeBackdrop();
          backdropTheme = getTheme();
        }
        scene.add(backdrop);
      }
    },
    /** 毎フレーム呼ぶ。最初の 1 回で立ち位置を決め、あとはスティックで歩く */
    update(dt) {
      const frame = renderer.xr.getFrame?.();
      const session = renderer.xr.getSession?.();
      if (!base || !frame || !session) return;
      const pose = frame.getViewerPose(base);
      if (!pose) return;
      const { position: p, orientation: o } = pose.transform;
      fwd.set(0, 0, -1).applyQuaternion(q.set(o.x, o.y, o.z, o.w));
      if (!rig) {
        if (Math.hypot(fwd.x, fwd.z) < 1e-3) return; // 真上か真下を見ている間は、決めない
        const obj = getCharacterObject();
        obj.getWorldPosition(charPos);
        charFwd.set(0, 0, 1).applyQuaternion(obj.getWorldQuaternion(q)).setY(0).normalize();
        floorY = charPos.y;
        rig = computeRig({ head: [p.x, p.y, p.z], forward: [fwd.x, fwd.y, fwd.z], charPos: charPos.toArray(), charForward: charFwd.toArray(), floorY });
        applyRig();
        return;
      }
      for (const src of session.inputSources) {
        const axes = src.gamepad?.axes;
        if (!axes || axes.length < 2) continue;
        const ax = axes.length >= 4 ? axes[2] : axes[0];
        const ay = axes.length >= 4 ? axes[3] : axes[1];
        if (Math.hypot(ax, ay) < STICK_DEAD) continue;
        // 頭の向きを基準に歩く(世界の向きへ直す)
        const [fx, fz] = rotateXZ(fwd.x, fwd.z, rig.yaw);
        const n = Math.hypot(fx, fz) || 1;
        const step = STICK_SPEED * Math.min(dt, 0.1);
        rig.x += ((fx / n) * -ay + (-fz / n) * ax) * step;
        rig.z += ((fz / n) * -ay + (fx / n) * ax) * step;
        applyRig();
        break;
      }
    },
    stop() {
      if (backdrop) scene.remove(backdrop);
      base = null;
      rig = null;
      renderer.xr.setReferenceSpace(null);
    },
  };
}
