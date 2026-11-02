// 端末のカメラで顔を見つける入力。映像は端末の中だけで使う(faceTracker.js)。
import { FaceTracker } from '../faceTracker.js';
import { faceToWorld } from '../geometry.js';

export class MediapipeSource {
  /**
   * @param {object} opts
   * @param {() => {toWorld:(local:number[])=>number[], headY:number, camZ:number}} opts.getFrame
   *   キャラの座標(足元が原点・+z が正面・+x がお客さんから見て右)とワールドの変換、頭の高さ、窓(カメラ)の距離
   * @param {number} [opts.gain] 視線の振れ幅の倍率
   * @param {number} [opts.hfovDeg] カメラの横の画角
   */
  constructor({ getFrame, gain = 2, hfovDeg = 65 }) {
    this.kind = 'mediapipe';
    this.getFrame = getFrame;
    this.gain = gain;
    this.hfovDeg = hfovDeg;
    this.tracker = new FaceTracker();
  }

  async start() {
    await this.tracker.start();
  }

  stop() {
    this.tracker.stop();
  }

  get video() {
    return this.tracker.video;
  }

  getPeople(nowMs) {
    const faces = this.tracker.step(nowMs);
    if (!faces.length) return [];
    const { toWorld, headY, camZ } = this.getFrame();
    const v = this.tracker.video;
    const aspect = v ? v.videoWidth / v.videoHeight : 4 / 3;
    return faces.map((f) => {
      const [x, y, z] = faceToWorld(f, { hfovDeg: this.hfovDeg, aspect, headY });
      return {
        position: toWorld([x, y, z]),
        // 画面は窓。キャラは、窓の向こうにいるカメラの位置から、人の左右・上下の分だけ振って見る
        gaze: toWorld([x * this.gain, y, camZ]),
        mouth: f.mouth,
      };
    });
  }

  info() {
    return { label: `${this.tracker.delegate} ${this.tracker.fps.toFixed(0)}fps`, ok: true };
  }
}
