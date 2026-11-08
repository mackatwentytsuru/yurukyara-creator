// 第 12c 波 QF4: 初めての会話の札の、低い画面・キーボード・終わり方・読み込み直しの続きを、画面なしの Chrome で測る試験。
// 試しの画面は初めての会話の部品だけ(舞台の WebGL は使わない)。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。
// FR_SHOTS_DIR を渡すと、そのフォルダに写真を残す(目で見る点検用)。YC_BROWSER_TESTS=1 のときだけ動く。
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
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>QF4 の試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<div id="gate" class="gate"><div class="gate-card"><h1>入口</h1><button id="startSim" type="button">カメラなしで試す</button></div></div>
<script>
// 見える範囲(visualViewport)のまね: キーボードが出ると高さだけが縮む(iPhone の Safari・Chrome と同じ)
const vv = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
window.__kb = (px) => { vv.height = innerHeight - px; vv.dispatchEvent(new Event('resize')); };
</script>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const params = new URLSearchParams(location.search);
const app = { character: { id: 'norrie', name: 'ノリー' }, characterId: 'norrie', persona: '',
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

async function open(browser, { width, height, query = 'onboard=1', touch = true }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
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
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
/** 文字送りを飛ばして、選ぶ所が出るまで待つ */
async function ready(page, { role = true } = {}) {
  await page.waitForSelector('.fr-actions > *', { timeout: 20000 });
  // 1 つ目のステップは「この子は、どこで だれと?」(B4 12b)。役目を選んで、ことばの欄のある見え方にする
  if (role && (await page.$('.fr-actions [data-act="role_home"]'))) {
    await page.click('.fr-actions [data-act="role_home"]');
    await page.waitForSelector('.fr-actions [data-act="words"]', { timeout: 20000 });
  }
  await page.click('.fr-log').catch(() => {});
  await settle(page, 400);
}

const SIZES = [
  { name: 'p390x670', width: 390, height: 670 },
  { name: 'p390x844', width: 390, height: 844 },
  { name: 'l844x390', width: 844, height: 390 },
];

for (const sz of SIZES) {
  test(`低い画面 ${sz.width}×${sz.height}: 札が画面に収まり、選ぶ所に指で届く(収まらない時は巻ける印がある)`, { skip: SLOW, timeout: 120_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い');
    try {
      const { ctx, page, errors } = await open(browser, sz);
      await ready(page);
      await shot(page, `qf4_${sz.name}_step1`);
      const r = await page.evaluate(() => {
        const sheet = document.querySelector('.fr-sheet');
        const log = document.querySelector('.fr-log');
        const actions = document.querySelector('.fr-actions');
        const s = sheet.getBoundingClientRect();
        const sheetScroll = sheet.scrollHeight > sheet.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(sheet).overflowY);
        const actScroll = actions.scrollHeight > actions.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(actions).overflowY);
        const shadow = (e) => getComputedStyle(e).backgroundImage.includes('radial-gradient');
        const btns = [...actions.querySelectorAll('button, label, a')].filter((b) => b.getBoundingClientRect().height > 0);
        return {
          vh: innerHeight, top: s.top, bottom: s.bottom, height: s.height, width: s.width, logH: log.getBoundingClientRect().height,
          sheetScroll, actScroll, shadowSheet: shadow(sheet), shadowActions: shadow(actions), n: btns.length,
          overflowY: getComputedStyle(sheet).overflowY, sheetClient: sheet.clientHeight, sheetScrollH: sheet.scrollHeight,
        };
      });
      assert.ok(r.bottom <= r.vh + 1 && r.top >= -1, `札が画面に収まる: ${JSON.stringify(r)}`);
      if (sz.height <= 500) {
        assert.equal(r.overflowY, 'auto', '札ごと巻ける(overflow-y: auto)');
        assert.ok(r.width === undefined || r.width < sz.width, '横向きは右の横の札(キャラは左。OL1)');
        assert.ok(r.logH >= 120, `会話の欄は 140px 近くを残す: ${r.logH}`);
        // 巻けば、いちばん下のボタンまで届く
        await page.evaluate(() => { const s = document.querySelector('.fr-sheet'); s.scrollTop = s.scrollHeight; });
        await settle(page, 200);
        await shot(page, `qf4_${sz.name}_step1_scrolled`);
        const last = await page.evaluate(() => {
          const bs = [...document.querySelectorAll('.fr-actions button, .fr-actions label, .fr-actions a')].filter((b) => b.getBoundingClientRect().height > 0);
          const b = bs.at(-1).getBoundingClientRect();
          const head = document.querySelector('.fr-head').getBoundingClientRect();
          const sheet = document.querySelector('.fr-sheet').getBoundingClientRect();
          return { bottom: b.bottom, vh: innerHeight, headTop: head.top, sheetTop: sheet.top };
        });
        assert.ok(last.bottom <= last.vh + 1, `巻いた後、いちばん下のボタンが画面の中: ${JSON.stringify(last)}`);
        assert.ok(Math.abs(last.headTop - last.sheetTop) <= 2, `巻いても上の細い段(あと いくつ・あとで)は上に止まる: ${JSON.stringify(last)}`);
      } else if (sz.height <= 700) {
        assert.ok(!r.actScroll || r.shadowActions, `選ぶ所が札の中で巻ける時は影が出る: ${JSON.stringify(r)}`);
        const moreShown = await page.evaluate(() => !document.querySelector('.fr-more').hidden && getComputedStyle(document.querySelector('.fr-more')).display !== 'none');
        assert.equal(moreShown, r.actScroll, `巻ける時だけ「まだ あるよ」の印が出る: 巻ける=${r.actScroll}`);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally {
      await browser.close();
    }
  });
}

test('キーボード(見える範囲だけが縮む): 札は見える範囲に重なり、上の細い段・入力欄・「送る」が見える。下がると最初と同じ', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    await ready(page);
    const first = await page.evaluate(() => JSON.stringify(['.fr-sheet', '.fr-head', '.fr-log', '.fr-actions'].map((q) => { const b = document.querySelector(q).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; })));
    await page.fill('.fr-field input[type="text"]', '赤い提灯の子');
    await page.focus('.fr-field input[type="text"]');
    await page.evaluate(() => window.__kb(336)); // キーボードの高さ(約 336px)
    await settle(page, 700);
    await shot(page, 'qf4_kb_step1');
    const r = await page.evaluate(() => {
      const sheet = document.querySelector('.fr-sheet');
      const s = sheet.getBoundingClientRect();
      const inp = document.querySelector('.fr-field input[type="text"]').getBoundingClientRect();
      const btn = document.querySelector('.fr-field button[type="submit"]').getBoundingClientRect();
      const head = document.querySelector('.fr-head').getBoundingClientRect();
      return { vvh: visualViewport.height, kb: sheet.classList.contains('fr-kb'), bottom: s.bottom, top: s.top, inpTop: inp.top, inpBottom: inp.bottom, btnTop: btn.top, btnBottom: btn.bottom, headTop: head.top, heightStyle: sheet.style.height };
    });
    assert.equal(r.kb, true, 'キーボード中の印');
    assert.equal(r.heightStyle, `${r.vvh}px`, '札を見える範囲の高さにする');
    assert.ok(r.headTop >= 0 && r.headTop <= 2, `上の細い段が見える: ${JSON.stringify(r)}`);
    assert.ok(r.bottom <= r.vvh + 1 && r.top >= 0, `札が見える範囲に収まる: ${JSON.stringify(r)}`);
    assert.ok(r.inpTop >= 0 && r.inpBottom <= r.vvh + 1, `入力欄が見える: ${JSON.stringify(r)}`);
    assert.ok(r.btnTop >= 0 && r.btnBottom <= r.vvh + 1, `「送る」が見える: ${JSON.stringify(r)}`);
    await page.evaluate(() => { document.activeElement?.blur(); window.__kb(0); });
    await settle(page, 1200);
    const back = await page.evaluate(() => ({ kb: document.querySelector('.fr-sheet').classList.contains('fr-kb'), bottom: document.querySelector('.fr-sheet').style.bottom, height: document.querySelector('.fr-sheet').style.height }));
    assert.deepEqual(back, { kb: false, bottom: '', height: '' }, 'キーボードが下がれば、元に戻る');
    const again = await page.evaluate(() => JSON.stringify(['.fr-sheet', '.fr-head', '.fr-log', '.fr-actions'].map((q) => { const b = document.querySelector(q).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; })));
    assert.equal(again, first, 'キーボードが下がった後は、最初と同じ見え方(札・上の細い段・会話・押す札の場所)');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

// CU(本人 11/8): 全体のおまかせは、押すとまず確かめる(「はい」で進む)。終わりは「はなしてみる」を押すと、作る画面を閉じて話す画面へ
test('おまかせで最後まで: 全体のおまかせは確かめてから進み、決めたことと「はなしてみる」を出す。押すと閉じる(中 5・CU)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    await ready(page);
    assert.equal(await page.locator('.fr-btn.fr-auto').innerText(), 'のこりを ぜんぶ おまかせ', '全体のおまかせは、問いごとの おまかせと名前を分ける');
    await page.click('.fr-btn.fr-auto');
    await page.waitForSelector('.fr-actions [data-act="omakase_yes"]', { timeout: 20000 });
    assert.match(await page.locator('.fr-log').innerText(), /ここから さきを ぜんぶ おまかせに するよ。いい\?/, 'まず確かめる');
    assert.equal(await page.locator('.fr-sheet').count(), 1);
    await page.click('.fr-actions [data-act="omakase_yes"]');
    await page.waitForSelector('.fr-actions [data-act="begin"]', { timeout: 20000 });
    assert.equal(await page.locator('.fr-actions [data-act="begin"]').innerText(), 'はなしてみる');
    const text = await page.locator('.fr-log').innerText();
    assert.match(text, /おまかせで えらんだのは、.+!/, 'おまかせは別の子を本当に出す(UIR 4)');
    assert.match(text, /は、.+ 話す 子に したよ。/);
    await shot(page, 'qf4_done_summary');
    await page.click('.fr-actions [data-act="begin"]');
    await page.waitForFunction(() => window.__closed?.reason === 'done');
    assert.equal(await page.locator('.fr-sheet').count(), 0, '「はなしてみる」で閉じる');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test('作り終わり: 「はなしてみる」を押さなくても、約 4 秒で作る画面を閉じて話す画面へ(CU。前は押すまで札が話す画面を覆っていた)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    await ready(page);
    await page.click('.fr-btn.fr-auto');
    await page.click('.fr-actions [data-act="omakase_yes"]');
    await page.waitForSelector('.fr-actions [data-act="begin"]', { timeout: 20000 });
    const t0 = Date.now();
    await settle(page, 2000);
    assert.equal(await page.locator('.fr-sheet').count(), 1, '2 秒ではまだ閉じない(決めたことを読める)');
    await page.waitForFunction(() => window.__closed?.reason === 'done', null, { timeout: 8000 });
    const took = Date.now() - t0;
    assert.ok(took >= 3000 && took <= 7000, `約 4 秒で閉じる: ${took}ms`);
    assert.equal(await page.locator('.fr-sheet').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cc-open')), false, '作る画面の印も外れる(話す画面の上の段・下の帯が戻る)');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test('読み込み直し: 途中経過が残っても、自分からは作る画面を開かない。「あたらしい子を つくる」に「つづき」が付き、押すと続きから始まる(高 1・CU)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が無い');
  try {
    const { ctx, page, errors } = await open(browser, { width: 390, height: 844 });
    // 4 歩目まで進んだ途中経過を、この端末に残した形で作る(歩みごとの保存は台本の試験が見る)
    await page.evaluate(() => {
      localStorage.setItem('yc.onboarding.progress.v1', JSON.stringify({ v: 1, t: Date.now(), step: 4, from: 'words', words: 'ねこ', check: null,
        character: { id: 'norrie', name: 'ノリー', sample: true, note: '' }, skipped: [2] }));
    });
    await page.goto(`${BASE}/__fr/index.html`); // ?onboard=1 なしで読み込み直す
    await page.waitForSelector('[data-firstrun="start"]');
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.fr-sheet').count(), 0, '作りかけがあっても、自分からは作る画面を開かない(普段の会話に作る札が出てこない)');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cc-open')), false);
    await page.evaluate(() => document.getElementById('gate').classList.add('hidden')); // 試しの画面の入口(本物は main.js が隠す)
    assert.equal(await page.getAttribute('[data-firstrun="start"]', 'data-resume'), '1', '作りかけの印(小さな「つづき」)');
    assert.match(await page.getAttribute('[data-firstrun="start"]', 'aria-label'), /つづきから/);
    assert.equal(await page.innerText('[data-firstrun="start"]'), 'あたらしい子を つくる', '印は文字ではなく見た目だけ(ボタンの名前は変わらない)');
    await page.click('[data-firstrun="start"]');
    await page.waitForSelector('.fr-sheet');
    await page.waitForSelector('.fr-actions [data-act="persona_ok"]', { timeout: 20000 });
    const text = await page.locator('.fr-log').innerText();
    assert.match(text, /さっきの つづきからだよ/);
    assert.doesNotMatch(text, /どんな子を生み出そうか/, '1 歩目に戻さない');
    assert.equal(await page.locator('.fr-steps li.now').getAttribute('data-n'), '4');
    await shot(page, 'qf4_resume_step4');
    // 終わった後は続きを出さない
    await page.evaluate(() => localStorage.setItem('yc.onboarded.v1', 'done'));
    await page.goto(`${BASE}/__fr/index.html`);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.fr-sheet').count(), 0, '済みなら出ない');
    // 別の端末から続けた端末(合鍵がある・7 歩はまだ)は、済みにする(低 14)
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('yc.memoryKey', 'A'.repeat(43)); });
    await page.goto(`${BASE}/__fr/index.html`);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.fr-sheet').count(), 0, '別の端末から続けた端末では 7 歩を始めない');
    assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarded.v1')), 'paired');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
  }
});
