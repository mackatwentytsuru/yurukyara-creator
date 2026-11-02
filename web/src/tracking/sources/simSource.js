// マウスの位置を「人の位置」にする入力。カメラなしの試しと、確かめ用。
// 画面の上でマウスを動かすと、その方向にお客さんがいることになる。ホイールで近づく・離れる。
import { faceToWorld } from '../geometry.js';

export class SimSource {
  constructor({ element, getFrame, gain = 2, hfovDeg = 65 }) {
    this.kind = 'sim';
    this.el = element;
    this.getFrame = getFrame;
    this.gain = gain;
    this.hfovDeg = hfovDeg;
    this.faces = []; // { x, y, width, mouth }(画像の中の位置の割合。試験から直接入れてもよい)
    this.width = 0.18;
    this._handlers = [];
  }

  async start() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push(() => target.removeEventListener(type, fn, opts));
    };
    on(window, 'pointermove', (e) => {
      if (e.target !== this.el) return;
      const r = this.el.getBoundingClientRect();
      this.faces = [{ x: 1 - (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, width: this.width, mouth: 0 }];
    });
    on(this.el, 'pointerleave', () => (this.faces = []));
    on(
      this.el,
      'wheel',
      (e) => {
        this.width = Math.min(0.5, Math.max(0.04, this.width * (e.deltaY < 0 ? 1.1 : 0.9)));
        e.preventDefault();
      },
      { passive: false },
    );
  }

  stop() {
    this._handlers.forEach((off) => off());
    this._handlers = [];
    this.faces = [];
  }

  getPeople() {
    if (!this.faces.length) return [];
    const { toWorld, headY, camZ } = this.getFrame();
    return this.faces.map((f) => {
      const [x, y, z] = faceToWorld(f, { hfovDeg: this.hfovDeg, aspect: 4 / 3, headY });
      return { position: toWorld([x, y, z]), gaze: toWorld([x * this.gain, y, camZ]), mouth: f.mouth ?? 0 };
    });
  }

  info() {
    return { label: 'マウスで試し中', ok: false };
  }
}
