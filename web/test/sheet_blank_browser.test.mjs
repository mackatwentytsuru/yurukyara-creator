// 作る札が「からっぽ」になった時の立て直し(11/8 本人の iPhone: 作り直したら、会話が進んでいるのに札の中が全部見えなくなった)。
// 画面なしの Chrome で、描き直し(なおしたい ところ・やりなおす・ひとつ もどる)のあと、札に会話・選び・言葉の欄が必ず見えることを確かめる。
// 本人の端末の失敗は手元の Chrome では起きないので、会話の欄が空になる・選びが消える・札が見えなくなる・札が取れる、を試験が起こして、
// 札が自分で気づいて元に戻す(札の点検)ことを確かめる。描く API は作り物の返事(お金は使わない)。
// 会話サーバーは鍵なしで立てる。重いので YC_BROWSER_TESTS=1 のときだけ動く。FR_PORT_RANGE=9450-9459 のように渡すと、その中の空いている番号を使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:net';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';

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
  delete childEnv.ANTHROPIC_API_KEY;
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
      if (r.ok) return { proc, base };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>札の点検の試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
import { createDrawCreator, createSampleCreator } from '/__fr/src/ui/onboarding/creators.js';
import { MAIN_CHARACTER } from '/__fr/src/character/defaults.js';
const params = new URLSearchParams(location.search);
const creator = createDrawCreator({ sample: createSampleCreator({ main: () => MAIN_CHARACTER }), enabled: () => true });
window.__fr = mountFirstRun({ app: null, params, buttonHost: document.getElementById('modes'), random: seededRandom(5), creator, showCharacter: async () => true });
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

async function openPage(browser, base, { width, height }) {
  const touch = width < 720;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
  await ctx.route(`${base}/__fr/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
    if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const file = join(WEB, rel);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const events = [];
  await ctx.route(`${base}/api/client-event`, (route) => {
    events.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  let drawn = 0;
  const bodies = [];
  await ctx.route(`${base}/api/draw`, async (route) => {
    drawn += 1;
    bodies.push(route.request().postDataJSON());
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `drawn_${drawn}`, name: `かいた子${drawn}` }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/__fr/index.html?onboard=1&draw=1`);
  return { ctx, page, errors, events, drawn: () => drawn, bodies };
}

const waitAct = (page, id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });

/** 札の中身の事実(見えている物だけ数える) */
const card = (page) =>
  page.evaluate(() => {
    const vis = (e) => {
      if (!e || !e.isConnected) return false;
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && b.width > 0 && b.height > 0;
    };
    const sheet = document.querySelector('.fr-sheet');
    const sb = sheet?.getBoundingClientRect();
    const inside = (e) => {
      const b = e.getBoundingClientRect();
      return Boolean(sb) && b.bottom > sb.top && b.top < sb.bottom;
    };
    return {
      sheet: vis(sheet),
      head: vis(sheet?.querySelector('.fr-head')),
      lines: [...document.querySelectorAll('.fr-log .fr-line')].filter((e) => vis(e) && inside(e)).length,
      chips: [...document.querySelectorAll('.fr-actions .fr-chip, .fr-actions .fr-back')].filter(vis).length,
      field: vis(document.querySelector('.fr-actions form.fr-field input[type="text"]')),
    };
  });

/** 会話・選び・言葉の欄が見えている(withField: 言葉の欄が出ている問いのとき) */
async function assertCard(page, where, { withField = true } = {}) {
  const c = await card(page);
  assert.equal(c.sheet, true, `${where}: 札が見える`);
  assert.equal(c.head, true, `${where}: 札の頭が見える`);
  assert.ok(c.lines > 0, `${where}: 会話の吹き出しが見える(${c.lines})`);
  assert.ok(c.chips > 0, `${where}: 押す札が見える(${c.chips})`);
  if (withField) assert.equal(c.field, true, `${where}: 言葉の欄が見える`);
}

/** 札の点検が立て直すのを待つ(ここを過ぎても戻らなければ失敗) */
async function waitHealed(page, where, opts) {
  try {
    await page.waitForFunction(
      () => {
        const sheet = document.querySelector('.fr-sheet');
        if (!sheet || !sheet.isConnected) return false;
        const log = sheet.querySelector('.fr-log');
        const b = sheet.getBoundingClientRect();
        const s = getComputedStyle(sheet);
        const head = sheet.querySelector('.fr-head')?.getBoundingClientRect();
        return (
          b.height > 100 &&
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          Number(s.opacity) > 0.9 &&
          Boolean(head) &&
          head.height > 10 &&
          log.querySelectorAll('.fr-line').length > 0 &&
          sheet.querySelectorAll('.fr-actions .fr-chip').length > 0 &&
          sheet.querySelectorAll('.fr-actions form.fr-field input').length > 0
        );
      },
      null,
      { timeout: 6_000 },
    );
  } catch {
    // 下の assertCard が、何が足りないかを言う
  }
  await assertCard(page, where, opts);
}

/** 描き直しを何回か重ねる: 言葉 → なおしたい ところ → やりなおす → 言葉 → ひとつ もどる */
async function redoWalk(page, h, label) {
  await waitAct(page, 'role_home');
  await page.click('.fr-actions [data-act="role_home"]');
  await waitAct(page, 'words');
  await page.fill('.fr-actions [data-act="words"] input', 'みどりの かえるの子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.equal(h.drawn(), 1);
  await assertCard(page, `${label} 1 回目に描いた後`);

  await page.fill('.fr-actions [data-act="fix"] input', 'みみを もっと 大きく');
  await page.click('.fr-actions [data-act="fix"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.fr-actions [data-act="keep"]').length > 0 && /なおしてみたよ/.test(document.querySelector('.fr-log')?.innerText ?? ''), null, { timeout: 30_000 });
  assert.equal(h.drawn(), 2);
  await assertCard(page, `${label} なおしたい ところで描き直した後`);

  await page.click('.fr-actions [data-act="again"]');
  await waitAct(page, 'words');
  await assertCard(page, `${label} やりなおすの後`);
  await page.fill('.fr-actions [data-act="words"] input', 'あおい ロボットの子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.equal(h.drawn(), 3);
  await assertCard(page, `${label} 3 回目に描いた後`);

  await page.click('.fr-actions .fr-back');
  await page.waitForFunction(() => /ひとつ もどったよ/.test(document.querySelector('.fr-log')?.innerText ?? '') && document.querySelectorAll('.fr-actions [data-act]').length > 0, null, { timeout: 30_000 });
  await assertCard(page, `${label} ひとつ もどるの後`);
}

const VIEWS = [
  { label: 'w390', width: 390, height: 844 },
  { label: 'pc1280', width: 1280, height: 800 },
];

test('作り直しを重ねても、札には会話・選び・言葉の欄がいつも見える(幅 390・PC)', { skip: SLOW, timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    for (const v of VIEWS) {
      await t.test(v.label, async () => {
        const h = await openPage(browser, server.base, v);
        try {
          await redoWalk(h.page, h, v.label);
          assert.deepEqual(h.errors, [], `画面のエラー: ${h.errors.join(' / ')}`);
        } finally {
          await h.ctx.close();
        }
      });
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

/** 札が空になった形を起こす。どれも、本人の iPhone で起きた「札の中が見えない」と同じ見え方 */
const SABOTAGE = {
  '会話の欄が空': () => document.querySelector('.fr-log').replaceChildren(),
  '選びと言葉の欄が空': () => {
    document.querySelector('.fr-chips').replaceChildren();
    document.querySelector('.fr-input').replaceChildren();
  },
  '札が見えない(display)': () => {
    document.querySelector('.fr-sheet').style.display = 'none';
  },
  '札が見えない(visibility と opacity)': () => {
    const s = document.querySelector('.fr-sheet');
    s.style.visibility = 'hidden';
    s.style.opacity = '0';
  },
  '札が画面から取れた': () => document.querySelector('.fr-sheet').remove(),
  '札の頭が潰れた': () => {
    document.querySelector('.fr-head').style.display = 'none';
  },
};

test('札が空になっても、札が自分で気づいて、会話・選び・言葉の欄を戻す(幅 390)', { skip: SLOW, timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    for (const [name, sabotage] of Object.entries(SABOTAGE)) {
      await t.test(name, async () => {
        const h = await openPage(browser, server.base, VIEWS[0]);
        try {
          await redoWalk(h.page, h, name);
          const before = (await h.page.$eval('.fr-log', (e) => e.innerText)).replace(/\s+/g, ' ');
          await h.page.evaluate(sabotage);
          await waitHealed(h.page, `${name}の後`);
          // 戻した会話は、前と同じ(新しく作り直した別の文ではなく、さっきの会話)
          const after = (await h.page.$eval('.fr-log', (e) => e.innerText)).replace(/\s+/g, ' ');
          assert.equal(after, before, `${name}: 会話が前のとおり戻る`);
          // 戻った札は、ふつうに使える: 「ひとつ もどる」が動く
          await h.page.click('.fr-actions .fr-back');
          await h.page.waitForFunction(() => /ひとつ もどったよ/.test(document.querySelector('.fr-log')?.innerText ?? ''), null, { timeout: 30_000 });
          await assertCard(h.page, `${name}を直した後に 戻る`, { withField: true });
          // 起きたことは、原因だけ記録に送る(会話の中身は送らない)
          assert.ok(h.events.some((e) => e.kind === 'sheet-blank'), `${name}: 記録に sheet-blank が送られる`);
          assert.ok(h.events.every((e) => !/かえる|ロボット|みみ/.test(JSON.stringify(e))), '会話の中身は記録に送らない');
          assert.deepEqual(h.errors, [], `画面のエラー: ${h.errors.join(' / ')}`);
        } finally {
          await h.ctx.close();
        }
      });
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});
