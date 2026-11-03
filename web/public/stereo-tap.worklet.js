// マイクの左右の音を、そのまま(時刻のずれなく)画面側へ渡すだけの小さな部品。声の向きを出すために使う。
// 音は、この端末のこのページの中にしか渡らない。保存も、送信もしない(通信・保存の道具を、ここでは使わない)。
class StereoTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = 0;
    this.l = new Float32Array(512);
    this.r = new Float32Array(512);
    this.mono = false;
  }

  process(inputs) {
    const ch = inputs[0];
    if (!ch || ch.length === 0) return true;
    if (ch.length < 2) {
      if (!this.mono) {
        this.mono = true;
        this.port.postMessage({ mono: true });
      }
      return true;
    }
    this.l.set(ch[0], this.blocks * 128);
    this.r.set(ch[1], this.blocks * 128);
    this.blocks += 1;
    if (this.blocks === 4) {
      // 128 サンプルを 4 つまとめて(512)、左右そろえて渡す
      const l = this.l.slice();
      const r = this.r.slice();
      this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
      this.blocks = 0;
    }
    return true;
  }
}

registerProcessor('stereo-tap', StereoTap);
