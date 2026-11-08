// 「ひとつ もどる」(本人 11/8)の画面の試験。画面なしの Chrome で、札の見た目と、押した時の動きを確かめる。
// 台本の細かい決まりは onboarding_back.test.mjs(画面なし・速い)。ここは画面だけ:
//   - 最初の問いには出ない。2 つ目から出る。ふつうの札より目立たない(ふち・ぬりが無い・小さい字)。押す所は 44px 以上。名前がある
//   - 押すと、ひとつ前の問いに戻り、会話の欄もその問いの所まで戻る。さっきの こたえに しるし。言葉は欄に入れ直す
//   - 「あと ◯ つ」が戻る。最初の問いまで続けて戻れる。「のこりを ぜんぶ おまかせ」の後にも出て、押すと終わりで閉じる待ちが止まる
// 会話サーバーは鍵なしで立てる(仮の頭脳)。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。
// 重いので YC_BROWSER_TESTS=1 のときだけ動く(onboarding_browser.test.mjs と同じ決まり)。FR_SHOTS_DIR で写真を残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:net';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SHOTS = process.env.FR_SHOTS_DIR || '';
// 終わりで札が自動で閉じるまでの長さ(index.js の FINISH_AUTO_MS。画面の部品は node に読み込まず、ソースの数字を読む)
const FINISH_AUTO_MS = Number(/FINISH_AUTO_MS = (\d+)/.exec(readFileSync(join(SRC, 'ui', 'onboarding', 'index.js'), 'utf8'))?.[1] ?? 8000);
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';

// FR_PORT_RANGE=9520-9529 のように渡すと、その中の空いている番号を使う(ほかの物と重ならないため)。無ければ、空いている番号を OS が選ぶ
const tryPort = (n) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(0));
    s.listen(n, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const freePort = async () => {
  const m = /^(\d+)-(\d+)$/.exec(process.env.FR_PORT_RANGE ?? '');
  if (m) {
    for (let n = Number(m[1]); n <= Number(m[2]); n++) {
      const p = await tryPort(n);
      if (p) return p;
    }
    throw new Error(`FR_PORT_RANGE ${process.env.FR_PORT_RANGE} に空きがありません`);
  }
  return tryPort(0);
};

async function startServer(env) {
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  delete childEnv.ANTHROPIC_API_KEY; // 本物の頭脳を呼ばない(仮の頭脳で試す)
  delete childEnv.ELEVENLABS_API_KEY;
  delete childEnv.APP_PASSPHRASE;
  Object.assign(childEnv, env);
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) return { proc, base, log: () => out };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

// 試しの画面: 会話の画面の CSS と、ボタンを置く #modes だけ(舞台の WebGL は使わない)
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>もどるの試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<div id="gate" class="gate"><div class="gate-card"><h1>入口</h1><button id="startSim" type="button">カメラなしで試す</button></div></div>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
import { createDrawCreator, createSampleCreator } from '/__fr/src/ui/onboarding/creators.js';
import { MAIN_CHARACTER } from '/__fr/src/character/defaults.js';
const params = new URLSearchParams(location.search);
window.__test = { closed: null };
addEventListener('yc:firstrun-closed', (e) => { window.__test.closed = e.detail; });
// ?draw=1: 描ける作り手(/api/draw は試験が数えて、仮の返事を返す。舞台は使わない)
const creator = params.get('draw') === '1' ? createDrawCreator({ sample: createSampleCreator({ main: () => MAIN_CHARACTER }), enabled: () => true }) : null;
window.__fr = mountFirstRun({ app: null, params, buttonHost: document.getElementById('modes'), random: seededRandom(5), ...(creator ? { creator, showCharacter: async () => true } : {}) });
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

async function openPage(browser, base, { width, height, query }) {
  const touch = width < 720;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(`${base}/__fr/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
    if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const file = join(WEB, rel);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/__fr/index.html?${query}`);
  return { ctx, page, errors };
}

/** 横にはみ出さない・押す所は 44px 以上・いちばん新しい吹き出しが見える */
async function checkLayout(page, where) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const visible = (e) => {
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0;
    };
    const out = { vw, scrollW: document.documentElement.scrollWidth, wide: [], small: [] };
    const root = document.querySelector('.fr-sheet');
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!visible(e) || e.closest('.fr-sr') || e.classList.contains('fr-file')) continue;
      if (e.closest('.fr-chips-scroll') && !e.matches('.fr-chips-scroll')) continue;
      const b = e.getBoundingClientRect();
      if (b.right > vw + 0.5 || b.left < -0.5) out.wide.push(`${e.tagName}.${e.className} ${Math.round(b.left)}..${Math.round(b.right)}`);
      if (e.matches('button, label.fr-btn, input[type="text"]') && b.height < 43.5) out.small.push(`${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 12)}" ${b.height.toFixed(1)}px`);
    }
    const log = document.querySelector('.fr-log');
    const last = log?.lastElementChild;
    if (last) out.lastHidden = last.getBoundingClientRect().bottom - log.getBoundingClientRect().bottom;
    return out;
  });
  assert.ok(!(r.lastHidden > 1), `${where}: いちばん新しい吹き出しが ${Math.round(r.lastHidden)}px 隠れている`);
  assert.ok(r.scrollW <= r.vw, `${where}: 横にはみ出しています(${r.scrollW} > ${r.vw})`);
  assert.deepEqual(r.wide, [], `${where}: 画面の外に出た物`);
  assert.deepEqual(r.small, [], `${where}: 押す所が 44px より小さい`);
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const logText = (page) => page.$eval('.fr-log', (e) => e.innerText);
const waitAct = (page, id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });
const backShown = (page) => page.$eval('.fr-backrow', (e) => getComputedStyle(e).display !== 'none' && !e.hidden);
const leftMain = (page) => page.$eval('.fr-left b', (e) => e.textContent);
const stepNow = (page) => page.$eval('.fr-sheet', (e) => e.dataset.step);
const clickBack = async (page) => {
  await page.click('.fr-actions .fr-back');
};
/** 戻った後、新しい問いの札が出るまで待つ(押した直後は選びが一度空になる) */
const waitBackDone = (page) => page.waitForFunction(() => /ひとつ もどったよ/.test(document.querySelector('.fr-log')?.innerText ?? '') && document.querySelectorAll('.fr-actions [data-act]').length > 0, null, { timeout: 30_000 });

const VIEWS = [
  { label: 'w390', width: 390, height: 844, omakase: true },
  { label: 'pc1280', width: 1280, height: 800, omakase: false },
];

async function walkBack(page, label, { omakase }) {
  // 最初の問い(役目)には出ない
  await waitAct(page, 'role_home');
  assert.equal(await backShown(page), false, '最初の問いには「ひとつ もどる」を出さない');
  assert.equal(await page.$$eval('.fr-actions .fr-back', (e) => e.filter((x) => x.offsetParent !== null).length), 0);
  await page.click('.fr-actions [data-act="role_home"]');
  await waitAct(page, 'words');

  // 2 つ目の問い: 出る。ふつうの札より目立たず、押す所は 44px 以上で、名前がある
  assert.equal(await backShown(page), true, '2 つ目の問いから出す');
  const quiet = await page.evaluate(() => {
    const b = document.querySelector('.fr-actions .fr-back');
    const c = document.querySelector('.fr-actions .fr-chip');
    const s = getComputedStyle(b);
    const t = getComputedStyle(c);
    return {
      name: b.getAttribute('aria-label'),
      text: b.textContent,
      h: b.getBoundingClientRect().height,
      bg: s.backgroundColor,
      border: s.borderTopWidth,
      fs: parseFloat(s.fontSize),
      chipFs: parseFloat(t.fontSize),
      chipBg: t.backgroundColor,
      chipBorder: t.borderTopWidth,
      underline: s.textDecorationLine,
    };
  });
  assert.equal(quiet.text, 'ひとつ もどる');
  assert.match(quiet.name, /^ひとつ もどる/, '名前がある');
  assert.ok(quiet.h >= 44, `押す所は 44px 以上 ${quiet.h}`);
  assert.equal(quiet.bg, 'rgba(0, 0, 0, 0)', 'ぬりが無い');
  assert.equal(quiet.border, '0px', 'ふちが無い');
  assert.ok(quiet.fs < quiet.chipFs, `字がふつうの札より小さい ${quiet.fs} < ${quiet.chipFs}`);
  assert.notEqual(quiet.chipBg, 'rgba(0, 0, 0, 0)', 'ふつうの札はぬりがある');
  assert.notEqual(quiet.chipBorder, '0px', 'ふつうの札はふちがある');
  assert.match(quiet.underline, /underline/);
  await checkLayout(page, `${label} 2 つ目の問い`);
  await shot(page, `back_${label}_2_start`);

  // 言葉を送って、できた子 → 性格へ。「あと ◯ つ」が戻る
  await page.fill('.fr-actions [data-act="words"] input', '赤い提灯の子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.equal(await leftMain(page), 'あと 4 つ');
  await checkLayout(page, `${label} できた子`);
  await shot(page, `back_${label}_3_meet`);
  await page.click('.fr-actions [data-act="keep"]');
  await waitAct(page, 'persona_ok');
  assert.equal(await leftMain(page), 'あと 3 つ');
  assert.match(await logText(page), /この子、少し.+みたい!/);
  await shot(page, `back_${label}_4_persona`);

  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'keep');
  assert.equal(await stepNow(page), '3', '歩みが戻る');
  assert.equal(await leftMain(page), 'あと 4 つ', '「あと ◯ つ」が戻る');
  assert.doesNotMatch(await logText(page), /この子、少し.+みたい!/, '性格の吹き出しは、会話の欄から戻る');
  assert.match(await logText(page), /ちょうちんくんだよ。この子は どうかな\?/, '戻った先の問いは、そのまま見える');
  assert.match(await page.$eval('.fr-actions [data-act="keep"]', (e) => e.className), /fr-prev/, 'さっき選んだ札に しるし');
  assert.match(await page.$eval('.fr-actions [data-act="keep"]', (e) => e.getAttribute('aria-label')), /さっき えらんだ こたえ/);
  await checkLayout(page, `${label} 戻った後(できた子)`);
  await shot(page, `back_${label}_5_back_to_meet`);

  // もう一度戻る: 言葉を欄に入れ直す。描き直さない(同じ子)
  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'words');
  assert.equal(await page.$eval('.fr-actions [data-act="words"] input', (e) => e.value), '赤い提灯の子', '言葉を欄に入れ直す');
  assert.equal(await page.$eval('.fr-actions .fr-count', (e) => e.textContent), '6 / 60', '字数の表示も合う');
  await checkLayout(page, `${label} 言葉の問いに戻った後`);
  await shot(page, `back_${label}_6_back_to_words`);

  // 最初の問いまで続けて戻る
  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'role_home');
  assert.equal(await backShown(page), false, '最初の問いに戻ったら、戻る札は消える');
  assert.equal(await stepNow(page), '1');
  assert.equal(await leftMain(page), 'あと 6 つ');
  assert.match(await page.$eval('.fr-actions [data-act="role_home"]', (e) => e.className), /fr-prev/);
  assert.match(await page.$eval('.fr-actions [data-act="role_home"]', (e) => e.getAttribute('aria-label')), /さっき えらんだ こたえ/);

  // 役目 → 場所の名前 → 場所の説明。戻ると、さっきの名前
  await page.click('.fr-actions [data-act="role_station"]');
  await waitAct(page, 'place_name');
  await page.fill('.fr-actions [data-act="place_name"] input', 'みどり駅');
  await page.click('.fr-actions [data-act="place_name"] button[type="submit"]');
  await waitAct(page, 'place_about');
  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'place_name');
  assert.equal(await page.$eval('.fr-actions [data-act="place_name"] input', (e) => e.value), 'みどり駅', 'さっきの名前');
  await checkLayout(page, `${label} 場所の問いに戻った後`);

  if (!omakase) return;
  // 「のこりを ぜんぶ おまかせ」の後: 最後に出して、押すと、押した時の問いに戻る。終わりで閉じる待ちも止まる
  await page.click('.fr-actions .fr-auto');
  await waitAct(page, 'omakase_yes');
  await page.click('.fr-actions [data-act="omakase_yes"]');
  await waitAct(page, 'begin');
  assert.equal(await backShown(page), true, 'おまかせが終わった後にも「ひとつ もどる」を出す');
  assert.match(await page.$eval('.fr-actions .fr-back', (e) => e.getAttribute('aria-label')), /おまかせに する まえ/);
  await shot(page, `back_${label}_7_after_omakase`);
  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'place_name');
  assert.equal(await stepNow(page), '1');
  await page.waitForTimeout(FINISH_AUTO_MS + 1500);
  assert.ok(await page.$('.fr-sheet'), '戻った後は、終わりで閉じる待ちが止まっていて、札が閉じない');
  assert.equal(await page.evaluate(() => window.__test.closed), null);
  await checkLayout(page, `${label} おまかせの後に戻った後`);
}

test('ひとつ もどる(画面): 最初の問いには出ず、目立たない札で、戻ると会話の欄・あと ◯ つ・さっきの こたえが戻る(幅 390・PC)', { skip: SLOW, timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    for (const v of VIEWS) {
      await t.test(v.label, async () => {
        const { ctx, page, errors } = await openPage(browser, server.base, { ...v, query: 'onboard=1' });
        try {
          await walkBack(page, v.label, v);
          assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
        } finally {
          await ctx.close();
        }
      });
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

/** 戻って同じ頼みを送り直しても、描かない。さっきの子の札は、幅 390 でも札の列の最初に見える */
async function walkNoRedraw(page, label, drawCount) {
  await waitAct(page, 'role_home');
  await page.click('.fr-actions [data-act="role_home"]');
  await waitAct(page, 'words');
  await page.fill('.fr-actions [data-act="words"] input', 'みどりの かえるの子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.equal(drawCount(), 1, `${label}: 1 回描いた`);

  // 戻る: 言葉は欄に入り直し、さっきの子の札が列の最初に、列の中で見える
  await clickBack(page);
  await waitBackDone(page);
  await waitAct(page, 'words');
  await waitAct(page, 'reuse_made');
  const reuse = await page.$eval('.fr-actions [data-act="reuse_made"]', (e) => {
    const b = e.getBoundingClientRect();
    const c = e.parentElement.getBoundingClientRect();
    return { first: e.parentElement.firstElementChild === e, inside: b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.width > 20, primary: e.classList.contains('primary'), name: e.getAttribute('aria-label'), text: e.textContent };
  });
  assert.equal(reuse.first, true, `${label}: 列の最初`);
  assert.equal(reuse.inside, true, `${label}: 列の外に隠れていない`);
  assert.equal(reuse.primary, true, `${label}: 目立つ札`);
  assert.match(reuse.name, /もう一度は 描きません/);
  assert.equal(await page.$eval('.fr-actions [data-act="words"] input', (e) => e.value), 'みどりの かえるの子');
  await checkLayout(page, `${label} さっきの子の札`);
  await shot(page, `back_${label}_8_reuse_chip`);

  // 欄の言葉をそのまま送る: 描かない(何回でも)
  for (let i = 0; i < 2; i++) {
    await page.click('.fr-actions [data-act="words"] button[type="submit"]');
    await waitAct(page, 'keep');
    assert.equal(drawCount(), 1, `${label}: 送り直しても描かない(${i + 1} 回目)`);
    assert.match(await logText(page), /もう一度は 描かないよ/);
    await clickBack(page);
    await waitBackDone(page);
    await waitAct(page, 'words');
  }
  // さっきの子で つづける: 描かない
  await page.click('.fr-actions [data-act="reuse_made"]');
  await waitAct(page, 'keep');
  assert.equal(drawCount(), 1, `${label}: 札で続けても描かない`);

  // やりなおすは、新しく描いてほしいということ
  await page.click('.fr-actions [data-act="again"]');
  await waitAct(page, 'words');
  await page.fill('.fr-actions [data-act="words"] input', 'みどりの かえるの子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.equal(drawCount(), 2, `${label}: やりなおす の後は描く`);
}

test('ひとつ もどる(画面): 戻って同じ頼みを送り直しても描かない。さっきの子の札は列の最初で見える(幅 390・PC)', { skip: SLOW, timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    for (const v of VIEWS) {
      await t.test(v.label, async () => {
        const { ctx, page, errors } = await openPage(browser, server.base, { ...v, query: 'onboard=1&draw=1' });
        let drawn = 0;
        await ctx.route(`${server.base}/api/draw`, (route) => {
          drawn += 1;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `drawn_${drawn}`, name: `かいた子${drawn}` }) });
        });
        try {
          await walkNoRedraw(page, v.label, () => drawn);
          assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
        } finally {
          await ctx.close();
        }
      });
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});
