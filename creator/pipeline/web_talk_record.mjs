// 会話の画面でキャラを話させ、画面と声をそのまま動画に録る(動画の素材用)。話す言葉は台本ではなく、その場の頭脳の返事。
//
// 使い方: node creator/pipeline/web_talk_record.mjs --port 8787 --character <id> --out <出力.webm> [--questions "質問|質問"] [--tail 2000]
// タブの録画(getDisplayMedia)を使う。録るのに GPU を使うので、重い仕事と重ねない。出力は webm。
// 字幕・考えの窓を含む画面と、声が同じ時間で入る。端末のスピーカーの遅れは入らない。
import { pathToFileURL } from 'node:url';
import { GPU_ARGS, assertGpu } from '../skilltest/gpu_only.mjs';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = arg('port', '8787');
const CHAR = arg('character');
const OUT = arg('out');
const QUESTIONS = arg('questions', 'はじめて来ました。どう楽しめばいいですか|次のショーは何時からですか').split('|');
const TAIL_MS = Number(arg('tail', 2000));
const LEAD_MS = 2500;
const TURN_TIMEOUT_MS = 90000;
const CHUNK_MS = 1000;
const BITRATE = 12_000_000;
const VIEW = { width: 1920, height: 1080 };
if (!CHAR || !OUT) {
  console.error('--character <id> と --out <出力.webm> を渡してください');
  process.exit(2);
}
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, Buffer.alloc(0));

const { chromium } = await import(pathToFileURL(path.join(HERE, '../../web/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: !process.argv.includes('--show'),
  args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture', `--window-size=${VIEW.width},${VIEW.height + 120}`, '--window-position=40,40'],
});
const page = await browser.newPage({ viewport: VIEW });
console.log('WebGL の描画役:', await assertGpu(page));
const problems = [];
page.on('pageerror', (e) => problems.push(e.message.slice(0, 200)));
await page.exposeFunction('__saveChunk', (b64) => fs.appendFileSync(OUT, Buffer.from(b64, 'base64')));
await page.goto(`http://127.0.0.1:${PORT}/?character=${CHAR}&auto=0`);
await page.waitForFunction(() => window.__app?.character, null, { timeout: 120000 });
await page.locator('#startSim').click();
await page.waitForTimeout(1000);
await page.evaluate(async ({ chunk, bitrate }) => {
  // 画面なしのブラウザでは、タブの音は無音で入る。声は読み上げの出口から直接取る
  const speaker = window.__app.speaker;
  speaker.unlock();
  const voice = speaker.ctx.createMediaStreamDestination();
  speaker.analyser.connect(voice);
  const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, preferCurrentTab: true });
  const stream = new MediaStream([...display.getVideoTracks(), ...voice.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: bitrate });
  let pending = Promise.resolve();
  rec.ondataavailable = (e) => {
    pending = pending.then(async () => {
      const buf = new Uint8Array(await e.data.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await window.__saveChunk(btoa(s));
    });
  };
  window.__stopRec = () => new Promise((resolve) => {
    rec.onstop = () => pending.then(resolve);
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
  });
  rec.start(chunk);
}, { chunk: CHUNK_MS, bitrate: BITRATE });
await page.waitForTimeout(LEAD_MS);
const replies = [];
for (const q of QUESTIONS) {
  const before = await page.evaluate(() => window.__app.dialogue.history.length);
  await page.locator('#textInput').fill(q);
  await page.locator('#textInput').press('Enter');
  await page.waitForFunction((n) => window.__app.dialogue.history.length > n + 1, before, { timeout: TURN_TIMEOUT_MS }).catch(() => problems.push('返事が来ない: ' + q));
  await page.waitForFunction(() => !window.__app.speaker?.speaking, null, { timeout: TURN_TIMEOUT_MS }).catch(() => problems.push('話し終わらない: ' + q));
  replies.push(await page.evaluate(() => window.__app.dialogue.history.at(-1)?.content ?? ''));
  await page.waitForTimeout(TAIL_MS);
}
await page.evaluate(() => window.__stopRec());
await browser.close();
console.log(JSON.stringify({ out: OUT, bytes: fs.statSync(OUT).size, problems, replies: replies.map((r) => String(r).slice(0, 120)) }));
process.exit(problems.length ? 1 : 0);
