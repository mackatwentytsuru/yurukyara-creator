// 長く動かしたときの安定を見る。会話を何十往復もさせ、メモリ・画面の部品・GPU の資源が増え続けないか測る。
//   node scripts/soak-memory.mjs [サーバーのURL] [--turns 60]
// 課金が出ないよう、読み上げの鍵と Claude の鍵を持たないサーバー(仮の頭脳・字幕のみ)に向けて使う:
//   env -u ANTHROPIC_API_KEY -u CLAUDE_CREDIT_API_KEY -u ELEVENLABS_API_KEY PORT=8815 node server/index.mjs
// 区切りごとに、強制のごみ集め(gc)のあとの JS ヒープ、DOM の数、three のジオメトリ・テクスチャの数、会話の履歴の長さを出す。
import { chromium } from 'playwright-core';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js'; // WebGL を CPU で描かない決まり

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:8815';
const TURNS = Number(opt('--turns', 60));
const CHECK_AT = [1, Math.round(TURNS / 3), Math.round((TURNS * 2) / 3), TURNS];
const QUESTIONS = ['こんにちは', 'お手洗いはどこですか', '休憩スペースはどこ', '入口はどっち', 'ありがとう', '今日は何ができますか'];

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  const real = window.fetch.bind(window);
  window.fetch = (url, init) => (String(url).includes('/api/metrics') && init?.method === 'POST' ? Promise.resolve(new Response('{"ok":true}')) : real(url, init));
});
await page.goto(`${base}/?character=f_led&place=test_room&auto=0`);
await stopIfSoftwareRenderer(page, browser); // CPU の描画なら止める
await page.waitForFunction(() => window.__app?.character && window.__app.speaker, null, { timeout: 60000 });
await page.click('#startSim');

const snapshot = () =>
  page.evaluate(async () => {
    window.gc();
    await new Promise((r) => setTimeout(r, 200));
    window.gc();
    const a = window.__app;
    const info = a.stage.renderer.info;
    return {
      heapMB: Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10,
      dom: document.getElementsByTagName('*').length,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? null,
      history: a.dialogue.history.length,
      timers: a.dialogue.timers?.length ?? null,
    };
  });

const rows = [];
for (let i = 1; i <= TURNS; i++) {
  const q = QUESTIONS[i % QUESTIONS.length];
  await page.evaluate((t) => window.__app.dialogue.send({ text: t, mode: 'text', t0: performance.now() }), q);
  // 3 回に 1 回は、返事の途中で割り込む(cancel の後始末が漏れないか)
  if (i % 3 === 0) {
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__app.dialogue.cancel());
  }
  await page.waitForTimeout(900);
  if (CHECK_AT.includes(i)) rows.push({ turn: i, ...(await snapshot()) });
}
await browser.close();
const f = (r) => `${String(r.turn).padStart(3)} 往復  ヒープ ${String(r.heapMB).padStart(5)}MB  DOM ${String(r.dom).padStart(4)}  ジオメトリ ${r.geometries}  テクスチャ ${r.textures}  シェーダー ${r.programs}  履歴 ${r.history}  タイマー ${r.timers}`;
rows.forEach((r) => console.log(f(r)));
const first = rows[0];
const last = rows.at(-1);
console.log(`\n増え方(最初 → 最後): ヒープ ${(last.heapMB - first.heapMB).toFixed(1)}MB・DOM ${last.dom - first.dom}・ジオメトリ ${last.geometries - first.geometries}・テクスチャ ${last.textures - first.textures}`);
if (errors.length) console.log('画面のエラー:', errors.slice(0, 3));
