// CU(本人 11/8): 作る画面を、画面なしの Chrome で確かめる(幅 390 のスマホと 1280 の PC)。
// - 作る画面を開いている間は、話す画面の上の段(はなす・かえる・もっと)と下の帯を隠し、見出し「キャラを つくる」と「おしゃべりに もどる」が見える
// - 声が始まるまでの空の吹き出しは「…」(動く点)。文字が入ると消える
// - 全体の「のこりを ぜんぶ おまかせ」(点線の札)は確かめる。「やめる」で同じ問いに戻る。問いごとの「おまかせ」は別の札
// - 押す所は 44px 以上・横にはみ出さない
// 試しの画面は、初めての会話の部品だけ(舞台の WebGL は使わない)。本物の画面(入口・字幕の「…」・GPU の Chrome)は、別の確かめで見る。
// YC_BROWSER_TESTS=1 のときだけ動く。FR_SHOTS_DIR を渡すと写真を残す。
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
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>CU の試し</title></head>
<body><canvas id="stage"></canvas>
<header class="top"><nav class="top-main" id="topMain"><button type="button" id="talkBtn" class="tm-btn">はなす</button><button type="button" id="changeBtn" class="tm-btn">かえる</button><button type="button" id="moreBtn" class="tm-btn">もっと</button></nav><div class="modes" id="modes"></div></header>
<footer class="bottom"><form id="composer" class="composer"><button type="button" id="micBtn" class="mic">はなす</button><input id="textInput" type="text" placeholder="文字で話しかける"><button type="submit" class="send">送る</button></form></footer>
<div id="gate" class="gate hidden"><div class="gate-card"><h1>入口</h1></div></div>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const params = new URLSearchParams(location.search);
const voiceDelay = Number(params.get('voice') || 0);
// 舞台の読み上げのまね: 声が始まる(onStart)まで voice ms かかる(スマホの遅い回線のまね)。始まるまで、吹き出しの文字は空のまま
// hang=1: 最初の 1 文が、止められて(stop)終わらないまま(本人の iPhone で起きた止まり。BP1)。止まりの見張りが札を出し直す
let hangFirst = params.get('hang') === '1';
const speaker = { speaking: false, setVoice() {}, prefetch() {}, enqueue: (text, o) => { if (hangFirst) { hangFirst = false; return new Promise(() => {}); } return new Promise((res) => setTimeout(() => { o?.onStart?.(text, {}); res(); }, voiceDelay)); } };
const app = { character: { id: 'norrie', name: 'ノリー' }, characterId: 'norrie', persona: '', speaker,
  stage: { state: {}, resize: () => {}, frameCharacter: () => {} }, swapCharacter: () => {} };
addEventListener('yc:firstrun-closed', (e) => { window.__closed = e.detail; });
window.__fr = mountFirstRun({ app, params, buttonHost: document.getElementById('modes'), random: seededRandom(5) });
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

async function open(browser, { width, height, query = 'onboard=1', touch = width < 720, reduced = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.route(`${BASE}/__fr/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
    if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const file = join(WEB, rel);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  await ctx.route(`${BASE}/api/**`, (route) => route.fulfill({ status: 503, body: '{}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/__fr/index.html?${query}`);
  await page.waitForSelector('.fr-sheet');
  return { ctx, page, errors };
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const waitAct = (page, id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });

/** 押す所は 44px 以上・横にはみ出さない(札の中) */
async function checkLayout(page, where) {
  const r = await page.evaluate(() => {
    const vw = innerWidth;
    const sheet = document.querySelector('.fr-sheet');
    const out = { scrollW: document.documentElement.scrollWidth, vw, wide: [], small: [] };
    for (const e of [sheet, ...sheet.querySelectorAll('*')]) {
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || !b.width || !b.height || e.closest('.fr-sr') || e.classList.contains('fr-file')) continue;
      if (e.closest('.fr-chips-scroll') && !e.matches('.fr-chips-scroll')) continue;
      if (b.right > vw + 0.5 || b.left < -0.5) out.wide.push(`${e.tagName}.${e.className}`);
      if (e.matches('button, label.fr-btn, input[type="text"]') && b.height < 43.5) out.small.push(`${e.className} ${e.textContent.trim().slice(0, 10)} ${b.height.toFixed(1)}`);
    }
    return out;
  });
  assert.ok(r.scrollW <= r.vw, `${where}: 横にはみ出す ${r.scrollW} > ${r.vw}`);
  assert.deepEqual(r.wide, [], `${where}: 画面の外に出た物`);
  assert.deepEqual(r.small, [], `${where}: 押す所が 44px より小さい`);
}

const SIZES = [
  { name: 'phone390', width: 390, height: 844 },
  { name: 'desk1280', width: 1280, height: 720 },
];

for (const sz of SIZES) {
  test(`作る画面 ${sz.width}×${sz.height}: 開いている間は話す画面の上の段と下の帯を隠し、見出しと「おしゃべりに もどる」が見える。閉じると戻る`, { skip: SLOW, timeout: 120_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い');
    try {
      const { ctx, page, errors } = await open(browser, sz);
      await waitAct(page, 'role_home');
      const hidden = (sel) => page.$eval(sel, (e) => getComputedStyle(e).visibility === 'hidden');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cc-open')), true);
      assert.equal(await hidden('.top'), true, '上の段(はなす・かえる・もっと)は隠れる');
      assert.equal(await hidden('.bottom'), true, '下の帯(はなす・文字で話す)は隠れる');
      const head = await page.$eval('.fr-title h2', (e) => ({ text: e.textContent, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, clip: getComputedStyle(e).clip }));
      assert.equal(head.text, 'キャラを つくる');
      assert.ok(head.w > 60 && head.h > 10, `見出しが見える ${JSON.stringify(head)}`);
      const close = await page.$eval('.fr-close', (e) => ({ text: e.textContent, h: e.getBoundingClientRect().height, right: e.getBoundingClientRect().right }));
      assert.equal(close.text, 'おしゃべりに もどる');
      assert.ok(close.h >= 44 && close.right <= sz.width, `「おしゃべりに もどる」は押せる大きさで、画面に収まる ${JSON.stringify(close)}`);
      assert.equal(await page.getAttribute('.fr-sheet', 'aria-label'), 'キャラを つくる');
      await checkLayout(page, `作る画面 ${sz.name}`);
      await shot(page, `cu_${sz.name}_screen`);
      await page.click('.fr-close');
      await page.waitForFunction(() => window.__closed?.reason === 'later');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cc-open')), false);
      assert.equal(await hidden('.top'), false, '閉じたら、上の段が戻る');
      assert.equal(await hidden('.bottom'), false, '閉じたら、下の帯が戻る');
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
}

test('声が始まるまでの空の吹き出しは「…」(動く点)。文字が入ると消える。動きを止める設定では、点は動かない', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844, query: 'onboard=1&voice=2500' });
    // 声が始まる前(2.5 秒の間): 案内役の最初の吹き出しは空で、中に「…」
    await page.waitForSelector('.fr-line.guide .fr-text .wd', { timeout: 5000 });
    const early = await page.$eval('.fr-line.guide .fr-text', (e) => ({ text: e.textContent, dots: e.querySelectorAll('.wd i').length, hiddenFromAt: e.querySelector('.wd').getAttribute('aria-hidden') }));
    assert.deepEqual(early, { text: '', dots: 3, hiddenFromAt: 'true' }, '空の吹き出しに、3 つの点(読み上げには出さない)');
    const anim = await page.$eval('.fr-text .wd i', (e) => getComputedStyle(e).animationName);
    assert.match(anim, /wd-blink/, '点は動く');
    await shot(page, 'cu_dots_phone390');
    await checkLayout(page, '…の吹き出し');
    // 声が始まると、文字が入って点は消える
    await page.waitForFunction(() => document.querySelector('.fr-line.guide .fr-text')?.textContent.includes('はじめまして'), null, { timeout: 8000 });
    assert.equal(await page.$eval('.fr-line.guide .fr-text', (e) => e.querySelectorAll('.wd').length), 0, '文字が入ったら、点は消える');
    assert.deepEqual(errors, []);
    await ctx.close();

    const calm = await open(browser, { width: 390, height: 844, query: 'onboard=1&voice=2500', reduced: true });
    await calm.page.waitForSelector('.fr-line.guide .fr-text .wd');
    assert.equal(await calm.page.$eval('.fr-text .wd i', (e) => getComputedStyle(e).animationName), 'none', '動きを止める設定では、点は動かさず文字だけ(点は静かに出したまま)');
    await calm.ctx.close();
  } finally {
    await browser.close();
  }
});

for (const sz of SIZES) {
  test(`おまかせ ${sz.width}×${sz.height}: 問いごとの「おまかせ」と全体の「のこりを ぜんぶ おまかせ」は別の札。全体は確かめて、「やめる」で同じ問いに戻る`, { skip: SLOW, timeout: 120_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い');
    try {
      const { ctx, page, errors } = await open(browser, sz);
      await waitAct(page, 'role_station');
      await page.click('.fr-actions [data-act="role_station"]');
      await waitAct(page, 'place_name');
      await page.fill('.fr-field input[type="text"]', 'みどり駅');
      await page.click('.fr-field button[type="submit"]');
      await waitAct(page, 'place_about');
      // 「どんな ことを あんないする?」の問い: 全体のおまかせ(点線)がある。「とばす」とは別の札
      await page.waitForSelector('.fr-actions .fr-auto');
      const auto = await page.$eval('.fr-actions .fr-auto', (e) => ({ text: e.textContent, border: getComputedStyle(e).borderTopStyle, h: e.getBoundingClientRect().height }));
      assert.equal(auto.text, 'のこりを ぜんぶ おまかせ');
      assert.equal(auto.border, 'dashed', '点線のふち(問いごとの札と見分ける)');
      assert.ok(auto.h >= 44);
      assert.equal(await page.$$eval('.fr-actions [data-act="place_skip"]', (b) => b.length), 1, '「とばす」は別にある');
      await shot(page, `cu_${sz.name}_auto_chip`);

      // 全体のおまかせ → 確かめる → やめる → 同じ問い(あんないする こと)に戻る
      await page.click('.fr-actions .fr-auto');
      await waitAct(page, 'omakase_yes');
      // 「ひとつ もどる」(小さな下線の札。.fr-back)は選びの外。ふつうの札の 2 択だけを数える
      assert.deepEqual(await page.$$eval('.fr-actions button:not(.fr-back)', (bs) => bs.map((b) => b.textContent)), ['はい、ぜんぶ おまかせ', 'やめる'], '確かめの 2 択だけ');
      assert.match(await page.$eval('.fr-log', (e) => e.innerText), /ここから さきを ぜんぶ おまかせに するよ。いい\?/);
      await checkLayout(page, `${sz.name} 確かめ`);
      await shot(page, `cu_${sz.name}_auto_confirm`);
      await page.click('.fr-actions [data-act="omakase_no"]');
      await waitAct(page, 'place_about');
      assert.equal(await page.locator('.fr-sheet').count(), 1, '閉じない');
      assert.equal(await page.$$eval('.fr-actions .fr-auto', (b) => b.length), 1, '戻った問いに、全体のおまかせの札がまた出る');
      await page.fill('.fr-field input[type="text"]', 'のりかえ');
      await page.click('.fr-field button[type="submit"]');

      // どんな子?: 問いごとの「おまかせ」 → 駅の子(ようこそくん)。ここで止まって「この子にする」を自分で押す
      await waitAct(page, 'what_auto');
      const what = await page.$eval('.fr-actions [data-act="what_auto"]', (e) => ({ text: e.textContent, border: getComputedStyle(e).borderTopStyle, h: e.getBoundingClientRect().height }));
      assert.equal(what.text, 'おまかせ');
      assert.notEqual(what.border, 'dashed', '問いごとの札は、ふつうの札');
      assert.ok(what.h >= 44);
      await checkLayout(page, `${sz.name} どんな子`);
      await shot(page, `cu_${sz.name}_what_auto`);
      await page.click('.fr-actions [data-act="what_auto"]');
      await waitAct(page, 'keep');
      const log = await page.$eval('.fr-log', (e) => e.innerText);
      assert.match(log, /「みどり駅で みちを あんないする 子」で つくるよ。/);
      assert.match(log, /見本: ようこそくん/, '駅の子(ロボくんなど、役目と関係のない子ではない)');
      assert.equal(await page.locator('.fr-sheet').count(), 1, '問いごとのおまかせは、ここで止まる(残りを自動にしない)');
      await shot(page, `cu_${sz.name}_what_done`);
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
}

test('作る途中で「おしゃべりに もどる」を押しても作りかけは残り、「あたらしい子を つくる」の「つづき」から続けられる(自動では開かない)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    await waitAct(page, 'role_station');
    await page.click('.fr-actions [data-act="role_station"]');
    await waitAct(page, 'place_name');
    await page.click('.fr-actions [data-act="place_skip"]');
    await waitAct(page, 'what_auto');
    await page.click('.fr-actions [data-act="what_auto"]');
    await waitAct(page, 'keep');
    await page.click('.fr-close');
    await page.waitForFunction(() => window.__closed?.reason === 'later');
    await page.waitForFunction(() => document.querySelector('[data-firstrun="start"]')?.dataset.resume === '1');
    await page.goto(`${BASE}/__fr/index.html`); // 読み込み直しても(?onboard=1 なし)、自分からは開かない
    await page.waitForSelector('[data-firstrun="start"]');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.fr-sheet').count(), 0);
    assert.equal(await page.getAttribute('[data-firstrun="start"]', 'data-resume'), '1', '作りかけの印が残る');
    await page.click('[data-firstrun="start"]');
    await waitAct(page, 'keep');
    assert.match(await page.$eval('.fr-log', (e) => e.innerText), /さっきの つづきからだよ/);
    // 続きの最初の選びに「はじめから」が 1 つ付く。押すと役目の問いから始まり、その次の選びには付かない(CU3)
    await waitAct(page, 'fresh');
    assert.equal(await page.$eval('.fr-actions [data-act="fresh"]', (e) => e.textContent), 'はじめから');
    await page.click('.fr-actions [data-act="fresh"]');
    await waitAct(page, 'role_station');
    assert.equal(await page.$$eval('.fr-actions [data-act="fresh"]', (b) => b.length), 0, '「はじめから」は最初の 1 回だけ');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test('作り終わった後に「おしゃべりに もどる」を押しても、「はなしてみる」と同じ(作った子を残し、終わりの印は done。CU3 must)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    await waitAct(page, 'role_station');
    await page.click('.fr-actions [data-act="role_station"]');
    await waitAct(page, 'place_name');
    await page.click('.fr-actions [data-act="place_skip"]');
    await waitAct(page, 'what_auto');
    await page.click('.fr-btn.fr-auto'); // 全体のおまかせ(確かめてから、最後まで)
    await page.click('.fr-actions [data-act="omakase_yes"]');
    await waitAct(page, 'begin');
    await page.click('.fr-close'); // 8 秒の自動で閉じる前に、上の「おしゃべりに もどる」を押す
    await page.waitForFunction(() => window.__closed?.reason);
    assert.equal(await page.evaluate(() => window.__closed.reason), 'done', '作った子を捨てる later にしない');
    assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarded.v1')), 'done', '済みの印は done(later で上書きしない)');
    assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarding.progress.v1')), null, '作りかけは消える');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test('作る画面: 話の文が止まって終わらなくても、8 秒ほどで札が戻る(下の札が空のままにならない。BP1)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844, query: 'onboard=1&hang=1' });
    const t0 = Date.now();
    assert.equal(await page.$('.fr-actions [data-act="role_home"]'), null, '止まっている間は、札が出ていない');
    await waitAct(page, 'role_home');
    const sec = (Date.now() - t0) / 1000;
    assert.ok(sec >= 6 && sec < 25, `見張りが働いて札が戻る(${sec.toFixed(1)} 秒)`);
    await page.click('.fr-actions [data-act="role_home"]');
    await waitAct(page, 'pick');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});
