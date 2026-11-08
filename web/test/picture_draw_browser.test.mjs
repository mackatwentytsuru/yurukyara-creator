// 絵から描く道を、画面なしの Chrome で通す試験(11/8 b13 picdraw)。サーバーは本物(/api/draw が有効)で、頭脳の行き先だけ偽の中継。
// 絵は自分たちで作った 1x1 の PNG だけ。よその会社の絵は使わない・置かない。
// 重いので YC_BROWSER_TESTS=1 のときだけ動く(onboarding_browser.test.mjs と同じ決まり)。Chrome の場所は CHROME_PATH で渡せる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { RIGHTS_ASK } from '../src/ui/onboarding/script.js';
import { SAMPLE_CHARACTERS } from '../src/ui/onboarding/creators.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
// 画面は「?」のところで 2 つの吹き出しに分けるので、問いの頭の文で数える(後ろの「(自分のキャラ・…)」は同じ吹き出しの組)
const ASK_HEAD = RIGHTS_ASK.slice(0, RIGHTS_ASK.indexOf('?') + 1);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const freePort = () => new Promise((resolve) => {
  const s = createNet();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** 偽の中継: 来た呼び出しを残し、いつも 502(描けない)を返す */
async function startRelay() {
  const calls = [];
  const srv = createHttp((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const content = b.messages?.[0]?.content ?? [];
      calls.push({ types: content.map((c) => c.type), media: content[0]?.source?.media_type ?? null });
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'x' } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { calls, url: `http://127.0.0.1:${srv.address().port}/v1/messages`, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}

async function startServer(env) {
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
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

// 試しの画面: 初めての会話の部品だけ。描ける設定(app.status.draw.on)を真似て渡す。舞台は数えるだけの偽物
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>絵から描く試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<div id="gate" class="gate"><div class="gate-card"><h1>入口</h1></div></div>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const params = new URLSearchParams(location.search);
window.__test = { swaps: [] };
const app = { character: { id: 'norrie', name: 'ノリー' }, characterId: 'norrie', persona: '', status: { draw: { on: true } },
  stage: { state: {}, resize() {}, frameCharacter() {} }, swapCharacter: (n) => { window.__test.swaps.push(n?.id ?? null); } };
window.__fr = mountFirstRun({ app, params, buttonHost: document.getElementById('modes'), byok: null, random: seededRandom(5) });
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

async function openPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
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
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); // 偽の中継の 502 は、わざと
  });
  await page.goto(`${base}/__fr/index.html?onboard=1`);
  return { ctx, page, errors };
}

const logText = (page) => page.$eval('.fr-log', (e) => e.innerText);
const waitAct = (page, id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });
const actIds = (page) => page.$$eval('.fr-actions [data-act]', (els) => els.map((e) => e.dataset.act).filter((a) => !/^(omakase|auto)/.test(a)));
const count = (text, word) => text.split(word).length - 1;

/** 押す所が 44px 以上・横にはみ出さない・いちばん新しい吹き出しが見える */
async function checkLayout(page, where) {
  const r = await page.evaluate(() => {
    const vw = innerWidth;
    const small = [...document.querySelectorAll('.fr-actions button, .fr-actions label.fr-btn')]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 43.5; }).map((e) => e.textContent.trim().slice(0, 12));
    const log = document.querySelector('.fr-log');
    const last = log?.lastElementChild;
    return { vw, scrollW: document.documentElement.scrollWidth, small, hidden: last ? last.getBoundingClientRect().bottom - log.getBoundingClientRect().bottom : 0 };
  });
  assert.ok(r.scrollW <= r.vw, `${where}: 横にはみ出す`);
  assert.deepEqual(r.small, [], `${where}: 押す所が小さい`);
  assert.ok(!(r.hidden > 1), `${where}: 最後の吹き出しが隠れている`);
}

async function setup(t) {
  const browser = await findChrome();
  if (!browser) { t.skip('Chrome が見つからない'); return null; }
  const relay = await startRelay();
  const dir = mkdtempSync(join(tmpdir(), 'pd-'));
  const server = await startServer({ ANTHROPIC_API_URL: relay.url, ANTHROPIC_API_KEY: 'test-key-not-real', YC_BROWSER_DRAW: '1', YC_DRAW_DAILY: '50', YC_DRAW_PER_VISITOR: '50', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'mem') });
  const { ctx, page, errors } = await openPage(browser, server.base);
  const done = async () => { await ctx.close(); await browser.close(); server.proc.kill(); relay.close(); };
  return { page, errors, relay, done };
}

test('絵を選ぶ(幅 390): 「使っていい絵か」を 1 回だけ聞き、はいで中継へ絵の段が届く。描けない時は見本を黙って出さず、3 つを出す', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const s = await setup(t);
  if (!s) return;
  try {
    const { page, relay } = s;
    await waitAct(page, 'role_home');
    await page.click('.fr-actions [data-act="role_home"]');
    await waitAct(page, 'pick');
    await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'own.png', mimeType: 'image/png', buffer: PNG });
    await waitAct(page, 'rights_yes');
    assert.equal(count(await logText(page), ASK_HEAD), 1, '確かめを 1 回聞く');
    assert.match(await logText(page), /\(自分のキャラ・使ってよいと言われたキャラ\)/, '例を添える');
    assert.deepEqual((await actIds(page)).filter((a) => a.startsWith('rights_')), ['rights_yes', 'rights_unsure', 'rights_no', 'rights_person']);
    assert.equal(relay.calls.length, 0, '答えが来るまで、絵を送らない');
    await checkLayout(page, '確かめ');
    await page.click('.fr-actions [data-act="rights_yes"]');
    await waitAct(page, 'draw_retry');
    assert.deepEqual(relay.calls[0], { types: ['image', 'text'], media: 'image/png' }, '中継へ、絵の段のあとに文の段が届く');
    const text = await logText(page);
    assert.match(text, /ごめんなさい、この絵から うまく 描けマセンでした/, 'ノリーの言葉で正直に言う');
    assert.ok(!SAMPLE_CHARACTERS.some((c) => text.includes(c.name)) && !text.includes('にた 見本の子'), '見本の子を黙って出さない');
    assert.deepEqual(await page.evaluate(() => window.__test.swaps), [], '舞台に子を出さない');
    assert.deepEqual((await actIds(page)).filter((a) => a !== 'back'), ['draw_retry', 'draw_words', 'choose_sample']); // 「ひとつ もどる」(back の枝)は、3 つの数に入れない
    await checkLayout(page, '描けなかった');
    await page.click('.fr-actions [data-act="draw_retry"]');
    await waitAct(page, 'draw_retry');
    assert.equal(relay.calls.length, 2, 'もういちど');
    assert.equal(count(await logText(page), ASK_HEAD), 1, '確かめはくり返さない');
    await page.click('.fr-actions [data-act="choose_sample"]');
    await waitAct(page, 's_robo');
    assert.deepEqual(await page.evaluate(() => window.__test.swaps), [], '見本は、自分で選ぶまで出さない');
    assert.deepEqual(s.errors, [], `画面のエラー: ${s.errors.join(' / ')}`);
  } finally {
    await s.done();
  }
});

test('絵を選ぶ(幅 390): わからない → 絵は送らず、色と形だけでオリジナルを頼む(文だけが中継へ)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const s = await setup(t);
  if (!s) return;
  try {
    const { page, relay } = s;
    await waitAct(page, 'role_home');
    await page.click('.fr-actions [data-act="role_home"]');
    await waitAct(page, 'pick');
    await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'own.png', mimeType: 'image/png', buffer: PNG });
    await waitAct(page, 'rights_unsure');
    await page.click('.fr-actions [data-act="rights_unsure"]');
    await waitAct(page, 'orig_yes');
    assert.equal(relay.calls.length, 0);
    assert.match(await logText(page), /どこにも 送らないよ/);
    await checkLayout(page, 'オリジナルの提案');
    await page.click('.fr-actions [data-act="orig_yes"]');
    await waitAct(page, 'col_blue');
    await page.click('.fr-actions [data-act="col_blue"]');
    await waitAct(page, 'shp_round');
    await page.click('.fr-actions [data-act="shp_round"]');
    await waitAct(page, 'draw_retry');
    assert.deepEqual(relay.calls, [{ types: ['text'], media: null }], '絵の段は送らない(文だけ)');
    assert.equal(count(await logText(page), ASK_HEAD), 1);
    assert.deepEqual(s.errors, [], `画面のエラー: ${s.errors.join(' / ')}`);
  } finally {
    await s.done();
  }
});
