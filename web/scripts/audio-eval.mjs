// 声の向きの精度を、計算で作ったステレオの声で測る(実機のマイクではない)。
//   node scripts/audio-eval.mjs --out ../docs/audio_eval/シミュレーション.json
// 1) 向きの誤差: マイク間隔 × 雑音(白い雑音との比) × 向き。
// 2) 話し手の見分け: 2 人が角度 s だけ離れて立ち、片方が話す(もう片方が小さく同時に話す場合も)。音だけで、正しく当てた割合。
// ここでの「間隔」は設定の値で、実機の間隔は実測が要る。雑音は白い雑音で、店の騒がしさ(人の声・音楽・反響)ではない。
import fs from 'node:fs';
import { StereoBearingTracker } from '../src/tracking/audio/stereoBearing.js';
import { fuseSpeaker } from '../src/tracking/speakerFusion.js';
import { makeSpeech, stereo, feed } from './lib/stereoSim.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const FS = 48000;
const LEN = 1 << 16; // 約 1.4 秒
const speech = (seed, f0 = 150) => makeSpeech({ fs: FS, length: LEN, seed, f0 });
const quantile = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};
const r1 = (v) => (v === null ? '—' : v.toFixed(1));

// ---- 1) 向きの誤差 ----
const SPACINGS = [0.03, 0.06, 0.1, 0.2];
const SNRS = [25, 10, 5, 0, -5];
const ANGLES = [-70, -45, -20, 0, 20, 45, 70];
const errTable = [];
for (const d of SPACINGS) {
  for (const snr of SNRS) {
    const errs = []; // 角度ごとの、見立て(中央値)の誤差の絶対値
    const frameErrs = []; // 枠ごとの誤差
    let frames = 0;
    let confident = 0;
    for (const deg of ANGLES) {
      const sig = stereo([{ x: speech(3), deg }], { fs: FS, spacingM: d, snrDb: snr });
      const tr = new StereoBearingTracker({ fs: FS, micSpacingM: d });
      const out = feed(tr, sig);
      frames += out.length;
      const ok = out.filter((f) => f.voiced && f.confidence >= 0.25);
      confident += ok.length;
      ok.forEach((f) => frameErrs.push(Math.abs(f.itdBearingDeg - deg)));
      const m = tr.estimate().measurements.find((q) => q.kind === 'itd');
      errs.push(m ? Math.abs(m.bearingDeg - deg) : null);
    }
    errTable.push({ spacingM: d, snrDb: snr, frameErrMedianDeg: quantile(frameErrs, 0.5), frameErrP90Deg: quantile(frameErrs, 0.9), confidentFrameRate: confident / frames, finalErrMaxDeg: errs.every((e) => e !== null) ? Math.max(...errs) : null, finalMissing: errs.filter((e) => e === null).length });
  }
}

// ---- 2) 話し手の見分け(音だけ) ----
const SEPS = [5, 10, 15, 20, 30, 45];
const CONDITIONS = [
  { name: '片方だけが話す(雑音 20dB)', snr: 20, other: 0 },
  { name: '片方だけが話す(雑音 5dB)', snr: 5, other: 0 },
  { name: '同時に話す(相手は半分の音量、雑音 20dB)', snr: 20, other: 0.5 },
];
const TRIALS = 16;
const idTable = [];
for (const d of [0.06, 0.1]) {
  for (const c of CONDITIONS) {
    for (const sep of SEPS) {
      let right = 0;
      let wrong = 0;
      let undecided = 0;
      for (let t = 0; t < TRIALS; t++) {
        const center = ((t * 37) % 60) - 30; // 立つ位置は試行ごとにずらす
        const people = [{ id: 'a', bearingDeg: center - sep / 2 }, { id: 'b', bearingDeg: center + sep / 2 }];
        const speaker = t % 2 ? 'a' : 'b';
        const other = speaker === 'a' ? 'b' : 'a';
        const at = (id) => people.find((p) => p.id === id).bearingDeg;
        const srcs = [{ x: speech(100 + t), deg: at(speaker), gain: 1 }];
        if (c.other) srcs.push({ x: speech(200 + t, 210), deg: at(other), gain: c.other });
        const sig = stereo(srcs, { fs: FS, spacingM: d, snrDb: c.snr, seed: 50 + t });
        const tr = new StereoBearingTracker({ fs: FS, micSpacingM: d });
        feed(tr, sig);
        const res = fuseSpeaker(people.map((p) => ({ ...p, activity: 0 })), tr.estimate());
        if (res.speakerId === speaker) right += 1;
        else if (res.speakerId === null) undecided += 1;
        else wrong += 1;
      }
      idTable.push({ spacingM: d, condition: c.name, separationDeg: sep, right, wrong, undecided, trials: TRIALS });
    }
  }
}

// ---- 表示 ----
const lines = [];
lines.push('## 1) 向きの誤差(枠ごと。向き 7 点 −70〜70 度の合計)', '', '| 間隔 | 雑音 | 枠の誤差 中央値 | 枠の誤差 90% | 確かな枠の割合 | 見立ての誤差(最大) |', '|---|---|---|---|---|---|');
for (const r of errTable) lines.push(`| ${(r.spacingM * 100).toFixed(0)} cm | ${r.snrDb} dB | ${r1(r.frameErrMedianDeg)}° | ${r1(r.frameErrP90Deg)}° | ${(r.confidentFrameRate * 100).toFixed(0)}% | ${r.finalMissing ? `欠け ${r.finalMissing}` : r1(r.finalErrMaxDeg) + '°'} |`);
lines.push('', '## 2) 話し手の見分け(音だけ。当たり / はずれ / 決めない、各 ' + TRIALS + ' 回)', '');
for (const d of [0.06, 0.1]) {
  for (const c of CONDITIONS) {
    lines.push(`### 間隔 ${d * 100} cm・${c.name}`, '', '| 2 人の角度差 | ' + SEPS.map((s) => `${s}°`).join(' | ') + ' |', '|---|' + SEPS.map(() => '---').join('|') + '|');
    const row = SEPS.map((s) => idTable.find((x) => x.spacingM === d && x.condition === c.name && x.separationDeg === s)).map((x) => `${x.right}/${x.wrong}/${x.undecided}`);
    lines.push('| 当/外/決めない | ' + row.join(' | ') + ' |', '');
  }
}
console.log(lines.join('\n'));
const out = arg('out', '');
if (out) {
  fs.mkdirSync(out.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ note: '計算で作ったステレオの声(白い雑音・反響なし)。実機のマイクの測定ではない', errTable, idTable }, null, 2));
  fs.writeFileSync(out.replace(/\.json$/, '.md'), lines.join('\n') + '\n');
}
