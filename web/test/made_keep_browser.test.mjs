// 作った子が「いつも残り・かえるから選べ・名前を変えられ・消せ・読み込み直しても同じ子で・記憶は子ごと」を、
// 本物の画面(vite build を一時フォルダへ)と本物の手元のサーバーと、画面なしの Chrome で通しで確かめる。
//  1. 作った子 2 人(characters/yb* に、to_2d.py が作るのと同じ形で置く)が、「かえる」の「つくった子」に並ぶ
//  2. 選ぶと舞台がその子になり、読み込み直しても同じ子で始まる(端末が覚える)
//  3. 名前を変えると、サーバーのファイルが変わり、読み込み直しても新しい名前
//  4. 別の端末(別の保存場所)でも、サーバーを入れ直した後でも、同じ子が並ぶ
//  5. 記憶は子ごと: A に話したことは、B は知らない。「覚えていること」の札も、舞台の子の分だけ
//  6. 消す: 1 回の確かめで消える(捨てずに別の場所へ移す)。その子の記憶も消え、舞台にいたら主役に戻る
// 重いので YC_BROWSER_TESTS=1 のときだけ(Chrome が無ければ飛ばす。CHROME_PATH で場所を渡せる)。作った子は、一時のリポジトリの頭(YC_REPO_ROOT)に置き、試験の後にまるごと消す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:net';
import { GPU_ARGS } from '../src/stage/gpuGuard.js';

const WEB = join(import.meta.dirname, '..');
const REAL_REPO = join(WEB, '..');
// 試験の間だけの、リポジトリの頭の代わり(YC_REPO_ROOT)。本物の characters/ に試験の子を置くと、同時に流れる別の試験が数え違える
let REPO = '';
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ(編集ごとの試験を 30 秒未満にするため。合わせの門で流す)';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.task': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
// 試験用の作った子(本物の日付 yb26… と混ざらない、遠い日付)
const K1 = 'yb991231_a1b2c3';
const K2 = 'yb991231_d4e5f6';
const KIDS = [K1, K2];
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// YC_TEST_PORT_BASE=9500 のように渡すと、その番号から 10 個の中の空いた番号を使う(決まった番号の枠で試す時)。無ければ OS が選ぶ
const PORT_BASE = Number(process.env.YC_TEST_PORT_BASE) || 0;
const tryPort = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(0));
    s.listen(port, '127.0.0.1', () => {
      const got = s.address().port;
      s.close(() => resolve(got));
    });
  });
async function freePort() {
  if (!PORT_BASE) return tryPort(0);
  for (let p = PORT_BASE; p < PORT_BASE + 10; p++) {
    const got = await tryPort(p);
    if (got) return got;
  }
  throw new Error(`YC_TEST_PORT_BASE ${PORT_BASE} からの 10 個が埋まっています`);
}

async function startServer(memDir) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'keep-log-')), MEMORY_DIR: memDir, YC_REPO_ROOT: REPO };
  delete env.ANTHROPIC_API_KEY; // 本物の頭脳を呼ばない(仮の頭脳)
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
  env.YC_BROWSER_DRAW = '1'; // 名前の変更と消すを許す設定(鍵が無いので、描く道そのものは動かない)
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
    return await chromium.launch({ ...opts, headless: true, args: GPU_ARGS });
  } catch {
    return null;
  }
}

/** 作った子 1 人分を、to_2d.py が作るのと同じ形で置く(2D の部品は、見本のようこそくんの物を写す) */
function plantKid(id, name) {
  const dir = join(REPO, 'characters', id);
  mkdirSync(dir, { recursive: true });
  cpSync(join(REAL_REPO, 'characters', 'yokoso', '2d'), join(dir, '2d'), { recursive: true });
  writeFileSync(join(dir, 'character.json'), JSON.stringify({ id, name, schema_version: 1, persona: 'persona.md', looks: { '2d': { parts: '2d/parts.json' }, default: '2d' }, role: 'home', origin: { drawn_by: 'claude', created: new Date().toISOString() } }, null, 2));
  writeFileSync(join(dir, 'persona.md'), `# ${name}\n\n- 生まれ: 使う人の言葉か絵から、Claude が描いた絵で生まれたゆるキャラ。\n- 話し方: やさしく、短く。\n`);
}

const kidDir = (id) => join(REPO, 'characters', id);
const trashed = (id) => {
  const root = join(REPO, 'creator', 'work', '_deleted_characters');
  return existsSync(root) ? readdirSync(root).filter((n) => n.startsWith(`${id}_`)) : [];
};

/** 1 台の端末(別の保存場所)。画面は一時フォルダの組み立てから配る(API とキャラのデータはサーバーへ) */
async function openDevice(browser, server, dist) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('yc.onboarded.v1')) localStorage.setItem('yc.onboarded.v1', 'done'); // 初めての会話の札は、この試験では出さない
    } catch {
      // 保存が使えなければ、そのまま
    }
  });
  await ctx.route(`${server.base}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.startsWith('/api/') || path.startsWith('/characters/') || path.startsWith('/places/')) return route.continue();
    const file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dist) || !existsSync(file)) return route.continue();
    return route.fulfill({ status: 200, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  const page = await ctx.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  return { ctx, page, errors, logs, server };
}

/**
 * 画面を開いて、「カメラなしで試す」まで進める。reload: true なら、いまのページを読み込み直す(1 回だけ。
 * 読み込み直した直後に、続けて goto すると、直前の保存が Chrome の中で追いつかずに消えることがあるので、続けて開かない)
 */
async function boot(device, { reload = false, url = '' } = {}) {
  const { page, server } = device;
  if (reload) await page.reload();
  else await page.goto(url || `${server.base}/`);
  await page.waitForFunction(() => { const b = document.getElementById('startSim'); return b && !b.disabled; }, null, { timeout: 60_000 });
  await page.evaluate(() => document.getElementById('startSim').click());
  await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 30_000 });
  await sleep(600);
}

const stageId = (page) => page.evaluate(() => window.__app.characterId);
const waitStage = (page, id) => page.waitForFunction((want) => window.__app?.characterId === want && window.__app.character, id, { timeout: 30_000 });

/** 「かえる」を開いて、「つくった子」が並ぶのを待つ */
async function openChange(page) {
  if (!(await page.evaluate(() => document.documentElement.classList.contains('top-change')))) await page.click('#changeBtn');
  await page.waitForSelector('#madeKids:not([hidden]) .mk-kid', { timeout: 15_000 });
}
const kidNames = (page) => page.$$eval('#madeKids .mk-kid', (lis) => lis.map((li) => ({ id: li.dataset.id, name: (li.querySelector('.mk-name') ?? li.querySelector('.mk-pick'))?.textContent ?? '', now: li.dataset.now === '1' })));

async function pickKid(page, id) {
  await openChange(page);
  await page.click(`#madeKids .mk-kid[data-id="${id}"] .mk-pick`);
  await waitStage(page, id);
  await sleep(300);
}

/** 文字で話しかけて、返事が最後まで届くのを待つ */
async function say(page, text) {
  // 開いた時のあいさつ(キャラが先に話す)が終わるのを待ってから話しかける(話している間の言葉は受け付けない)
  await page.waitForFunction(() => !window.__app.dialogue?.busy, null, { timeout: 30_000 });
  await page.fill('#textInput', text);
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST' && (r.request().postData() ?? '').includes(text), { timeout: 30_000 });
  await page.press('#textInput', 'Enter');
  // 返事の本文は、画面の切り替えと重なると取れないことがある(取れなくても、返事が届いた事は waitForResponse で分かる)
  await (await reply).text().catch(() => '');
  await sleep(500);
}

/** 「もっと」の中の「覚えていること」を開いて、want が出るまで待ち、並んでいる事を返す(返したら閉じる) */
async function drawerTexts(page, want) {
  await page.click('#moreBtn');
  if (!(await page.evaluate(() => document.querySelector('#memoryDrawer').open))) await page.click('#memoryDrawer summary');
  await page.waitForFunction((w) => [...document.querySelectorAll('.mem-item span')].some((e) => e.textContent === w), want, { timeout: 10_000 });
  const texts = await page.$$eval('.mem-item span', (els) => els.map((e) => e.textContent));
  await page.click('#moreBtn');
  return texts;
}
const memoryOf = async (server, key, ch) => {
  const r = await fetch(`${server.base}/api/memory`, { headers: { 'x-memory-key': key, ...(ch ? { 'x-yc-character': ch } : {}) } });
  return r.ok ? (await r.json()).items.map((i) => i.text) : null;
};

test('作った子: かえるに並ぶ・選べる・読み込み直しても同じ子・名前を変えられる・記憶は子ごと・消せる(別の端末・サーバーの入れ直しでも)', { skip: SLOW, timeout: 360_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) {
    t.skip('Chrome が無い(CHROME_PATH で場所を渡せる)');
    return;
  }
  const dist = mkdtempSync(join(tmpdir(), 'keep-dist-'));
  const memDir = mkdtempSync(join(tmpdir(), 'keep-mem-'));
  let server = null;
  let server2 = null;
  try {
    // 一時のリポジトリの頭: 主役(ノリー)と、2D の部品の元(ようこそくん)だけを写し、作った子はここへ置く
    REPO = mkdtempSync(join(tmpdir(), 'keep-repo-'));
    for (const id of ['norrie', 'yokoso']) cpSync(join(REAL_REPO, 'characters', id), join(REPO, 'characters', id), { recursive: true });
    plantKid(K1, 'あたらしい子');
    plantKid(K2, 'あたらしい子');
    const { build } = await import('vite');
    await build({ root: WEB, logLevel: 'silent', build: { outDir: dist, emptyOutDir: true } });
    server = await startServer(memDir);

    // ---- 1. かえるに「つくった子」が並ぶ ----
    const A = await openDevice(browser, server, dist);
    await boot(A);
    assert.equal(await stageId(A.page), 'norrie', '初めはいつもの子');
    assert.equal(await A.page.evaluate(() => window.__app.status.made), true, 'サーバーが一覧を持つと知らせる');
    await openChange(A.page);
    assert.equal(await A.page.textContent('#madeKids .mk-title'), 'つくった子');
    const listed = await kidNames(A.page);
    assert.deepEqual(listed.map((k) => k.id).filter((id) => KIDS.includes(id)).sort(), [...KIDS].sort(), '作った 2 人が並ぶ');
    assert.equal(listed[0].id, 'norrie', 'いつもの子が先頭');
    assert.equal(listed.find((k) => k.id === 'norrie').now, true);

    // ---- 2. 選ぶ → 読み込み直しても同じ子 ----
    await pickKid(A.page, K1);
    assert.equal(await A.page.evaluate(() => JSON.parse(localStorage.getItem('yc.stage.v1')).id), K1, '端末が「いまの子」を覚える');
    await boot(A, { reload: true });
    assert.equal(await stageId(A.page), K1, `読み込み直しても、同じ子で始まる(console: ${A.logs.filter((l) => !/DOM/.test(l)).slice(-10).join(' / ')})`);
    await openChange(A.page);
    assert.equal((await kidNames(A.page)).find((k) => k.id === K1).now, true, 'かえるの印も、その子');
    await pickKid(A.page, 'norrie');
    assert.equal(await A.page.evaluate(() => localStorage.getItem('yc.stage.v1')), null, 'ノリーに戻したら、覚えを消す');
    await boot(A, { reload: true });
    assert.equal(await stageId(A.page), 'norrie', 'ノリーに戻した後は、読み込み直してもノリー');
    // アドレスの ?character= は、覚えより先
    await pickKid(A.page, K1);
    await boot(A, { url: `${server.base}/?character=norrie` });
    assert.equal(await stageId(A.page), 'norrie', '?character= が先');
    await boot(A); // アドレスを元に戻す(?character= が付いたままだと、読み込み直しも ?character= が先になる)

    // ---- 3. 名前を変える ----
    await openChange(A.page);
    await A.page.click(`#madeKids .mk-kid[data-id="${K1}"] .mk-edit`);
    await A.page.fill('#madeKids .mk-input', 'タロウ');
    await A.page.click('#madeKids .mk-ok');
    await A.page.waitForFunction((id) => [...document.querySelectorAll('#madeKids .mk-kid')].find((li) => li.dataset.id === id)?.querySelector('.mk-name')?.textContent === 'タロウ', K1, { timeout: 10_000 });
    assert.equal(JSON.parse(readFileSync(join(kidDir(K1), 'character.json'), 'utf8')).name, 'タロウ', 'サーバーのファイルが変わる');
    assert.match(readFileSync(join(kidDir(K1), 'persona.md'), 'utf8'), /^# タロウ\n/);
    await boot(A, { reload: true });
    await openChange(A.page);
    assert.equal((await kidNames(A.page)).find((k) => k.id === K1).name, 'タロウ', '読み込み直しても新しい名前');

    // ---- 4. 別の端末・サーバーの入れ直しでも ----
    const B = await openDevice(browser, server, dist);
    await boot(B);
    assert.equal(await stageId(B.page), 'norrie', '別の端末の「いまの子」は、その端末の物(初めはいつもの子)');
    await openChange(B.page);
    const onB = await kidNames(B.page);
    assert.equal(onB.find((k) => k.id === K1).name, 'タロウ', '別の端末にも、同じサーバーの子が並ぶ');
    assert.ok(onB.some((k) => k.id === K2));
    await B.ctx.close();

    // ---- 5. 記憶は子ごと ----
    await pickKid(A.page, K1);
    await say(A.page, 'ぼくはケンです');
    const key = await A.page.evaluate(() => localStorage.getItem('yc.memoryKey'));
    assert.match(key ?? '', KEY_RE, '覚えた最初の回に、合鍵を受け取る');
    assert.deepEqual(await memoryOf(server, key, K1), ['名前: ケン']);
    assert.deepEqual(await memoryOf(server, key, K2), [], 'K2 は何も知らない');
    await pickKid(A.page, K2);
    await say(A.page, 'ぼくはハナです');
    assert.deepEqual(await memoryOf(server, key, K2), ['名前: ハナ']);
    assert.deepEqual(await memoryOf(server, key, K1), ['名前: ケン'], 'K1 の記憶は変わらない');
    // 「覚えていること」の札は、舞台の子の分だけ(替えると読み直す)
    assert.deepEqual(await drawerTexts(A.page, '名前: ハナ'), ['名前: ハナ']);
    await pickKid(A.page, K1);
    assert.deepEqual(await drawerTexts(A.page, '名前: ケン'), ['名前: ケン'], 'K1 に替えると、K1 の分だけ');

    // ---- 6. 消す(1 回の確かめ。舞台にいる子も) ----
    await pickKid(A.page, K2);
    await boot(A, { reload: true });
    assert.equal(await stageId(A.page), K2, `舞台にいた子のまま始まる(保存: ${await A.page.evaluate(() => localStorage.getItem('yc.stage.v1'))} / console: ${A.logs.filter((l) => !/DOM/.test(l)).slice(-10).join(' / ')})`);
    await openChange(A.page);
    await A.page.click(`#madeKids .mk-kid[data-id="${K2}"] .mk-del`);
    assert.ok(existsSync(kidDir(K2)), '1 回目では消えない');
    assert.match(await A.page.textContent(`#madeKids .mk-kid[data-id="${K2}"] .mk-ask`), /けす\?/);
    await A.page.click(`#madeKids .mk-kid[data-id="${K2}"] .mk-sure`);
    await waitStage(A.page, 'norrie'); // 舞台にいた子は、先に主役へ
    await A.page.waitForFunction((id) => ![...document.querySelectorAll('#madeKids .mk-kid')].some((li) => li.dataset.id === id), K2, { timeout: 10_000 });
    assert.ok(!existsSync(kidDir(K2)), 'サーバーの一覧から消える');
    assert.equal(trashed(K2).length, 1, '捨てずに別の場所へ移してある');
    assert.deepEqual(await memoryOf(server, key, K2), [], 'その子が覚えた記憶も消える');
    assert.deepEqual(await memoryOf(server, key, K1), ['名前: ケン'], 'ほかの子の記憶は残る');
    assert.equal(await A.page.evaluate(() => localStorage.getItem('yc.stage.v1')), null);
    await boot(A, { reload: true });
    assert.equal(await stageId(A.page), 'norrie');

    // ---- 7. サーバーを入れ直す(ファイルに残っているので、子も記憶も同じ。消した子は消えたまま) ----
    assert.deepEqual(A.errors, [], ('ページのエラー: ' + A.errors.join(' / ')));
    await A.ctx.close();
    server.proc.kill();
    await sleep(400);
    server2 = await startServer(memDir);
    const C = await openDevice(browser, server2, dist);
    await boot(C);
    await openChange(C.page);
    const onC = await kidNames(C.page);
    assert.equal(onC.find((k) => k.id === K1)?.name, 'タロウ', 'サーバーを入れ直しても、子は並ぶ');
    assert.equal(onC.some((k) => k.id === K2), false, '消した子は、入れ直しても戻らない');
    assert.deepEqual(await memoryOf(server2, key, K1), ['名前: ケン'], '記憶も残る');
    await C.ctx.close();
    assert.deepEqual(A.errors, [], `ページのエラー: ${A.errors.join(' / ')}`);
  } finally {
    await browser.close();
    server?.proc.kill();
    server2?.proc.kill();
    for (const dir of [dist, memDir, REPO]) if (dir && dir.startsWith(tmpdir()) && /keep-(dist|mem|repo)-/.test(dir)) rmSync(dir, { recursive: true, force: true });
  }
});
