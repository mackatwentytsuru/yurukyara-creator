// 公開のリンクの CSP(web/vercel.json)の下で、画面が動くかを GPU の Chrome で確かめる。
// 手元で Vercel の形をまねる(vercel_local.mjs)。本物の鍵は使わない: 頭脳は仮、声のサービスへの通信は Playwright が偽の無音で答える。
// 使い方(web で。先に npm install(public/mediapipe を作る)と npx vite build):
//   python <machine_lock.py> run --machine <機械> --kind gpu --who <流れ> --job "CSP の確かめ" --minutes 10 --wait 30 -- node api/_test/csp_browser_check.mjs <出力のフォルダ>
// 見る事:
//   ① 3D のノリーが出て、文字で話すとノリーの言葉で答える(公開の仮の頭脳が人格を使う)
//   ② 2D のノリー(?look=2d)
//   ③ カメラ: MediaPipe の wasm とモデルを読んで、カメラの入力になる(Chrome の偽のカメラ)
//   ④ 自分の鍵の声: 声のサービスへの通信が CSP で止まらない(偽の鍵と偽の無音。外へは出ない)
//   ⑤ 記憶の札: 覚える → 一覧に出る
//   ⑥ 止まるべき物が止まる: 外の URL のキャラ(connect-src)・外の枠(frame-src)
//   ①〜⑤ は CSP の違反 0 件。⑥ は違反が出て、外へは 1 回も出ない事。
// 出力: csp_check.json と絵。終わりの番号 0 = 全部できた、1 = できない所がある、3 = CPU の描画で止めた
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 本物の鍵と合言葉を、この試しでは使わない(値は読まずに外す)
for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'DEMO_PASSPHRASE', 'APP_PASSPHRASE', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION']) delete process.env[k];

const out = process.argv[2];
if (!out) {
  console.error('使い方: node api/_test/csp_browser_check.mjs <出力のフォルダ>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const { startVercelLocal, WEB } = await import('./vercel_local.mjs');
const { chromium } = await import('playwright-core');
const { GPU_ARGS, stopIfSoftwareRenderer } = await import('../../src/stage/gpuGuard.js');

const html = readFileSync(join(WEB, 'dist', 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]) && m[2].trim()).length;

const server = await startVercelLocal();
const browser = await chromium.launch({
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const FAKE_VOICE_KEY = ['test', 'only', 'not', 'a', 'real', 'voice', 'key'].join('_'); // 形だけの偽の鍵(声のサービスへは届かない)
const SILENCE = Buffer.alloc(24000 * 2 * 0.4); // 0.4 秒の無音(16bit・24kHz・モノラルの PCM)
const results = [];
let renderer = null;

/** 違反を集める仕掛けつきのページを開く */
async function open(name, query, { voiceKey = false, expectBlocks = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.__YC_CAMERA_FEATURE = true; // 11-08: カメラは次のアップデートまで外してある。CSP の確かめでは入れて通す
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 100), source: String(e.sourceFile).split('/').pop() });
    });
  });
  if (voiceKey) await context.addInitScript((k) => localStorage.setItem('yc.voiceKey', k), FAKE_VOICE_KEY);
  const outside = []; // 外へ出ようとした通信(声のサービスは偽の返事、ほかは止める)
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const u = new URL(route.request().url());
    outside.push(`${u.host}${u.pathname}`.slice(0, 100));
    if (u.host === 'api.elevenlabs.io') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: SILENCE });
    return route.abort();
  });
  const page = await context.newPage();
  const r = { check: name, query, problems: [], expected_blocks: [], console_errors: [], responses: {}, outside };
  page.on('pageerror', (e) => r.problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 160);
    r.console_errors.push(t);
    if (/Content Security Policy|Refused to/i.test(t)) (expectBlocks ? r.expected_blocks : r.problems).push(`console: ${t}`);
  });
  page.on('response', (res) => {
    const p = new URL(res.url()).pathname;
    if (/\/mediapipe\/|\.glb$|\.svg$|\/api\//.test(p)) r.responses[`${res.request().method()} ${p}`] = res.status();
  });
  const resp = await page.goto(`${server.base}/${query}`, { waitUntil: 'load' });
  r.csp_header = Boolean(resp.headers()['content-security-policy']);
  if (!renderer) renderer = await stopIfSoftwareRenderer(page, browser);
  return { context, page, r };
}

const ready = (page) =>
  page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null && document.getElementById('gateStatus').textContent === '', null, { timeout: 60000 });
const violations = (page) => page.evaluate(() => window.__csp ?? []);
const replyText = (page) => page.evaluate(() => `${document.getElementById('caption')?.textContent ?? ''} ${document.getElementById('tReply')?.textContent ?? ''}`);

async function say(page, text) {
  await page.fill('#textInput', text);
  await page.click('#composer .send');
}

async function finish({ context, page, r }, ok, shot) {
  r.violations = await violations(page).catch(() => []);
  if (shot) await page.screenshot({ path: join(out, shot) }).catch(() => {});
  r.ok = ok && r.problems.length === 0 && r.violations.length === 0 && r.csp_header;
  results.push(r);
  await context.close();
}

async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    results.push({ check: name, ok: false, problems: [`止まった: ${err.message.split('\n')[0]}`] });
  }
}

// ① 3D のノリーと、公開の仮の頭脳が人格の言葉で答えること
await step('3d', async () => {
  const s = await open('3d', '');
  await ready(s.page);
  s.r.character = await s.page.evaluate(() => ({ id: window.__app.characterId, look: window.__app.character?.look ?? null, name: window.__app.character?.name ?? null }));
  await s.page.click('#startSim');
  await say(s.page, 'こんにちは');
  await s.page.waitForFunction(() => /ノリー/.test(`${document.getElementById('caption')?.textContent ?? ''} ${document.getElementById('tReply')?.textContent ?? ''}`), null, { timeout: 20000 });
  s.r.reply = (await replyText(s.page)).trim().slice(0, 80);
  s.r.notice = await s.page.evaluate(() => document.getElementById('brainNotice')?.textContent ?? '');
  await finish(s, s.r.character.id === 'norrie' && /ノリー/.test(s.r.reply) && /おためしモード/.test(s.r.notice), 'csp_1_3d.png');
});

// ② 2D のノリー
await step('2d', async () => {
  const s = await open('2d', '?look=2d');
  await ready(s.page);
  s.r.character = await s.page.evaluate(() => ({ id: window.__app.characterId, look: window.__app.character?.look ?? null }));
  await s.page.waitForTimeout(1500);
  await finish(s, s.r.character.look === '2d', 'csp_2_2d.png');
});

// ③ カメラ(MediaPipe の wasm とモデル)
await step('camera', async () => {
  const s = await open('camera', '');
  await s.page.waitForFunction(() => window.__app?.character && !document.getElementById('startCam').disabled, null, { timeout: 60000 });
  await s.page.click('#startCam');
  await s.page.waitForFunction(() => window.__app.mode === 'camera', null, { timeout: 60000 });
  await s.page.waitForTimeout(2000);
  s.r.mode = await s.page.evaluate(() => ({ mode: window.__app.mode, kind: window.__app.source?.kind ?? null }));
  const loaded = Object.entries(s.r.responses).filter(([k, v]) => /\/mediapipe\//.test(k) && v === 200).map(([k]) => k);
  s.r.mediapipe = loaded;
  await finish(s, s.r.mode.mode === 'camera' && loaded.some((k) => /\.wasm$/.test(k)) && loaded.some((k) => /face_landmarker\.task$/.test(k)), 'csp_3_camera.png');
});

// ④ 自分の鍵の声(偽の鍵。声のサービスへの通信は Playwright が無音で答える)
await step('voice-byok', async () => {
  const s = await open('voice-byok', '', { voiceKey: true });
  await ready(s.page);
  await s.page.click('#startSim');
  await say(s.page, 'こんにちは');
  const t0 = Date.now();
  while (!s.r.outside.some((u) => u.startsWith('api.elevenlabs.io')) && Date.now() - t0 < 20000) await s.page.waitForTimeout(250);
  await s.page.waitForTimeout(1500);
  s.r.voice = await s.page.evaluate(() => ({ status: window.__app.speaker?.voiceKeyStatus ?? null, error: window.__app.speaker?.ttsError ?? null }));
  const eleven = s.r.outside.filter((u) => u.startsWith('api.elevenlabs.io'));
  s.r.eleven_requests = eleven.length;
  await finish(s, eleven.length > 0 && eleven.every((u) => /\/v1\/text-to-speech\/[A-Za-z0-9]+\/stream$/.test(u.replace('api.elevenlabs.io', ''))) && s.r.voice.status === null, 'csp_4_voice.png');
});

// ⑤ 記憶の札(覚える → 一覧)
await step('memory', async () => {
  const s = await open('memory', '');
  await ready(s.page);
  await s.page.click('#startSim');
  await say(s.page, 'わたしはタロウ。カレーが好き');
  await s.page.waitForFunction(() => /タロウ/.test(`${document.getElementById('caption')?.textContent ?? ''} ${document.getElementById('tReply')?.textContent ?? ''}`), null, { timeout: 20000 });
  await s.page.click('#memoryDrawer summary');
  await s.page.waitForFunction(() => document.querySelectorAll('.mem-item').length >= 2, null, { timeout: 20000 });
  s.r.items = await s.page.$$eval('.mem-item span', (els) => els.map((e) => e.textContent));
  await finish(s, s.r.items.some((t) => /タロウ/.test(t)), 'csp_5_memory.png');
});

// ⑥ 止まるべき物: 外の URL のキャラと外の枠(違反が出て、外へは出ない)
await step('blocked', async () => {
  const s = await open('blocked', '?character=https://example.com/c/character.json', { expectBlocks: true });
  await s.page.waitForTimeout(4000);
  await s.page.evaluate(() => {
    const f = document.createElement('iframe');
    f.src = 'https://example.com/';
    document.body.appendChild(f);
  });
  await s.page.waitForTimeout(1500);
  const v = await violations(s.page);
  s.r.violations = v;
  const connect = v.some((x) => x.directive === 'connect-src' && x.blocked.includes('example.com'));
  const frame = v.some((x) => x.directive === 'frame-src' && x.blocked.includes('example.com'));
  s.r.blocked = { connect, frame };
  s.r.ok = connect && frame && s.r.outside.length === 0 && s.r.csp_header && s.r.problems.length === 0;
  results.push(s.r);
  await s.context.close();
});

await browser.close();
await server.close();
const ok = results.every((r) => r.ok) && inlineScripts === 0;
const report = { ok, renderer, inline_scripts_in_dist: inlineScripts, api_hits: Object.fromEntries(server.hits), results };
writeFileSync(join(out, 'csp_check.json'), JSON.stringify(report, null, 2));
for (const r of results) console.log(`${r.ok ? 'ok ' : 'NG '} ${r.check}${r.problems?.length ? ` — ${r.problems.join(' / ')}` : ''}${r.violations?.length && r.check !== 'blocked' ? ` — 違反 ${JSON.stringify(r.violations)}` : ''}`);
console.log(`描画役: ${renderer} / dist の埋め込みの台本: ${inlineScripts} / 結果: ${ok ? '全部できた' : 'できない所がある'}`);
process.exit(ok ? 0 : 1);
