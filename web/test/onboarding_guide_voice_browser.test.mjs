// 初めての会話: 案内役の文も、案内役が舞台に出ていれば舞台の声で話す(QF3b 8)。画面なしの Chrome で動かす。
// - 案内役(主役)が舞台に居る: 1 歩目の最初の 2 文が、舞台の読み上げ(enqueue)に渡る。2 文目の声は、1 文目を話している間に前もって取る(prefetch)
// - 舞台に別の子が居る: 案内役の文は声に渡さない(文字送りと「ピッ」のまま)
// 重いので YC_BROWSER_TESTS=1 のときだけ動く。舞台と読み上げは偽物(WebGL も声のサービスも使わない)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { guideFirstLines } from '../src/ui/onboarding/script.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const BASE = 'http://guide-voice.test';
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>案内役の声の試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const params = new URLSearchParams(location.search);
const log = [];
const t0 = performance.now();
const stageId = params.get('stage');
const speaker = {
  fakeUntil: 0,
  setVoice() {},
  prefetch(text) { log.push({ n: 'prefetch', text, t: Math.round(performance.now() - t0) }); },
  async enqueue(text, { onStart } = {}) {
    log.push({ n: 'enqueue', text, t: Math.round(performance.now() - t0) });
    onStart?.(performance.now(), { crawl: false });
    await new Promise((r) => setTimeout(r, 250));
    log.push({ n: 'done', text, t: Math.round(performance.now() - t0) });
  },
};
const app = {
  character: { id: stageId, name: params.get('name') || stageId },
  characterId: stageId,
  persona: '',
  speaker,
  stage: { state: {}, resize() {}, frameCharacter() {} },
  swapCharacter() {},
};
window.__log = log;
window.__fr = mountFirstRun({ app, params, buttonHost: document.getElementById('modes'), byok: null, random: seededRandom(5) });
</script></body></html>`;

async function open(browser, stage, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await ctx.route(`${BASE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const rel = path.replace('/__fr/', '');
    const file = join(WEB, rel);
    if (!path.startsWith('/__fr/') || !file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/index.html?onboard=1&stage=${stage}&name=${encodeURIComponent(name)}`);
  return { ctx, page, errors };
}

test('案内役の最初の 2 文は、案内役が舞台に居れば舞台の声へ渡り、2 文目は前もって取る', { skip: SLOW }, async (t) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    t.skip('playwright-core が無い');
    return;
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  let browser;
  try {
    browser = await chromium.launch({ ...opts, headless: true });
  } catch {
    t.skip('Chrome が無い');
    return;
  }
  try {
    const want = guideFirstLines(MAIN.name, true);
    {
      const { ctx, page, errors } = await open(browser, MAIN.id, MAIN.name);
      await page.waitForFunction(() => document.querySelectorAll('.fr-line.guide').length >= 2 && document.querySelector('.fr-actions button, .fr-actions label'), null, { timeout: 20_000 });
      const log = await page.evaluate(() => window.__log);
      const enq = log.filter((e) => e.n === 'enqueue').map((e) => e.text);
      assert.deepEqual(enq.slice(0, 2), want, `案内役の最初の 2 文を声へ渡す: ${JSON.stringify(enq)}`);
      const pre = log.filter((e) => e.n === 'prefetch').map((e) => e.text);
      assert.ok(pre.includes(want[1]), `2 文目を前もって取る: ${JSON.stringify(pre)}`);
      const firstDone = log.find((e) => e.n === 'done' && e.text === want[0]);
      const preSecond = log.find((e) => e.n === 'prefetch' && e.text === want[1]);
      assert.ok(preSecond.t < firstDone.t, `2 文目の前もっては、1 文目を話し終える前(${preSecond.t} < ${firstDone.t})`);
      assert.equal(await page.$$eval('.fr-line.guide .fr-text', (els) => els.slice(0, 2).map((e) => e.textContent).join('|')), want.join('|'));
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, 'mikan', 'みかんちゃん'); // 舞台に居るのは別の子。案内役の文は文字送りと「ピッ」のまま
      await page.waitForFunction(() => document.querySelectorAll('.fr-line.guide').length >= 2 && document.querySelector('.fr-actions button, .fr-actions label'), null, { timeout: 20_000 });
      const log = await page.evaluate(() => window.__log);
      assert.equal(log.filter((e) => e.n === 'enqueue').length, 0, '舞台に居ない案内役の文は、声に渡さない');
      assert.equal(log.filter((e) => e.n === 'prefetch').length, 0, '舞台に居ない案内役の文は、前もって取らない');
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});
