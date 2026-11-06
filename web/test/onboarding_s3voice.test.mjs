// 初めての会話 × 会話の流れ(S3)の声の部品の、つなぎ目の試験。S3 の部品(conversation/voiceKey.js など)がある線でだけ動く
// (S4 の線だけのときは飛ばす。合わせ②で両方が入ると、自動で動く)。
// - 鍵の受け口(s3voice.js): 形の違う鍵は声のサービスに聞かない・確かめに通った鍵だけ覚える・覚えない選び方
// - 画面なしの Chrome: 舞台の読み上げ(S3 の speaker.js)で、鍵なしはレトロ音と文字送り、鍵を入れると本物の声のかわりの音で
//   「声が出せるようになったよ、ありがとう!」。声のサービスへの通信は Playwright で横取りして、外へは出さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createServer } from 'node:net';
import { VOICE_THANKS } from '../src/ui/onboarding/script.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const HAS_S3 = ['voiceKey.js', 'elevenDirect.js', 'voiceKeyForm.js', 'retroVoice.js'].every((f) => existsSync(join(SRC, 'conversation', f)));
const SKIP = HAS_S3 ? false : '会話の流れ(S3)の声の部品がまだ無い線(合わせ②の後で動く)';
const FAKE_KEY = 'fakeVoiceKeyForTestOnly0123456789';

test('鍵の受け口(s3voice.js): 形・確かめ・覚えない', { skip: SKIP }, async () => {
  const { createByok, VOICE_KEY_SHAPE } = await import('../src/ui/onboarding/s3voice.js');
  const { clearVoiceKey, getVoiceKey } = await import('../src/conversation/voiceKey.js');
  const { VOICE_KEY_HELP } = await import('../src/conversation/voiceKeyForm.js');
  clearVoiceKey();
  const asked = [];
  const said = [];
  const app = { speaker: { voiceId: 'v1', enqueue: async (t) => said.push(t) } };
  let answer = { ok: false, status: 401, message: '声の鍵が違うみたい。入れ直してね' };
  const b = createByok({ app, check: async (k, o) => (asked.push({ k, o }), answer) });
  assert.equal(b.notice(), VOICE_KEY_HELP);
  assert.deepEqual(await b.useKey('short'), { ok: false, message: VOICE_KEY_SHAPE });
  assert.equal(asked.length, 0, '形の違う鍵は、声のサービスに聞かない');
  assert.deepEqual(await b.useKey(FAKE_KEY), { ok: false, message: '声の鍵が違うみたい。入れ直してね' });
  assert.equal(getVoiceKey(), '', '通らなかった鍵は覚えない');
  assert.equal(b.available(), false);
  answer = { ok: true, status: 200, message: '' };
  assert.deepEqual(await b.useKey(` ${FAKE_KEY} `, { remember: false }), { ok: true });
  assert.equal(asked.at(-1).o.voiceId, 'v1');
  assert.equal(getVoiceKey(), FAKE_KEY);
  assert.equal(b.available(), true);
  await b.speak('こんにちは');
  assert.deepEqual(said, ['こんにちは']);
  clearVoiceKey();
});

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer(env) {
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE']) delete childEnv[k];
  Object.assign(childEnv, env);
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, log: () => out };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

// 試しの画面: 舞台の WebGL は使わず、キャラは表情と動きを受けるだけの偽物。読み上げは S3 の本物(speaker.js)
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/__fr/src/ui/style.css"></head>
<body><header class="top"><div class="modes" id="modes"></div></header>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { Speaker } from '/__fr/src/conversation/speaker.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const speaker = new Speaker();
const moves = [];
const app = {
  speaker,
  persona: '',
  status: await (await fetch('/api/status')).json(),
  character: { id: 'd_lantern', name: 'ちょうちんくん', expressions: [], setEmotion: (e) => moves.push(e), play: (m) => moves.push(m) },
};
window.__test = { moves, app };
window.__fr = mountFirstRun({ app, params: new URLSearchParams(location.search), buttonHost: document.getElementById('modes'), random: seededRandom(5) });
</script></body></html>`;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

test('画面なしの Chrome(幅 390): 鍵なしはレトロ音と文字送り、鍵を入れると声で「ありがとう」(声のサービスは横取り)', { skip: SKIP, timeout: 180_000 }, async (t) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return t.skip('playwright-core が無い');
  }
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  } catch {
    return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  }
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-s3-')) });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const eleven = [];
    const ours = [];
    // 声のサービスへの通信は横取りして、0.2 秒の無音の PCM を返す(外へは出さない・お金はかからない)
    await ctx.route(/^https:\/\/api\.elevenlabs\.io\//, (route) => {
      eleven.push({ url: route.request().url(), key: route.request().headers()['xi-api-key'] === FAKE_KEY, body: route.request().postData() ?? '' });
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(9600) });
    });
    await ctx.route(`${server.base}/__fr/**`, async (route) => {
      const rel = new URL(route.request().url()).pathname.replace('/__fr/', '');
      if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
      const file = join(WEB, rel);
      if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().startsWith(server.base)) ours.push(`${r.url()} ${JSON.stringify(r.headers())} ${r.postData() ?? ''}`);
    });
    await page.goto(`${server.base}/__fr/index.html?onboard=1&character=d_lantern`);
    await page.evaluate(() => window.__fr.byokReady);
    const act = (id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });
    await act('words');
    await page.fill('.fr-actions [data-act="words"] input', '赤い提灯の子');
    await page.click('.fr-actions [data-act="words"] button[type="submit"]');
    await act('keep');
    await page.click('.fr-actions [data-act="keep"]');
    await act('persona_ok');
    await page.click('.fr-actions [data-act="persona_ok"]');
    await act('to_retro');
    const s1 = await page.evaluate(() => window.__fr.sheet.stats);
    assert.ok(s1.crawled >= 1, '鍵なし: 舞台の読み上げのレトロ音と文字送りで話した');
    assert.equal(s1.voiced.length, 0);
    await page.click('.fr-actions [data-act="to_retro"]');
    await act('to_voice');
    await page.click('.fr-actions [data-act="to_voice"]');
    await act('key');
    assert.match(await page.$eval('.fr-log', (e) => e.innerText), /私たちのサーバーには送りません/, 'S3 の説明を、鍵の前に出す');
    await page.fill('.fr-actions [data-act="key"] input[type="password"]', FAKE_KEY);
    await page.click('.fr-actions [data-act="key"] button[type="submit"]');
    await act('close');
    const s2 = await page.evaluate(() => window.__fr.sheet.stats);
    assert.ok(s2.voiced.some((v) => v.text === VOICE_THANKS && v.way === 'speaker'), `声で「ありがとう」を言っていない: ${JSON.stringify(s2.voiced)}`);
    assert.ok(eleven.length >= 2, `声のサービスへの頼み: ${eleven.length} 回(確かめの 1 文と、ありがとう)`);
    assert.ok(eleven.every((e) => e.key), '声のサービスへは、入れた鍵で頼んだ');
    assert.ok(eleven.some((e) => e.body.includes('声が出せるようになったよ')));
    assert.ok(!ours.some((l) => l.includes(FAKE_KEY)), '私たちのサーバーには、鍵を送っていない');
    assert.ok(!server.log().includes(FAKE_KEY), 'サーバーの記録に鍵が無い');
    const leak = await page.evaluate((k) => [document.documentElement.outerHTML.includes(k), JSON.stringify({ ...localStorage }).includes(k), location.href.includes(k)], FAKE_KEY);
    assert.deepEqual(leak, [false, false, false], '画面・保存(覚えない を選んだ)・URL に鍵が無い');
    assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    await ctx.close();
  } finally {
    await browser.close();
    server.proc.kill();
  }
});
