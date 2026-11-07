// 窓の resize が来ないまま canvas の箱だけが変わっても、描く大きさ(drawing buffer)と画角の縦横(camera.aspect)が箱に合い、
// キャラが細長く・平たくならないことを、本物の GPU の Chrome で確かめる(11/7 本人の iPhone の Chrome で、7 つのステップの札を開いた時に
// ノリーが約 3.8 倍細長く写った。直す前は、横向き 844x390 で起動 → 縦 390x670 で、描く大きさ 1266x585 のまま・縦横の差 3.72 倍だった)。
// 画面は組み立てた本物(vite build を一時フォルダへ。web/dist は触らない)。会話サーバーは鍵なし(仮の頭脳)。
// 窓の resize・visualViewport の resize・orientationchange は、アプリより先に止める(届かない端末のまね)。
// SwiftShader(GPU の無い描画)なら飛ばす。重いので YC_BROWSER_TESTS=1 のときだけ(合わせの門と、画面を直した時に流す)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:net';
import { GPU_ARGS, isSoftwareRenderer } from '../src/stage/gpuGuard.js';

const WEB = join(import.meta.dirname, '..');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';
const BOX_TOL = 0.01; // 描く大きさ・画角の縦横と箱の差(1% 以内)
const SHAPE_TOL = 0.03; // キャラの縦横の比の、PC との差(3% 以内)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.task': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer() {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'size-log-')) };
  delete env.ANTHROPIC_API_KEY; // 本物の頭脳を呼ばない
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
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
    return await chromium.launch({ ...opts, headless: true, args: GPU_ARGS });
  } catch {
    return null;
  }
}

// アプリより先に入れる: 印が立っている間、窓の resize・回転・見える範囲の resize をアプリに届けない
const BLOCKER = () => {
  window.__blockResize = false;
  const stop = (e) => {
    if (window.__blockResize) e.stopImmediatePropagation();
  };
  window.addEventListener('resize', stop, true);
  window.addEventListener('orientationchange', stop, true);
  const vv = window.visualViewport;
  if (vv) {
    const add = vv.addEventListener.bind(vv);
    vv.addEventListener = (type, fn, opts) => add(type, (e) => { if (!(window.__blockResize && type === 'resize')) fn.call(vv, e); }, opts);
  }
};

/** キャラの動き(体・目・口)を止める(同じ形で、PC と箱の変化の後を比べるため) */
const freeze = () => {
  const c = window.__app.character;
  c.update = () => {};
  c.lookAt = () => {};
  c.setMouth = () => {};
};

/** 描く大きさ・箱・画角の縦横と、描いたキャラの縦横の比(不透明な所だけ。床の丸い影は薄いので数えない) */
const measure = () => {
  const st = window.__app.stage;
  const c = st.renderer.domElement;
  const cw = c.clientWidth;
  const ch = c.clientHeight;
  st.render();
  const gl = st.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 160) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const silW = ((maxX - minX + 1) * cw) / W;
  const silH = ((maxY - minY + 1) * ch) / H;
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    // 読めない時は空のまま
  }
  return { box: [cw, ch], buffer: [c.width, c.height], aspect: st.camera.aspect, ratio: maxX >= 0 ? silW / silH : 0, renderer };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 箱との差(1 に近いほどよい) */
function assertMatchesBox(m, what) {
  const boxAspect = m.box[0] / m.box[1];
  const bufAspect = m.buffer[0] / m.buffer[1];
  assert.ok(Math.abs(bufAspect / boxAspect - 1) <= BOX_TOL, `${what}: 描く大きさ ${m.buffer} が箱 ${m.box} の縦横と 1% 以上ちがう(${(bufAspect / boxAspect).toFixed(4)})`);
  assert.ok(Math.abs(m.aspect / boxAspect - 1) <= BOX_TOL, `${what}: 画角の縦横 ${m.aspect.toFixed(4)} が箱 ${boxAspect.toFixed(4)} と 1% 以上ちがう`);
}

test('窓の resize が来ないまま箱が変わっても、描く大きさ・画角の縦横は箱に合い、キャラの縦横は PC の 3% 以内', { skip: SLOW, timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) {
    t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    return;
  }
  const dist = mkdtempSync(join(tmpdir(), 'size-dist-'));
  let server = null;
  try {
    const { build } = await import('vite');
    await build({ root: WEB, logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } });
    server = await startServer();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(BLOCKER);
    // 画面は一時フォルダの組み立てから配る(API とキャラのデータはサーバーへ)
    await ctx.route(`${server.base}/**`, async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.startsWith('/api/')) return route.continue();
      const file = normalize(join(dist, path === '/' ? 'index.html' : path));
      if (!file.startsWith(dist) || !existsSync(file)) return route.continue();
      return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.base}/`);
    await page.waitForFunction(() => { const b = document.getElementById('startSim'); return b && !b.disabled; }, null, { timeout: 60_000 });
    await page.evaluate(() => document.getElementById('startSim').click());
    await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 30_000 });
    await sleep(1500);
    // 7 つのステップの札は閉じておく(PC では札が右に立ち、舞台の幅が変わるので、比べる元は札なしにする)
    await page.evaluate(() => [...document.querySelectorAll('.fr-sheet button')].find((b) => /あとで/.test(b.textContent || ''))?.click());
    await sleep(800);
    await page.evaluate(freeze);
    await sleep(300);
    const pc = await page.evaluate(measure);
    if (isSoftwareRenderer(pc.renderer)) {
      t.skip(`描画役が SwiftShader(${pc.renderer})。本物の GPU で流す`);
      return;
    }
    assertMatchesBox(pc, 'PC 1280x720');
    assert.ok(pc.ratio > 0.2, `PC でキャラが描けていない(縦横 ${pc.ratio})`);

    // ここから、窓の resize はアプリに届かない
    await page.evaluate(() => { window.__blockResize = true; });
    const steps = [
      ['縦 390x670', () => page.setViewportSize({ width: 390, height: 670 })],
      ['横 670x390(回転)', () => page.setViewportSize({ width: 670, height: 390 })],
      ['縦 390x844', () => page.setViewportSize({ width: 390, height: 844 })],
      // 窓は同じで、箱だけが変わる(PC の札で舞台の幅を変える時と同じ形)
      ['箱だけ 幅 60%', () => page.addStyleTag({ content: '#stage { width: 60% !important; }' })],
    ];
    for (const [what, change] of steps) {
      await change();
      await sleep(600);
      const m = await page.evaluate(measure);
      assertMatchesBox(m, what);
      assert.ok(Math.abs(m.ratio / pc.ratio - 1) <= SHAPE_TOL, `${what}: キャラの縦横 ${m.ratio.toFixed(4)} が PC ${pc.ratio.toFixed(4)} と 3% 以上ちがう(細長い・平たい)`);
    }
    assert.deepEqual(errors, [], `ページのエラー: ${errors.join(' / ')}`);
    await ctx.close();
  } finally {
    await browser.close();
    server?.proc.kill();
    // 消すのは、この試験が作った一時フォルダだけ(名前と場所を確かめてから)
    if (dist.startsWith(tmpdir()) && /size-dist-/.test(dist)) rmSync(dist, { recursive: true, force: true });
  }
});
