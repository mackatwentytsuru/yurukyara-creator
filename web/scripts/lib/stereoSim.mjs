// 試験用: 声らしい音と、決まった向き・マイク間隔のステレオ録音を、計算で作る(実機の録音ではない)。
// 小数サンプルの遅れは、周波数の位相をずらして正確に作る。マイクの雑音は、白い雑音を足す。
import { fft } from '../../src/tracking/audio/fft.js';

export const C = 343;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 声らしい音: 基本周波数がゆれる倍音(〜3.5kHz)に、音節のリズム(約 4Hz)と摩擦音のような雑音を重ねる */
export function makeSpeech({ fs, length, seed = 1, f0 = 150 }) {
  const r = rng(seed);
  const x = new Float64Array(length);
  const harmonics = Math.floor(3500 / f0);
  const phase = Array.from({ length: harmonics }, () => r() * 2 * Math.PI);
  const amp = Array.from({ length: harmonics }, (_, k) => (1 / (k + 1)) * (0.6 + 0.4 * r()));
  const lfo = r() * 2 * Math.PI;
  let ph = 0;
  for (let n = 0; n < length; n++) {
    const t = n / fs;
    const f = f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 0.7 * t + lfo));
    ph += (2 * Math.PI * f) / fs;
    let s = 0;
    for (let k = 0; k < harmonics; k++) s += amp[k] * Math.sin((k + 1) * ph + phase[k]);
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t + lfo);
    x[n] = s * (0.3 + 0.7 * env) + 0.15 * env * gauss(r);
  }
  return x;
}

/** 秒単位の遅れ(小数サンプル)を、位相でずらして作る(円環。長さは 2 のべき乗) */
export function delayed(x, sec, fs) {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = k <= n / 2 ? k : k - n;
    const ang = (-2 * Math.PI * f * sec * fs) / n;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const a = re[k];
    re[k] = a * c - im[k] * s;
    im[k] = a * s + im[k] * c;
  }
  fft(re, im, true);
  return re;
}

const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

/**
 * 向きのある音源(複数可)から、左右のマイクの音を作る。向きは正面 0・右が正。
 * 右の音源は、右のマイクに先に着く(左が遅れる)。
 * @param {{x:Float64Array, deg:number, gain?:number}[]} sources
 * @param {{fs:number, spacingM:number, snrDb?:number, seed?:number, rms?:number}} o snrDb は、音源の音とマイクの白い雑音の比(未指定なら雑音なし)
 */
export function stereo(sources, { fs, spacingM, snrDb = Infinity, seed = 7, rms = 0.08 }) {
  const n = sources[0].x.length;
  const l = new Float64Array(n);
  const r = new Float64Array(n);
  for (const s of sources) {
    const dt = (spacingM * Math.sin((s.deg * Math.PI) / 180)) / C; // 左 − 右 の到着の差
    const xl = delayed(s.x, dt / 2, fs);
    const xr = delayed(s.x, -dt / 2, fs);
    const g = (s.gain ?? 1) * (rms / rmsOf(s.x));
    for (let i = 0; i < n; i++) {
      l[i] += xl[i] * g;
      r[i] += xr[i] * g;
    }
  }
  if (Number.isFinite(snrDb)) {
    const nr = rng(seed);
    const sigma = rmsOf(l) / 10 ** (snrDb / 20);
    for (let i = 0; i < n; i++) {
      l[i] += sigma * gauss(nr);
      r[i] += sigma * gauss(nr);
    }
  }
  return { l: Float32Array.from(l), r: Float32Array.from(r) };
}

/** tracker に 128 サンプルずつ渡して、枠ごとの結果を集める */
export function feed(tracker, { l, r }, chunk = 128) {
  const frames = [];
  for (let i = 0; i + chunk <= l.length; i += chunk) {
    const out = tracker.push(l.subarray(i, i + chunk), r.subarray(i, i + chunk));
    if (out) frames.push(out);
  }
  return frames;
}
