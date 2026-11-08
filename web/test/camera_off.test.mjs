// 11-08 本人「VR 以外はカメラ機能を外す。次のアップデートで出す」。既定のスイッチ(stage/cameraFeature.js)で、カメラが画面に出ず、開きもしないこと。
// 画面の試験は YC_BROWSER_TESTS=1 のときだけ(組み立てた本物の画面。幅 390x844 と 1280x720)。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { cameraFeatureOn } from '../src/stage/cameraFeature.js';
import { GPU_ARGS } from '../src/stage/gpuGuard.js';

const WEB = join(import.meta.dirname, '..');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const SIZES = [
  { name: 'phone', w: 390, h: 844, touch: true },
  { name: 'pc', w: 1280, h: 720, touch: false },
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('スイッチ: 既定は外す。ヘッドセットと、試験が入れた時だけ入る', () => {
  assert.equal(cameraFeatureOn({ location: { search: '' } }), false);
  assert.equal(cameraFeatureOn({ location: { search: '?camera=1' } }), false, 'URL で入れる口は作らない');
  assert.equal(cameraFeatureOn({ location: { search: '?headset=1' } }), true);
  assert.equal(cameraFeatureOn({ location: { search: '' }, __YC_CAMERA_FEATURE: true }), true);
});

let distPromise = null;
const dist = () => {
  distPromise ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nocam-dist-'));
    const { build } = await import('vite');
    await build({ root: WEB, logLevel: 'silent', build: { outDir: dir, emptyOutDir: true } });
    return dir;
  })();
  return distPromise;
};
let serverProc = null;
after(async () => {
  serverProc?.kill();
  if (distPromise) {
    const dir = await distPromise.catch(() => '');
    if (dir && dir.startsWith(tmpdir()) && /nocam-dist-/.test(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer() {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'nocam-log-')), MEMORY_DIR: mkdtempSync(join(tmpdir(), 'nocam-mem-')) };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE', 'ANTHROPIC_API_URL']) delete env[k];
  serverProc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/status`).then((r) => r.ok, () => false)) return base;
    await sleep(100);
  }
  throw new Error('サーバーが立ちませんでした');
}

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return null;
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  const args = process.env.YC_SOFTWARE_GL === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : GPU_ARGS;
  return chromium.launch({ ...opts, headless: true, args: [...args, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }).catch(() => null);
}

async function open(browser, base, size, query, { feature = false } = {}) {
  const dir = await dist();
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, hasTouch: size.touch, isMobile: size.touch, permissions: ['microphone'] });
  await ctx.route(`${base}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.startsWith('/api/')) return route.continue();
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dir) || !existsSync(file)) return route.continue();
    return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await ctx.addInitScript((on) => {
    if (on) window.__YC_CAMERA_FEATURE = true;
    window.__videoAsks = 0;
    const md = navigator.mediaDevices;
    if (!md) return;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      if (c?.video) window.__videoAsks += 1;
      return real(c);
    };
  }, feature);
  const page = await ctx.newPage();
  await page.goto(`${base}/${query}`);
  return { ctx, page };
}

const ready = (page) => page.waitForFunction(() => { const b = document.getElementById('startSim'); return b && !b.disabled; }, null, { timeout: 90_000 });
const started = (page) => page.waitForFunction(() => window.__app?.source && document.getElementById('gate').classList.contains('hidden'), null, { timeout: 90_000 });

for (const size of SIZES) {
  test(`既定のスイッチ(${size.name}): カメラのボタンも入口の札も出ず、カメラを開かない。入口のボタンは 1 つ`, { skip: SLOW, timeout: 180_000 }, async (t) => {
    const browser = await launch();
    if (!browser) return t.skip('Chrome が無い');
    const base = await startServer().catch((e) => { throw e; });
    const { ctx, page } = await open(browser, base, size, '?auto=0');
    try {
      await ready(page);
      assert.equal(await page.isVisible('#startCam'), false, '入口の「カメラを使って始める」は出さない');
      assert.equal(await page.isVisible('#startSim'), true);
      assert.equal((await page.textContent('#startSim .btn-main')).trim(), 'はじめる');
      assert.doesNotMatch(await page.textContent('#gateFine'), /カメラ/, '入口の注意書きはカメラを言わない');
      await page.click('#startSim');
      await started(page);
      assert.equal(await page.isVisible('#camBtn'), false, '入力の列のカメラのボタンは出さない');
      assert.equal(await page.isVisible('#camAsk'), false);
      assert.equal(await page.evaluate(() => window.__app.camera.plan.show), false);
      assert.equal(await page.evaluate(() => window.__app.dialogue?.getImage?.({}) ?? null), null, '絵を返さない');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('camBtn')).display), 'none', '入力の列(flex)に場所を取らない');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '横に巻かない');
      assert.equal(await page.evaluate(() => window.__videoAsks), 0, 'getUserMedia を video で呼ばない');
      await page.goto(`${base}/?auto=0&autostart=1`);
      await page.waitForFunction(() => window.__app?.source, null, { timeout: 90_000 });
      assert.equal(await page.evaluate(() => window.__app.mode), 'sim', '自動で始める画面もカメラを使わない');
      assert.equal(await page.evaluate(() => window.__videoAsks), 0);
    } finally {
      await ctx.close();
      await browser.close();
      serverProc?.kill();
    }
  });
}

test('スイッチを試験で入れると、入口の札とボタンが戻る(次のアップデートの形)', { skip: SLOW, timeout: 180_000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('Chrome が無い');
  const base = await startServer();
  const { ctx, page } = await open(browser, base, SIZES[1], '?auto=0', { feature: true });
  try {
    await ready(page);
    assert.equal(await page.isVisible('#startCam'), true);
    assert.match(await page.textContent('#gateFine'), /カメラ/);
    await page.click('#startSim');
    await started(page);
    assert.equal(await page.isVisible('#camBtn'), true);
  } finally {
    await ctx.close();
    await browser.close();
    serverProc?.kill();
  }
});
