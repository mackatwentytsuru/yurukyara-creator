// おためしモード(鍵も Claude Code も無く、決まった台本で話す間)の見せ方を、組み立てた本物の画面で確かめる。幅 390x844(スマホ)と 1280x720(PC)。
// 見る物:
//  ・鍵なし: 入口の始めるボタンの下に 1 行 → 始めると上に帯(決まった文・ボタン・スマホで 2 行まで)→ ボタンで案内の窓(2 つの道)
//    帯があっても、AI の表示・文字の欄・送るボタンは見えて押せる。キャラの頭は帯の下。話しかけても帯は残る
//  ・鍵あり(偽の鍵・本物の所へは出さない): 入口の 1 行も帯も札も出ない
//  ・接客モード・鍵なし: 入口に店の人への知らせ(案内のボタンなし)、動いている間は来場者に見える札(案内のボタンなし)
//  ・接客モード・鍵あり: 何も出ない
// 会話サーバーは手元で起こす(鍵なし / 偽の鍵。偽の鍵の行き先は閉じた手元の口にして、外へは何も送らない)。画面は vite build を一時フォルダへ(web/dist は触らない)。
// ポートは 9470〜9479 から選ぶ。GPU の Chrome(GPU_ARGS)で流す。重いので YC_BROWSER_TESTS=1 のときだけ。KY3_SHOTS_DIR を渡すと写真を残す。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { GPU_ARGS } from '../src/stage/gpuGuard.js';
import { TRIAL_BANNER_BUTTON, TRIAL_BANNER_TEXT, TRIAL_GATE_LINE, TRIAL_KIOSK_LABEL, TRIAL_KIOSK_STAFF_LINE } from '../src/ui/trialMode.js';
import { START_COMMANDS } from '../src/ui/keyLinks.js';

const WEB = join(import.meta.dirname, '..');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const SHOTS = process.env.KY3_SHOTS_DIR || '';
const SIZES = [
  { name: 'phone_390x844', w: 390, h: 844, touch: true },
  { name: 'pc_1280x720', w: 1280, h: 720, touch: false },
];
const FAKE_KEY = 'fake-key-for-test'; // 本物の形ではない。行き先は閉じた手元の口
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.task': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const usedPorts = new Set();
const pickPort = async () => {
  for (let p = 9470; p <= 9479; p++) {
    if (usedPorts.has(p)) continue;
    const free = await new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error('9470〜9479 に空きがありません');
};

let distPromise = null;
const dist = () => {
  distPromise ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ky3-dist-'));
    const { build } = await import('vite');
    await build({ root: WEB, logLevel: 'silent', build: { outDir: dir, emptyOutDir: true } });
    return dir;
  })();
  return distPromise;
};
const servers = [];
after(async () => {
  for (const s of servers) s.proc.kill();
  if (distPromise) {
    const dir = await distPromise.catch(() => '');
    if (dir && dir.startsWith(tmpdir()) && /ky3-dist-/.test(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

async function startServer({ key }) {
  const port = await pickPort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'ky3-log-')), MEMORY_DIR: mkdtempSync(join(tmpdir(), 'ky3-mem-')) };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE', 'ANTHROPIC_API_URL']) delete env[k];
  if (key) {
    env.ANTHROPIC_API_KEY = FAKE_KEY;
    env.ANTHROPIC_API_URL = 'http://127.0.0.1:9/v1/messages'; // 閉じた口。外へは送らない
  }
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  const server = { proc, base };
  servers.push(server);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return server;
    } catch {
      // まだ立っていない
    }
    await sleep(100);
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

async function findChrome() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return null;
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  try {
    return await chromium.launch({ ...opts, headless: true, args: [...GPU_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  } catch {
    return null;
  }
}

async function openApp(browser, server, size, query = '') {
  const dir = await dist();
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, hasTouch: size.touch, isMobile: size.touch, permissions: ['microphone'] });
  await ctx.route(`${server.base}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.startsWith('/api/')) return route.continue();
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dir) || !existsSync(file)) return route.continue();
    return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.base}/${query}`);
  return { ctx, page, errors };
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

/** 見えているか(hidden の中・display:none・大きさ 0 は見えない) */
const shown = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return !el.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, sel);
const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; });
const disjoint = (a, b) => a.b <= b.y + 0.5 || b.b <= a.y + 0.5 || a.r <= b.x + 0.5 || b.r <= a.x + 0.5;
/** 中心を押すと、その物に当たるか(ほかの物に覆われていない) */
const hits = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(top && (el === top || el.contains(top) || top.contains(el)));
  }, sel);

/** 描いたキャラの、いちばん上といちばん下(画面の上からの px)。不透明な所だけ */
const SILHOUETTE = () => {
  const st = window.__app.stage;
  const c = st.renderer.domElement;
  st.render();
  const gl = st.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let minY = H;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      if (px[(y * W + x) * 4 + 3] > 160) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  const r = c.getBoundingClientRect();
  return maxY < 0 ? null : { top: r.top + ((H - 1 - maxY) * r.height) / H, bottom: r.top + ((H - 1 - minY) * r.height) / H };
};

/** 入口を通って始める。始めるボタンを押し、はじめての会話の札は「あとで」で閉じる */
async function start(page, button = 'startSim') {
  await page.waitForFunction((id) => { const b = document.getElementById(id); return b && !b.disabled; }, button, { timeout: 90_000 });
  await page.evaluate((id) => document.getElementById(id).click(), button);
  await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null && document.getElementById('gate').classList.contains('hidden'), null, { timeout: 60_000 });
  await sleep(1200);
  await page.evaluate(() => [...document.querySelectorAll('.fr-sheet button')].find((b) => /あとで/.test(b.textContent || ''))?.click());
  await sleep(900);
}

for (const size of SIZES) {
  test(`おためしモード(${size.name}・鍵なし): 入口に 1 行 → 始めると帯 → ボタンで案内。AI の表示・文字の欄・キャラの頭は帯に隠れない`, { skip: SLOW, timeout: 240_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    const server = await startServer({ key: false });
    const { ctx, page, errors } = await openApp(browser, server, size, '?auto=0');
    try {
      // 入口: 始めるボタンの下に 1 行。帯はまだ(入口が開いている間は上の段が隠れる)
      await page.waitForFunction(() => { const b = document.getElementById('startCam'); return b && !b.disabled; }, null, { timeout: 90_000 });
      assert.equal(await shown(page, '#gateTrial'), true, '入口の 1 行が見えない');
      assert.equal((await page.textContent('#gateTrial')).trim(), TRIAL_GATE_LINE);
      const cam = await rect(page, '#startCam');
      const line = await rect(page, '#gateTrial');
      assert.ok(line.y >= cam.b - 0.5, `1 行は始めるボタンの下: ボタンの下 ${cam.b} / 1 行の上 ${line.y}`);
      assert.ok(line.x >= 0 && line.r <= size.w, '入口の 1 行が画面に収まる');
      assert.equal(await shown(page, '#trialBanner'), false, '入口が開いている間は帯を見せない');
      assert.equal(await shown(page, '#kioskTrial'), false);
      await shot(page, `trial_${size.name}_gate`);

      await start(page);
      // 帯
      assert.equal(await shown(page, '#trialBanner'), true, '帯が出ない');
      const text = await page.$eval('#trialBanner .tb-text', (p) => [...p.childNodes].filter((n) => n.nodeName !== 'BUTTON').map((n) => n.textContent).join(''));
      assert.equal(text, TRIAL_BANNER_TEXT);
      assert.equal((await page.textContent('#trialBanner .tb-btn')).trim(), TRIAL_BANNER_BUTTON);
      const banner = await rect(page, '#trialBanner');
      const btn = await rect(page, '#trialBanner .tb-btn');
      assert.ok(banner.x >= 0 && banner.r <= size.w && banner.y >= 0, `帯が画面に収まる: ${JSON.stringify(banner)}`);
      assert.ok(btn.h >= 40, `ボタンは 40px 以上: ${btn.h}`);
      const rows = await page.$eval('#trialBanner .tb-text', (p) => {
        const r = document.createRange();
        const kids = [...p.childNodes].filter((n) => n.nodeName !== 'BUTTON');
        r.setStartBefore(kids[0]);
        r.setEndAfter(kids[kids.length - 1]);
        return new Set([...r.getClientRects()].map((q) => Math.round(q.top / 4))).size;
      });
      assert.ok(rows <= 2, `文が ${rows} 行(2 行まで)`);
      assert.ok(btn.y < banner.b && btn.b <= banner.b + 0.5, 'ボタンも帯の中');
      assert.ok(banner.h <= (size.touch ? 84 : 60), `帯の高さ ${banner.h}px(スマホは 2 行+ボタン、PC は 1 行)`);
      if (size.touch) assert.ok(rows === 2 || banner.h <= 84);
      // 黄色の知らせは帯が言うので畳む
      assert.equal(await shown(page, '#brainNotice'), false, '同じことを 2 か所で言わない');
      // AI の表示・文字の欄・送るボタンは見えて、帯と重ならず、押せる
      for (const sel of ['#aiNotice', '#textInput', '.composer .send']) {
        assert.equal(await shown(page, sel), true, `${sel} が見えない`);
        assert.ok(disjoint(banner, await rect(page, sel)), `帯が ${sel} に重なっている`);
        if (sel !== '#aiNotice') assert.equal(await hits(page, sel), true, `${sel} がほかの物に覆われている`); // AI の表示は押さない物(pointer-events なし)。重なりは四角で見る
      }
      assert.equal(await hits(page, '#trialBanner .tb-btn'), true, '帯のボタンが覆われている');
      // キャラの頭は帯の下
      const sil = await page.evaluate(SILHOUETTE);
      assert.ok(sil, 'キャラが描けていない');
      assert.ok(sil.top >= banner.b - 2, `キャラの頭 ${sil.top.toFixed(1)} が帯の下 ${banner.b.toFixed(1)} に入っている`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
      await shot(page, `trial_${size.name}_banner`);

      // 話しかけても帯は残り、見えている物は見えたまま
      await page.fill('#textInput', 'こんにちは');
      await page.click('.composer .send');
      await page.waitForFunction(() => { const c = document.getElementById('caption'); return c && !c.hidden && c.textContent.trim().length > 0; }, null, { timeout: 30_000 });
      assert.equal(await shown(page, '#trialBanner'), true, '話した後に帯が消えた');
      for (const sel of ['#aiNotice', '#textInput', '.composer .send']) assert.equal(await shown(page, sel), true, `話した後に ${sel} が見えない`);
      assert.ok(disjoint(await rect(page, '#trialBanner'), await rect(page, '#aiNotice')));

      // ボタンで案内の窓(2 つの道)。閉じると帯のボタンへ戻る
      await page.click('#trialBanner .tb-btn');
      assert.equal(await shown(page, '#brainGuide'), true);
      assert.deepEqual(await page.$$eval('#brainGuidePanel .bg-way', (s) => s.map((e) => e.dataset.way)), ['key', 'claude-code']);
      const panelText = await page.$eval('#brainGuidePanel', (e) => e.innerText);
      assert.ok(panelText.includes(START_COMMANDS.easy) && panelText.includes(START_COMMANDS.claudeCode));
      const panel = await rect(page, '#brainGuidePanel');
      assert.ok(panel.x >= 0 && panel.r <= size.w && panel.y >= 0 && panel.b <= size.h, `案内の窓が画面に収まる: ${JSON.stringify(panel)}`);
      await shot(page, `trial_${size.name}_guide`);
      await page.keyboard.press('Escape');
      assert.equal(await shown(page, '#brainGuide'), false);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test(`おためしモード(${size.name}・鍵あり): 入口の 1 行も、帯も、接客の札も出ない`, { skip: SLOW, timeout: 240_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    const server = await startServer({ key: true });
    assert.equal((await (await fetch(`${server.base}/api/status`)).json()).brain, 'haiku');
    const { ctx, page, errors } = await openApp(browser, server, size, '?auto=0');
    try {
      await page.waitForFunction(() => { const b = document.getElementById('startCam'); return b && !b.disabled; }, null, { timeout: 90_000 });
      assert.equal(await shown(page, '#gateTrial'), false, '鍵ありで入口の 1 行が出ている');
      await start(page);
      await sleep(1200); // 見張りが何度か回る
      for (const sel of ['#trialBanner', '#trialLabel', '#brainGuide', '#kioskTrial', '#gateTrial', '#trialBanner .tb-btn']) assert.equal(await shown(page, sel), false, `${sel} が出ている`);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('trial-banner-on')), false);
      for (const sel of ['#aiNotice', '#textInput', '.composer .send']) assert.equal(await shown(page, sel), true, `${sel} が見えない`);
      await shot(page, `trial_${size.name}_withkey`);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test(`おためしモード(${size.name}・接客・鍵なし): 入口に店の人への知らせ、動いている間は来場者に見える札。どちらも案内のボタンなし`, { skip: SLOW, timeout: 240_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    const server = await startServer({ key: false });
    const { ctx, page, errors } = await openApp(browser, server, size, '?kiosk=ky3test&auto=0');
    try {
      await page.waitForFunction(() => { const b = document.getElementById('kioskStart'); return b && !b.disabled; }, null, { timeout: 90_000 });
      // 接客の入口(店の人が見る)
      assert.equal(await shown(page, '#kioskTrial'), true, '店の人への知らせが無い');
      assert.equal((await page.textContent('#kioskTrial')).trim(), TRIAL_KIOSK_STAFF_LINE);
      assert.equal(await shown(page, '#kioskStart'), true);
      const staff = await rect(page, '#kioskTrial');
      assert.ok(staff.x >= 0 && staff.r <= size.w, '知らせが画面に収まる');
      assert.ok(staff.b <= (await rect(page, '#kioskStart')).y + 0.5, '知らせは はじめるボタンの上');
      for (const sel of ['#gateTrial', '#trialBanner', '#trialBanner .tb-btn', '#brainGuide', '#kioskTrial button', '#kioskTrial a']) assert.equal(await shown(page, sel), false, `接客の入口に ${sel} が出ている`);
      await shot(page, `trial_${size.name}_kiosk_gate`);

      await start(page, 'kioskStart');
      // 接客が動いている間: 来場者に見える札
      await page.waitForFunction(() => { const l = document.getElementById('trialLabel'); return l && !l.hidden; }, null, { timeout: 15_000 });
      assert.equal(await shown(page, '#trialLabel'), true, '来場者の札が見えない');
      assert.equal((await page.textContent('#trialLabel')).trim(), TRIAL_KIOSK_LABEL);
      const label = await rect(page, '#trialLabel');
      const ai = await rect(page, '#aiNotice');
      assert.ok(label.x >= 0 && label.r <= size.w && label.y >= 0 && label.b <= size.h, `札が画面に収まる: ${JSON.stringify(label)}`);
      assert.ok(disjoint(label, ai), '札が AI の表示に重なっている');
      assert.ok(label.b <= ai.y + 1, '札は AI の表示のすぐ上');
      for (const sel of ['#trialBanner', '#trialBanner .tb-btn', '#brainGuide', '#trialLabel button', '#trialLabel a', '#kioskTrial']) assert.equal(await shown(page, sel), false, `接客の画面に ${sel} が出ている`);
      for (const sel of ['#aiNotice', '#textInput', '.composer .send', '#micBtn']) {
        assert.equal(await shown(page, sel), true, `${sel} が見えない`);
        if (sel !== '#aiNotice') assert.equal(await hits(page, sel), true, `${sel} がほかの物に覆われている`);
        assert.ok(disjoint(label, await rect(page, sel)), `札が ${sel} に重なっている`);
      }
      const sil = await page.evaluate(SILHOUETTE);
      assert.ok(sil, 'キャラが描けていない');
      assert.ok(label.y >= sil.top + 0.5 * (sil.bottom - sil.top), `札がキャラの顔(上半分)にかかっている: 札の上 ${label.y.toFixed(1)} / キャラ ${sil.top.toFixed(1)}〜${sil.bottom.toFixed(1)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
      await shot(page, `trial_${size.name}_kiosk_run`);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test(`おためしモード(${size.name}・接客・鍵あり): 入口の知らせも札も出ない`, { skip: SLOW, timeout: 240_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    const server = await startServer({ key: true });
    const { ctx, page, errors } = await openApp(browser, server, size, '?kiosk=ky3test&auto=0');
    try {
      await page.waitForFunction(() => { const b = document.getElementById('kioskStart'); return b && !b.disabled; }, null, { timeout: 90_000 });
      assert.equal(await shown(page, '#kioskTrial'), false, '鍵ありなのに入口に知らせが出ている');
      await start(page, 'kioskStart');
      await sleep(1200);
      for (const sel of ['#trialLabel', '#trialBanner', '#kioskTrial', '#brainGuide']) assert.equal(await shown(page, sel), false, `${sel} が出ている`);
      for (const sel of ['#aiNotice', '#textInput', '.composer .send']) assert.equal(await shown(page, sel), true, `${sel} が見えない`);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });
}
