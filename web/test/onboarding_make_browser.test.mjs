// 初めての会話の 1〜3 歩を、本当の作る道で通す画面の試験(画面なしの Chrome。YC_BROWSER_TESTS=1 のときだけ。合わせの門で流す)。
// 本物の会話の画面(試しの頁)+ 本物の作る画面(PC のサーバー serve_review.py --make が配る /m/ を札の枠に出す)+ 本物の PC の側
// (yuru_make.py next)で、言葉 → 段 0 の絵 → 直したい(一言)= G1 → 2 回目 → この子にする → 性格、と、
// 絵 → ゆるキャラチェック(人の絵)→ ゆるキャラにしてみる → 絵、を通す。絵とチェックだけは試験のふり(Claude を呼ばない)。
// 舞台の WebGL は使わない(CPU の 3D 描画にならない)。FR_SHOTS_DIR を渡すと写真を残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const WEB = join(import.meta.dirname, '..');
const ROOT = join(WEB, '..');
const SRC = join(WEB, 'src');
const SHOTS = process.env.FR_SHOTS_DIR || '';
const PY = process.env.PYTHON || 'python';
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';
const HAS_PY = !SLOW && spawnSync(PY, ['-c', 'import PIL'], { windowsHide: true }).status === 0;
const PICTURE = join(ROOT, 'creator', 'samples', 'mikan_元の絵.png');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * 試しの頁と web/src だけを配る小さなサーバー。Playwright の横取り(route)で頁を渡すと、Chrome は頁の場所が分からず、
 * 手元の PC の作る画面(127.0.0.1)を枠に入れるのを「手元の通信の確かめ」で止める(実測: ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS)。
 * 本物の会話の画面(vite・会話のサーバー)と同じく、この PC の住所から配る。
 */
async function startWeb() {
  const port = await freePort();
  const server = createHttpServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (path === '/__fr/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    const file = join(WEB, path.replace(/^\/__fr\//, ''));
    if (!path.startsWith('/__fr/') || !file.startsWith(SRC) || !TYPES[extname(file)]) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] });
    res.end(readFileSync(file, 'utf8'));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { proc: { kill: () => server.close() }, base: `http://127.0.0.1:${port}` };
}

async function startMake(work, token, allow) {
  const env = { ...process.env, YC_REVIEW_TEST: '1', YC_REVIEW_TOKEN: token, YC_REVIEW_WORK: work };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawn(PY, [join(ROOT, 'creator', 'review', 'serve_review.py'), '--make', '--port', '0', '--allow-origin', allow], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`作る道のサーバーが起きない: ${out}`)), 15000);
    proc.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/PORT (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.stderr.on('data', (c) => (out += c));
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

/** PC の側: yuru_make.py next を 1 回(待つのは 20 秒まで) */
function pcNext(work, ...extra) {
  return pcNextEnv(work, {}, ...extra);
}

/** pcNext と同じ。more は足す環境変数(試験の絵の描き方 YC_FAKE_REDO など) */
function pcNextEnv(work, more, ...extra) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...more, YC_REVIEW_WORK: work };
    delete env.ANTHROPIC_API_KEY;
    const p = spawn(PY, [join(ROOT, 'creator', 'review', 'yuru_make.py'), 'next', '--wait', '20', ...extra], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('exit', () => {
      const i = out.lastIndexOf('\n{');
      try {
        resolve(JSON.parse(i >= 0 ? out.slice(i + 1) : out.slice(out.indexOf('{'))));
      } catch {
        resolve({ raw: out });
      }
    });
  });
}

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/__fr/src/ui/style.css"><title>作る道の試し</title></head>
<body><header class="top"><div class="modes" id="modes"></div></header>
<div id="gate" class="gate"><div class="gate-card"><h1>入口</h1></div></div>
<script type="module">
import { mountFirstRun } from '/__fr/src/ui/onboarding/index.js';
import { seededRandom } from '/__fr/src/ui/persona/settings.js';
window.__fr = mountFirstRun({ app: null, params: new URLSearchParams(location.search), buttonHost: document.getElementById('modes'), random: seededRandom(5) });
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

async function openPage(browser, web, make, token, width, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: width < 720, isMobile: width < 720, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('requestfailed', (r) => errors.push(`通信の失敗 ${r.failure()?.errorText ?? ''}`));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${web}/__fr/index.html?onboard=1#yc-make=${encodeURIComponent(make)}&yc-key=${token}`);
  return { ctx, page, errors };
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const logText = (page) => page.$eval('.fr-log', (e) => e.innerText);
/** 入力欄の例(placeholder)を出すのに要る幅と、欄の中の幅(px)。同じ字の形の見えない span で測る */
const placeholderRoom = (frame, id) =>
  frame.evaluate((id) => {
    const inp = document.getElementById(id);
    const cs = getComputedStyle(inp);
    const span = Object.assign(document.createElement('span'), { textContent: inp.placeholder });
    Object.assign(span.style, { font: cs.font, letterSpacing: cs.letterSpacing, position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' });
    document.body.append(span);
    const need = span.getBoundingClientRect().width;
    span.remove();
    const room = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { need: Math.ceil(need), room: Math.floor(room), width: Math.round(inp.getBoundingClientRect().width), text: inp.placeholder };
  }, id);
async function frameOf(page) {
  await page.waitForSelector('iframe.fr-frame', { timeout: 15_000 });
  const handle = await page.$('iframe.fr-frame');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('#mk', { timeout: 15_000 });
  return frame;
}
async function fits(page, frame, where) {
  const outer = await page.evaluate(() => ({ vw: window.innerWidth, sw: document.documentElement.scrollWidth }));
  assert.ok(outer.sw <= outer.vw, `${where}: 会話の画面が横にはみ出した(${outer.sw} > ${outer.vw})`);
  const inner = await frame.evaluate(() => {
    const small = [...document.querySelectorAll('.mk-btn, input[type="text"]')]
      .filter((e) => !e.closest('[hidden]') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5)
      .map((e) => `${e.id || e.className} ${e.getBoundingClientRect().height.toFixed(1)}px`);
    return { vw: window.innerWidth, sw: document.documentElement.scrollWidth, small };
  });
  assert.ok(inner.sw <= inner.vw, `${where}: 作る画面が横にはみ出した(${inner.sw} > ${inner.vw})`);
  assert.deepEqual(inner.small, [], `${where}: 作る画面の押す所が 44px より小さい`);
}

test('作る道(幅 390): 言葉 → PC の絵 → 直したい(一言)= G1 → 2 回目 → この子にする → 性格', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-make-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 390);
    try {
      const frame = await frameOf(page);
      assert.equal(new URL(page.url()).hash, '', '合言葉をアドレスの欄に残さない');
      assert.equal(new URL(frame.url()).hash, '', '枠の中でも消す');
      assert.match(await logText(page), /ノリーデス/);
      assert.match(await logText(page), /Anthropic\)に 送られるよ/);
      await fits(page, frame, '1 歩目');
      await shot(page, 'make390_1_input');
      await frame.fill('#words', '赤い提灯の子');
      await frame.click('#wordsBtn');
      await frame.waitForSelector('#waiting:not([hidden])');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('パソコンの Claude Code に わたしたよ'));
      assert.doesNotMatch(await logText(page), /\/yuru-next/, '子どもの画面にパソコンのコマンドを出さない(動かし方は作る画面の中。OL1)');
      assert.equal(await page.$eval('.fr-sheet', (e) => e.dataset.step), '3', '言葉のときは 2 歩目(チェック)をとばす');
      const pc1 = await pcNext(work, '--fake-draw');
      assert.equal(pc1.did, 'drew', JSON.stringify(pc1));
      await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
      assert.match(await frame.$eval('#picCap', (e) => e.textContent), /1 回目の試しの絵です。Claude は呼んでいません/);
      assert.doesNotMatch(await frame.$eval('#picCap', (e) => e.textContent), /C0|段 \d/, '内部の言葉を出さない(D7)');
      // 作る画面は img の src(blob:)と #c0 を同じ時に出し、絵はその後に読み込まれる(ふだん 2〜8ms)。#c0 だけを待って
      // すぐ読むと、絵の読み込みが詰まった時に naturalWidth 0 で落ちる(順の揺れ。絵を 60ms 遅らせると必ず落ちた)。
      // PC の 3 本目と同じく、読み終わるのを待ってから同じ文で確かめる(読めなければ「描いた絵が出る」で落ちる)
      await frame.waitForFunction(() => document.getElementById('pic').naturalWidth > 0, null, { timeout: 10_000 }).catch(() => {});
      assert.ok(await frame.$eval('#pic', (e) => e.naturalWidth > 0), '描いた絵が出る');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('こんな子が できたよ。どうかな?'));
      await fits(page, frame, '3 歩目');
      await shot(page, 'make390_3_c0');

      // G1: 会話の画面の中で、文字で頼む → request.json → PC の /yuru-next が描き直す
      await frame.fill('#note', '帽子を青にして');
      await frame.click('#noteBtn');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('なおったら 見せるね'));
      const req = JSON.parse(readFileSync(join(work, pc1.id, 'review', 'request.json'), 'utf8'));
      assert.deepEqual([req.gate, req.decision, req.note.text], ['C0', 'redo', '帽子を青にして']);
      // 試験の絵は、頼んでいない体の色まで変える(drift)。PC の決まった確かめが 1 回だけ自動で描き直し、それでも違うので、
      // 絵は出したうえで、作る画面と札に「頼んでいない所も変わりました: 体の色…」を出す(第 11 波・N-0026)
      const pc2 = await pcNextEnv(work, { YC_FAKE_REDO: 'drift' }, '--fake-draw');
      assert.equal(pc2.did, 'redrew', JSON.stringify(pc2));
      assert.equal(pc2.identity?.passes, 2, `決まった確かめの後に 1 回だけ描き直す ${JSON.stringify(pc2.identity)}`);
      await frame.waitForFunction(() => document.querySelector('#picCap')?.textContent.includes('2 回目'), null, { timeout: 20_000 });
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('なおしてみたよ。どうかな?'));
      const drift = await frame.$eval('#drift', (e) => ({ hidden: e.hidden, text: e.textContent }));
      assert.ok(!drift.hidden && /^頼んでいない所も変わりました: .*体の色/.test(drift.text), `作る画面に頼んでいない変化の一言が無い ${JSON.stringify(drift)}`);
      // QF4 中 11: 知らせは 2 つの列の外(絵と「この子にする」の上)に置く。列が左の細い列に崩れない
      const pos = await frame.evaluate(() => ({ d: document.getElementById('drift').getBoundingClientRect(), f: document.querySelector('#c0 .mk-fig').getBoundingClientRect(), ok: document.getElementById('okBtn').getBoundingClientRect(), w: innerWidth }));
      assert.ok(pos.d.bottom <= pos.f.top + 1, `知らせは絵の上 ${JSON.stringify(pos)}`);
      assert.ok(pos.ok.width > pos.w * 0.35, `「この子にする」の列が細く崩れない ${JSON.stringify(pos)}`);
      await page.waitForFunction(() => /頼んでいない所も変わりました: .*体の色/.test(document.querySelector('.fr-log').innerText), null, { timeout: 10_000 }).catch(() => {});
      assert.match(await logText(page), /頼んでいない所も変わりました: .*体の色/, '札にも頼んでいない変化の一言');
      await fits(page, frame, '3 歩目(2 回目・頼んでいない変化の一言つき)');
      await shot(page, 'make390_3_c0_r2');

      await frame.click('#okBtn');
      await page.waitForSelector('.fr-actions [data-act="persona_ok"]', { timeout: 15_000 });
      assert.equal(await page.$('.fr-actions iframe.fr-frame'), null, '決めたら作る画面の枠を閉じる');
      assert.match(await logText(page), /けってい! パソコンに つたえたよ/);
      assert.match(await logText(page), /それまでは、ノリーが かわりに 舞台に立って/, '主役が代わりに立つと言う(D5)');
      assert.doesNotMatch(await logText(page), /段 \d|C0/, '札に内部の言葉(段 0・C0)を出さない(D7)');
      // 描いた絵は、札の上の小さな枠(絵だけ)に出したまま。話している間も見える(D5)
      const pic = await page.waitForSelector('.fr-pin iframe.fr-frame', { timeout: 10_000 });
      assert.match(await pic.getAttribute('src'), /\/m\/#k=.*&view=pic$/);
      const picFrame = await pic.contentFrame();
      await picFrame.waitForFunction(() => (document.getElementById('donePic')?.naturalWidth ?? 0) > 0, null, { timeout: 15_000 });
      assert.equal(await picFrame.$eval('#okBtn', (e) => e.offsetParent === null), true, '絵だけの枠にボタンを出さない');
      assert.match(await page.$eval('.fr-pin-cap', (e) => e.textContent), /パソコンの Claude Code が描いた絵。3D はまだ/);
      const box = await page.$eval('.fr-pin', (e) => e.getBoundingClientRect().height);
      assert.ok(box > 0 && box < 140, `絵の欄は小さく ${box}`);
      await shot(page, 'make390_4_persona');
      const pc3 = await pcNext(work, '--fake-draw');
      assert.equal(pc3.did, 'claimed_ok', JSON.stringify(pc3));
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

test('作る道(幅 400): 絵 → ゆるキャラチェック(人の絵)→ ゆるキャラにしてみる → 絵', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-make-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 400);
    try {
      const frame = await frameOf(page);
      await frame.setInputFiles('#pick', { name: 'drawing.png', mimeType: 'image/png', buffer: readFileSync(PICTURE) });
      await frame.waitForSelector('#waiting:not([hidden])');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('(絵を わたした)'));
      const pc1 = await pcNext(work, '--fake-check', 'human', '--fake-draw');
      assert.equal(pc1.did, 'checked', JSON.stringify(pc1));
      await frame.waitForSelector('#check:not([hidden])', { timeout: 20_000 });
      assert.equal(await frame.$eval('#chooseBtn', (e) => e.textContent), 'ゆるキャラにしてみる');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('ゆるキャラに してみる?'));
      await fits(page, frame, '2 歩目');
      await shot(page, 'make400_2_check');
      await frame.click('#chooseBtn');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('描けたら 見せるね'));
      const pc2 = await pcNext(work, '--fake-check', 'human', '--fake-draw');
      assert.equal(pc2.did, 'drew', JSON.stringify(pc2));
      await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('こんな子が できたよ。どうかな?'));
      const orig = readFileSync(join(work, pc1.id, 'review', 'original.png'));
      assert.ok(orig.length > 0 && orig.subarray(0, 4).toString('latin1') === '\x89PNG', '絵は PC の作業場所にだけ届く(png に描き直して)');
      await shot(page, 'make400_3_c0');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill();
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

// PC(1280×720): 札は下の帯(会話の欄と「送る」)の上。作る画面は暗い色で、絵を左・ボタンを右に並べ、枠を巻かずに「直したい」まで見える(CRITux 14・22)
test('作る道(PC 1280×720): 札が下の帯を隠さず、作る画面の「直したい」まで巻かずに見える', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-make-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 1280, 720);
    try {
      // 会話の画面(main.js)が測る上の段と下の帯の高さのまね(1280×720 の実測に近い値)
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--top-h', '96px');
        document.documentElement.style.setProperty('--bottom-h', '110px');
      });
      const frame = await frameOf(page);
      await frame.fill('#words', '赤い提灯の子');
      await frame.click('#wordsBtn');
      await frame.waitForSelector('#waiting:not([hidden])');
      const pc1 = await pcNext(work, '--fake-draw');
      assert.equal(pc1.did, 'drew', JSON.stringify(pc1));
      await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
      await frame.waitForFunction(() => document.getElementById('pic').naturalWidth > 0, null, { timeout: 10_000 });
      const sheet = await page.$eval('.fr-sheet', (e) => {
        const b = e.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
      });
      assert.ok(sheet.bottom <= 720 - 110 - 11, `札が下の帯にかかる ${JSON.stringify(sheet)}`);
      assert.ok(sheet.top >= 96, `札が上の段にかかる ${JSON.stringify(sheet)}`);
      const inner = await frame.evaluate(() => {
        const vh = innerHeight;
        const bottom = (id) => Math.round(document.getElementById(id).getBoundingClientRect().bottom);
        return { vh, ok: bottom('okBtn'), note: bottom('noteBtn'), again: bottom('againBtn'), bg: getComputedStyle(document.body).backgroundColor, sh: document.documentElement.scrollHeight };
      });
      assert.ok(inner.note <= inner.vh && inner.ok <= inner.vh, `「この子にする」「直したい」が枠の下に隠れた ${JSON.stringify(inner)}`);
      assert.equal(inner.bg, 'rgb(29, 26, 46)', '作る画面は会話の画面と同じ暗い色');
      // 一言の欄は、例「例: 帽子を青にして」が切れない幅(欄が 70px ほどで「例: 帽」で切れていた。CRITux2 低 10)
      const note = await placeholderRoom(frame, 'note');
      assert.ok(note.need <= note.room, `一言の欄の例が切れる ${JSON.stringify(note)}`);
      assert.match(await frame.$eval('#noteBtn', (e) => e.innerText.trim()), /直したい/, 'ボタンは「直したい」と読める');
      await fits(page, frame, 'PC 3 歩目');
      await shot(page, 'make1280_3_c0');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
      return { sheet, inner };
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

// SVG の絵(Claude が描く絵も SVG)を、作る画面で受ける(断っていた。使える形も言わなかった。CRITux2 低 5)。
// ゆるキャラの絵は 1 回の /yuru-next でチェックと絵が続けて流れる: 札では「ゆるキャラにぴったりの絵だね」が、PC の様子
// (「絵を描いています」「絵ができました」)より先に出る(順が逆だった。CRITux2 低 11)
const TEST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240"><ellipse cx="100" cy="130" rx="80" ry="90" fill="#7cc4ff"/><circle cx="72" cy="120" r="10" fill="#222"/><circle cx="128" cy="120" r="10" fill="#222"/><path d="M80 160 Q100 178 120 160" stroke="#222" stroke-width="6" fill="none"/></svg>';

test('作る道(幅 390): SVG の絵 → ゆるキャラチェック(ゆるキャラ)→ チェックの言葉が描く知らせより先 → 絵。使える絵の形を書いてある', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-make-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 390);
    try {
      const frame = await frameOf(page);
      const formats = await frame.$eval('#formats', (e) => ({ text: e.textContent, shown: e.offsetParent !== null }));
      assert.ok(formats.shown && /PNG/.test(formats.text) && /JPEG/.test(formats.text) && /SVG/.test(formats.text), `使える絵の形: ${JSON.stringify(formats)}`);
      // QF4 低 15: 前の赤い断りの文は、新しく書き始めたら消える(前は残って、次の入力の横に居座った)
      await frame.setInputFiles('#pick', { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
      await frame.waitForFunction(() => !document.getElementById('err').hidden, null, { timeout: 5000 });
      await frame.fill('#words', 'あ');
      assert.equal(await frame.$eval('#err', (e) => e.hidden), true, '書き始めたら、前の断りは消える');
      await frame.fill('#words', '');
      await frame.setInputFiles('#pick', { name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(TEST_SVG) });
      await frame.waitForSelector('#waiting:not([hidden])', { timeout: 15_000 });
      assert.equal(await frame.$eval('#err', (e) => e.hidden), true, `SVG を断った: ${await frame.$eval('#err', (e) => e.textContent)}`);
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('(絵を わたした)'));
      const pc1 = await pcNext(work, '--fake-check', 'yuru', '--fake-draw');
      assert.equal(pc1.did, 'drew', JSON.stringify(pc1));
      const orig = readFileSync(join(work, pc1.id, 'review', 'original.png'));
      assert.ok(orig.subarray(0, 4).toString('latin1') === '\x89PNG', 'SVG はこの画面の中で絵にして、PC の作業場所にだけ届く(png に描き直して)');
      await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('こんな子が できたよ。どうかな?'), null, { timeout: 15_000 });
      const log = await logText(page);
      const check = log.indexOf('ゆるキャラに ぴったりの絵だね。');
      const drawing = Math.min(...['絵を描いています', '絵ができました'].map((w) => log.indexOf(w)).filter((i) => i >= 0));
      assert.ok(check >= 0, `チェックの言葉が無い: ${log}`);
      assert.ok(Number.isFinite(drawing) && check < drawing, `チェックの言葉が、描く知らせより後に出た: ${log}`);
      await shot(page, 'make390_svg_c0');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------- 眉のおすすめ・よく頼む直し・おまかせ(本人 11/7。第 11d 波) ----------
const BROW_NORMAL = '眉を足す(ふつうの太さ)。ほかは変えない';

/** 作る画面の、眉の札・よく頼む直し・絵・「この子にする」「直したい」の箱と大きさ */
const browLayout = (frame) =>
  frame.evaluate(() => {
    const r = (e) => (e ? e.getBoundingClientRect() : null);
    const slot = document.getElementById('browSlot');
    const box = (e) => (e ? { top: Math.round(r(e).top), bottom: Math.round(r(e).bottom), left: Math.round(r(e).left), right: Math.round(r(e).right) } : null);
    return {
      vh: window.innerHeight,
      hidden: slot.hidden,
      title: slot.querySelector('.sg-title')?.textContent ?? '',
      why: slot.querySelector('.sg-why')?.textContent ?? '',
      btns: [...slot.querySelectorAll('.sg-btn')].map((b) => ({ text: b.textContent, h: Math.round(r(b).height) })),
      chips: [...document.querySelectorAll('#quick .sg-chip')].map((b) => ({ text: b.textContent, h: Math.round(r(b).height) })),
      card: box(slot.hidden ? null : slot),
      pic: box(document.getElementById('pic')),
      ok: box(document.getElementById('okBtn')),
      note: box(document.getElementById('noteBtn')),
      chipRow: box(document.getElementById('quick')),
      again: box(document.getElementById('againBtn')),
      auto: box(document.getElementById('autoPick')),
    };
  });
// 直しは 3 回まで(第 12 波・CRITux3 D1): 4 枚目の絵の後は、一言の欄(直したい)が畳まれて理由が出る。画面と PC が互いを待たない。
// 「この子にする」は通る。サーバーが 4 回目の直しを断る事は creator/review/tests/test_make.py が見る。
test('作る道(幅 390): 直しは 3 回まで。4 枚目の絵の後は「直したい」が畳まれ、「この子にする」で進める', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 240_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-limit-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 390, 844);
    try {
      const frame = await frameOf(page);
      await frame.fill('#words', '青い雲の子');
      await frame.click('#wordsBtn');
      await frame.waitForSelector('#waiting:not([hidden])');
      assert.equal((await pcNext(work, '--fake-draw')).did, 'drew');
      await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
      for (const n of [2, 3, 4]) {
        assert.equal(await frame.$eval('#noteForm', (e) => e.hidden), false, `${n - 1} 枚目の絵では、まだ直せる`);
        await frame.fill('#note', '帽子を青にして');
        await frame.click('#noteBtn');
        await frame.waitForSelector('#waiting:not([hidden])');
        const pc = await pcNext(work, '--fake-draw');
        assert.equal(pc.did, 'redrew', JSON.stringify(pc));
        await frame.waitForFunction((k) => document.querySelector('#picCap')?.textContent.includes(`${k} 回目`) && !document.getElementById('c0').hidden, n, { timeout: 20_000 });
      }
      const lim = await frame.evaluate(() => ({ form: document.getElementById('noteForm').classList.contains('mk-off') && document.getElementById('note').disabled && document.getElementById('noteBtn').disabled, limit: !document.getElementById('limit').hidden, text: document.getElementById('limit').textContent, ok: !document.getElementById('okBtn').disabled, again: !document.getElementById('againBtn').hidden }));
      assert.deepEqual([lim.form, lim.limit, lim.ok, lim.again], [true, true, true, true], `4 枚目の絵の後は、一言の欄と送るが灰色で押せない(確かめる画面と同じ。QF4 低 15)。画面 ${JSON.stringify(lim)}`);
      assert.match(lim.text, /直しは 3 回までです。この子にするか/);
      await fits(page, frame, '4 枚目の絵(直しの上限)');
      await shot(page, 'make390_3_c0_limit');
      await frame.click('#okBtn');
      await page.waitForSelector('.fr-actions [data-act="persona_ok"]', { timeout: 15_000 });
      assert.equal((await pcNext(work, '--fake-draw')).did, 'claimed_ok');
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill();
    web.proc.kill();
  }
});

const overlap = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);

for (const [w, h] of [[390, 844], [390, 670], [1280, 720]]) {
  test(`眉のおすすめ(${w}×${h}): 眉の無い絵 → 札とよく頼む直し → 足す(ふつう)= 決まった一言 → 眉あり → 札が消える`, { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
    const work = mkdtempSync(join(tmpdir(), 'fr-brow-'));
    const token = randomBytes(16).toString('hex');
    const web = await startWeb();
    const make = await startMake(work, token, web.base);
    try {
      const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, w, h);
      try {
        if (w >= 720) await page.evaluate(() => { document.documentElement.style.setProperty('--top-h', '96px'); document.documentElement.style.setProperty('--bottom-h', '110px'); });
        const frame = await frameOf(page);
        const left = await page.$eval('.fr-left', (e) => e.innerText.replace(/\s+/g, ' '));
        assert.match(left, /あと 6 つ\s*\d+ 分くらい/, `上の段に、あと いくつ・あと 何分 ${left}`);
        await frame.fill('#words', 'みかんの子。頭に葉っぱ');
        await frame.click('#wordsBtn');
        await frame.waitForSelector('#waiting:not([hidden])');
        const pc1 = await pcNext(work, '--fake-draw');
        assert.equal(pc1.did, 'drew', JSON.stringify(pc1));
        await frame.waitForSelector('#c0:not([hidden])', { timeout: 20_000 });
        await frame.waitForFunction(() => document.getElementById('pic').naturalWidth > 0, null, { timeout: 10_000 }).catch(() => {});
        const L = await browLayout(frame);
        assert.equal(L.hidden, false, '眉の無い絵におすすめの札を出す');
        assert.equal(L.title, '眉を足しませんか?(おすすめ)');
        assert.equal(L.why, '眉があると、うれしい・こまった・おこった などの気持ちが、ぐっと伝わりやすくなります');
        assert.deepEqual(L.btns.map((b) => b.text), ['足す(ふつう)', '足す(ほそめ)', '足す(ふとめ)', '足さない']);
        assert.deepEqual(L.chips.map((b) => b.text), ['眉を足す', '目を大きく', '色を明るく', '小物を足す', '形はそのまま色だけ変える']);
        for (const b of [...L.btns, ...L.chips]) assert.ok(b.h >= 44, `押す所は 44px 以上: ${b.text} ${b.h}px`);
        assert.ok(!overlap(L.card, L.pic), `札が絵に重ならない ${JSON.stringify(L)}`);
        assert.ok(L.card.bottom <= L.ok.top, `札は「この子にする」の上 ${JSON.stringify(L)}`);
        if (w >= 720) assert.ok(L.card.bottom <= L.vh && L.ok.bottom <= L.vh && L.note.bottom <= L.vh, `PC の背の低い枠でも、札・「この子にする」「直したい」は巻かずに見える ${JSON.stringify(L)}`);
        // 第 12 波: よく頼む直しの列とおまかせ(と「別の子に」)も、枠の中を巻かずに見える(眉の札の下で隠れていた)
        if (w >= 720) assert.ok(L.chipRow.bottom <= L.vh && L.again.bottom <= L.vh && L.auto.bottom <= L.vh, `PC 1280×720 でも、よく頼む直し・おまかせは巻かずに見える ${JSON.stringify(L)}`);
        await fits(page, frame, `眉の札(${w}×${h})`);
        await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('眉を 足すと'), null, { timeout: 10_000 });
        assert.match(await logText(page), /眉を 足すと/, '札にも、眉のおすすめの一言');
        await shot(page, `brow${w}x${h}_1_card`);
        // よく頼む直し: 押すと一言の欄に入り、送る前に書き直せる
        await frame.click('#quick .sg-chip:nth-child(2)');
        assert.equal(await frame.$eval('#note', (e) => e.value), '目を大きく。ほかは変えない');
        assert.equal(await frame.$eval('#noteBtn', (e) => e.disabled), false);
        await frame.fill('#note', '');
        // キーボード: 札のボタンに Tab で届き、Enter で押せる(足す(ふつう))
        await frame.focus('#browSlot .sg-btn.primary');
        await frame.press('#browSlot .sg-btn.primary', 'Enter');
        await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('なおったら 見せるね'));
        const req = JSON.parse(readFileSync(join(work, pc1.id, 'review', 'request.json'), 'utf8'));
        assert.deepEqual([req.gate, req.decision, req.note.text], ['C0', 'redo', BROW_NORMAL], '決まった一言で、ふつうのやり直し');
        const pc2 = await pcNextEnv(work, { YC_FAKE_REDO: 'brows' }, '--fake-draw');
        assert.equal(pc2.did, 'redrew', JSON.stringify(pc2));
        assert.deepEqual(pc2.identity?.beyond, [], `眉だけ足した = 頼んでいない変化なし ${JSON.stringify(pc2.identity)}`);
        await frame.waitForFunction(() => document.querySelector('#picCap')?.textContent.includes('2 回目'), null, { timeout: 20_000 });
        assert.equal(await frame.$eval('#browSlot', (e) => e.hidden), true, '眉のある絵には札を出さない');
        await shot(page, `brow${w}x${h}_2_after`);
        assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
      } finally {
        await ctx.close();
      }
    } finally {
      await browser.close();
      make.proc.kill(); // 自分で起こした PID だけ
      web.proc.kill();
      rmSync(work, { recursive: true, force: true });
    }
  });
}

test('眉のおすすめ(幅 390): 「足さない」で札が消え、この子にはもう出さない', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-brow-no-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 390);
    try {
      const frame = await frameOf(page);
      await frame.fill('#words', 'まるい子');
      await frame.click('#wordsBtn');
      await frame.waitForSelector('#waiting:not([hidden])');
      const pc1 = await pcNext(work, '--fake-draw');
      await frame.waitForSelector('#browSlot:not([hidden])', { timeout: 20_000 });
      await frame.click('#browSlot .sg-btn.no');
      assert.equal(await frame.$eval('#browSlot', (e) => e.hidden), true, '足さない → 札が消える');
      // 一言で描き直しても(眉のまま無い絵)、この子にはもう出さない
      await frame.fill('#note', '帽子を青にして');
      await frame.click('#noteBtn');
      await frame.waitForSelector('#waiting:not([hidden])');
      const pc2 = await pcNextEnv(work, { YC_FAKE_REDO: 'keep' }, '--fake-draw');
      assert.equal(pc2.did, 'redrew', JSON.stringify(pc2));
      await frame.waitForFunction(() => document.querySelector('#picCap')?.textContent.includes('2 回目'), null, { timeout: 20_000 });
      assert.equal(await frame.$eval('#browSlot', (e) => e.hidden), true, 'この子には、もう出さない');
      assert.equal(pc1.id, pc2.id);
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

test('おまかせ(ぜんぶ じどう、幅 390): 1 回押すと、言葉・眉・この子にする・性格まで全部おすすめで決まり、最後まで行く', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 180_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const work = mkdtempSync(join(tmpdir(), 'fr-auto-'));
  const token = randomBytes(16).toString('hex');
  const web = await startWeb();
  const make = await startMake(work, token, web.base);
  try {
    const { ctx, page, errors } = await openPage(browser, web.base, make.base, token, 390);
    try {
      const frame = await frameOf(page);
      const auto = await frame.$eval('#autoStart', (e) => ({ text: e.innerText.replace(/\s+/g, ' '), h: Math.round(e.getBoundingClientRect().height) }));
      assert.match(auto.text, /^おまかせ\(ぜんぶ じどう\)/);
      assert.match(auto.text, /あとから 直せます/, 'あとから変えられると書く');
      assert.ok(auto.h >= 44, `おまかせは大きなボタン ${auto.h}px`);
      await frame.click('#autoStart'); // 押すのは、この 1 回だけ
      await frame.waitForSelector('#waiting:not([hidden])');
      const pc1 = await pcNext(work, '--fake-draw');
      assert.equal(pc1.did, 'drew', JSON.stringify(pc1));
      // 眉の無い絵 → おまかせは眉を足す(ふつう)を選んで、ふつうのやり直し
      const reqPath = join(work, pc1.id, 'review', 'request.json');
      await page.waitForFunction(() => document.querySelector('.fr-log').innerText.includes('なおったら 見せるね'), null, { timeout: 20_000 });
      const req = JSON.parse(readFileSync(reqPath, 'utf8'));
      assert.deepEqual([req.decision, req.note.text], ['redo', BROW_NORMAL]);
      const pc2 = await pcNextEnv(work, { YC_FAKE_REDO: 'brows' }, '--fake-draw');
      assert.equal(pc2.did, 'redrew', JSON.stringify(pc2));
      // 眉のある絵 → おまかせは「この子にする」→ 会話の札も性格から後をおすすめで決めて、最後まで
      await page.waitForFunction(() => document.querySelector('.fr-log')?.innerText.includes('おまかせで、ぜんぶ きめマシタ!'), null, { timeout: 25_000 });
      await page.waitForFunction(() => document.querySelector('.fr-log')?.innerText.includes('ぜんぶ、あとから かえられるよ。'), null, { timeout: 10_000 });
      const log = await logText(page);
      assert.match(log, /きめたこと: .*文字と おと[\s\S]*あとから かえられるよ/);
      assert.match(log, /けってい! パソコンに つたえたよ/);
      const ok = JSON.parse(readFileSync(join(work, pc1.id, 'review', 'request.json'), 'utf8'));
      assert.equal(ok.decision, 'ok');
      // QF4 中 5: 終わっても札を自動で閉じない。決めたことと「はじめる」を出し、押した時だけ閉じる
      await page.waitForSelector('.fr-actions [data-act="begin"]', { timeout: 10_000 });
      await page.waitForTimeout(2500);
      assert.ok(await page.$('.fr-sheet'), '2.5 秒たっても閉じない');
      assert.equal(await page.evaluate(() => localStorage.getItem('yc.onboarded.v1')), 'done', '初めての会話は終わり');
      await page.click('.fr-actions [data-act="begin"]');
      await page.waitForFunction(() => !document.querySelector('.fr-sheet'), null, { timeout: 10_000 });
      assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    web.proc.kill();
    rmSync(work, { recursive: true, force: true });
  }
});
