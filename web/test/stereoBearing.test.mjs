// ステレオの音から声の向きを出す。計算で作った音(scripts/lib/stereoSim.mjs)で、向き・間隔・雑音・複数の声を確かめる。
// 実機のマイクの録音ではない。間隔(micSpacingM)は設定で、機材ごとに実測が要る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft } from '../src/tracking/audio/fft.js';
import { StereoBearingTracker, analyzeFrame, bearingFromLag, fitSpacing, fitIldSlope, confidenceFromCoherence } from '../src/tracking/audio/stereoBearing.js';
import { makeSpeech, stereo, feed } from '../scripts/lib/stereoSim.mjs';

const fs = 48000;
const N = 1 << 16;
const speech = (seed = 3) => makeSpeech({ fs, length: N, seed });
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** 向き deg の声を流して、確かな枠の向きの平均と、枠ごとの揺れを返す */
function run(deg, { spacingM = 0.06, snrDb = 25, seed = 3, opts = {} } = {}) {
  const sig = stereo([{ x: speech(seed), deg }], { fs, spacingM, snrDb });
  const tr = new StereoBearingTracker({ fs, micSpacingM: spacingM, ...opts });
  const frames = feed(tr, sig).filter((f) => f.voiced && f.confidence >= 0.25);
  const b = frames.map((f) => f.itdBearingDeg);
  return { n: b.length, mean: mean(b), sd: Math.sqrt(mean(b.map((v) => (v - mean(b)) ** 2))), tr };
}

test('FFT: 逆変換で元に戻り、正弦波は 1 つの山になる', () => {
  const n = 64;
  const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
  const im = new Float64Array(n);
  const orig = Float64Array.from(re);
  fft(re, im);
  assert.ok(Math.abs(re[5] - n / 2) < 1e-9 && Math.abs(re[7]) < 1e-9);
  fft(re, im, true);
  orig.forEach((v, i) => assert.ok(Math.abs(re[i] - v) < 1e-9));
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)));
});

test('時間差 → 向き: 右の音は正、左は負、物理の範囲を超えたら範囲外', () => {
  const d = 0.06;
  const maxLag = d / 343;
  assert.ok(Math.abs(bearingFromLag(0, d).bearingDeg) < 1e-9);
  assert.ok(Math.abs(bearingFromLag(maxLag, d).bearingDeg - 90) < 1e-6);
  assert.ok(bearingFromLag(-maxLag / 2, d).bearingDeg < -29.9 && bearingFromLag(-maxLag / 2, d).bearingDeg > -30.1);
  assert.equal(bearingFromLag(maxLag * 1.3, d).outOfRange, true);
});

test('間隔 6cm: −60〜60 度の声の向きを、平均で 1.5 度以内で当てる(雑音 25dB)', () => {
  for (const deg of [-60, -30, 0, 30, 60]) {
    const r = run(deg);
    assert.ok(r.n > 40, `${deg}度: 確かな枠が少ない ${r.n}`);
    assert.ok(Math.abs(r.mean - deg) < 1.5, `${deg}度 → ${r.mean.toFixed(1)}`);
  }
});

test('間隔が違っても(4cm・10cm・20cm)、設定の間隔を合わせれば当たる。間隔を取り違えると外れる', () => {
  for (const d of [0.04, 0.1, 0.2]) {
    const r = run(30, { spacingM: d });
    assert.ok(Math.abs(r.mean - 30) < 2, `間隔 ${d}: ${r.mean.toFixed(1)}`);
  }
  // 設定が実際の半分だと、向きは大きく外れる(間隔の実測が必要な理由)
  const sig = stereo([{ x: speech(), deg: 30 }], { fs, spacingM: 0.1, snrDb: 25 });
  const wrong = new StereoBearingTracker({ fs, micSpacingM: 0.05 });
  const m = mean(feed(wrong, sig).filter((f) => f.confidence >= 0.25).map((f) => f.itdBearingDeg));
  assert.ok(Math.abs(m - 30) > 15, String(m));
});

test('左右を入れ替える設定で、向きが反転する', () => {
  const a = run(40);
  const b = run(40, { opts: { swapLeftRight: true } });
  assert.ok(a.mean > 35 && b.mean < -35);
});

test('雑音(白い雑音との比)が下がっても、0dB までは向きが当たり、確かさは下がる', () => {
  const clean = run(30, { snrDb: 25 });
  const noisy = run(30, { snrDb: 0 });
  assert.ok(Math.abs(noisy.mean - 30) < 4, String(noisy.mean));
  assert.ok(noisy.sd > clean.sd);
});

test('声が無い(左右別の雑音だけ)ときは、確かな向きを出さない', () => {
  let st = 17;
  const rnd = () => ((st = (st * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.1;
  const l = Float32Array.from({ length: N }, rnd);
  const r = Float32Array.from({ length: N }, rnd);
  const tr = new StereoBearingTracker({ fs, micSpacingM: 0.06 });
  const frames = feed(tr, { l, r });
  const confident = frames.filter((f) => f.voiced && f.confidence >= 0.25);
  assert.ok(confident.length / frames.length < 0.1, `${confident.length}/${frames.length}`);
});

test('無音は「声なし」。声が止まって 0.4 秒たつと、向きの見立ては空になる', () => {
  const tr = new StereoBearingTracker({ fs, micSpacingM: 0.06 });
  feed(tr, stereo([{ x: speech(), deg: 20 }], { fs, spacingM: 0.06, snrDb: 25 }));
  assert.equal(tr.estimate().voiced, true);
  assert.equal(tr.estimate().measurements[0].kind, 'itd');
  const silent = { l: new Float32Array(48000).fill(0), r: new Float32Array(48000).fill(0) };
  feed(tr, silent);
  assert.equal(tr.estimate().voiced, false);
  assert.deepEqual(tr.estimate().measurements, []);
});

test('2 人が同時に話すと、大きいほうの向きに寄る(声が 2 倍違うとき)', () => {
  const sig = stereo([{ x: speech(3), deg: -40, gain: 1 }, { x: makeSpeech({ fs, length: N, seed: 9, f0: 210 }), deg: 40, gain: 0.35 }], { fs, spacingM: 0.06, snrDb: 25 });
  const tr = new StereoBearingTracker({ fs, micSpacingM: 0.06 });
  const b = feed(tr, sig).filter((f) => f.confidence >= 0.25).map((f) => f.itdBearingDeg);
  const med = [...b].sort((x, y) => x - y)[Math.floor(b.length / 2)];
  assert.ok(med < -30, `大きい声(−40 度)に寄る: 中央値 ${med.toFixed(1)}`);
});

test('音量差: 設定すれば測定値に入る(既定は使わない)。向きへの変換係数は、既知の向きから最小二乗で求める', () => {
  // 右が 6dB 大きい音
  const x = speech();
  const l = Float32Array.from(x, (v) => v * 0.05);
  const r = Float32Array.from(x, (v) => v * 0.1);
  const none = new StereoBearingTracker({ fs, micSpacingM: 0.06 });
  feed(none, { l, r });
  assert.equal(none.estimate().measurements.some((m) => m.kind === 'ild'), false);
  const on = new StereoBearingTracker({ fs, micSpacingM: 0.06, ildDegPerDb: 5 });
  feed(on, { l, r });
  const ild = on.estimate().measurements.find((m) => m.kind === 'ild');
  assert.ok(ild && ild.bearingDeg > 25 && ild.bearingDeg < 35, JSON.stringify(ild));
  assert.ok(Math.abs(fitIldSlope([{ trueDeg: 15, ildDb: 3 }, { trueDeg: -30, ildDb: -6 }, { trueDeg: 0, ildDb: 0 }]) - 5) < 1e-9);
});

test('間隔の実測: 既知の向きと時間差から、実効の間隔を求める(20 度未満の点は使わない)', () => {
  const d = 0.057;
  const samples = [-60, -30, -5, 5, 30, 60].map((deg) => ({ trueDeg: deg, lagSec: (d * Math.sin((deg * Math.PI) / 180)) / 343 }));
  assert.ok(Math.abs(fitSpacing(samples) - d) < 1e-9);
  assert.equal(fitSpacing([{ trueDeg: 5, lagSec: 0.0001 }]), null);
});

test('確かさ: 位相がそろうほど高く、間隔が広いほど床が高い', () => {
  assert.equal(confidenceFromCoherence(0.1, 0.06), 0);
  assert.ok(confidenceFromCoherence(0.8, 0.06) > 0.9);
  assert.ok(confidenceFromCoherence(0.4, 0.2) < confidenceFromCoherence(0.4, 0.04));
});

test('1 枠の分析は、時間差・音量差・揃い具合・音の大きさを返す', () => {
  const sig = stereo([{ x: speech(), deg: 20 }], { fs, spacingM: 0.06, snrDb: 30 });
  const f = analyzeFrame(sig.l.subarray(0, 2048), sig.r.subarray(0, 2048), { fs, spacingM: 0.06 });
  assert.ok(f.lagSamples > 0 && f.coherence > 0.8 && f.rms > 0.05 && Math.abs(f.ildDb) < 1);
});
