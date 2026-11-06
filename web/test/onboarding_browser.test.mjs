// 初めての会話(7 歩)と性格の画面を、画面なしの Chrome で通す試験。幅 390・400(スマホ)と 1280(PC)。
// 会話サーバーは鍵なしで立てる(仮の頭脳。本物の API は呼ばない)。声の鍵の部品は偽物(本物の ElevenLabs は呼ばない)。
// 試しの画面は、初めての会話の部品だけ(舞台の WebGL は使わない)。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。
// FR_SHOTS_DIR を渡すと、そのフォルダに画面の写真を残す(目で見る点検用)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:net';
import { VOICE_THANKS } from '../src/ui/onboarding/script.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SHOTS = process.env.FR_SHOTS_DIR || '';
const GOOD_KEY = 'test-key-ok-0123456789';
const BAD_KEY = 'test-key-bad-9876543210';

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
  delete childEnv.ANTHROPIC_API_KEY; // 本物の頭脳を呼ばない(仮の頭脳で試す)
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
      if (r.ok) return { proc, base, log: () => out };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

// 試しの画面: 会話の画面の CSS と、ボタンを置く #modes だけ。声の鍵の部品は、鍵を受け取ったら記録するだけの偽物
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>初めての会話の試し</title></head>
<body><header class="top"><div class="modes" id="modes"></div></header>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
const params = new URLSearchParams(location.search);
const spoken = [];
let keySet = false;
const calls = [];
const byok = params.get('byok') === '1' ? {
  available: () => keySet,
  useKey: async (key, opts) => { calls.push({ len: key.length, remember: opts.remember }); keySet = key.includes('-ok-'); return keySet ? { ok: true } : { ok: false, message: '鍵が違うみたい(試し)' }; },
  speak: async (text) => { spoken.push(text); },
  notice: () => '試しの鍵の部品です(本物の ElevenLabs は呼びません)。',
  canRemember: () => true,
} : null;
window.__test = { spoken, calls };
window.__fr = mountFirstRun({ app: null, params, buttonHost: document.getElementById('modes'), byok, random: seededRandom(5) });
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

async function openPage(browser, base, { width, height, query, reduced = false, touch = width < 720 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
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
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/__fr/index.html?${query}`);
  return { ctx, page, errors };
}

/** 横にはみ出さない・押す所は 44px 以上・本文の文字は 16px 以上 */
async function checkLayout(page, where) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const roots = [...document.querySelectorAll('.fr-sheet, .yp-panel')];
    const visible = (e) => {
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0;
    };
    const out = { vw, scrollW: document.documentElement.scrollWidth, wide: [], small: [], tiny: [] };
    for (const root of roots) {
      for (const e of [root, ...root.querySelectorAll('*')]) {
        if (!visible(e) || e.closest('.fr-sr') || e.classList.contains('fr-file')) continue;
        const b = e.getBoundingClientRect();
        if (b.right > vw + 0.5 || b.left < -0.5) out.wide.push(`${e.tagName}.${e.className} ${Math.round(b.left)}..${Math.round(b.right)}`);
        const tap = e.matches('button, label.fr-btn, input[type="text"], input[type="password"], summary') && !e.closest('.yp-energy');
        if (tap && b.height < 43.5) out.small.push(`${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 12)}" ${b.height.toFixed(1)}px`);
        if (e.matches('.fr-text, .yp-reply') && parseFloat(getComputedStyle(e).fontSize) < 16) out.tiny.push(e.className);
      }
    }
    // 会話の欄は、いつも最後の文が見えている(選択肢の高さが変わった後も)
    const log = document.querySelector('.fr-log');
    const last = log?.lastElementChild;
    if (last && !document.querySelector('.yp-panel')) out.lastHidden = last.getBoundingClientRect().bottom - log.getBoundingClientRect().bottom;
    return out;
  });
  assert.ok(!(r.lastHidden > 1), `${where}: 最後の文が ${Math.round(r.lastHidden)}px 隠れている`);
  assert.ok(r.scrollW <= r.vw, `${where}: 横にはみ出しています(${r.scrollW} > ${r.vw})`);
  assert.deepEqual(r.wide, [], `${where}: 画面の外に出た物`);
  assert.deepEqual(r.small, [], `${where}: 押す所が 44px より小さい`);
  assert.deepEqual(r.tiny, [], `${where}: 本文が 16px より小さい`);
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const logText = (page) => page.$eval('.fr-log', (e) => e.innerText);
const waitAct = (page, id) => page.waitForSelector(`.fr-actions [data-act="${id}"]`, { timeout: 30_000 });
const lastChar = (page) => page.$$eval('.fr-line.char .fr-text', (els) => els.at(-1)?.textContent ?? '');
const previewed = (page) => page.$eval('.yp-panel', (e) => Number(e.dataset.previewed ?? 0));

async function waitPreview(page, before) {
  await page.waitForFunction((n) => Number(document.querySelector('.yp-panel')?.dataset.previewed ?? 0) > n, before, { timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector('.yp-try-btn')?.disabled, null, { timeout: 15_000 });
  return page.$eval('.yp-reply-text', (e) => e.textContent);
}

/** 言葉の入口から 7 歩目のお礼まで。full = 文字送りを本当にする(音の数も確かめる) */
async function walkWords(page, label, { full }) {
  await waitAct(page, 'words');
  await checkLayout(page, `${label} 1 歩目`);
  await shot(page, `${label}_1_start`);
  assert.equal(await page.$eval('.fr-sheet', (e) => e.dataset.step), '1');

  await page.fill('.fr-actions [data-act="words"] input', '赤い提灯の子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.match(await logText(page), /見本: ちょうちんくん/);
  assert.match(await logText(page), /ちょうちんくんだよ。この子はどうかな\?/);
  assert.equal(await page.$eval('.fr-steps li[data-n="2"]', (e) => e.className), 'skip', '言葉のときは 2 歩目(チェック)をとばす');
  await checkLayout(page, `${label} 3 歩目`);
  await shot(page, `${label}_3_meet`);

  await page.click('.fr-actions [data-act="keep"]');
  await waitAct(page, 'persona_ok');
  assert.match(await logText(page), /この子、少し.+みたい!/);

  // 性格の画面: 型と口調を変えると、仮の頭脳の返事の話し方がその場で変わる
  await page.click('.fr-actions [data-act="persona_edit"]');
  await page.waitForSelector('.yp-panel');
  let n = await previewed(page);
  const first = await waitPreview(page, n - 1);
  await checkLayout(page, `${label} 性格の画面`);
  await shot(page, `${label}_4_persona`);
  n = await previewed(page);
  await page.click('.yp-presets [data-key="genki"]');
  const genki = await waitPreview(page, n);
  n = await previewed(page);
  await page.click('.yp-presets [data-key="shy"]');
  const shy = await waitPreview(page, n);
  assert.notEqual(genki, shy, `元気と恥ずかしがり屋で返事が同じ: ${genki}`);
  assert.match(shy, /^(あ、あの…|えっと…)/, `恥ずかしがり屋の一言が無い: ${shy}`);
  // 語尾: おまかせで別の語尾(ぽよ など)のこともあるので、欄に「にゃ」と書く
  await page.click('.yp-seg [data-key="ending"]');
  await page.fill('.yp-ending-in', 'にゃ');
  await page.waitForFunction(() => document.querySelector('.yp-reply-text')?.textContent.includes('にゃ') && !document.querySelector('.yp-try-btn').disabled, null, { timeout: 15_000 });
  const nya = await page.$eval('.yp-reply-text', (e) => e.textContent);
  assert.match(nya, /^(あ、あの…|えっと…).*にゃ/, `語尾「にゃ」が付かない: ${nya}`);
  n = await previewed(page);
  await page.click('.yp-seg [data-key="short"]');
  const short = await waitPreview(page, n);
  assert.ok([...short.matchAll(/[。!?…]/g)].length <= 2, `短めなのに長い: ${short}`);
  assert.match(await page.$eval('.yp-brain-note', (e) => e.textContent), /仮の頭脳です/);
  assert.match(await page.$eval('.yp-block', (e) => e.textContent), /恥ずかしがり屋/);
  await shot(page, `${label}_4_persona_shy`);
  assert.ok(first.length > 0);
  await page.click('.yp-save');
  await page.waitForSelector('.yp-panel', { state: 'detached' });
  await waitAct(page, 'persona_ok');
  assert.match(await logText(page), /恥ずかしがり屋にしたよ。/);

  // 5 歩目: 初めてのあいさつ(仮の頭脳。話し方は設定どおり)
  await page.click('.fr-actions [data-act="persona_ok"]');
  await waitAct(page, 'to_retro');
  const hello = await lastChar(page);
  assert.match(hello, /^(あ、あの…|えっと…)こんにちはにゃ。$/, `あいさつ: ${hello}`);
  assert.match(await logText(page), /仮の頭脳です/);
  await shot(page, `${label}_5_hello`);

  // 6 歩目: 文字とレトロな音で話す
  await page.click('.fr-actions [data-act="to_retro"]');
  await waitAct(page, 'say');
  await page.fill('.fr-actions [data-act="say"] input', '好きな食べ物はなに?');
  await page.click('.fr-actions [data-act="say"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.fr-line.char').length >= 2, null, { timeout: 30_000 });
  await waitAct(page, 'to_voice');
  const stats = await page.evaluate(() => ({ blips: window.__fr.voice.blipper.stats(), crawled: window.__fr.sheet.stats.crawled }));
  if (full) {
    assert.ok(stats.crawled >= 3, `文字送りの回数 ${stats.crawled}`);
    assert.ok(stats.blips.count >= 10, `効果音の回数 ${stats.blips.count}`);
    assert.ok(stats.blips.played >= 1, '音を出す許可(最初のタップ)の後は、本当に鳴らしている');
  }
  await checkLayout(page, `${label} 6 歩目`);
  await shot(page, `${label}_6_retro`);

  // 7 歩目: 鍵(違う鍵 → もう一度 → 正しい鍵 → 本物の声のかわりの記録に「ありがとう」)
  await page.click('.fr-actions [data-act="to_voice"]');
  await waitAct(page, 'key');
  assert.match(await logText(page), /試しの鍵の部品です/, '鍵の前に、何をどこへ送るかを出す');
  await checkLayout(page, `${label} 7 歩目`);
  await shot(page, `${label}_7_key`);
  await page.fill('.fr-actions [data-act="key"] input[type="password"]', BAD_KEY);
  await page.click('.fr-actions [data-act="key"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('うまくいかなかったみたい。'), null, { timeout: 30_000 });
  await waitAct(page, 'key');
  await page.fill('.fr-actions [data-act="key"] input[type="password"]', GOOD_KEY);
  await page.click('.fr-actions [data-act="key"] button[type="submit"]');
  await page.waitForFunction((t) => window.__test.spoken.includes(t), VOICE_THANKS, { timeout: 30_000 });
  await waitAct(page, 'close');
  assert.equal(await lastChar(page), VOICE_THANKS);
  await shot(page, `${label}_7_thanks`);
  const leak = await page.evaluate(
    ([a, b]) => {
      const where = [];
      const html = document.documentElement.outerHTML;
      const store = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      for (const k of [a, b]) {
        if (html.includes(k)) where.push('画面');
        if (store.includes(k)) where.push('保存');
        if (location.href.includes(k)) where.push('URL');
      }
      return where;
    },
    [GOOD_KEY, BAD_KEY],
  );
  assert.deepEqual(leak, [], '鍵の文字が残っている');
  const calls = await page.evaluate(() => window.__test.calls);
  assert.deepEqual(calls.map((c) => c.len), [BAD_KEY.length, GOOD_KEY.length]);

  await page.click('.fr-actions [data-act="close"]');
  await page.waitForSelector('.fr-sheet', { state: 'detached', timeout: 15_000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarded.v1')), 'done');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yc.persona.v1.d_lantern')));
  assert.equal(saved.preset, 'shy');
  assert.equal(saved.voice.provider, 'elevenlabs');
}

const VIEWS = [
  { label: 'w390', width: 390, height: 844, full: true },
  { label: 'w400', width: 400, height: 800, full: false },
  { label: 'pc1280', width: 1280, height: 800, full: false },
];

test('初めての会話: 言葉の入口から 7 歩目まで(幅 390・400・PC、仮の頭脳)', { timeout: 300_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const status = await (await fetch(`${server.base}/api/status`)).json();
    assert.equal(status.brain, 'mock', '仮の頭脳で試す');
    for (const v of VIEWS) {
      await t.test(v.label, async () => {
        const { ctx, page, errors } = await openPage(browser, server.base, { ...v, query: 'onboard=1&byok=1&character=d_lantern', reduced: !v.full });
        try {
          await walkWords(page, v.label, v);
          assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
        } finally {
          await ctx.close();
        }
      });
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// 1×1 の白い PNG(試しの絵)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

test('絵の入口(幅 390): 人の絵 →「ゆるキャラにしてみる?」→ 主役の子。鍵の部品が無いと正直に言う', { timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 390, height: 844, query: 'onboard=1&character=yokoso', reduced: true });
    try {
      await waitAct(page, 'pick');
      await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'face.png', mimeType: 'image/png', buffer: PNG_1PX });
      await waitAct(page, 'kind_human');
      assert.equal(await page.$eval('.fr-sheet', (e) => e.dataset.step), '2');
      assert.equal(await page.$$eval('.fr-line.user img.fr-pic', (els) => els.length), 1, '選んだ絵を、この画面の中だけで見せる');
      assert.match(await page.$eval('.fr-line.user img.fr-pic', (e) => e.src), /^blob:/);
      await checkLayout(page, '絵 2 歩目');
      await shot(page, 'w390_2_check');
      await page.click('.fr-actions [data-act="kind_human"]');
      await waitAct(page, 'yurufy');
      assert.match(await logText(page), /これはちょっとリアルな写真みたい。ゆるキャラにしてみる\?/);
      await shot(page, 'w390_2_human');
      await page.click('.fr-actions [data-act="yurufy"]');
      await waitAct(page, 'keep');
      assert.match(await logText(page), /協力者が手で描いた絵から/);
      await page.click('.fr-actions [data-act="keep"]');
      await waitAct(page, 'persona_ok');
      await page.click('.fr-actions [data-act="persona_ok"]');
      await waitAct(page, 'to_retro');
      await page.click('.fr-actions [data-act="to_retro"]');
      await waitAct(page, 'to_voice');
      await page.click('.fr-actions [data-act="to_voice"]');
      await waitAct(page, 'close');
      assert.match(await logText(page), /まだこの画面につながっていない/);
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

test('「性格」のボタン(幅 400): 開く → おまかせ → これにする で、この端末に覚える', { timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 400, height: 800, query: 'character=mikan', reduced: true });
    try {
      await page.waitForSelector('#modes [data-firstrun="persona"]');
      assert.equal(await page.$('.fr-sheet'), null, '?onboard=1 が無ければ、初めての会話は自動で出さない(既定)');
      await page.click('#modes [data-firstrun="persona"]');
      await page.waitForSelector('.yp-panel');
      await waitPreview(page, 0);
      await checkLayout(page, '性格の画面(ボタンから)');
      const n = await previewed(page);
      await page.click('.yp-random');
      await waitPreview(page, n);
      await page.click('.yp-save');
      await page.waitForSelector('.yp-panel', { state: 'detached' });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yc.persona.v1.mikan')));
      assert.ok(saved && saved.v === 1, '設定を覚えた');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});
