// 「いま はたらいているよ」(ui/work.js・ui/workFx.js)を、画面なしの Chrome で確かめる(幅 390 のスマホと 1280 の PC)。
// - 描く・3D を待つ間はすぐ、きらきら(スマホ 9 個・PC 16 個)と小さな印(回る輪+星・文・動く点・流れる線)が出る。終わると消える(動きの計算も止まる)
// - 場所が動かない: ほかの物(「AI キャラクターと話しています」・下の帯)の場所と、ページの大きさは、出す前・出している間・文を替えた後で同じ
// - 「AI の キャラクターと話しています」の知らせは、きらきらより手前(きらきらの層が、下の帯より前に置かれ、前に重ならない)
// - 動きを止める設定(prefers-reduced-motion)では、粒も輪も星も止まる
// - 小さな印は画面の中に収まる(幅 390 でも)
// 試しの画面は、舞台の canvas(WebGL は使わない)と下の帯だけ。YC_BROWSER_TESTS=1 のときだけ動く。FR_SHOTS_DIR を渡すと写真を残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SHOTS = process.env.FR_SHOTS_DIR || '';
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const BASE = 'http://127.0.0.1:9'; // 中身は route で配る。外へは出ない

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>はたらく動きの試し</title></head>
<body><canvas id="stage"></canvas>
<header class="top"><nav class="top-main" id="topMain"><button type="button" class="tm-btn">はなす</button><button type="button" class="tm-btn">かえる</button><button type="button" class="tm-btn">もっと</button></nav></header>
<footer class="bottom"><p class="ai-notice" id="aiNotice" role="note">AI キャラクターと話しています</p><form class="composer"><input type="text" placeholder="文字で話しかける"><button type="submit" class="send">送る</button></form></footer>
<script type="module">
import { beginWork, work } from '/__fr/src/ui/work.js';
import { mountWorkFx } from '/__fr/src/ui/workFx.js';
mountWorkFx({ stage: document.getElementById('stage') });
window.__w = { beginWork, work };
document.documentElement.dataset.ready = '1';
</script></body></html>`;

// 作る札を開いた画面(札の中の 1 行の確かめ用。onboarding_cu_browser.test.mjs と同じ作り)
const SHEET_PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>作る札の試し</title></head>
<body><canvas id="stage"></canvas>
<header class="top"><nav class="top-main"><button type="button" class="tm-btn">はなす</button></nav><div class="modes" id="modes"></div></header>
<footer class="bottom"><p class="ai-notice" id="aiNotice" role="note">AI キャラクターと話しています</p></footer>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
import { beginWork } from '/__fr/src/ui/work.js';
import { mountWorkFx } from '/__fr/src/ui/workFx.js';
mountWorkFx({ stage: document.getElementById('stage') });
const speaker = { speaking: false, setVoice() {}, prefetch() {}, enqueue: (text, o) => { o?.onStart?.(text, {}); return Promise.resolve(); } };
const app = { character: { id: 'norrie', name: 'ノリー' }, characterId: 'norrie', persona: '', speaker, stage: { state: {}, resize: () => {}, frameCharacter: () => {} }, swapCharacter: () => {} };
window.__w = { beginWork };
window.__fr = mountFirstRun({ app, params: new URLSearchParams('onboard=1'), buttonHost: document.getElementById('modes'), random: seededRandom(5) });
document.documentElement.dataset.ready = '1';
</script></body></html>`;

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function findChrome() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return null;
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  try {
    return await chromium.launch({ ...opts, headless: true });
  } catch {
    return null;
  }
}

async function open(browser, { width, height, touch, reduced = false, sheet = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.route(`${BASE}/__fr/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
    if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: sheet ? SHEET_PAGE : PAGE });
    const file = join(WEB, rel);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/__fr/index.html`);
  await page.waitForSelector('html[data-ready="1"]');
  return { ctx, page, errors };
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

/** ほかの物の場所とページの大きさ(出し入れで動かない確かめ用) */
const geometry = (page) =>
  page.evaluate(() => {
    const r = (s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return [b.left, b.top, b.width, b.height].map((x) => Math.round(x * 10) / 10);
    };
    return { notice: r('#aiNotice'), bottom: r('.bottom'), top: r('.top'), doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
  });

const SIZES = [
  { name: 'phone390', width: 390, height: 844, touch: true, sparkles: 9 },
  { name: 'desk1280', width: 1280, height: 720, touch: false, sparkles: 16 },
];

for (const sz of SIZES) {
  test(`はたらく動き ${sz.width}×${sz.height}: 描く間は粒と小さな印が出て、場所は動かず、知らせは前に出て、終わると消える`, { skip: SLOW, timeout: 120_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い');
    try {
      const { ctx, page, errors } = await open(browser, sz);
      const before = await geometry(page);
      assert.equal(await page.$eval('#workFx', (e) => getComputedStyle(e).display), 'none', '出す前は見えない');
      assert.equal(await page.$eval('#workPill', (e) => getComputedStyle(e).display), 'none');
      assert.equal(await page.evaluate(() => document.getElementById('workFx').getAnimations({ subtree: true }).length), 0, '出ていない間は動きの計算をしない');

      await page.evaluate(() => {
        window.__end = window.__w.beginWork('draw');
      });
      await page.waitForSelector('#workPill', { state: 'visible' });
      const info = await page.evaluate(() => {
        const fx = document.getElementById('workFx');
        const pill = document.getElementById('workPill').getBoundingClientRect();
        const layer = fx.getBoundingClientRect();
        return {
          sparkles: fx.querySelectorAll('.wk-sp').length,
          text: document.querySelector('#workPill .wk-text').textContent,
          note: document.querySelector('#workPill .wk-note').textContent,
          dots: document.querySelectorAll('#workPill .wd i').length,
          pillBox: [pill.left, pill.top, pill.right, pill.bottom],
          layerBox: [layer.left, layer.top, layer.right, layer.bottom],
          events: getComputedStyle(fx).pointerEvents,
          animating: fx.getAnimations({ subtree: true }).length,
          ring: getComputedStyle(document.querySelector('#workPill .wk-ring')).animationName,
          star: getComputedStyle(document.querySelector('#workPill .wk-mark .wk-star')).animationName,
          // きらきらの層は、下の帯(「AI キャラクターと話しています」の入れ物)より前に置かれ、同じ重なりの段の中で下の帯が上に描かれる
          layerBeforeBottom: Boolean(fx.compareDocumentPosition(document.querySelector('.bottom')) & Node.DOCUMENT_POSITION_FOLLOWING),
          layerZ: getComputedStyle(fx).zIndex,
          noticeShown: (() => {
            const n = document.getElementById('aiNotice');
            const s = getComputedStyle(n);
            const b = n.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.4 && b.width > 20 && b.height > 8;
          })(),
        };
      });
      assert.equal(info.sparkles, sz.sparkles, `粒の数(スマホ 9・PC 16): ${info.sparkles}`);
      assert.equal(info.text, 'えを かいているよ');
      assert.equal(info.note, '1 分くらい かかるよ', '長くかかると、すぐ言う');
      assert.equal(info.dots, 3, '動く点');
      assert.equal(info.events, 'none', 'きらきらは押す所の邪魔をしない');
      assert.ok(info.animating >= sz.sparkles, `粒が動いている ${info.animating}`);
      assert.equal(info.ring, 'wk-spin', 'くるくる回る輪');
      assert.equal(info.star, 'wk-bounce', 'はずむ星');
      assert.equal(info.layerBeforeBottom, true, 'きらきらの層は下の帯より前(後ろに描かれる)');
      assert.equal(info.layerZ, 'auto', '重なりの段を上げない(知らせより手前に来ない)');
      assert.equal(info.noticeShown, true, '「AI キャラクターと話しています」は見えたまま');
      const [pl, , pr] = info.pillBox;
      assert.ok(pl >= 0 && pr <= sz.width, `小さな印が画面に収まる ${info.pillBox}`);
      assert.ok(info.layerBox[2] <= sz.width + 0.5 && info.layerBox[3] <= sz.height + 0.5, `きらきらの層が画面に収まる ${info.layerBox}`);
      await shot(page, `work_${sz.name}_draw`);

      // 場所が動かない: 出している間も、文を替えても、ほかの物とページの大きさは同じ
      assert.deepEqual(await geometry(page), before, '出している間も、ほかの物の場所は同じ');
      const pillWidth = (await page.$eval('#workPill', (e) => e.getBoundingClientRect().width)).toFixed(1);
      await page.evaluate(() => window.__end.update('いま: 形を つくっているよ'));
      assert.equal(await page.$eval('#workPill .wk-text', (e) => e.textContent), 'いま: 形を つくっているよ');
      assert.deepEqual(await geometry(page), before, '文を替えても、ほかの物の場所は同じ');
      assert.equal((await page.$eval('#workPill', (e) => e.getBoundingClientRect().width)).toFixed(1), pillWidth, '文を替えても、印の幅は動かない');

      // 終わりの印で消え、動きの計算も止まる
      await page.evaluate(() => window.__end());
      assert.equal(await page.$eval('#workFx', (e) => getComputedStyle(e).display), 'none');
      assert.equal(await page.$eval('#workPill', (e) => getComputedStyle(e).display), 'none');
      assert.equal(await page.evaluate(() => document.getElementById('workFx').getAnimations({ subtree: true }).length), 0);
      assert.deepEqual(await geometry(page), before, '消えた後も、ほかの物の場所は同じ');

      // 1.5 秒より短い待ちは、出さない(ちらつかない)
      await page.evaluate(() => {
        window.__short = window.__w.beginWork('wait');
      });
      await page.waitForTimeout(300);
      assert.equal(await page.$eval('#workFx', (e) => getComputedStyle(e).display), 'none', '短い待ちは出さない');
      await page.evaluate(() => window.__short());
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
}

test('はたらく動き: 動きを止める設定(prefers-reduced-motion)では、粒も輪も星も止まり、文と薄い光だけが出る', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844, touch: true, reduced: true });
    await page.evaluate(() => {
      window.__end = window.__w.beginWork('draw');
    });
    await page.waitForSelector('#workPill', { state: 'visible' });
    const r = await page.evaluate(() => {
      const name = (s) => getComputedStyle(document.querySelector(s)).animationName;
      return {
        sparkle: name('#workFx .wk-sp'),
        ring: name('#workPill .wk-ring'),
        star: name('#workPill .wk-mark .wk-star'),
        bar: name('#workPill .wk-bar i'),
        running: document.getElementById('workFx').getAnimations({ subtree: true }).length + document.getElementById('workPill').getAnimations({ subtree: true }).filter((a) => /wk-(spin|bounce|slide|twinkle)/.test(a.animationName ?? '')).length,
        text: document.querySelector('#workPill .wk-text').textContent,
      };
    });
    assert.equal(r.sparkle, 'none');
    assert.equal(r.ring, 'none');
    assert.equal(r.star, 'none');
    assert.equal(r.bar, 'none');
    assert.equal(r.running, 0, '動いているものは無い');
    assert.equal(r.text, 'えを かいているよ', '文はそのまま出る(固まって見えない・文で分かる)');
    await shot(page, 'work_phone390_reduced');
    await page.evaluate(() => window.__end());
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

for (const sz of SIZES) {
  test(`はたらく動き(作る札) ${sz.width}×${sz.height}: 描く間は会話のいちばん下に 1 行(回る輪・文・動く点)が出て、文を替えても高さは同じ。終わると消え、札からはみ出さない`, { skip: SLOW, timeout: 120_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い');
    try {
      const { ctx, page, errors } = await open(browser, { ...sz, sheet: true });
      await page.waitForSelector('.fr-sheet');
      assert.equal(await page.$$eval('.fr-working', (e) => e.length), 0, '何もしていない間は出ない');
      await page.evaluate(() => {
        window.__end = window.__w.beginWork('draw');
      });
      await page.waitForSelector('.fr-working');
      const row = () =>
        page.evaluate(() => {
          const r = document.querySelector('.fr-working');
          const log = document.querySelector('.fr-log');
          const b = r.getBoundingClientRect();
          const l = log.getBoundingClientRect();
          return { h: Math.round(b.height * 10) / 10, last: log.lastElementChild === r, text: r.querySelector('.wk-text').textContent, ring: getComputedStyle(r.querySelector('.wk-ring')).animationName, inside: b.left >= l.left - 0.5 && b.right <= l.right + 0.5, scrollW: document.documentElement.scrollWidth, vw: innerWidth };
        });
      const a = await row();
      assert.equal(a.last, true, '会話のいちばん下');
      assert.equal(a.text, 'えを かいているよ');
      assert.equal(a.ring, 'wk-spin');
      assert.equal(a.inside, true, '札の中に収まる');
      assert.ok(a.scrollW <= a.vw, '横にはみ出さない');
      assert.equal(await page.$eval('#workPill', (e) => getComputedStyle(e).display), 'none', '札が開いている間は、舞台の印は出さない(札の中の 1 行だけ)');
      await page.evaluate(() => window.__end.update('いま: 形を つくっているよ'));
      const b = await row();
      assert.equal(b.text, 'いま: 形を つくっているよ');
      assert.equal(b.h, a.h, '文を替えても高さは同じ');
      await shot(page, `work_${sz.name}_sheet`);
      await page.evaluate(() => window.__end());
      await page.waitForFunction(() => !document.querySelector('.fr-working'));
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
}
