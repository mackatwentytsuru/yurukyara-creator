// 初めての会話(7 歩)と性格の画面を、画面なしの Chrome で通す試験。幅 390・400(スマホ)と 1280(PC)。
// 会話サーバーは鍵なしで立てる(仮の頭脳。本物の API は呼ばない)。声の鍵の部品は偽物(本物の ElevenLabs は呼ばない)。
// 試しの画面は、初めての会話の部品だけ(舞台の WebGL は使わない)。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。
// FR_SHOTS_DIR を渡すと、そのフォルダに画面の写真を残す(目で見る点検用)。
// 重いので YC_BROWSER_TESTS=1 のときだけ動く(編集ごとのフックの試験を 30 秒未満にする。合わせの門と、画面を直した時に流す)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:net';
import { VOICE_THANKS } from '../src/ui/onboarding/script.js';
import { ENDINGS, SETTINGS_VERSION, STORE_PREFIX } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SHOTS = process.env.FR_SHOTS_DIR || '';
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';
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

// 試しの画面: 会話の画面の CSS と、ボタンを置く #modes だけ。声の鍵の部品は、鍵を受け取ったら記録するだけの偽物。
// ?fakeapp=<id> の時は、舞台のまね(app。WebGL は使わない)を渡す: 舞台の子は <id>、入れ替え(swapCharacter)と描き直し(resize・
// frameCharacter)は数えるだけ。canvas #stage は会話の画面と同じ CSS(style.css)で置く(PC で札の左に収めるかを測る)
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><link rel="help" href="https://example.org/readme#make-your-own-character-on-your-pc-with-claude-code"><title>初めての会話の試し</title></head>
<body><canvas id="stage"></canvas><header class="top"><div class="modes" id="modes"></div></header>
<aside id="thought" class="thought" aria-label="Claude の考え"><button class="thought-head" type="button">Claude の考え</button></aside>
<div id="gate" class="gate"><div class="gate-card"><h1>入口</h1><button type="button" class="primary">はじめる</button><button id="startSim" type="button">カメラなしで試す</button></div></div>
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
window.__test = { spoken, calls, simStarted: 0, swaps: [], resized: 0, framed: 0 };
const fakeId = params.get('fakeapp');
const NAMES = { mikan: 'みかんちゃん', norrie: 'ノリー', yokoso: 'ようこそくん' };
const app = fakeId ? {
  character: { id: fakeId, name: NAMES[fakeId] ?? fakeId },
  characterId: fakeId,
  persona: '',
  stage: { state: {}, resize: () => { window.__test.resized += 1; }, frameCharacter: () => { window.__test.framed += 1; } },
  swapCharacter: (next) => { window.__test.swaps.push(next?.id ?? null); },
} : null;
window.__test.app = app;
addEventListener('yc:firstrun-closed', (e) => { window.__test.closed = e.detail; });
// main.js の「カメラなしで試す」のまね: 押すと少し後に入口を隠す
document.getElementById('startSim').addEventListener('click', () => { window.__test.simStarted += 1; setTimeout(() => document.getElementById('gate').classList.add('hidden'), 60); });
window.__fr = mountFirstRun({ app, params, buttonHost: document.getElementById('modes'), byok, random: seededRandom(5) });
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
        if (e.closest('.fr-chips-scroll') && !e.matches('.fr-chips-scroll')) continue; // 2 段で横に巻ける札の中(巻けば届く。おまかせは先頭)
        const b = e.getBoundingClientRect();
        if (b.right > vw + 0.5 || b.left < -0.5) out.wide.push(`${e.tagName}.${e.className} ${Math.round(b.left)}..${Math.round(b.right)}`);
        const tap = e.matches('button, label.fr-btn, input[type="text"], input[type="password"], summary') && !e.closest('.yp-energy');
        if (tap && b.height < 43.5) out.small.push(`${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 12)}" ${b.height.toFixed(1)}px`);
        if (e.matches('.fr-text, .yp-reply') && parseFloat(getComputedStyle(e).fontSize) < 16) out.tiny.push(e.className);
      }
    }
    // 会話の欄: 今のまとまりの最初の行(.fr-latest。「ごめんね…」など)がいつも見えていて、最後の文も見えている。
    // まとまりが欄より長い時だけ、最後の文は下に隠れてよい(その時は、最初の行が欄の上の端にある)。CRITux2 中 2
    const log = document.querySelector('.fr-log');
    const last = log?.lastElementChild;
    const latest = log?.querySelector('.fr-latest');
    if (last && !document.querySelector('.yp-panel')) {
      const lb = log.getBoundingClientRect();
      out.lastHidden = last.getBoundingClientRect().bottom - lb.bottom;
      if (latest) {
        const t = latest.getBoundingClientRect();
        out.latestTop = t.top - lb.top;
        out.latestShown = Math.min(t.bottom, lb.bottom) - Math.max(t.top, lb.top);
        out.latestH = t.height;
        out.groupH = last.getBoundingClientRect().bottom - t.top;
        out.logInner = log.clientHeight;
      }
    }
    return out;
  });
  // OL1(LINE のような会話): いちばん新しい吹き出しは、いつも見える。今のまとまりが欄に入る時は、その最初の行も見える(入らない時だけ上へ流れてよい)
  assert.ok(!(r.lastHidden > 1), `${where}: いちばん新しい吹き出しが ${Math.round(r.lastHidden)}px 隠れている`);
  if (r.latestTop !== undefined && r.groupH <= r.logInner - 12) {
    assert.ok(r.latestTop >= -1, `${where}: 今のまとまりが欄に入るのに、最初の行が上に ${Math.round(-r.latestTop)}px 隠れている`);
  }
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
/** 1 つ目のステップの「この子は、どこで だれと?」(B4 12b)。役目の札を押して、ことばと絵の入れ方へ進む */
async function pastRole(page, role = 'home') {
  await waitAct(page, `role_${role}`);
  await page.click(`.fr-actions [data-act="role_${role}"]`);
}
const lastChar = (page) => page.$$eval('.fr-line.char .fr-text', (els) => els.at(-1)?.textContent ?? '');
const previewed = (page) => page.$eval('.yp-panel', (e) => Number(e.dataset.previewed ?? 0));

async function waitPreview(page, before) {
  await page.waitForFunction((n) => Number(document.querySelector('.yp-panel')?.dataset.previewed ?? 0) > n, before, { timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector('.yp-try-btn')?.disabled, null, { timeout: 15_000 });
  return page.$eval('.yp-reply-text', (e) => e.textContent);
}

/** 言葉の入口から 7 歩目のお礼まで。full = 文字送りを本当にする(音の数も確かめる) */
async function walkWords(page, label, { full }) {
  await waitAct(page, 'role_home');
  assert.match(await logText(page), /この子は、どこで だれと\?/, '役目を先に聞く');
  const roles = await page.$$eval('.fr-actions [data-act^="role_"]', (els) => els.map((e) => ({ id: e.dataset.act, h: e.getBoundingClientRect().height })));
  assert.deepEqual(roles.map((r) => r.id), ['role_home', 'role_shop', 'role_station', 'role_facility', 'role_auto']);
  assert.ok(roles.every((r) => r.h >= 44), `役目の札は 44px 以上 ${JSON.stringify(roles)}`);
  assert.equal(await page.$$eval('.fr-actions .fr-auto', (els) => els.length), 0, 'おまかせの札は 1 つだけ(役目の札のおまかせ)');
  await checkLayout(page, `${label} 1 歩目(役目)`);
  await shot(page, `${label}_1_role`);
  await pastRole(page);
  await waitAct(page, 'words');
  await checkLayout(page, `${label} 1 歩目`);
  await shot(page, `${label}_1_start`);
  assert.equal(await page.$eval('.fr-sheet', (e) => e.dataset.step), '1');
  // 歩みの名前(「7 声」など)は、行の高さを字の 1.4 倍以上にして、字の下が切れないようにする(幅 390 で「声」が「芦」に見えた。CRITux2 低 9)
  const label7 = await page.$eval('.fr-steps li[data-n="7"] b', (e) => ({ lh: parseFloat(getComputedStyle(e).lineHeight), fs: parseFloat(getComputedStyle(e).fontSize), text: e.textContent }));
  assert.ok(label7.text === '声' && label7.lh >= label7.fs * 1.4, `「7 声」の行の高さ ${JSON.stringify(label7)}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.locator('.fr-head').screenshot({ path: join(SHOTS, `${label}_head.png`) });
  }
  const gate = () => page.$eval('#gate', (e) => [getComputedStyle(e).opacity, getComputedStyle(e).pointerEvents].join(' '));
  assert.equal(await gate(), '0 none', '初めての会話の間は、入口のゲートを消して舞台を見せる');
  const thought = () => page.$eval('#thought', (e) => getComputedStyle(e).display);
  assert.equal(await thought(), 'none', '初めての会話の間は「Claude の考え」を隠す(スマホは上の段のボタン、PC は札に重なっていた)');
  // スマホの 1 歩目は、写真と絵を 2 つ並べて札を低くする(上に案内役の顔が見えるように。CRITux 16)
  const vh = await page.evaluate(() => innerHeight);
  const sheetH = await page.$eval('.fr-sheet', (e) => e.getBoundingClientRect().height);
  if ((await page.evaluate(() => innerWidth)) < 720) assert.ok(sheetH >= 0.55 * vh - 1 && sheetH <= 0.66 * vh + 1, `1 歩目の会話の札は、見える高さの 55〜65%(OL1): ${sheetH}/${vh}`);

  await page.fill('.fr-actions [data-act="words"] input', '赤い提灯の子');
  await page.click('.fr-actions [data-act="words"] button[type="submit"]');
  await waitAct(page, 'keep');
  assert.match(await logText(page), /見本の中に、近い子が いたよ!/, '見本だと言う説明が、読み込み直しで消えない(D2)');
  assert.match(await logText(page), /見本: ちょうちんくん/);
  assert.match(await logText(page), /ちょうちんくんだよ。この子は どうかな\?/);
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
  // 声の役(第 11 波): おまかせ / 男の子 / 女の子。押すと選ばれ、下の一言が今の声を言う(舞台の読み上げにも渡す)
  assert.deepEqual(await page.$$eval('.yp-roles button', (bs) => bs.map((b) => b.textContent)), ['おまかせ', '男の子', '女の子']);
  assert.equal(await page.$eval('.yp-roles [data-key="auto"]', (e) => e.getAttribute('aria-checked')), 'true', '初めは おまかせ');
  await page.click('.yp-roles [data-key="male"]');
  assert.equal(await page.$eval('.yp-roles [data-key="male"]', (e) => e.getAttribute('aria-checked')), 'true');
  assert.match(await page.$eval('.yp-role-note', (e) => e.textContent), /男の子の声で話します/);
  await page.click('.yp-roles [data-key="auto"]');
  assert.match(await page.$eval('.yp-role-note', (e) => e.textContent), /^おまかせ: /);
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
  assert.match(await logText(page), /おためしの あたま/);
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
  assert.match(await logText(page), /声の会社に 送られて/, '鍵の前に、何をどこへ送るかを出す');
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
  // QF4 中 5: 終わっても札は自動で閉じない。決めたことと「はじめる」を出し、押した時だけ閉じる
  await waitAct(page, 'begin');
  await page.waitForTimeout(2200);
  assert.ok(await page.$('.fr-sheet'), '2.2 秒たっても札は閉じない(昔は 1.6 秒で閉じた)');
  assert.match(await logText(page), /ちょうちんくんは、.+ 話す 子だよ。/, '決めたことを 1 つの文で(UIR 15)');
  await page.click('.fr-actions [data-act="begin"]');
  await page.waitForSelector('.fr-sheet', { state: 'detached', timeout: 15_000 });
  // 閉じたら: 入口を出し直さない(カメラなしで始める)・アドレスから onboard=1 を消す・読み込み直しても 7 歩を始めない(D4)
  await page.waitForFunction(() => document.getElementById('gate').classList.contains('hidden'), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__test.simStarted), 1, '入口が残っていたので、カメラなしで 1 回始めた');
  assert.ok(!/onboard=/.test(await page.evaluate(() => location.search)), 'アドレスから onboard=1 を消した');
  assert.notEqual(await thought(), 'none', '閉じたら「Claude の考え」も戻る');
  assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarded.v1')), 'done');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), `${STORE_PREFIX}d_lantern`);
  assert.equal(saved.preset, 'shy');
  assert.equal(saved.voice.provider, 'elevenlabs');
  await page.reload();
  await page.waitForSelector('#modes [data-firstrun="start"]');
  await page.waitForTimeout(400);
  assert.equal(await page.$('.fr-sheet'), null, '読み込み直しても、7 歩を最初から始めない');
}

const VIEWS = [
  { label: 'w390', width: 390, height: 844, full: true },
  { label: 'w400', width: 400, height: 800, full: false },
  { label: 'pc1280', width: 1280, height: 800, full: false },
];

test('初めての会話: 言葉の入口から 7 歩目まで(幅 390・400・PC、仮の頭脳)', { skip: SLOW, timeout: 300_000 }, async (t) => {
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

/** 案内役の「ごめんね…」の行が、会話の欄の中に全部見えているか(スマホで上へ流れて見えなかった。CRITux2 中 2) */
const sorryShown = (page, word = 'ごめんね') =>
  page.evaluate((w) => {
    const log = document.querySelector('.fr-log').getBoundingClientRect();
    const line = [...document.querySelectorAll('.fr-line.guide')].find((l) => l.textContent.includes(w));
    const b = line?.getBoundingClientRect();
    return b ? { top: Math.round(b.top - log.top), below: Math.round(log.bottom - b.bottom), latest: line.classList.contains('fr-latest'), logH: Math.round(log.height) } : null;
  }, word);

test('絵の入口(幅 390): 絵を見られないと正直に言い、色と形を聞いて、近い見本を出す。開発の言葉を出さない。絵は札に出したまま(UIR 2・D3)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    // ?character= なし: 案内役は主役(?character=<id> で開くと、その子が案内役になる。下の試験)
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 390, height: 844, query: 'onboard=1', reduced: true });
    try {
      await pastRole(page);
      await waitAct(page, 'pick');
      await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'face.png', mimeType: 'image/png', buffer: PNG_1PX });
      await waitAct(page, 'col_green');
      assert.equal(await page.$eval('.fr-sheet', (e) => e.dataset.step), '2');
      assert.equal(await page.$$eval('.fr-line.user img.fr-pic', (els) => els.length), 1, '選んだ絵を、この画面の中だけで見せる');
      assert.match(await page.$eval('.fr-line.user img.fr-pic', (e) => e.src), /^blob:/);
      assert.match(await logText(page), /絵を 見られないんだ/, '見ていないのに見たと言わない');
      await checkLayout(page, '絵 2 歩目(色)');
      await shot(page, 'w390_2_color');
      await page.click('.fr-actions [data-act="col_green"]');
      await waitAct(page, 'shp_round');
      await page.click('.fr-actions [data-act="shp_round"]');
      await waitAct(page, 'keep');
      assert.match(await logText(page), /ぴったりではないけど、この子はどう\?/, '近い子を出す(行き止まりにしない)');
      assert.match(await logText(page), /見本: ようこそくん/, 'みどりで まるい → ようこそくん');
      assert.equal(await page.$$eval('.fr-line img.fr-pic-small', (els) => els.length) >= 1, true, '見本の子の小さな絵を出す');
      assert.doesNotMatch(await logText(page), /Claude Code|serve_review|yuru-next|README|make-character|つくりかた|ごめんね/, '子どもの画面に開発の言葉を出さない(UIR 1)');
      assert.equal(await page.$('.fr-actions a[data-act="readme"]'), null, 'パソコンでの作り方のリンクを出さない');
      const pinned = () => page.$eval('.fr-pin', (e) => ({ hidden: e.hidden, src: e.querySelector('img')?.src ?? '', h: e.getBoundingClientRect().height }));
      assert.ok(!(await pinned()).hidden && /^blob:/.test((await pinned()).src), '選んだ絵を札の上に出したまま(D3)');
      assert.ok((await pinned()).h <= 70, `スマホの絵の欄は小さく(${(await pinned()).h}px)`);
      await checkLayout(page, '絵 3 歩目(近い子)');
      await shot(page, 'w390_3_near_picture');
      await page.click('.fr-actions [data-act="choose_sample"]');
      await waitAct(page, 's_robo');
      const cards = await page.$$eval('.fr-actions .fr-card', (els) => els.map((e) => ({ h: e.getBoundingClientRect().height, img: Boolean(e.querySelector('img.fr-card-img')) })));
      assert.ok(cards.length >= 5 && cards.every((c) => c.img && c.h >= 44), `見本は小さな絵つきの札(UIR 10) ${JSON.stringify(cards)}`);
      await checkLayout(page, '見本の一覧(絵つき)');
      await shot(page, 'w390_3_cards');
      await page.click('.fr-actions [data-act="s_robo"]');
      await waitAct(page, 'keep');
      await page.click('.fr-actions [data-act="keep"]');
      await waitAct(page, 'persona_ok');
      assert.ok(/^blob:/.test((await pinned()).src), '4 歩目でも絵は見えている');
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

// 11/7 03:09 の録画で、おまかせが主役に語尾「ぽよ」を付けた(「ノリーと申しマスぽよ」)。試しの画面の乱数(種 5)は、直す前なら
// 最初のおまかせで語尾「ぽよ」を選ぶ。入口(index.js)が主役を「話し方の決まった子」と見て、語尾も口調も足さないかを見る
test('主役の絵の入口(幅 390): おまかせ・性格の画面のおまかせ 5 回・あいさつで、語尾を足さない(この子の話し方)', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  const noEnding = (text, where) => assert.ok(!ENDINGS.some((e) => text.includes(e)), `${where}: 語尾が付いた: ${text}`);
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 390, height: 844, query: `onboard=1&character=${MAIN.id}`, reduced: true });
    try {
      await pastRole(page);
      await waitAct(page, 'pick');
      await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'drawing.png', mimeType: 'image/png', buffer: PNG_1PX });
      await waitAct(page, 'col_brown');
      await page.click('.fr-actions [data-act="col_brown"]');
      await waitAct(page, 'shp_tall');
      await page.click('.fr-actions [data-act="shp_tall"]');
      await waitAct(page, 'keep');
      await page.click('.fr-actions [data-act="keep"]');
      await waitAct(page, 'persona_ok');
      assert.match(await logText(page), /この子らしく 話す 子に したよ。/, '4 歩目のおまかせ');

      await page.click('.fr-actions [data-act="persona_edit"]');
      await page.waitForSelector('.yp-panel');
      await waitPreview(page, 0);
      const ownChecked = () => page.$eval('.yp-tones [data-key="own"]', (e) => e.getAttribute('aria-checked'));
      assert.equal(await ownChecked(), 'true');
      assert.equal(await page.$$eval('.yp-tones button', (els) => els.length), 4, '口調は 4 つ');
      // 主役の話し方は人格の文で決まっている: 口調の列は止めて、理由を書く(D6)
      assert.deepEqual(await page.$$eval('.yp-tones button', (els) => els.map((b) => b.disabled)), [true, true, true, true], '口調のボタンは押せない');
      assert.match(await page.$eval('.yp-tone-lock', (e) => (e.hidden ? '' : e.textContent)), /話し方は、この子の人格の文で決まっています/);
      await page.click('.yp-tones [data-key="ending"]', { force: true });
      assert.equal(await ownChecked(), 'true', '押しても口調は変わらない');
      await checkLayout(page, '主役の性格の画面');
      await shot(page, 'w390_main_persona_own');
      noEnding(await page.$eval('.yp-reply-text', (e) => e.textContent), '性格の画面の試し');
      assert.match(await page.$eval('.yp-block', (e) => e.textContent), /話し方のまま/);
      for (let i = 1; i <= 5; i++) {
        const n = await previewed(page);
        await page.click('.yp-random');
        const reply = await waitPreview(page, n);
        assert.equal(await ownChecked(), 'true', `性格の画面のおまかせ ${i} 回目`);
        noEnding(reply, `性格の画面のおまかせ ${i} 回目`);
      }
      await page.click('.yp-save');
      await page.waitForSelector('.yp-panel', { state: 'detached' });
      await waitAct(page, 'persona_ok');
      await page.click('.fr-actions [data-act="persona_ok"]');
      await waitAct(page, 'to_retro');
      noEnding(await lastChar(page), '5 歩目のあいさつ');
      await shot(page, 'w390_main_hello_own');
      const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), `${STORE_PREFIX}${MAIN.id}`);
      assert.equal(saved.tone, 'own');
      assert.equal(saved.v, SETTINGS_VERSION);
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

test('「性格」のボタン(幅 400): 開く → おまかせ → これにする で、この端末に覚える', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 400, height: 800, query: 'character=mikan', reduced: true });
    try {
      await page.waitForSelector('#modes [data-firstrun="persona"]');
      assert.equal(await page.$('.fr-sheet'), null, '?onboard=1 が無ければ、初めての会話は自動で出さない(既定)');
      await page.evaluate(() => document.getElementById('gate').classList.add('hidden')); // 使う人が入口を通った後(会話の画面と同じ)
      await page.click('#modes [data-firstrun="persona"]');
      await page.waitForSelector('.yp-panel');
      await waitPreview(page, 0);
      await checkLayout(page, '性格の画面(ボタンから)');
      const n = await previewed(page);
      await page.click('.yp-random');
      await waitPreview(page, n);
      await page.click('.yp-save');
      await page.waitForSelector('.yp-panel', { state: 'detached' });
      const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), `${STORE_PREFIX}mikan`);
      assert.ok(saved && saved.v === SETTINGS_VERSION, '設定を覚えた');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// 本人 11/7(第 11d 波): 全部オートでできる道。性格の画面の上の「おまかせ(ぜんぶ じどう)」は 1 回で決めて閉じる。下のくじびきとは名前を分ける
test('性格の画面(幅 390): 上の「おまかせ(ぜんぶ じどう)」1 回で、おすすめの性格と声の役 おまかせ で決まって閉じる。下は「くじびき」', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 390, height: 844, query: 'character=mikan', reduced: true });
    try {
      await page.waitForSelector('#modes [data-firstrun="persona"]');
      await page.evaluate(() => document.getElementById('gate').classList.add('hidden'));
      await page.click('#modes [data-firstrun="persona"]');
      await page.waitForSelector('.yp-panel');
      await waitPreview(page, 0);
      const top = await page.$eval('.yp-auto', (e) => ({ text: e.textContent, h: Math.round(e.getBoundingClientRect().height) }));
      assert.equal(top.text, 'おまかせ(ぜんぶ じどう)');
      assert.ok(top.h >= 44, `おまかせは大きなボタン ${top.h}px`);
      assert.match(await page.$eval('.yp-auto-note', (e) => e.textContent), /^えらぶ所は 6 つ.*おまかせなら 1 回で おわります/);
      assert.equal(await page.$eval('.yp-random', (e) => e.textContent), 'くじびき', '下のくじ(画面は閉じない)は、上のおまかせと名前が違う');
      await checkLayout(page, '性格の画面(おまかせつき)');
      await page.click('.yp-auto'); // 押すのは、この 1 回だけ
      await page.waitForSelector('.yp-panel', { state: 'detached' });
      const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), `${STORE_PREFIX}mikan`);
      assert.ok(saved && saved.v === SETTINGS_VERSION, '設定を覚えた');
      assert.match(JSON.stringify(saved), /"role":"auto"/, '声の役は おまかせ');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// 背の低い画面(本物の Quest 3 のブラウザは 1280×670): 1 歩目の最初の一言が欄の下で切れていた(第 11 波)。
// 字の幅は端末の書体で変わる(Quest では 3 行、この PC の Chrome では 2 行)ので、「今の文が全部見える」に加えて
// 「3 行の一言が入るだけの高さが欄にある」も見る。PC の上の段・下の帯の高さは、Quest で測った値(92px・103px)をまねる
test('背の低い画面(390×670・1280×670・400×640): 1 歩目の最初の一言が欠けずに見え、3 行でも入る', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    for (const v of [{ width: 390, height: 670 }, { width: 1280, height: 670, bars: [92, 103] }, { width: 400, height: 640 }]) {
      const label = `${v.width}×${v.height}`;
      const { ctx, page, errors } = await openPage(browser, server.base, { ...v, query: 'onboard=1', reduced: true });
      try {
        if (v.bars) {
          await page.evaluate(([top, bottom]) => {
            document.documentElement.style.setProperty('--top-h', `${top}px`);
            document.documentElement.style.setProperty('--bottom-h', `${bottom}px`);
          }, v.bars);
        }
        await waitAct(page, 'role_home');
        const m = await page.evaluate(() => {
          const log = document.querySelector('.fr-log');
          const first = log.querySelector('.fr-line');
          const text = first.querySelector('.fr-text');
          const lb = log.getBoundingClientRect();
          const fb = first.getBoundingClientRect();
          const padTop = parseFloat(getComputedStyle(log).paddingTop);
          const lh = parseFloat(getComputedStyle(text).lineHeight);
          const lines = Math.round(text.getBoundingClientRect().height / lh);
          const extra = fb.height - lines * lh; // 名前・吹き出しの余白
          return { text: text.textContent, top: fb.top - lb.top, below: fb.bottom - lb.bottom, room: log.clientHeight - padTop, need3: extra + 3 * lh, scrollTop: log.scrollTop };
        });
        assert.match(m.text, /^はじめまして! ノリーデス。いっしょに ゆるキャラを 生み出しマス!$/u, `${label}: 1 歩目の最初の一言`);
        assert.ok(m.top >= -1 && m.below <= 1 && m.scrollTop === 0, `${label}: 最初の一言が欠けている ${JSON.stringify(m)}`);
        assert.ok(m.room >= m.need3, `${label}: 3 行の一言(${Math.round(m.need3)}px)が欄(${Math.round(m.room)}px)に入らない`);
        await checkLayout(page, `${label} 1 歩目`);
        await shot(page, `short_${v.width}x${v.height}_1_start`);
        assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// README の「?character=mikan」で初めて開いた時(CRITux2 高 1): 入口の「案内するのは「みかんちゃん」です」のとおり、7 歩の案内役もその子。
// 舞台を主役に替えず(舞台のまねの入れ替え 0 回)、「あとで」で閉じてもアドレスに ?character=mikan が残る(onboard=1 だけ消す)
test('?character=<id> で開いた初めての訪問(幅 390): その子が案内役。舞台を主役に替えず、閉じても ?character=<id> を残す', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 390, height: 844, query: 'onboard=1&character=mikan&fakeapp=mikan', reduced: true });
    try {
      await pastRole(page);
      await waitAct(page, 'words');
      const guideLines = await page.$$eval('.fr-line.guide .fr-text', (els) => els.map((e) => e.textContent));
      assert.match(guideLines[0], /^はじめまして。みかんちゃんだよ。/, `案内役の名乗り: ${guideLines[0]}`);
      assert.ok(!guideLines.join('').includes('ノリー、'), '主役の口調で名乗らない');
      assert.deepEqual(await page.$$eval('.fr-name', (els) => [...new Set(els.map((e) => e.textContent))]), ['みかんちゃん']);
      assert.equal(await page.evaluate(() => window.__fr.lead.id), 'mikan');
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(() => window.__test.swaps), [], '舞台を主役に替えない');
      await shot(page, 'w390_mikan_1_start');

      // ぴったりの子がいない言葉: 「ぴったりではないけど」が見えていて、近い子が出る。見本の一覧は主役が先頭で、案内役は入れない
      // 意味で近い子が案内役(みかんちゃん)の時は、舞台を替えずに続ける(試しの画面は本物のキャラを読めない)
      await page.fill('.fr-actions [data-act="words"] input', 'りんごの子');
      await page.click('.fr-actions [data-act="words"] button[type="submit"]');
      await waitAct(page, 'choose_sample');
      assert.match(await logText(page), /見本: みかんちゃん/);
      const sorry = await sorryShown(page, 'ぴったりではないけど');
      assert.ok(sorry && sorry.top >= -1 && sorry.below >= -1, `「ぴったりではないけど」が会話の欄の中に全部見えない ${JSON.stringify(sorry)}`);
      await checkLayout(page, '?character=mikan 近い子');
      await shot(page, 'w390_mikan_3_nomatch');
      await page.click('.fr-actions [data-act="choose_sample"]');
      await waitAct(page, 's_robo');
      const list = await page.$$eval('.fr-actions [data-act^="s_"]', (els) => els.map((e) => e.dataset.act));
      assert.equal(list[0], `s_${MAIN.id}`, `見本の一覧の先頭は主役: ${list.join(' ')}`);
      assert.ok(!list.includes('s_mikan'), '案内役は見本の一覧に入れない(「〜で続きを試す」で選べる)');
      await checkLayout(page, '?character=mikan 見本の一覧');
      await shot(page, 'w390_mikan_3_list');

      // あとで: 閉じても ?character=mikan を残す。onboard=1 は消す
      const swapsBefore = await page.evaluate(() => window.__test.swaps.length);
      await page.click('.fr-sheet .fr-close');
      await page.waitForSelector('.fr-sheet', { state: 'detached', timeout: 15_000 });
      await page.waitForFunction(() => !/onboard=/.test(location.search), null, { timeout: 5000 });
      const search = await page.evaluate(() => location.search);
      assert.match(search, /[?&]character=mikan(&|$)/, `閉じた後のアドレス: ${search}`);
      assert.ok(await page.evaluate(() => window.__test.swaps.length) >= swapsBefore, '閉じた時は案内役(みかんちゃん)に戻すだけ');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('fr-guest')), false);
      assert.deepEqual(await page.evaluate(() => window.__test.closed), { reason: 'later', character: 'mikan' }, '閉じた知らせに、舞台の子');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// PC(1280×720)で札が開いている間は、舞台の絵(canvas)を札の左までにする(幅の広い見本の右の端が札に隠れていた。CRITux2 低 13)。
// 閉じると元の幅に戻す。札の左が狭い画面(768 の縦のタブレット)では狭めない
test('PC(1280×720): 札が開いている間は、舞台の絵を札の左に収める。閉じると戻す。狭い画面では狭めない', { skip: SLOW, timeout: 120_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  const measure = (page) =>
    page.evaluate(() => {
      const c = document.getElementById('stage').getBoundingClientRect();
      const s = document.querySelector('.fr-sheet')?.getBoundingClientRect();
      return { side: document.documentElement.classList.contains('fr-side'), canvasW: Math.round(c.width), canvasRight: Math.round(c.right), sheetLeft: s ? Math.round(s.left) : null, resized: window.__test.resized, framed: window.__test.framed };
    });
  try {
    const { ctx, page, errors } = await openPage(browser, server.base, { width: 1280, height: 720, query: 'onboard=1&character=mikan&fakeapp=mikan', reduced: true });
    try {
      await pastRole(page);
      await waitAct(page, 'words');
      await page.waitForFunction(() => document.documentElement.classList.contains('fr-side'), null, { timeout: 5000 });
      const open = await measure(page);
      assert.ok(open.canvasRight <= open.sheetLeft - 8, `舞台の絵が札にかかる ${JSON.stringify(open)}`);
      assert.ok(open.canvasW >= 420, `舞台の絵が狭すぎる ${JSON.stringify(open)}`);
      assert.ok(open.resized >= 1 && open.framed >= 1, `舞台の大きさと見せ方を取り直していない ${JSON.stringify(open)}`);
      await shot(page, 'pc1280_side_open');
      await page.click('.fr-sheet .fr-close');
      await page.waitForSelector('.fr-sheet', { state: 'detached', timeout: 15_000 });
      await page.waitForFunction(() => !document.documentElement.classList.contains('fr-side'), null, { timeout: 5000 });
      const closed = await measure(page);
      assert.equal(closed.canvasW, 1280, `閉じた後の舞台の幅 ${JSON.stringify(closed)}`);
      assert.ok(closed.resized > open.resized, '閉じた時も大きさを取り直す');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
    const tab = await openPage(browser, server.base, { width: 768, height: 1024, query: 'onboard=1&character=mikan&fakeapp=mikan', reduced: true, touch: false });
    try {
      await pastRole(tab.page);
      await waitAct(tab.page, 'words');
      await tab.page.waitForTimeout(400);
      const m = await measure(tab.page);
      assert.equal(m.side, true, `iPad の縦(768)も、横の札と、その左の舞台(OL1) ${JSON.stringify(m)}`);
      assert.ok(m.canvasRight <= m.sheetLeft - 8 && m.canvasW >= 300, `iPad の縦: 舞台の絵が札にかかる・狭すぎる ${JSON.stringify(m)}`);
      assert.deepEqual(tab.errors, [], `画面のエラー: ${tab.errors.join(' / ')}`);
    } finally {
      await tab.ctx.close();
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

// 札は画面の高さの 45% まで(第 12 波。7 つのステップの札が見本の子を隠した: 390×664 で 98%・iPhone 15 で 75%・iPad 縦で 68%)。
// 1 歩目と、絵を選んだ後(絵の欄が出る)と、見本の一覧で測る。選ぶ所は札の中で巻けるが、消えない(押す所が 1 つは見える)。
test('札の高さ(スマホ 390×844・390×664・360×640・iPad 縦 768×1024): スマホは見える高さの 55〜65%(OL1)・iPad は横の札。選ぶ所は消えない', { skip: SLOW, timeout: 150_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const server = await startServer({ MEMORY_DIR: mkdtempSync(join(tmpdir(), 'fr-mem-')) });
  const measure = (page) =>
    page.evaluate(() => {
      const sheet = document.querySelector('.fr-sheet');
      const a = document.querySelector('.fr-actions');
      const b = sheet.getBoundingClientRect();
      const visibleBtn = [...a.querySelectorAll('button, label.fr-btn, a.fr-btn')].some((e) => {
        const r = e.getBoundingClientRect();
        const ar = a.getBoundingClientRect();
        return r.height >= 40 && r.top >= ar.top - 1 && r.bottom <= ar.bottom + 1;
      });
      return { ratio: b.height / innerHeight, h: Math.round(b.height), vh: innerHeight, bottom: Math.round(innerHeight - b.bottom), visibleBtn, opaque: getComputedStyle(sheet).backgroundColor };
    });
  try {
    for (const v of [{ width: 390, height: 844 }, { width: 390, height: 664 }, { width: 360, height: 640 }, { width: 768, height: 1024 }]) {
      const label = `${v.width}×${v.height}`;
      const { ctx, page, errors } = await openPage(browser, server.base, { ...v, query: 'onboard=1', reduced: true, touch: true });
      try {
        await pastRole(page);
        await waitAct(page, 'words');
        let m = await measure(page);
        const phone = v.width < 720;
        if (phone) assert.ok(m.ratio >= 0.549 && m.ratio <= 0.661, `${label} 1 歩目: 札が画面の ${Math.round(m.ratio * 100)}%(${m.h}/${m.vh}px)`);
        if (phone) assert.equal(m.bottom, 0, `${label}: 札は画面の下いっぱい`);
        assert.ok(m.visibleBtn, `${label} 1 歩目: 選ぶ所が 1 つも見えない`);
        assert.match(m.opaque, /^rgb\(/, `${label}: 札の背景は不透明(WebKit で透けた。P1)`);
        await page.setInputFiles('.fr-actions [data-act="pick"] input[type="file"]', { name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX });
        await waitAct(page, 'col_red');
        m = await measure(page);
        if (phone) assert.ok(m.ratio >= 0.549 && m.ratio <= 0.661, `${label} 絵の欄あり: 札の高さは変わらない ${Math.round(m.ratio * 100)}%(${m.h}/${m.vh}px)`);
        assert.ok(m.visibleBtn, `${label} 絵の欄あり: 選ぶ所が 1 つも見えない`);
        await shot(page, `card45_${label}`);
        assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.proc.kill();
  }
});
