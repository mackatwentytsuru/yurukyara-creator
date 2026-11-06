#!/usr/bin/env node
// 2D のキャラを、GPU の Chrome で 1 コマずつ進めて撮る(確かめの写真と短い動画)。
//   node creator/d2/record_preview.mjs --parts characters/norrie/2d/parts.json --out <フォルダ> --stills
//   node creator/d2/record_preview.mjs --parts characters/norrie/2d/parts.json --out <フォルダ> --video 10 [--mp4 <出力.mp4>]
// 時間はページの中で決まった刻み(1/30 秒)で進めるので、毎回同じ絵になる(まばたきも台本どおり)。
// WebGL を CPU で描かない決まり: GPU の引数で起動し、CPU の描画なら止める(gpuGuard.js)。GPU の札を取ってから流す。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../../web/src/stage/gpuGuard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const PARTS = arg('parts', 'characters/norrie/2d/parts.json');
const OUT = path.resolve(arg('out', 'preview_out'));
const [VW, VH] = (arg('size', '720x1280') ?? '').split('x').map(Number);
const FPS = 30;
const DT = 1 / FPS;

// リポジトリの根を読むだけの小さなサーバー(127.0.0.1、GET だけ)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  const file = path.resolve(ROOT, `.${p}`);
  if (req.method !== 'GET' || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = await import(new URL('../../web/node_modules/playwright-core/index.mjs', import.meta.url).href);
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true, args: [...GPU_ARGS] });
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
const query = new URLSearchParams({ parts: `../../${PARTS}`, quiet: '1', bg: arg('bg', '#cdcdcd'), fit: arg('fit', '1.22') });
await page.goto(`http://127.0.0.1:${port}/creator/d2/preview.html?${query}`);
const rendererName = await stopIfSoftwareRenderer(page, browser);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 30000 });
const err = await page.evaluate(() => window.__error ?? null);
if (err) throw new Error(err);
fs.mkdirSync(OUT, { recursive: true });

/** ページの中で台本の 1 コマを進めて描く */
async function frame(cmd = {}) {
  await page.evaluate(({ cmd, DT }) => {
    const p = window.__preview;
    const c = p.character;
    if (cmd.emotion) c.setEmotion(cmd.emotion, cmd.weight ?? 1);
    if (cmd.gesture) c.play(cmd.gesture);
    if (typeof cmd.mouth === 'number') c.setMouth(cmd.mouth);
    if (cmd.blink) p.blinkNow();
    if (cmd.noRandomBlink) p.noRandomBlink();
    if ('caption' in cmd) p.caption(cmd.caption);
    p.step(DT, cmd.steps ?? 1);
    p.render();
  }, { cmd, DT });
}
const shot = (file) => page.screenshot({ path: file });
const state = () => page.evaluate(() => {
  const c = window.__preview.character;
  return { emotion: c.state2d.emotion, mouth: c.state2d.mouthShape, eyesScaleY: +c.state2d.eyesScaleY.toFixed(3), armR: +c.groups.arm_r?.rotation.z.toFixed(3), faceIds: c.state2d.faceIds };
});

const log = [];
if (has('stills')) {
  // 名前 → [台本の命令, 進める秒, 撮るまでの秒]
  const STILLS = {
    neutral: [{ emotion: 'neutral', mouth: 0, noRandomBlink: true }, 1.2],
    blink: [{ emotion: 'neutral', mouth: 0, noRandomBlink: true }, 1.0, { blink: true }, 0.08],
    talk_half: [{ emotion: 'neutral', mouth: 0.3, noRandomBlink: true }, 0.8],
    talk_open: [{ emotion: 'neutral', mouth: 0.9, noRandomBlink: true }, 0.8],
    happy: [{ emotion: 'happy', mouth: 0, noRandomBlink: true }, 1.0],
    surprised: [{ emotion: 'surprised', mouth: 0.3, noRandomBlink: true }, 1.0],
    sad: [{ emotion: 'sad', mouth: 0, noRandomBlink: true }, 1.0],
    angry: [{ emotion: 'angry', mouth: 0, noRandomBlink: true }, 1.0],
    relaxed: [{ emotion: 'relaxed', mouth: 0, noRandomBlink: true }, 1.0],
    think: [{ emotion: 'think', mouth: 0, noRandomBlink: true }, 1.0],
    wave: [{ emotion: 'happy', mouth: 0.6, noRandomBlink: true }, 0.6, { gesture: 'wave' }, 0.75],
    bow: [{ emotion: 'neutral', mouth: 0, noRandomBlink: true }, 0.6, { gesture: 'bow' }, 0.9],
    tilt: [{ emotion: 'think', mouth: 0, noRandomBlink: true }, 0.6, { gesture: 'tilt' }, 0.7],
    shrug: [{ emotion: 'neutral', mouth: 0, noRandomBlink: true }, 0.6, { gesture: 'shrug' }, 0.6],
  };
  const only = arg('only');
  for (const [name, plan] of Object.entries(STILLS)) {
    if (only && !only.split(',').includes(name)) continue;
    await page.reload();
    await page.waitForFunction(() => window.__ready);
    for (let i = 0; i < plan.length; i += 2) {
      const n = Math.max(1, Math.round(plan[i + 1] / DT));
      await frame({ ...plan[i], steps: 1 });
      if (n > 1) await frame({ steps: n - 1 });
    }
    const file = path.join(OUT, `${name}.png`);
    await shot(file);
    log.push({ name, file, ...(await state()) });
  }
}

if (has('video')) {
  const seconds = Number(arg('video', 10));
  const framesDir = path.join(OUT, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  // 10 秒の台本: まばたき → 話す(口 3 形)→ うれしい(手を振る)→ おどろき → かなしい(おじぎ)→ もどる
  const PLAN = [
    { t: 0.0, emotion: 'neutral', mouth: 0, noRandomBlink: true, caption: 'ノリー(2D)' },
    { t: 0.8, blink: true, caption: 'まばたき' },
    { t: 1.5, blink: true },
    { t: 2.0, caption: '話す(口の形 3 つ)', talk: [2.0, 4.6, 0.95] },
    { t: 2.6, gesture: 'nod' },
    { t: 4.8, emotion: 'happy', gesture: 'wave', caption: 'うれしい', talk: [5.0, 5.8, 0.75] },
    { t: 6.6, emotion: 'surprised', caption: 'おどろき', talk: [6.7, 7.3, 0.9] },
    { t: 7.5, blink: true },
    { t: 8.2, emotion: 'sad', gesture: 'bow', caption: 'かなしい' },
    { t: 9.4, emotion: 'neutral', caption: 'ノリー(2D)' },
    { t: 9.6, blink: true },
  ];
  let talk = null;
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const cmd = {};
    for (const p of PLAN) {
      if (Math.abs(p.t - t) < DT / 2) {
        const { t: _t, talk: tk, ...rest } = p;
        Object.assign(cmd, rest);
        if (tk) talk = tk;
      }
    }
    // 話す: 1 秒に 5〜6 音のつもりで、口の開きを上げ下げする(音の大きさの代わり)
    if (talk && t >= talk[0] && t <= talk[1]) {
      const u = (t - talk[0]) * 5.6;
      const syll = Math.max(0, Math.sin(u * Math.PI));
      const vary = 0.55 + 0.45 * Math.abs(Math.sin(u * 1.7 + 0.6));
      cmd.mouth = talk[2] * syll ** 0.7 * vary;
    } else if (talk && t > talk[1]) {
      cmd.mouth = 0;
      talk = null;
    }
    await frame(cmd);
    await shot(path.join(framesDir, `f_${String(i).padStart(4, '0')}.png`));
    if (i % 15 === 0) log.push({ t: +t.toFixed(2), ...(await state()) });
  }
  const mp4 = arg('mp4');
  if (mp4) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, 'f_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', '-map_metadata', '-1', path.resolve(mp4)], { stdio: 'inherit' });
    if (r.status !== 0) problems.push(`ffmpeg が失敗(${r.status})`);
  }
}

fs.writeFileSync(path.join(OUT, 'record_log.json'), JSON.stringify({ renderer: rendererName, size: [VW, VH], problems, log }, null, 2));
console.log(JSON.stringify({ renderer: rendererName, frames: log.length, problems }));
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
