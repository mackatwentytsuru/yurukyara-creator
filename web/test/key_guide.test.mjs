// 鍵を入れやすくする案内の試験。
// - 「本物の Claude で話すには」の案内の窓: おためしモードの帯のボタンで開く・2 つの道(鍵 / Claude Code)・公式のリンク・命令・「鍵はファイルに保存されません」
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
import { GUIDE_SAFE_LINE, GUIDE_TITLE, shouldShowGuide } from '../src/ui/brainGuide.js';
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
  assert.equal(shouldShowGuide('mock', 'おためしモードです(今日の上限に届きました)'), false, '上限・合言葉などの理由の時は出さない');
});

test('main.js: 仮の頭脳の知らせを更新する所で、おためしモードの帯と案内を出し入れする。案内の窓は最初は隠れている', () => {
  const main = read('src/main.js');
  assert.match(main, /import \{ mountBrainGuide \} from '\.\/ui\/brainGuide\.js';/);
  assert.match(main, /import \{ mountTrialMode, trialView \} from '\.\/ui\/trialMode\.js';/);
  assert.match(main, /trialMode\.update\(trialView\(\{ brain: currentBrain\(\), noticeText: brainNoticeText, statusBrain: app\.status\?\.brain \?\? null, kiosk: KIOSK\.on \}\)\);/);
  assert.match(read('index.html'), /<div id="brainGuide" class="brain-guide" hidden><\/div>/);
});

test('案内の窓は、上の段(.top)にも字幕の列(.subs)にも入れず、画面いっぱいの板として別に置く。接客モードでは隠す', () => {
  const html = read('index.html');
  const top = html.slice(html.indexOf('<header class="top">'), html.indexOf('</header>'));
  const subs = html.slice(html.indexOf('<div class="subs">'), html.indexOf('id="aiNoticeTop"'));
  assert.ok(!top.includes('id="brainGuide"') && !subs.includes('id="brainGuide"'));
  assert.ok(html.indexOf('id="brainGuide"') > html.indexOf('id="aiNoticeTop"'));
  assert.ok(HIDDEN.some((h) => h.selector === '#brainGuide'));
  assert.match(read('src/ui/kiosk.css'), /html\.is-kiosk #brainGuide,/);
});

test('案内の文: 2 つの道(鍵 / Claude Code)・鍵を作る公式のリンク・起こす命令・かんたんな道・鍵はファイルに保存しない', () => {
  const src = read('src/ui/brainGuide.js');
  assert.match(src, /KEY_LINKS\.claudeKeys/);
  assert.match(src, /target: '_blank', rel: 'noopener noreferrer'/);
  assert.match(src, /'data-way': 'key'/);
  assert.match(src, /'data-way': 'claude-code'/);
  for (const c of Object.values(START_COMMANDS)) assert.ok(c.length > 5);
  assert.equal(START_COMMANDS.easy, 'npm run start:keys');
  assert.equal(START_COMMANDS.claudeCode, 'npm run start:claude-code');
  assert.match(START_COMMANDS.unix, /^ANTHROPIC_API_KEY="ここに鍵" npm start$/);
  assert.match(START_COMMANDS.windows, /^\$env:ANTHROPIC_API_KEY="ここに鍵"; npm start$/);
  assert.equal(GUIDE_TITLE, '本物の Claude で話すには');
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

/** 実物の index.html の本文(main.js と kioskEarly.js を外した物)。入口は閉じた後の画面を見る */
function realBody() {
  const html = read('index.html');
  return html
    .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
    .replace(/<script type="module" src="\/src\/main\.js"><\/script>/, '')
    .replace(/<script type="module" src="\/src\/stage\/kioskEarly\.js"><\/script>/, '');
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
<link rel="stylesheet" href="/src/ui/themes.css"><link rel="stylesheet" href="/src/ui/style.css"><link rel="stylesheet" href="/src/ui/kiosk.css"></head><body>${realBody()}
<script type="module">
import { mountBrainGuide } from '/src/ui/brainGuide.js';
import { mountTrialMode, trialView } from '/src/ui/trialMode.js';
document.getElementById('gate').classList.add('hidden');
document.getElementById('topMain').hidden = false;
const guide = mountBrainGuide({ root: document.getElementById('brainGuide') });
const trial = mountTrialMode({ banner: document.getElementById('trialBanner'), gateLine: document.getElementById('gateTrial'), kioskStaff: document.getElementById('kioskTrial'), label: document.getElementById('trialLabel'), guide });
window.__set = (brain, notice) => { const n = document.getElementById('brainNotice'); n.hidden = brain !== 'mock'; n.textContent = notice ?? 'おためしモードです(本物の頭脳につながっていません)'; trial.update(trialView({ brain, noticeText: notice ?? null, statusBrain: brain, kiosk: false })); };
window.__ready = true;
</script></body></html>`;

test('画面なしの Chrome(幅 390x844): 鍵が無い時だけ帯が出て、ボタンで案内の窓が開き(2 つの道)、AI の表示と文字の欄に重ならず、公式リンクを新しいタブで開く', { skip: SLOW, timeout: 120_000 }, async (t) => {
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
    const visible = (sel) => page.$eval(sel, (e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);

    await page.evaluate(() => window.__set('haiku'));
    assert.equal(await visible('#trialBanner'), false, '本物の頭脳: 帯は出ない');
    await page.evaluate(() => window.__set('mock', 'おためしモードです(今日の上限に届きました)'));
    assert.equal(await visible('#trialBanner'), false, '理由つきの仮の頭脳: 帯は出ない');
    await page.evaluate(() => window.__set('mock'));
    assert.equal(await visible('#trialBanner'), true, '鍵が無い仮の頭脳: 帯が出る');
    assert.equal((await page.textContent('#trialBanner .tb-btn')).trim(), '本物の Claude にする');
    assert.equal(await visible('#brainGuide'), false, '案内の窓は最初は閉じている');

    await page.click('#trialBanner .tb-btn');
    assert.equal(await visible('#brainGuide'), true);
    assert.equal(await page.getAttribute('#trialBanner .tb-btn', 'aria-expanded'), 'true');
    assert.equal((await page.textContent('#brainGuideTitle')).trim(), GUIDE_TITLE);
    const ways = await page.$$eval('#brainGuidePanel .bg-way', (s) => s.map((e) => ({ way: e.dataset.way, text: e.innerText })));
    assert.deepEqual(ways.map((w) => w.way), ['key', 'claude-code'], '道は 2 つ');
    for (const c of [START_COMMANDS.easy, START_COMMANDS.unix, START_COMMANDS.windows]) assert.ok(ways[0].text.includes(c), c);
    assert.ok(ways[1].text.includes(START_COMMANDS.claudeCode));
    assert.ok(ways[0].text.includes('鍵はファイルに保存されません'));
    const link = await page.$eval('#brainGuidePanel a', (a) => ({ href: a.href, target: a.target, rel: a.rel }));
    assert.deepEqual(link, { href: KEY_LINKS.claudeKeys, target: '_blank', rel: 'noopener noreferrer' });
    const box = async (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
    const panel = await box('#brainGuidePanel');
    assert.ok(panel.x >= 0 && panel.r <= 390 && panel.y >= 0 && panel.b <= 844, `案内が画面に収まる: ${JSON.stringify(panel)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
    assert.ok((await box('.bg-close')).h >= 44, '押す所は 44px 以上');
    // 新しいタブで開く(外へは出さない: 横取りして中身は返さない)
    await ctx.route(/^https:\/\/platform\.claude\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>' }));
    const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#brainGuidePanel a')]);
    assert.equal(new URL(popup.url()).hostname, 'platform.claude.com');
    await popup.close();

    await page.keyboard.press('Escape');
    assert.equal(await visible('#brainGuide'), false, 'Escape で閉じる');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'tb-btn', '閉じたら、押したボタンへ戻る');
    await page.click('#trialBanner .tb-btn');
    await page.click('.bg-close');
    assert.equal(await visible('#brainGuide'), false, '「とじる」で閉じる');
    // 開いたまま本物の頭脳に替わったら、帯も案内も消える
    await page.click('#trialBanner .tb-btn');
    await page.evaluate(() => window.__set('haiku'));
    assert.equal(await visible('#brainGuide'), false);
    assert.equal(await visible('#trialBanner'), false);
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