// AR(iPhone の殻・Quest のパススルー)で、キャラを現実の床に立たせる。
// AR の世界は、アプリを起動した位置が原点で、撮った部屋(place)とは重ならない。
// そのため AR のあいだは、撮った部屋を隠し、キャラを「床をタップした点」か「いま見ている方向の少し前」に置く。
import * as THREE from 'three';

const AHEAD_M = 1.6; // はじめは、見ている方向のこの先に立たせる
const HAND_HEIGHT_M = 1.4; // 床がまだ見つからないとき、端末は床からこの高さにあるとみなす

export function createArPlacement({ object3d, camera }) {
  let floorY = null;
  let hitY = null;
  let placed = false;
  const saved = { position: object3d.position.clone(), quaternion: object3d.quaternion.clone() };
  const v = new THREE.Vector3();

  const faceCamera = () => {
    camera.getWorldPosition(v);
    object3d.rotation.set(0, Math.atan2(v.x - object3d.position.x, v.z - object3d.position.z), 0);
  };
  const currentFloor = () => floorY ?? hitY ?? camera.getWorldPosition(v).y - HAND_HEIGHT_M;

  return {
    get placed() {
      return placed;
    },
    /** 殻が床の高さを見つけた */
    onFloor(y) {
      floorY = y;
      if (placed) object3d.position.y = y;
    },
    /** 床をタップした点(ワールド)に立たせる */
    onHit(p) {
      hitY = p.y;
      object3d.position.set(p.x, p.y, p.z);
      faceCamera();
      placed = true;
    },
    /** 姿勢が来るたびに呼ぶ。まだ置いていなければ、見ている方向の先に置く */
    onPose() {
      if (placed) return;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) return;
      dir.normalize();
      camera.getWorldPosition(v);
      object3d.position.set(v.x + dir.x * AHEAD_M, currentFloor(), v.z + dir.z * AHEAD_M);
      faceCamera();
      placed = true;
    },
    /** 画面に戻ったら、元の位置と向きに戻す */
    restore() {
      object3d.position.copy(saved.position);
      object3d.quaternion.copy(saved.quaternion);
      placed = false;
      floorY = null;
      hitY = null;
    },
  };
}
