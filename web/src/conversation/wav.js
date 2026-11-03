// サーバーの聞き取りへ送る音を作る。マイクの音を 16kHz・16bit の WAV にする。DOM を使わない部分だけここに置く(試験できるように)。

export const STT_RATE = 16000;

/** 線形補間で標本化の周波数を変える */
export function resample(input, fromRate, toRate = STT_RATE) {
  if (fromRate === toRate) return input;
  const n = Math.floor((input.length * toRate) / fromRate);
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const a = Math.floor(p);
    const b = Math.min(a + 1, input.length - 1);
    out[i] = input[a] + (input[b] - input[a]) * (p - a);
  }
  return out;
}

/** -1〜1 の音を、16bit・1ch の WAV の中身にする */
export function encodeWav(samples, rate = STT_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 1ch
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
  return buf;
}

/**
 * 声の区間を集める。声と判定されるのは出始めの少し後なので、直前の音も(preroll)含める。
 *   push(音) を流し続け、声が出たら begin()、止まったら end() で区間を受け取る。
 */
export class SegmentCollector {
  constructor({ rate, prerollS = 0.5, maxS = 20 }) {
    this.rate = rate;
    this.prerollLen = Math.round(rate * prerollS);
    this.maxLen = Math.round(rate * maxS);
    this.ring = [];
    this.ringLen = 0;
    this.chunks = null;
    this.len = 0;
  }

  get active() {
    return this.chunks !== null;
  }

  /** 区間が長くなりすぎた(いったん区切って送る) */
  get full() {
    return this.active && this.len >= this.maxLen;
  }

  push(samples) {
    const copy = Float32Array.from(samples);
    if (this.active) {
      this.chunks.push(copy);
      this.len += copy.length;
      return;
    }
    this.ring.push(copy);
    this.ringLen += copy.length;
    while (this.ring.length > 1 && this.ringLen - this.ring[0].length >= this.prerollLen) {
      this.ringLen -= this.ring.shift().length;
    }
  }

  begin() {
    if (this.active) return;
    this.chunks = this.ring;
    this.len = this.ringLen;
    this.ring = [];
    this.ringLen = 0;
  }

  /** 区間を捨てる(キャラ自身の声を拾っていたときなど) */
  cancel() {
    this.chunks = null;
    this.len = 0;
  }

  /** @returns {Float32Array|null} 区間の音。始まっていなければ null */
  end() {
    if (!this.active) return null;
    const out = new Float32Array(this.len);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.cancel();
    return out;
  }
}
