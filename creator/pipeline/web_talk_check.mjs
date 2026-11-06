// 作ったキャラを、会話の画面(web/)で実際に話させて確かめる。動かない所を人に見つけてもらう前に、ここで止める。
//
// 使い方: node creator/pipeline/web_talk_check.mjs --port 8787 --character <id> --out <出力フォルダ> [--questions "質問|質問"] [--video] [--gpu]
// 確かめること: キャラが読める / 返事が返る / 口が動く / 表情か動きが出る。出力: web_check.json、web_talk.png(--video なら webm も)。
// 前提: web のサーバーが動いている(cd web && npm run build && npm run server)。
// 頭脳の鍵がないサーバーでは仮の返事になる。読み上げの鍵がなければ字幕と口パクだけになる。どちらだったかを json に書く。
// 終わりの番号: 0 = 全部できた、1 = できない所がある。
import { pathToFileURL } from 'node:url';
import { GPU_ARGS, assertGpu } from '../skilltest/gpu_only.mjs';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes('--' + k);
const PORT = arg('port', '8787');
const CHAR = arg('character');
const OUT = arg('out', '.');
const QUESTIONS = arg('questions', 'こんにちは、はじめて来ました|どこに座ればいいですか').split('|');
const LOAD_TIMEOUT_MS = 180000;
const TURN_TIMEOUT_MS = 60000;
const WATCH_TICK_MS = 200;
const VIEW = { width: 1280, height: 720 };
if (!CHAR) {
  console.error('--character <id> を渡してください');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = await import(pathToFileURL(path.join(HERE, '../../web/node_modules/playwright-core/index.mjs')).href);
const gpuArgs = GPU_ARGS; // CPU の描画には落とさない(--gpu は前の版との互換で、付けなくても GPU)
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: VIEW, ...(has('video') ? { recordVideo: { dir: OUT, size: VIEW } } : {}) });
const page = await context.newPage();
console.log('WebGL の描画役:', await assertGpu(page));
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));
const result = { character: CHAR, loaded: false, turns: [], mouth_max: 0, expressions: [], motions: [], problems };

async function finish(code) {
  await page.screenshot({ path: path.join(OUT, 'web_talk.png') }).catch(() => {});
  result.ok = code === 0;
  fs.writeFileSync(path.join(OUT, 'web_check.json'), JSON.stringify(result, null, 1));
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: result.ok, loaded: result.loaded, mouth_max: result.mouth_max, expressions: result.expressions, motions: result.motions, turns: result.turns.map((t) => t.reply.slice(0, 40)), problems }, null, 0));
  process.exit(code);
}

await page.goto(`http://127.0.0.1:${PORT}/?character=${CHAR}&auto=0`);
try {
  await page.waitForFunction(() => window.__app?.character, null, { timeout: LOAD_TIMEOUT_MS });
} catch {
  problems.push('キャラを読み込めない: ' + (await page.evaluate(() => document.getElementById('status')?.textContent ?? '')));
  await finish(1);
}
result.loaded = true;
await page.getByText('カメラなしで試す').click({ timeout: 20000 }).catch(() => problems.push('「カメラなしで試す」が押せない'));
result.status = await page.evaluate(() => fetch('/api/status').then((r) => r.json()).then((s) => ({ brain: s.brain ?? null, tts: s.tts ?? null })).catch(() => null));
// 口・表情・動きの呼び出しを記録する
await page.evaluate((tick) => {
  const c = window.__app.character;
  const rec = { mouth: 0, expr: new Set(), motion: new Set() };
  window.__rec = rec;
  for (const [fn, note] of [['setExpression', (n, w) => { if (w > 0 && n !== 'neutral') rec.expr.add(n); }], ['play', (n) => rec.motion.add(n)], ['setMouth', (v) => { rec.mouth = Math.max(rec.mouth, v ?? 0); }]]) {
    const orig = c[fn].bind(c);
    c[fn] = (...a) => { note(...a); return orig(...a); };
  }
  window.__tick = tick;
}, WATCH_TICK_MS);

for (const q of QUESTIONS) {
  const before = await page.evaluate(() => window.__app.dialogue.history.length);
  await page.evaluate((text) => window.__app.dialogue.send({ text, mode: 'voice', t0: performance.now() }), q);
  await page.waitForFunction((n) => window.__app.dialogue.history.length > n + 1, before, { timeout: TURN_TIMEOUT_MS }).catch(() => problems.push('返事が来ない: ' + q));
  await page.waitForFunction(() => !window.__app.speaker?.speaking, null, { timeout: TURN_TIMEOUT_MS }).catch(() => problems.push('話し終わらない: ' + q));
  const reply = await page.evaluate(() => window.__app.dialogue.history.at(-1)?.content ?? '');
  result.turns.push({ q, reply: typeof reply === 'string' ? reply : JSON.stringify(reply) });
}
const rec = await page.evaluate(() => ({ mouth: window.__rec.mouth, expr: [...window.__rec.expr], motion: [...window.__rec.motion] }));
result.mouth_max = rec.mouth;
result.expressions = rec.expr;
result.motions = rec.motion;
if (rec.mouth <= 0) problems.push('口が動いていない');
if (!rec.expr.length && !rec.motion.length) problems.push('表情も動きも出ていない');
await finish(problems.length ? 1 : 0);
