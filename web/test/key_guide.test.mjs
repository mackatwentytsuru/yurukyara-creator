// 鍵を入れやすくする案内の試験。
// - 「本物の Claude で話すには」: 仮の頭脳(鍵が入っていない時)だけ出る・公式のリンク・命令・「鍵はファイルに保存されません」
// - 声の歩み: 声の鍵の欄の下に、声の会社の公式の「鍵のページ」「料金のページ」と 1 行の注意。値段は書かない
// - 画面なしの Chrome(YC_BROWSER_TESTS=1)で、幅 390x844 に収まり、AI の表示に重ならないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { GUIDE_BUTTON_LABEL, GUIDE_SAFE_LINE, shouldShowGuide } from '../src/ui/brainGuide.js';
import { KEY_LINKS, START_COMMANDS, VOICE_TRIAL_NOTE } from '../src/ui/keyLinks.js';
import { HIDDEN } from '../src/stage/kioskMode.js';

const WEB = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';

test('公式のリンクだけ: https で、Claude の鍵の頁と ElevenLabs の鍵・料金の頁', () => {
  assert.deepEqual(Object.keys(KEY_LINKS).sort(), ['claudeKeys', 'voiceKeys', 'voicePricing']);
  const hosts = Object.values(KEY_LINKS).map((u) => new URL(u));
  assert.ok(hosts.every((u) => u.protocol === 'https:' && u.search === '' && u.hash === ''));
  assert.deepEqual(hosts.map((u) => u.hostname), ['platform.claude.com', 'elevenlabs.io', 'elevenlabs.io']);
  assert.equal(KEY_LINKS.claudeKeys, 'https://platform.claude.com/settings/keys');
  assert.equal(KEY_LINKS.voiceKeys, 'https://elevenlabs.io/app/api/api-keys');
  assert.equal(KEY_LINKS.voicePricing, 'https://elevenlabs.io/pricing/api');
});

test('案内を出すのは、仮の頭脳で、理由つきの知らせが無い時(鍵が入っていない時)だけ', () => {
  assert.equal(shouldShowGuide('mock', null), true);
  assert.equal(shouldShowGuide('haiku', null), false, '本物の頭脳なら出さない');
  assert.equal(shouldShowGuide(null, null), false, 'まだ分からない間は出さない');
  assert.equal(shouldShowGuide('mock', '仮の頭脳です(今日の上限に届きました)'), false, '上限・合言葉などの理由の時は出さない');
});

test('main.js: 仮の頭脳の知らせを更新する所で、案内を出し入れする。案内は最初は隠れている', () => {
  const main = read('src/main.js');
  assert.match(main, /import \{ mountBrainGuide, shouldShowGuide \} from '\.\/ui\/brainGuide\.js';/);
  assert.match(main, /brainGuide\?\.show\(shouldShowGuide\(currentBrain\(\), brainNoticeText\)\);/);
  assert.match(read('index.html'), /<div id="brainGuide" class="brain-guide" hidden><\/div>/);
});

test('案内は AI の表示(#aiNotice)と同じ字幕の列の中、その上に置く。接客モードでは隠す', () => {
  const html = read('index.html');
  const subs = html.slice(html.indexOf('<div class="subs">'), html.indexOf('id="aiNoticeTop"'));
  assert.ok(subs.indexOf('id="brainGuide"') > 0 && subs.indexOf('id="brainGuide"') < subs.indexOf('id="aiNotice"'), '案内は AI の表示より上');
  assert.ok(HIDDEN.some((h) => h.selector === '#brainGuide'));
  assert.match(read('src/ui/kiosk.css'), /html\.is-kiosk #brainGuide,/);
});

test('案内の文: 鍵を作る公式のリンク・起こす命令(Mac/Linux と PowerShell)・かんたんな道・鍵はファイルに保存しない', () => {
  const src = read('src/ui/brainGuide.js');
  assert.match(src, /KEY_LINKS\.claudeKeys/);
  assert.match(src, /target: '_blank', rel: 'noopener noreferrer'/);
  for (const c of Object.values(START_COMMANDS)) assert.ok(c.length > 5);
  assert.equal(START_COMMANDS.easy, 'npm run start:keys');
  assert.match(START_COMMANDS.unix, /^ANTHROPIC_API_KEY="ここに鍵" npm start$/);
  assert.match(START_COMMANDS.windows, /^\$env:ANTHROPIC_API_KEY="ここに鍵"; npm start$/);
  assert.equal(GUIDE_BUTTON_LABEL, '本物の Claude で話すには');
  assert.equal(GUIDE_SAFE_LINE.startsWith('鍵はファイルに保存されません'), true);
  assert.equal(/innerHTML/.test(src.replace(/\/\/.*$/gm, '')), false, 'innerHTML は使わない');
});

test('声の歩み: 鍵の欄の下に公式の 2 つのリンクと 1 行の注意。値段・お試しの中身は書かない', () => {
  const view = read('src/ui/onboarding/view.js');
  assert.match(view, /KEY_LINKS\.voiceKeys/);
  assert.match(view, /KEY_LINKS\.voicePricing/);
  assert.match(view, /rel: 'noopener noreferrer'/);
  assert.equal(/[¥￥円]|\d\s?%|\$\s?\d|ドル/.test(VOICE_TRIAL_NOTE), false);
  assert.match(VOICE_TRIAL_NOTE, /公式ページで たしかめてね/);
});

/** 実物の index.html の字幕の列(.subs)だけを取り出す */
function realSubs() {
  const html = read('index.html');
  const start = html.indexOf('<div class="subs">');
  const end = html.indexOf('<p class="ai-notice ai-notice-top"');
  return html.slice(start, end);
}
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** src を配るだけの小さなサーバー */
function serve(page) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(page);
      }
      const file = join(WEB, path);
      if (!file.startsWith(join(WEB, 'src')) || !TYPES[extname(file)]) return res.writeHead(404).end();
      let data;
      try {
        data = readFileSync(file);
      } catch {
        return res.writeHead(404).end();
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] });
      return res.end(data);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function openChrome(t) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return t.skip('playwright-core が無い');
  }
  try {
    return await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  } catch {
    return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  }
}

const GUIDE_PAGE = () => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/ui/style.css"></head><body>${realSubs()}
<script type="module">
import { mountBrainGuide, shouldShowGuide } from '/src/ui/brainGuide.js';
const guide = mountBrainGuide({ root: document.getElementById('brainGuide') });
window.__set = (brain, notice) => { const n = document.getElementById('brainNotice'); n.hidden = brain !== 'mock'; n.textContent = notice ?? '仮の頭脳です(本物の頭脳につながっていません)'; guide.show(shouldShowGuide(brain, notice ?? null)); };
window.__ready = true;
</script></body></html>`;

test('画面なしの Chrome(幅 390x844): 仮の頭脳の時だけ案内が出て、開いても AI の表示に重ならず、公式リンクを新しいタブで開く', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await openChrome(t);
  if (!browser) return;
  const { server, base } = await serve(GUIDE_PAGE());
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 30_000 });
    const visible = (sel) => page.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none');

    await page.evaluate(() => window.__set('haiku'));
    assert.equal(await visible('#brainGuide'), false, '本物の頭脳: 案内は出ない');
    await page.evaluate(() => window.__set('mock', '仮の頭脳です(今日の上限に届きました)'));
    assert.equal(await visible('#brainGuide'), false, '理由つきの仮の頭脳: 案内は出ない');
    await page.evaluate(() => window.__set('mock'));
    assert.equal(await visible('#brainGuide'), true, '鍵が無い仮の頭脳: 案内が出る');
    assert.equal((await page.textContent('.brain-guide-btn')).trim(), '本物の Claude で話すには');
    assert.equal(await visible('#brainGuidePanel'), false, '最初はたたんである');

    await page.click('.brain-guide-btn');
    assert.equal(await visible('#brainGuidePanel'), true);
    assert.equal(await page.getAttribute('.brain-guide-btn', 'aria-expanded'), 'true');
    const link = await page.$eval('#brainGuidePanel a', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
    assert.deepEqual(link, { href: KEY_LINKS.claudeKeys, target: '_blank', rel: 'noopener noreferrer' });
    const text = await page.$eval('#brainGuidePanel', (e) => e.innerText);
    for (const c of Object.values(START_COMMANDS)) assert.ok(text.includes(c), c);
    assert.ok(text.includes('鍵はファイルに保存されません'));

    // 390x844 に収まる・横に巻かない・AI の表示に重ならない・押せる
    const box = async (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
    const panel = await box('#brainGuidePanel');
    const ai = await box('#aiNotice');
    const btn = await box('.brain-guide-btn');
    assert.ok(panel.x >= 0 && panel.r <= 390 && panel.y >= 0, `案内が画面に収まる: ${JSON.stringify(panel)}`);
    assert.ok(panel.b <= ai.y + 0.5, `案内は AI の表示の上: 案内の下 ${panel.b} / AI の表示の上 ${ai.y}`);
    assert.ok(btn.h >= 44, `押す所は 44px 以上: ${btn.h}`);
    assert.ok(ai.w > 0 && ai.h > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
    const clear = (a, b) => a.b <= b.y + 0.5 || b.b <= a.y + 0.5 || a.r <= b.x || b.r <= a.x;
    assert.ok(clear(btn, ai) && clear(panel, ai), `ボタンも案内も、AI の表示と四角が重ならない: ${JSON.stringify({ btn, panel, ai })}`);
    // 新しいタブで開く(外へは出さない: 横取りして中身は返さない)
    await ctx.route(/^https:\/\/platform\.claude\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>' }));
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#brainGuidePanel a')]);
    assert.equal(new URL(popup.url()).hostname, 'platform.claude.com');
    await popup.close();

    await page.keyboard.press('Escape');
    assert.equal(await visible('#brainGuidePanel'), false, 'Escape で閉じる');
    await page.evaluate(() => window.__set('haiku'));
    assert.equal(await visible('#brainGuide'), false, '本物の頭脳に替わると案内は消える');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
});

const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** 手元のサーバー(鍵なし)を起こす。声・頭脳の API は本物の鍵なしの動き */
async function startServer() {
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', MEMORY_DIR: mkdtempSync(join(tmpdir(), 'kg-mem-')) };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE']) delete childEnv[k];
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('サーバーが立ちませんでした');
}

const VOICE_PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/__fr/src/ui/style.css"></head>
<body><header class="top"><div class="modes" id="modes"></div></header>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { Speaker } from '/__fr/src/conversation/speaker.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const app = { speaker: new Speaker(), persona: '', status: await (await fetch('/api/status')).json(), character: { id: 'd_lantern', name: 'ちょうちんくん', expressions: [], setEmotion() {}, play() {} } };
window.__fr = mountFirstRun({ app, params: new URLSearchParams(location.search), buttonHost: document.getElementById('modes'), random: seededRandom(5) });
</script></body></html>`;

test('画面なしの Chrome(幅 390x844): 声の歩みの鍵の欄の下に、公式のリンク 2 つと 1 行の注意。リンクは新しいタブ・画面に収まる', { skip: SLOW, timeout: 180_000 }, async (t) => {
  const browser = await openChrome(t);
  if (!browser) return;
  const server = await startServer();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await ctx.route(`${server.base}/__fr/**`, async (route) => {
      const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
      if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: VOICE_PAGE });
      const file = join(WEB, rel);
      if (!file.startsWith(join(WEB, 'src')) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.base}/__fr/index.html?onboard=1&character=d_lantern`);
    await page.waitForFunction(() => window.__fr, null, { timeout: 30_000 });
    await page.evaluate(() => window.__fr.byokReady);
    const act = (id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });
    await act('role_home');
    await page.click('.fr-actions [data-act="role_home"]');
    await act('words');
    await page.fill('.fr-actions [data-act="words"] input', '赤い提灯の子');
    await page.click('.fr-actions [data-act="words"] button[type="submit"]');
    await act('keep');
    await page.click('.fr-actions [data-act="keep"]');
    await act('persona_ok');
    await page.click('.fr-actions [data-act="persona_ok"]');
    await act('to_retro');
    await page.click('.fr-actions [data-act="to_retro"]');
    await act('to_voice');
    await page.click('.fr-actions [data-act="to_voice"]');
    await act('key');
    const links = await page.$$eval('.fr-key-links a', (as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel, h: a.getBoundingClientRect().height })));
    assert.deepEqual(links.map((l) => l.href), [KEY_LINKS.voiceKeys, KEY_LINKS.voicePricing]);
    assert.ok(links.every((l) => l.target === '_blank' && l.rel === 'noopener noreferrer' && l.h >= 44), JSON.stringify(links));
    assert.equal((await page.textContent('.fr-key-note')).trim(), VOICE_TRIAL_NOTE);
    const inView = await page.$eval('.fr-key-links', (e) => { const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= 390 && r.bottom <= window.innerHeight; });
    assert.equal(inView, true, 'リンクの欄が画面に収まる');
    const keyBox = await page.$eval('.fr-actions [data-act="key"] input[type="password"]', (e) => { const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.height >= 44; });
    assert.equal(keyBox, true, '鍵の欄も画面に収まり、押せる高さ');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
    await ctx.route(/^https:\/\/elevenlabs\.io\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>' }));
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('.fr-key-links a:nth-of-type(2)')]);
    assert.equal(new URL(popup.url()).pathname, '/pricing/api', '料金のページを新しいタブで開く');
    await popup.close();
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    server.proc.kill();
  }
});