// 実機のステレオマイク(録音機など)の、マイク間隔と音量差の係数を、既知の向きの音から実測する道具。
//   録音しながら測る:  node scripts/audio-calibrate.mjs --device "マイク (Audio Control (DVR))" --angles -60,-30,0,30,60 --seconds 6
//   録音済みの wav を測る: node scripts/audio-calibrate.mjs --file a30.wav --angle 30
// 手順: マイクの正面を 0 度、右を正として、同じ距離(1〜1.5m)に、スマホなどの小さなスピーカーで声(または話しかける)を鳴らす位置を決める。
//       各角度で Enter → 6 秒録音。角度ごとの時間差(サンプル)・音量差(dB)を出し、実効のマイク間隔と、音量差 1dB あたりの角度を求める。
//       求めた値は URL で渡す: ?micspacing=<m>&ild=<度/dB>。左右が逆なら ?micswap=1。
// 録音は一時ファイルに置き、測ったあとに消す(保存しない)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { StereoBearingTracker, fitSpacing, fitIldSlope, SPEED_OF_SOUND } from '../src/tracking/audio/stereoBearing.js';

const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let fs0 = 44100;
  let ch = 2;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4);
    const sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      ch = b.readUInt16LE(p + 10);
      fs0 = b.readUInt32LE(p + 12);
    }
    if (id === 'data') {
      const off = p + 8;
      const n = Math.floor(Math.min(sz, b.length - off) / (2 * ch));
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        l[i] = b.readInt16LE(off + i * 2 * ch) / 32768;
        r[i] = b.readInt16LE(off + i * 2 * ch + (ch > 1 ? 2 : 0)) / 32768;
      }
      return { fs: fs0, channels: ch, l, r };
    }
    p += 8 + sz;
  }
  throw new Error('wav の音の部分が見つかりません');
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** wav から、確かな枠の時間差(サンプル・秒)と音量差(dB)の中央値を出す。間隔は広め(20cm)で測って、範囲に収まらない値も見えるようにする */
export function measureWav(file) {
  const w = readWav(file);
  const tr = new StereoBearingTracker({ fs: w.fs, micSpacingM: 0.2, minRms: 0.002, noiseMargin: 2 });
  const lags = [];
  const ilds = [];
  let frames = 0;
  for (let i = 0; i + 128 <= w.l.length; i += 128) {
    const o = tr.push(w.l.subarray(i, i + 128), w.r.subarray(i, i + 128));
    if (!o) continue;
    frames += 1;
    if (o.voiced && o.coherence > 0.5) {
      lags.push(o.lagSamples);
      ilds.push(o.ildDb);
    }
  }
  const lag = median(lags);
  const mad = median(lags.map((v) => Math.abs(v - lag))) * 1.4826;
  return { fs: w.fs, channels: w.channels, frames, usedFrames: lags.length, lagSamples: lag, lagSec: lag === null ? null : lag / w.fs, lagMadSamples: mad, ildDb: median(ilds) };
}

if (arg('file')) {
  const m = measureWav(arg('file'));
  console.log(JSON.stringify({ angle: Number(arg('angle', NaN)), ...m }, null, 1));
} else if (arg('device')) {
  const angles = arg('angles', '-60,-30,0,30,60').split(',').map(Number);
  const secs = Number(arg('seconds', 6));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-'));
  const rows = [];
  for (const a of angles) {
    await rl.question(`音源をマイクの正面から ${a} 度(右が正)に置いて、鳴らし始めてから Enter: `);
    const f = path.join(tmp, `a${a}.wav`);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${arg('device')}`, '-t', String(secs), '-ac', '2', f]);
    const m = measureWav(f);
    rows.push({ trueDeg: a, ...m });
    console.log(`  ${a}度: 時間差 ${m.lagSamples?.toFixed(2)} サンプル(±${m.lagMadSamples?.toFixed(2)}) 音量差 ${m.ildDb?.toFixed(1)} dB 使えた枠 ${m.usedFrames}/${m.frames}`);
  }
  rl.close();
  fs.rmSync(tmp, { recursive: true, force: true }); // 録音は残さない
  const spacing = fitSpacing(rows.filter((r) => r.lagSec !== null).map((r) => ({ trueDeg: r.trueDeg, lagSec: r.lagSec })));
  const slope = fitIldSlope(rows.filter((r) => r.ildDb !== null).map((r) => ({ trueDeg: r.trueDeg, ildDb: r.ildDb })));
  console.log(JSON.stringify({ 実効のマイク間隔_m: spacing, 最大の時間差_サンプル: spacing ? (spacing / SPEED_OF_SOUND) * rows[0].fs : null, 音量差1dBあたりの角度: slope, rows }, null, 1));
  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify({ spacingM: spacing, ildDegPerDb: slope, rows }, null, 2));
} else {
  console.log('使い方は、このファイルの先頭のコメントを見てください。');
}
