// しつかん(3D の材質)の切り替えを、本物の GPU の Chrome で確かめる(B5M)。決まりの試験は shitsukan.test.mjs。
//  1. 既定は ぬの(どの端末でも)。体の部品が布の材質になり、輪郭の殻は隠れ、足元の影が出る
//  2. 上の段の「しつかん」を押すと札が開き、キャラは札の下(重ならない)。つるつる・いつもの・け を押すとすぐ替わり、このブラウザで覚える
//  3. いつもの は読み込んだままの材質(同じ物)で、ぬの → いつもの と戻すと 1 画素も変わらない
//  4. 端末の段(PC・スマホ・弱い端末・ヘッドセット)を替えても、同じ大きさの画面なら同じ絵(段で見た目を変えない)
//  5. character.json の looks.3d.material が既定になる。2D の時は しつかん を出さない。スマホでは毛に「おもいよ」
// 画面は組み立てた本物(vite build を一時フォルダへ。web/dist は触らない)。会話サーバーは鍵なし(仮の頭脳)。SwiftShader(GPU の無い描画)なら飛ばす。
// 重いので YC_BROWSER_TESTS=1 のときだけ(合わせの門と、画面を直した時に流す)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:net';
import { GPU_ARGS, isSoftwareRenderer } from '../src/stage/gpuGuard.js';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '..');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.task': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'sk-log-')) };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ページの中: 今の しつかん・材質の様子・輪郭・毛の殻・足元の影・描画役 */
const STATE = () => {
  const app = window.__app;
  const c = app.character;
  const st = app.shitsukan.look.stateOf(c);
  const body = st ? st.entries.filter((e) => e.kind === 'body') : [];
  const outline = st ? st.entries.filter((e) => e.kind === 'outline') : [];
  let shells = 0;
  c.object3d.traverse((o) => {
    if (o.isMesh && /_fur\d+$/.test(o.name) && o.visible) shells++;
  });
  const m = body[0]?.mesh.material;
  let renderer = '';
  try {
    const gl = app.stage.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    // 読めない時は空のまま
  }
  return {
    current: app.shitsukan.current(),
    tier: app.tier?.name,
    look: c.look,
    bodyCount: body.length,
    bodyOriginal: body.filter((e) => e.mesh.material === e.original).length,
    bodyPhysical: body.filter((e) => e.mesh.material?.isMeshPhysicalMaterial && e.mesh.material.userData.ycShitsukan).length,
    plainNormals: body.filter((e) => !e.mesh.geometry.userData.ycNormals || e.mesh.geometry.attributes.normal === e.mesh.geometry.userData.ycNormals.plain).length,
    outlineShown: outline.filter((e) => e.mesh.visible).length,
    outlineCount: outline.length,
    shells,
    contact: app.stage.scene.children.some((o) => o.name === 'yc_contact_shadow'),
    sample: m ? { roughness: m.roughness, sheen: m.sheen ?? 0, clearcoat: m.clearcoat ?? 0, env: m.envMapIntensity ?? 0, specular: m.specularIntensity ?? 0 } : null,
    exposure: app.shitsukan.look.uniforms().ycExposure.value,
    switchShown: !document.getElementById('shitsukan')?.hidden,
    stored: (() => {
      try {
        return JSON.parse(localStorage.getItem('yc.shitsukan.v1') ?? 'null');
      } catch {
        return null;
      }
    })(),
    renderer,
  };
};

/** キャラの動き・目・口を止め、動きの最初の形にそろえる(別のページ・別の しつかん で同じ形をくらべるため) */
const FREEZE = () => {
  const c = window.__app.character;
  c.update = () => {};
  c.lookAt = () => {};
  c.setMouth = () => {};
  if (c.lookBone && c.lookRest) c.lookBone.quaternion.copy(c.lookRest);
  c.mixer?.setTime(0);
  for (const b of c.eyeBones ?? []) b.quaternion.copy(c.eyeRest.get(b));
  for (const m of c.morphMeshes ?? []) m.morphTargetInfluences?.fill(0);
};

/** 今の絵の画素(描く輪を止めて描き、そのまま読む) */
const PIXELS = () => {
  const st = window.__app.stage;
  st.renderer.setAnimationLoop(null);
  st.render();
  const gl = st.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { W, H, data: Array.from(px) };
};

/** キャラの画面の箱(止まった形の箱の 8 つの角を画面へ。CSS の px)と、開いた札の箱 */
const RECTS = () => {
  const app = window.__app;
  const THREE = app.THREE;
  const c = app.character;
  c.object3d.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(c.object3d);
  const cam = app.stage.camera;
  cam.updateMatrixWorld(true);
  let l = Infinity;
  let r = -Infinity;
  let t = Infinity;
  let b = -Infinity;
  const v = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    v.set(x, y, z).project(cam);
    l = Math.min(l, ((v.x + 1) / 2) * innerWidth);
    r = Math.max(r, ((v.x + 1) / 2) * innerWidth);
    t = Math.min(t, ((1 - v.y) / 2) * innerHeight);
    b = Math.max(b, ((1 - v.y) / 2) * innerHeight);
  }
  const el = document.getElementById('shitsukanList');
  const q = el?.getBoundingClientRect();
  return { char: { l, r, t, b }, list: q && q.height > 0 ? { l: q.left, r: q.right, t: q.top, b: q.bottom } : null, vw: innerWidth };
};

function diff(a, b) {
  assert.equal(a.data.length, b.data.length, '絵の大きさが違う');
  let sum = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    sum += d;
    hist[d]++;
  }
  const n = a.data.length / 4;
  let acc = 0;
  let p99 = 0;
  for (let d = 0; d < 256; d++) {
    acc += hist[d];
    if (acc >= n * 0.99) {
      p99 = d;
      break;
    }
  }
  return { mean: sum / n, p99 };
}

test('しつかん: 既定は ぬの・押すとすぐ替わり覚える・いつもの は元のまま・段で見た目を変えない・設計図の既定・2D とスマホ', { skip: SLOW, timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) {
    t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    return;
  }
  const dist = mkdtempSync(join(tmpdir(), 'sk-dist-'));
  let server = null;
  try {
    const { build } = await import('vite');
    await build({ root: WEB, logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } });
    server = await startServer();
    /** 画面は一時フォルダの組み立てから配る(API とキャラのデータはサーバーへ)。jsonPatch があれば ノリー の character.json に足す */
    const open = async (spec, query = '', jsonPatch = null) => {
      const ctx = await browser.newContext(spec);
      await ctx.route(`${server.base}/**`, async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname);
        if (path.startsWith('/api/')) return route.continue();
        if (jsonPatch && path === '/characters/norrie/character.json') {
          const json = JSON.parse(readFileSync(join(REPO, 'characters', 'norrie', 'character.json'), 'utf8'));
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jsonPatch(json)) });
        }
        const file = normalize(join(dist, path === '/' ? 'index.html' : path));
        if (!file.startsWith(dist) || !existsSync(file)) return route.continue();
        return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(file) });
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const go = async (q = query) => {
        await page.goto(`${server.base}/?character=norrie&auto=0${q}`);
        await page.waitForFunction(() => { const b = document.getElementById('startSim'); return b && !b.disabled; }, null, { timeout: 60_000 });
        await page.evaluate(() => document.getElementById('startSim').click());
        await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null && window.__app.shitsukan?.current?.(), null, { timeout: 30_000 });
        await sleep(600);
      };
      await go();
      return { ctx, page, errors, go };
    };
    const pick = async (page, id) => {
      const compact = await page.evaluate(() => getComputedStyle(document.getElementById('shitsukanOpen')).display !== 'none');
      if (compact) await page.click('#shitsukanOpen');
      await page.click(`#shitsukanList button[data-shitsukan="${id}"]`);
      await page.waitForFunction((want) => window.__app.shitsukan.current() === want, id, { timeout: 20_000 });
      await sleep(150);
    };

    // ---- PC 1280x720 ----
    const pc = await open({ viewport: { width: 1280, height: 720 } });
    let s = await pc.page.evaluate(STATE);
    if (isSoftwareRenderer(s.renderer)) {
      t.skip(`描画役が SwiftShader(${s.renderer})。本物の GPU で流す`);
      return;
    }
    // 1. 既定は ぬの
    assert.equal(s.current, 'fabric', '既定は ぬの');
    assert.ok(s.bodyCount > 5 && s.bodyPhysical === s.bodyCount, `体の部品が全部 布の材質(${s.bodyPhysical}/${s.bodyCount})`);
    assert.ok(s.sample.sheen > 0 && s.sample.roughness === 1, '布: 布のつや と 粗さの絵');
    assert.equal(s.outlineShown, 0, '輪郭の殻は隠す');
    assert.ok(s.outlineCount > 0, 'ノリー には輪郭の殻がある(隠す物がある)');
    assert.equal(s.contact, true, '足元の影');
    assert.equal(s.plainNormals, 0, '布ではならした法線');
    assert.equal(s.switchShown, true, '3D の時は しつかん を出す');
    // 2. 札を開くと、キャラの箱と重ならない(重なる時はキャラが札の下へ)
    await pc.page.click('#shitsukanOpen');
    await sleep(400);
    let rc = await pc.page.evaluate(RECTS);
    assert.ok(rc.list, 'PC 1280 では押すと札が開く');
    const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    assert.ok(!overlaps(rc.list, rc.char), `札がキャラに重なる: 札 ${JSON.stringify(rc.list)} キャラ ${JSON.stringify(rc.char)}`);
    assert.ok(rc.list.l >= 0 && rc.list.r <= rc.vw, '札は画面の中');
    await pc.page.keyboard.press('Escape');
    // つるつる → いつもの(すぐ替わる・覚える)
    await pick(pc.page, 'vinyl');
    s = await pc.page.evaluate(STATE);
    assert.equal(s.current, 'vinyl');
    assert.ok(s.sample.clearcoat === 1 && s.sample.sheen === 0, 'つるつる: 上塗りのつや');
    assert.deepEqual(s.stored, { norrie: 'vinyl' }, 'このブラウザで覚える');
    // 3. いつもの は元の材質そのもので、ぬの → いつもの と戻すと 1 画素も変わらない
    await pick(pc.page, 'drawn');
    s = await pc.page.evaluate(STATE);
    assert.equal(s.current, 'drawn');
    assert.equal(s.bodyOriginal, s.bodyCount, 'いつもの: 読み込んだままの材質');
    assert.equal(s.outlineShown, s.outlineCount, 'いつもの: 輪郭の殻を出す');
    assert.equal(s.plainNormals, s.bodyCount, 'いつもの: 元の法線');
    assert.equal(s.contact, false, 'いつもの: 足元の影なし');
    await pc.page.evaluate(FREEZE);
    const drawnA = await pc.page.evaluate(PIXELS);
    await pc.page.evaluate(() => window.__app.shitsukan.look.apply(window.__app.character, 'fabric'));
    const fabricPx = await pc.page.evaluate(PIXELS);
    await pc.page.evaluate(() => window.__app.shitsukan.look.apply(window.__app.character, 'drawn'));
    const drawnB = await pc.page.evaluate(PIXELS);
    const same = diff(drawnA, drawnB);
    assert.equal(same.mean, 0, `いつもの → ぬの → いつもの で絵が変わった(平均の差 ${same.mean})`);
    assert.ok(diff(drawnA, fabricPx).mean > 0.3, 'ぬの は いつもの と違う絵');
    // 読み込み直しても いつもの(覚えた物)。毛 → ぬの
    await pc.go();
    s = await pc.page.evaluate(STATE);
    assert.equal(s.current, 'drawn', '読み込み直しても、このブラウザで選んだ物');
    await pick(pc.page, 'fur');
    s = await pc.page.evaluate(STATE);
    assert.equal(s.current, 'fur');
    assert.ok(s.shells > 0, '毛の殻が出る');
    const furShells = s.shells;
    await pick(pc.page, 'fabric');
    s = await pc.page.evaluate(STATE);
    assert.equal(s.shells, 0, 'ぬの に戻すと毛の殻を隠す');
    assert.deepEqual(s.stored, { norrie: 'fabric' });
    // 5. 2D の時は出さない。3D に戻すと、前と同じ絵(舞台から外れた子の後片づけで、共有の部屋の光や毛羽の絵を捨てられても困らない)
    await pc.page.evaluate(FREEZE);
    const before2d = await pc.page.evaluate(PIXELS); // ここから描く輪は止まる(次の描きは PIXELS で)
    await pc.page.click('#lookSwitch button[data-look="2d"]');
    await pc.page.waitForFunction(() => window.__app.character.look === '2d', null, { timeout: 30_000 });
    await pc.page.evaluate(PIXELS);
    s = await pc.page.evaluate(STATE);
    assert.equal(s.switchShown, false, '2D の時は しつかん を出さない');
    assert.equal(s.contact, false, '2D の時は足元の影なし');
    await pc.page.click('#lookSwitch button[data-look="3d"]');
    await pc.page.waitForFunction(() => window.__app.character.look === '3d', null, { timeout: 30_000 });
    const after2d = await pc.page.evaluate(PIXELS);
    s = await pc.page.evaluate(STATE);
    assert.equal(s.switchShown, true);
    assert.equal(s.current, 'fabric', '3D に戻すと選んだ物');
    const back = diff(before2d, after2d);
    assert.ok(back.mean < 0.5, `3D に戻した後の絵が前と違う(平均の差 ${back.mean.toFixed(3)}。部屋の光や毛羽の絵が消えた?)`);
    assert.deepEqual(pc.errors, [], `ページのエラー: ${pc.errors.join(' / ')}`);
    await pc.ctx.close();

    // ---- 4. 段で見た目を変えない(同じ 390x844・密度 1 なら、描く倍率はどの段も 1。絵が同じ) ----
    const pics = {};
    let furCounts = new Set();
    for (const tier of ['high', 'mid', 'low', 'xr']) {
      const tp = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }, `&tier=${tier}`);
      const ts = await tp.page.evaluate(STATE);
      assert.equal(ts.tier, tier);
      assert.equal(ts.current, 'fabric', `段 ${tier} でも既定は ぬの`);
      assert.deepEqual({ ...ts.sample, exposure: ts.exposure }, { ...s.sample, exposure: s.exposure }, `段 ${tier} の材質の数字が PC と同じ`);
      await tp.page.evaluate(FREEZE);
      pics[tier] = await tp.page.evaluate(PIXELS);
      // 毛の層の数も段で変えない
      await tp.page.evaluate(() => window.__app.shitsukan.look.apply(window.__app.character, 'fur'));
      await tp.page.waitForFunction(() => window.__app.shitsukan.look.stateOf(window.__app.character)?.fur?.ready, null, { timeout: 20_000 });
      await tp.page.evaluate(() => window.__app.shitsukan.look.apply(window.__app.character, 'fur'));
      const fs = await tp.page.evaluate(STATE);
      furCounts.add(fs.shells);
      assert.deepEqual(tp.errors, [], `段 ${tier} のページのエラー: ${tp.errors.join(' / ')}`);
      await tp.ctx.close();
    }
    for (const tier of ['mid', 'low', 'xr']) {
      const d = diff(pics.high, pics[tier]);
      assert.ok(d.mean < 0.5 && d.p99 <= 8, `段 high と ${tier} の絵の差 平均 ${d.mean.toFixed(3)}・99% ${d.p99}`);
    }
    assert.deepEqual([...furCounts], [furShells], `毛の殻の数が段で変わった: ${[...furCounts]}`);

    // ---- 5. character.json の looks.3d.material が既定。スマホ 390x844 では札が画面の中・毛に「おもいよ」 ----
    const ph = await open(
      { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE },
      '',
      (json) => ({ ...json, looks: { ...(json.looks ?? {}), '3d': { ...(json.looks?.['3d'] ?? {}), material: 'つるつる' } } }),
    );
    s = await ph.page.evaluate(STATE);
    assert.equal(s.current, 'vinyl', 'character.json の looks.3d.material(日本語でも)が既定');
    assert.equal(s.tier, 'mid');
    await ph.page.click('#shitsukanOpen');
    await sleep(400);
    rc = await ph.page.evaluate(RECTS);
    assert.ok(rc.list && rc.list.l >= 0 && rc.list.r <= rc.vw, `スマホの札は画面の中: ${JSON.stringify(rc.list)}`);
    assert.ok(!overlaps(rc.list, rc.char), `スマホの札がキャラに重なる: 札 ${JSON.stringify(rc.list)} キャラ ${JSON.stringify(rc.char)}`);
    const furSub = await ph.page.evaluate(() => document.querySelector('#shitsukanList button[data-shitsukan="fur"] .sk-sub')?.textContent);
    assert.equal(furSub, 'おもいよ', 'スマホでは毛に「おもいよ」');
    const top = await ph.page.evaluate(() => [...document.querySelectorAll('#shitsukanList button')].map((b) => b.getBoundingClientRect().height));
    assert.ok(top.every((h) => h >= 44), `押す所は 44px 以上: ${top}`);
    await ph.page.keyboard.press('Escape');
    // 「しつかん」のボタンで、スマホの上の段の行を増やさない(390x844 と 390x670。出す・隠すで上の段の高さが同じ)
    for (const size of [{ width: 390, height: 844 }, { width: 390, height: 670 }]) {
      await ph.page.setViewportSize(size);
      await sleep(500);
      const h = await ph.page.evaluate(() => {
        const bar = document.querySelector('.top');
        const box = document.getElementById('shitsukan');
        const shown = bar.getBoundingClientRect().height;
        box.style.display = 'none';
        const hidden = bar.getBoundingClientRect().height;
        box.style.display = '';
        return { shown, hidden };
      });
      assert.ok(h.shown - h.hidden <= 1, `${size.width}x${size.height}: しつかん で上の段が ${h.hidden} → ${h.shown}px に高くなった`);
    }
    assert.deepEqual(ph.errors, [], `ページのエラー: ${ph.errors.join(' / ')}`);
    await ph.ctx.close();
  } finally {
    await browser.close();
    server?.proc.kill();
    // 消すのは、この試験が作った一時フォルダだけ(名前と場所を確かめてから)
    if (dist.startsWith(tmpdir()) && /sk-dist-/.test(dist)) rmSync(dist, { recursive: true, force: true });
  }
});
