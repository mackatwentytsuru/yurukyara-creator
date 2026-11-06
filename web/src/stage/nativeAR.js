// iPhone の AR。Safari に WebXR が無いので、自作の殻アプリ(place/ios/ARStage)が
// ARKit の上に透明な WKWebView を重ねて、このページを開く。殻が毎フレーム姿勢を送り、ここで three.js のカメラに写す。
//
// 約束(殻 → ページ): window.__arhost.onPose(world16, projection16)
//   world16      … カメラのワールド行列(列優先 16 個、メートル、y が上。向きは縦持ち(portrait)に直したもの)
//   projection16 … 縦持ちの画面に合わせた射影行列(列優先 16 個、OpenGL の流儀)
//   window.__arhost.onHit(x, y, z)       … raycast の答え(ワールド座標)。当たらなければ呼ばない
//   window.__arhost.onFloor(y)           … 見つけた床の高さ(いちばん低い水平面)
// 約束(ページ → 殻): window.webkit.messageHandlers.arhost.postMessage({type, ...})
//   {type:'ready'} … ページの用意ができた。{type:'raycast', x, y} … 画面上の点(0〜1、左上が原点)の先の床を聞く
import * as THREE from 'three';

export function hasNativeAR(win = globalThis) {
  return Boolean(win?.webkit?.messageHandlers?.arhost);
}

const isArr16 = (a) => Array.isArray(a) && a.length === 16 && a.every(Number.isFinite);

/**
 * @param {object} args
 * @param {THREE.PerspectiveCamera} args.camera 殻の姿勢で動かす camera
 * @param {Window} [args.win]
 * @param {(p:THREE.Vector3)=>void} [args.onHit] raycast の答え
 * @param {(y:number)=>void} [args.onFloor] 床の高さの知らせ
 * @param {(camera:THREE.PerspectiveCamera)=>void} [args.onPose] 姿勢を写すたび(毎フレーム)に呼ぶ。見ている人の頭 = camera の位置
 */
export function createNativeAR({ camera, win = globalThis, onHit, onFloor, onPose }) {
  const state = { poses: 0, lastPoseAt: 0, floorY: null, active: false };

  function post(message) {
    win.webkit?.messageHandlers?.arhost?.postMessage(message);
  }

  const host = {
    onPose(world16, projection16) {
      if (!isArr16(world16) || !isArr16(projection16)) return;
      camera.matrix.fromArray(world16);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      camera.matrixWorldNeedsUpdate = true;
      camera.projectionMatrix.fromArray(projection16);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      state.poses += 1;
      state.lastPoseAt = Date.now();
      onPose?.(camera);
    },
    onHit(x, y, z) {
      if ([x, y, z].every(Number.isFinite)) onHit?.(new THREE.Vector3(x, y, z));
    },
    onFloor(y) {
      if (!Number.isFinite(y)) return;
      state.floorY = y;
      onFloor?.(y);
    },
  };

  return {
    state,
    host,
    start() {
      win.__arhost = host;
      state.active = true;
      post({ type: 'ready' });
    },
    stop() {
      state.active = false;
      if (win.__arhost === host) delete win.__arhost;
    },
    /** 画面上の点(0〜1)の先の床を殻に聞く。答えは onHit で来る。 */
    raycast(x, y) {
      post({ type: 'raycast', x, y });
    },
  };
}

/**
 * 殻の中で、キャラを置く位置(床)をどう決めるか。
 * 見つけた床の高さがあればそれ、無ければ最後にタップした床の点、どちらも無ければ
 * カメラの 1.4 m 下(手に持った高さの目安)。
 */
export function floorYFor({ floorY, hitY }, camera) {
  if (Number.isFinite(floorY)) return floorY;
  if (Number.isFinite(hitY)) return hitY;
  return camera.position.y - 1.4;
}
