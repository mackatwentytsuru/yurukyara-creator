// ステレオのマイクから、声のする向き(水平の角度)を出す。特定の機材に依存しない: マイクの間隔(m)だけを設定にする。
// 手がかりは 2 つ。
//   1. 時間差(ITD): 左右の音のずれを GCC-PHAT(位相だけを使う相互相関)で測る。間隔が短いほどずれは小さいが、補間で 1 サンプルの数分の 1 まで読む。
//   2. 音量差(ILD): 左右の音量の比。間隔が極端に短い・向きのあるマイクでは、こちらが主になる。向きへの変換は機材ごとに測って決める(既定は使わない)。
// 角度は、マイクの正面を 0、右を正、左を負(−90〜90 度)。左右の向きの取り違えは leftRightSwap で直す。
// 音は端末の中で数字にするだけ。ここは配列を受け取って数字を返す純粋なロジックで、保存も送信もしない(node --test で確かめる)。
import { fft } from './fft.js';

export const SPEED_OF_SOUND = 343; // m/s(室温)

export const AUDIO_DEFAULTS = {
  micSpacingM: 0.06, // 左右のマイクの間隔。機材で違うので、実測で決める(録音機は未測定)
  frameSize: 2048, // 1 回の分析の長さ(サンプル)。48kHz で約 43ms
  hop: 1024,
  upsample: 4, // 相互相関を 4 倍に補間して、ピークを 1/4 サンプルで読む
  itdBandHz: [300, 4000], // 時間差を測る帯域。上は、間隔が広いと空間のエイリアスで崩れるので、c/(2d) でも抑える
  ildBandHz: [500, 5000],
  ildDegPerDb: 0, // 音量差 1dB あたりの角度。0 なら音量差は使わない(機材ごとに測って入れる)
  minRms: 0.004, // これ未満は無音
  noiseMargin: 3, // 雑音の床のこの倍を超えたら「声がある」
  minConfidence: 0.25, // これ未満の時間差は、使わない
  swapLeftRight: false,
  holdS: 0.4, // 声が途切れても、この間は直前の向きを返す
  historyFrames: 6,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deg = (rad) => (rad * 180) / Math.PI;

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
const windows = new Map();
const windowOf = (n) => {
  if (!windows.has(n)) windows.set(n, hann(n));
  return windows.get(n);
};

/** 時間差から向きへ。sin θ = c·Δt / d(Δt は 左の遅れ − 右の遅れ。右から来る音で正) */
export function bearingFromLag(lagSec, spacingM) {
  const s = (SPEED_OF_SOUND * lagSec) / spacingM;
  return { bearingDeg: deg(Math.asin(clamp(s, -1, 1))), outOfRange: Math.abs(s) > 1.15 };
}

/**
 * 左右 1 枠分の音から、時間差と音量差を出す。
 * @param {Float32Array|number[]} l 左 @param {Float32Array|number[]} r 右(同じ長さ、2 のべき乗)
 * @returns {{lagSamples:number, lagSec:number, psr:number, ildDb:number, rms:number}}
 */
export function analyzeFrame(l, r, { fs, spacingM = AUDIO_DEFAULTS.micSpacingM, upsample = AUDIO_DEFAULTS.upsample, itdBandHz = AUDIO_DEFAULTS.itdBandHz, ildBandHz = AUDIO_DEFAULTS.ildBandHz } = {}) {
  const n = l.length;
  const w = windowOf(n);
  const lr = new Float64Array(n);
  const li = new Float64Array(n);
  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    lr[i] = l[i] * w[i];
    rr[i] = r[i] * w[i];
    energy += l[i] * l[i] + r[i] * r[i];
  }
  fft(lr, li);
  fft(rr, ri);

  const binHz = fs / n;
  const hi = Math.min(itdBandHz[1], SPEED_OF_SOUND / (2 * spacingM));
  const kLo = Math.max(1, Math.ceil(itdBandHz[0] / binHz));
  const kHi = Math.min(n / 2 - 1, Math.floor(hi / binHz));
  const m = n * upsample;
  const gr = new Float64Array(m);
  const gi = new Float64Array(m);
  let pl = 0;
  let pr = 0;
  const ildLo = Math.ceil(ildBandHz[0] / binHz);
  const ildHi = Math.min(n / 2 - 1, Math.floor(ildBandHz[1] / binHz));
  for (let k = 1; k < n / 2; k++) {
    const cr = lr[k] * rr[k] + li[k] * ri[k]; // L · conj(R)
    const ci = li[k] * rr[k] - lr[k] * ri[k];
    if (k >= ildLo && k <= ildHi) {
      pl += lr[k] * lr[k] + li[k] * li[k];
      pr += rr[k] * rr[k] + ri[k] * ri[k];
    }
    if (k < kLo || k > kHi) continue;
    const mag = Math.hypot(cr, ci) + 1e-12;
    gr[k] = cr / mag; // PHAT: 位相だけ
    gi[k] = ci / mag;
    gr[m - k] = gr[k];
    gi[m - k] = -gi[k];
  }
  fft(gr, gi, true);

  const maxLag = (spacingM / SPEED_OF_SOUND) * fs; // 物理的に起こりうる最大のずれ(サンプル)
  const range = Math.ceil(maxLag * upsample) + upsample; // 少し余裕を見る
  const at = (i) => gr[(i + m) % m];
  let best = -Infinity;
  let bi = 0;
  for (let i = -range; i <= range; i++) {
    const v = at(i);
    if (v > best) {
      best = v;
      bi = i;
    }
  }
  // 放物線で、ピークを格子の間まで読む
  const a = at(bi - 1);
  const b = at(bi);
  const c = at(bi + 1);
  const den = a - 2 * b + c;
  const frac = den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
  const lagSamples = (bi + frac) / upsample;
  // 山のめだち(ピーク ÷ ほかの所の平均)。雑音だけなら小さく、声があれば大きい
  let sum = 0;
  let cnt = 0;
  for (let i = -range; i <= range; i++) {
    if (Math.abs(i - bi) <= 2 * upsample) continue;
    sum += Math.abs(at(i));
    cnt += 1;
  }
  const psr = cnt ? best / (sum / cnt + 1e-12) : 1;
  // 帯域内の周波数ごとの位相の揃い具合の平均(1 = 全部そろう、雑音だけなら 0 に近い)。間隔・帯域が違っても同じ物差しで比べられる
  const coherence = kHi >= kLo ? (best * m) / (2 * (kHi - kLo + 1)) : 0;
  return { lagSamples, lagSec: lagSamples / fs, psr, coherence, ildDb: 10 * Math.log10((pr + 1e-18) / (pl + 1e-18)), rms: Math.sqrt(energy / (2 * n)) };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/** 位相の揃い具合(0〜1) → 0〜1 の確かさ。雑音だけの入力(揃い具合の上位 10% が約 0.15〜0.34)で 0 に近くなるよう、間隔が広いほど床を上げる(scripts/audio-eval.mjs のシミュレーションで決めた) */
export function confidenceFromCoherence(coh, spacingM) {
  return clamp((coh - (0.15 + 0.5 * spacingM)) / 0.4, 0, 1);
}

/** 受け取った音を枠に切って分析し、向きの測定値(時間差・音量差)を返す。枠ごとの揺れを均して、揺れの大きさ(σ)も付ける */
export class StereoBearingTracker {
  constructor(options = {}) {
    this.o = { ...AUDIO_DEFAULTS, ...options };
    if (!this.o.fs) throw new Error('fs(サンプリング周波数)が要ります');
    const n = this.o.frameSize;
    this.l = new Float32Array(n);
    this.r = new Float32Array(n);
    this.filled = 0;
    this.sinceHop = 0;
    this.floor = this.o.minRms;
    this.history = []; // { bearingDeg, ildBearing }
    this.lastVoicedAt = -Infinity;
    this.clock = 0; // 受け取ったサンプルの数から数えた時刻(秒)
    this.current = null;
  }

  /** 128 サンプルなどの小さな塊を渡す。分析が走ったら、その測定値を返す(走らなければ null) */
  push(l, r) {
    const n = this.o.frameSize;
    const len = l.length;
    this.l.copyWithin(0, len);
    this.r.copyWithin(0, len);
    this.l.set(l, n - len);
    this.r.set(r, n - len);
    this.filled = Math.min(n, this.filled + len);
    this.sinceHop += len;
    this.clock += len / this.o.fs;
    if (this.filled < n || this.sinceHop < this.o.hop) return null;
    this.sinceHop = 0;
    return this._analyze();
  }

  _analyze() {
    const o = this.o;
    const f = analyzeFrame(this.l, this.r, { fs: o.fs, spacingM: o.micSpacingM, upsample: o.upsample, itdBandHz: o.itdBandHz, ildBandHz: o.ildBandHz });
    const voiced = f.rms > Math.max(o.minRms, this.floor * o.noiseMargin);
    if (!voiced) this.floor += (Math.max(f.rms, 1e-5) - this.floor) * 0.05; // 静かなときだけ、雑音の床を覚える
    const swap = o.swapLeftRight ? -1 : 1;
    const itd = bearingFromLag(f.lagSec * swap, o.micSpacingM);
    const confidence = voiced && !itd.outOfRange ? confidenceFromCoherence(f.coherence, o.micSpacingM) : 0;
    const ildBearing = o.ildDegPerDb ? clamp(f.ildDb * swap * o.ildDegPerDb, -90, 90) : null;
    const frame = { t: this.clock, voiced, level: f.rms, itdBearingDeg: itd.bearingDeg, confidence, coherence: f.coherence, ildDb: f.ildDb * swap, ildBearingDeg: ildBearing, lagSamples: f.lagSamples * swap };
    if (voiced) {
      this.lastVoicedAt = this.clock;
      if (confidence >= o.minConfidence || ildBearing !== null) {
        this.history.push({ itd: confidence >= o.minConfidence ? itd.bearingDeg : null, ild: ildBearing, confidence });
        if (this.history.length > o.historyFrames) this.history.shift();
      }
    } else if (this.clock - this.lastVoicedAt > o.holdS) {
      this.history.length = 0;
    }
    this.current = this._summarize(voiced, confidence, f.rms);
    return { ...frame, estimate: this.current };
  }

  _summarize(voiced, lastConfidence, level) {
    const o = this.o;
    const holding = this.clock - this.lastVoicedAt <= o.holdS;
    if (!holding) return { voiced: false, level, measurements: [] };
    const out = [];
    const itds = this.history.filter((h) => h.itd !== null).map((h) => h.itd);
    if (itds.length) {
      const med = median(itds);
      const mad = median(itds.map((v) => Math.abs(v - med))) * 1.4826;
      const conf = median(this.history.filter((h) => h.itd !== null).map((h) => h.confidence));
      // 1 サンプルの 1/4 の読みの粗さを、向きの角度に直した下限(正面ほど細かく、横ほど粗い)
      const degPerSample = deg((SPEED_OF_SOUND / (o.fs * o.micSpacingM)) / Math.max(0.2, Math.cos((med * Math.PI) / 180)));
      const resolution = degPerSample * 0.25;
      const sigma = Math.max(2, Math.hypot(mad, resolution)) / Math.sqrt(Math.max(conf, 0.25));
      out.push({ kind: 'itd', bearingDeg: med, sigmaDeg: sigma, confidence: conf });
    }
    const ilds = this.history.filter((h) => h.ild !== null).map((h) => h.ild);
    if (ilds.length && o.ildDegPerDb) out.push({ kind: 'ild', bearingDeg: median(ilds), sigmaDeg: 25, confidence: 0.5 }); // 音量差は粗い(既定の σ。機材ごとに測って直す)
    return { voiced: out.length > 0 && voiced, level, measurements: out };
  }

  /** いまの向きの見立て。声が途切れて holdS 過ぎたら、measurements は空 */
  estimate() {
    if (!this.current) return { voiced: false, level: 0, measurements: [] };
    if (this.clock - this.lastVoicedAt > this.o.holdS) return { voiced: false, level: this.current.level, measurements: [] };
    return this.current;
  }
}

/** 既知の向きで鳴らした音から、実効のマイク間隔を求める(正面から離れた 20 度以上の点だけ使う)。samples: [{ trueDeg, lagSec }] */
export function fitSpacing(samples) {
  const d = samples.filter((s) => Math.abs(s.trueDeg) >= 20).map((s) => (SPEED_OF_SOUND * s.lagSec) / Math.sin((s.trueDeg * Math.PI) / 180));
  return d.length ? median(d) : null;
}

/** 既知の向きの音量差(dB)から、1dB あたりの角度を最小二乗で求める(原点を通る直線)。samples: [{ trueDeg, ildDb }] */
export function fitIldSlope(samples) {
  let num = 0;
  let den = 0;
  for (const s of samples) {
    num += s.trueDeg * s.ildDb;
    den += s.ildDb * s.ildDb;
  }
  return den > 0 ? num / den : null;
}
