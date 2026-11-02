// カメラから顔を見つける。処理はすべてこの端末の中。映像は <video> と MediaPipe の中だけで使い、
// 外に出るのは「位置・大きさ・口の開き」の数字だけ(attention.js に渡す)。保存も送信もしない。
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;

/** ブレンドシェイプから口の開きを 1 つの数にする */
export function mouthOpenness(categories) {
  const get = (name) => categories.find((c) => c.categoryName === name)?.score ?? 0;
  return Math.min(1, get('jawOpen') + 0.5 * get('mouthFunnel') + 0.3 * get('mouthPucker'));
}

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.faces = [];
    this.fps = 0;
    this._fpsClock = { t: 0, n: 0 };
    this.delegate = 'GPU';
  }

  async start({ facingMode = 'user' } = {}) {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const make = (delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numFaces: 4,
        outputFaceBlendshapes: true,
      });
    try {
      this.landmarker = await make('GPU');
    } catch (err) {
      console.warn('GPU で動かせなかったので CPU にします:', err.message);
      this.delegate = 'CPU';
      this.landmarker = await make('CPU');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
    return video;
  }

  /** 1 フレーム処理する。新しいフレームが無ければ前の結果を返す */
  step(nowMs) {
    const v = this.video;
    if (!this.landmarker || !v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return this.faces;
    this.lastVideoTime = v.currentTime;
    const result = this.landmarker.detectForVideo(v, nowMs);
    const aspect = v.videoWidth / v.videoHeight;
    this.faces = (result.faceLandmarks ?? []).map((lm, i) => {
      const xs = lm.map((p) => p.x);
      const ys = lm.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      // 顔の幅 = 頬から頬(画像の幅に対する割合)
      const width = Math.hypot(lm[LEFT_CHEEK].x - lm[RIGHT_CHEEK].x, (lm[LEFT_CHEEK].y - lm[RIGHT_CHEEK].y) / aspect);
      const mouth = mouthOpenness(result.faceBlendshapes?.[i]?.categories ?? []);
      return { x: cx, y: cy, width, mouth };
    });
    this._fpsClock.n += 1;
    if (nowMs - this._fpsClock.t >= 1000) {
      this.fps = (this._fpsClock.n * 1000) / (nowMs - this._fpsClock.t);
      this._fpsClock = { t: nowMs, n: 0 };
    }
    return this.faces;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.stream = null;
    this.landmarker = null;
  }
}
