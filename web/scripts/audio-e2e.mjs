// 声の向きの通し(画面なしの Chrome)。向きの分かっている偽のステレオ録音(計算で作った物)を、偽のマイクとして流し、
// ページの中の StereoMic(AudioWorklet → 向きの推定)が出す向きを読む。実機のマイクではない。
//   node scripts/audio-e2e.mjs --spacing 0.06 --angles -60,-30,0,30,60 --snr 25 --out <json>
// 確かめること: 2 チャンネルが取れる・左右が時間ずれなく届く(AudioWorklet)・ブラウザの経路でも向きが合う。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSpeech, stereo } from './lib/stereoSim.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = arg('port', '8787');
const SPACING = Number(arg('spacing', 0.06));
const SNR = Number(arg('snr', 25));
const ANGLES = arg('angles', '-60,-30,0,30,60').split(',').map(Number);
const OUT = arg('out', '');
const FS = 48000;
const LEN = 1 << 18; // 約 5.5 秒

function wav(l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(FS, 24);
  buf.writeUInt32LE(FS * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

const { chromium } = await import('playwright-core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stereo-e2e-'));
const x = makeSpeech({ fs: FS, length: LEN, seed: 4 });
const rows = [];
for (const deg of ANGLES) {
  const sig = stereo([{ x, deg }], { fs: FS, spacingM: SPACING, snrDb: SNR });
  const file = path.join(dir, `a${deg}.wav`).split(path.sep).join('/');
  fs.writeFileSync(file, wav(sig.l, sig.r));
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message.slice(0, 160)));
  await page.goto(`http://127.0.0.1:${PORT}/?micspacing=${SPACING}&auto=0`);
  await page.waitForFunction(() => window.__app?.startStereo, null, { timeout: 60000 });
  const status = await page.evaluate(() => window.__app.startStereo());
  const info = await page.evaluate(() => window.__app.stereoMic.info);
  await page.waitForTimeout(1500);
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const e = await page.evaluate(() => window.__app.stereoMic.estimate());
    const m = e?.measurements?.find((q) => q.kind === 'itd');
    if (m) samples.push(m.bearingDeg);
    await page.waitForTimeout(100);
  }
  await browser.close();
  const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
  const sd = samples.length ? Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length) : null;
  rows.push({ trueDeg: deg, status, channels: info.channels, sampleRate: info.sampleRate, n: samples.length, meanDeg: mean, sdDeg: sd, errorDeg: mean === null ? null : mean - deg, problems });
  console.log(`${String(deg).padStart(4)}度: ${status}(${info.channels}ch ${info.sampleRate}Hz) 読み ${mean === null ? '—' : mean.toFixed(1)}度 ±${sd === null ? '—' : sd.toFixed(1)} (${samples.length}/40) ${problems.length ? problems.join('|') : ''}`);
}
fs.rmSync(dir, { recursive: true, force: true });
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ spacingM: SPACING, snrDb: SNR, note: '計算で作った偽のステレオ録音を、偽のマイクとして Chrome(画面なし)に流した。実機のマイクではない', rows }, null, 2));
