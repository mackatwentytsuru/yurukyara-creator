// 実機のマイク(録音機など)を、Chrome(画面なし)で選んで、マイクの確認の画面が 2 チャンネルで取れるかを見る。
//   node kiosk/eval/mic-real.mjs --hint DVR --port 8852 [--play 1] [--out <json>]
// --play 1: PC のスピーカーから、計算で作った声(wav)を鳴らして、マイクが拾う左右の音量差・時間差・向きの読みを集める(保存しない)。
// 録音ではなく、画面の中の数字(window.__mic)を読むだけ。人の声・部屋の位置の測定ではない(スピーカーの位置は分からない)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makeSpeech } from '../../web/scripts/lib/stereoSim.mjs';

const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const hint = arg('hint', 'DVR');
const port = arg('port', '8852');
const play = arg('play') === '1';
const { chromium } = await import(pathToFileURL('repo/web/node_modules/playwright-core/index.mjs').href);

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
await page.goto(`http://127.0.0.1:${port}/kiosk/mic.html?hint=${encodeURIComponent(hint)}&auto=1&spacing=0.06`);
await page.waitForFunction(() => window.__mic?.status && window.__mic.status !== 'starting' && window.__mic.status !== 'idle', null, { timeout: 30000 }).catch(() => {});
const devices = await page.evaluate(() => [...document.getElementById('dev').options].map((o) => o.textContent));
const info = await page.evaluate(() => ({ status: window.__mic?.status, ...window.__mic?.info, error: window.__mic?.error }));

const sample = async (seconds) => {
  const rows = [];
  for (let i = 0; i < seconds * 10; i++) {
    rows.push(await page.evaluate(() => {
      const t = window.__mic?.tracker;
      const f = t?.current;
      const e = window.__mic?.estimate();
      const m = e?.measurements?.find((x) => x.kind === 'itd');
      return { level: f?.level ?? null, ild: f?.ildDb ?? null, lag: f?.lagSamples ?? null, coh: f?.coherence ?? null, bearing: m?.bearingDeg ?? null, conf: m?.confidence ?? null, voiced: Boolean(e?.voiced) };
    }));
    await page.waitForTimeout(100);
  }
  return rows;
};
const stat = (rows, k) => {
  const v = rows.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? { median: v[Math.floor(v.length / 2)], min: v[0], max: v[v.length - 1], n: v.length } : null;
};
const quiet = await sample(3);
let loud = null;
if (play) {
  const x = makeSpeech({ fs: 44100, length: 44100 * 8, seed: 3 });
  const wavFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'micreal-')), 'speech.wav');
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round((x[i] / peak) * 0.6 * 32767), 44 + i * 2);
  fs.writeFileSync(wavFile, b);
  const ps = spawn('powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${wavFile}').PlaySync()`], { stdio: 'ignore' });
  loud = await sample(7);
  ps.kill();
  fs.rmSync(path.dirname(wavFile), { recursive: true, force: true });
}
await browser.close();
const result = {
  devices,
  info,
  problems,
  静かな間: { level: stat(quiet, 'level'), 声と判定した割合: quiet.filter((r) => r.voiced).length / quiet.length },
  ...(loud ? { スピーカーの声: { level: stat(loud, 'level'), ild_dB: stat(loud, 'ild'), lag_サンプル: stat(loud, 'lag'), 一致度: stat(loud, 'coh'), 向き_度: stat(loud, 'bearing'), 声と判定した割合: loud.filter((r) => r.voiced).length / loud.length } } : {}),
  note: 'PC のスピーカーの声をマイクが拾った数字(スピーカーの向き・距離は不明)。人の声・店の騒がしさの測定ではない。音は保存していない。',
};
console.log(JSON.stringify(result, null, 1));
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(result, null, 2));
