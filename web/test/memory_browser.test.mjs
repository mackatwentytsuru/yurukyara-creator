// 端末をまたぐ記憶を、画面なしの Chrome で通しで試す(仮の頭脳。本物の API は呼ばない)。
// タブ A(端末 A)で名前と好きなものを話す → 番号を出す → タブ B(別の端末 = 別の保存場所)で番号を入れる
// → タブ B で続きを話す → 一覧に見える → 「全部わすれる」で消える → 番号ももう使えない。
// 画面は合鍵を自分で作らない(11-07 CRITsec F8): 開いただけ・全部わすれた後は合鍵なし。覚える事が出た最初の回に、会話の返事で受け取る。
// Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。WebGL は使わない(描画の試験ではない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

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
  // 記録(回数の数え・遅れの記録)は試験ごとの一時フォルダへ(作業フォルダの web/logs を汚さない)
  const childEnv = { ...process.env, LOG_DIR: mkdtempSync(join(tmpdir(), 'mem-log-')), ...env, PORT: String(port), HOST: '127.0.0.1' };
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

/** 手元のサーバーの /api/chat を 1 回(流れる形の返事を、最後まで読んでイベントの列にする) */
async function chatEvents(base, text, headers = {}) {
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ text, history: [], character: { name: 'テスト' } }),
  });
  assert.equal(r.status, 200);
  return (await r.text())
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(5)));
}

// 試しの画面: 記憶の札と、文字で話す欄だけ。src のファイルを、同じ場所(サーバーと同じ origin)から配る
const PAGE = `<!doctype html><meta charset="utf-8"><title>記憶の試し</title>
<div id="mem"></div>
<input id="say"><button id="send">送る</button><ol id="log"></ol>
<script type="module">
import { mountMemoryPanel } from '/__memtest/src/ui/memoryPanel.js';
import { streamChat } from '/__memtest/src/conversation/brainClient.js';
const panel = mountMemoryPanel(document.getElementById('mem'));
window.panelReady = panel.ready.then(() => true);
window.talk = async (text) => {
  const said = [];
  await streamChat({ text, history: [], character: { name: 'テスト' } }, (ev) => {
    panel.onChatEvent(ev);
    if (ev.type === 'say') said.push(ev.text);
  }, new AbortController().signal);
  const li = document.createElement('li');
  li.textContent = said.join('');
  document.getElementById('log').append(li);
  return said.join('');
};
</script>`;

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

async function openDevice(browser, base) {
  // 別の端末のかわりに、別の保存場所(context)を使う。localStorage は共有されない
  const ctx = await browser.newContext();
  await ctx.route(`${base}/__memtest/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/__memtest/', '');
    if (rel === 'index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const file = join(WEB, rel);
    if (!file.startsWith(SRC)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: readFileSync(file, 'utf8') });
  });
  const page = await ctx.newPage();
  const errors = [];
  const requests = []; // 記憶と会話の API への問い合わせ(「POST /api/memory/new」を出していないかを見る)
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/')) requests.push(`${r.method()} ${path}`);
  });
  await page.goto(`${base}/__memtest/index.html`);
  await page.evaluate(() => window.panelReady);
  return { ctx, page, errors, requests };
}

const items = (page) => page.$$eval('.mem-item span', (els) => els.map((e) => e.textContent));
const storedKey = (page) => page.evaluate(() => localStorage.getItem('yc.memoryKey'));

test('画面なしの Chrome: タブ A → 番号 → タブ B で続きが話せる → 一覧 → わすれて', { timeout: 60_000 }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  const memDir = mkdtempSync(join(tmpdir(), 'mem-e2e-'));
  const server = await startServer({ MEMORY_DIR: memDir });
  try {
    const A = await openDevice(browser, server.base);
    const B = await openDevice(browser, server.base);

    // 開いただけでは合鍵を作らない(F8)。札は空の一覧と「7 日で消えます」を出す
    assert.equal(await storedKey(A.page), null);
    assert.equal(await A.page.getAttribute('.memory-panel', 'data-ready'), '1');
    assert.match(await A.page.textContent('.mem-notice'), /7 日で消えます/);
    assert.match(await A.page.textContent('.mem-list'), /まだ何も覚えていません/);

    // タブ A: 自己紹介。仮の頭脳が覚えたことを言い、一覧に出る(合鍵は、この回の返事のイベントで受け取る)
    const a1 = await A.page.evaluate(() => window.talk('わたしはタロウ。カレーが好き'));
    assert.match(a1, /タロウ/);
    await A.page.waitForFunction(() => document.querySelectorAll('.mem-item').length >= 2);
    // 種類の名前を 2 回出さない(S4 の頼み。前は「名前 名前: タロウ」と出ていた)
    assert.deepEqual(await items(A.page), ['名前: タロウ', '好きなもの: カレー', '前に話したこと: カレーの話']);
    assert.match(await A.page.textContent('.mem-notice'), /7 日で消えます/);
    const keyA = await storedKey(A.page);
    assert.match(keyA ?? '', KEY_RE, '覚えた最初の回に、会話の返事で合鍵を受け取る');

    // タブ B は、まだ何も覚えていない(合鍵も無い。あいさつだけでは作らない)
    const b0 = await B.page.evaluate(() => window.talk('こんにちは'));
    assert.doesNotMatch(b0, /タロウ/);
    assert.equal(await storedKey(B.page), null);

    // タブ A で番号を出し、タブ B で入れる
    await A.page.click('.mem-pair');
    await A.page.waitForFunction(() => /^[0-9]{6}$/.test(document.querySelector('.mem-code').textContent));
    const code = await A.page.textContent('.mem-code');
    assert.match(await A.page.textContent('.mem-status'), /1 回だけ/);
    await B.page.fill('.mem-code-in', code);
    await B.page.click('.mem-claim');
    await B.page.waitForFunction(() => document.querySelectorAll('.mem-item').length >= 2);
    assert.deepEqual(await items(B.page), await items(A.page));

    // タブ B: 続きから話せる
    const b1 = await B.page.evaluate(() => window.talk('こんにちは'));
    assert.match(b1, /タロウさん/);
    assert.match(b1, /カレー/);

    // 1 つだけ消す(好きなもの)
    await B.page.click('.mem-item:nth-child(2) .mem-item-forget');
    await B.page.waitForFunction(() => document.querySelectorAll('.mem-item').length === 2);
    assert.ok(!(await items(B.page)).some((t) => t.startsWith('好きなもの')));

    // 同じ番号は 2 回使えない(3 台目)
    const C = await openDevice(browser, server.base);
    await C.page.fill('.mem-code-in', code);
    await C.page.click('.mem-claim');
    await C.page.waitForFunction(() => /違うか/.test(document.querySelector('.mem-status').textContent));

    // タブ B で「全部わすれる」→ 一覧が空になり、タブ A の合鍵でも読めない。
    // 知らせ(「全部わすれました」)が出た瞬間の一覧の数も控える: 札は知らせと同じ時に一覧を空にする(S4w8a の順の揺れ)
    await B.page.evaluate(() => {
      const st = document.querySelector('.mem-status');
      window.itemsAtNotice = null;
      new MutationObserver(() => {
        if (window.itemsAtNotice === null && /全部わすれました/.test(st.textContent)) window.itemsAtNotice = document.querySelectorAll('.mem-item').length;
      }).observe(st, { childList: true, characterData: true, subtree: true });
    });
    await B.page.click('.mem-forget');
    await B.page.waitForFunction(() => /全部わすれました/.test(document.querySelector('.mem-status').textContent));
    // 読むのは、一覧が空になるのを待ってから(知らせの直後にすぐ読むと、遅い通信の時に古い一覧を読んで揺れた)
    await B.page.waitForFunction(() => document.querySelectorAll('.mem-item').length === 0);
    assert.deepEqual(await items(B.page), []);
    assert.equal(await B.page.evaluate(() => window.itemsAtNotice), 0, '知らせが出た時に、一覧はもう空');
    assert.equal(await storedKey(B.page), null, '全部わすれた後は、新しい合鍵を作らない');
    const aAfter = await A.page.evaluate(async (k) => (await fetch('/api/memory', { headers: { 'x-memory-key': k } })).status, keyA);
    assert.equal(aAfter, 404, '消えた記憶は、もう一方の端末からも読めない');
    const a2 = await A.page.evaluate(() => window.talk('こんにちは'));
    assert.doesNotMatch(a2, /タロウ/);

    // 会話の「わすれて」でも消える(覚える事が出た最初の回に、新しい合鍵を受け取ってから)
    await B.page.evaluate(() => window.talk('ぼくはジロウです'));
    await B.page.waitForFunction(() => document.querySelectorAll('.mem-item').length >= 1);
    const keyB = await storedKey(B.page);
    assert.match(keyB ?? '', KEY_RE);
    assert.notEqual(keyB, keyA, '消した合鍵は使い回さない');
    const bForget = await B.page.evaluate(() => window.talk('わすれて'));
    assert.match(bForget, /全部消したよ/);
    await B.page.waitForFunction(() => document.querySelectorAll('.mem-item').length === 0);
    assert.equal(await storedKey(B.page), null, '「わすれて」の後も、新しい合鍵を作らない');

    // どの画面も、合鍵を作る入口(/api/memory/new)を一度も呼んでいない(F8)
    for (const d of [A, B, C]) assert.ok(!d.requests.includes('POST /api/memory/new'), d.requests.join(', '));
    // サーバーの記録とログに、合鍵が書かれていない
    for (const k of [keyA, keyB]) {
      for (const f of readdirSync(memDir)) assert.ok(!readFileSync(join(memDir, f), 'utf8').includes(k));
      assert.ok(!server.log().includes(k));
    }
    for (const d of [A, B, C]) assert.deepEqual(d.errors, []);
  } finally {
    await browser.close();
    server.proc.kill();
  }
});

test('合鍵の無い会話: 覚える事が出た最初の回にだけ合鍵を作り、返事のイベントで渡す(あいさつだけでは作らない・作る回数は 1 分 10 回まで)', { timeout: 30_000 }, async () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-first-'));
  const server = await startServer({ MEMORY_DIR: memDir });
  try {
    const hello = await chatEvents(server.base, 'こんにちは');
    assert.ok(!hello.some((e) => e.type === 'memory'), 'あいさつだけでは合鍵を作らない');
    assert.deepEqual(readdirSync(memDir), []);

    const first = await chatEvents(server.base, 'わたしはタロウ。カレーが好き');
    const ev = first.find((e) => e.type === 'memory');
    assert.match(ev?.key ?? '', KEY_RE);
    assert.deepEqual(ev.added.map((a) => a.text), ['名前: タロウ', '好きなもの: カレー', '前に話したこと: カレーの話']);
    assert.equal(ev.retentionDays, 7);
    assert.match(ev.notice, /7 日で消えます/);
    assert.ok(first.some((e) => e.type === 'say' && /タロウ/.test(e.text)), 'その回の返事で、覚えた事を言う');
    const list = await (await fetch(`${server.base}/api/memory`, { headers: { 'x-memory-key': ev.key } })).json();
    assert.deepEqual(list.items.map((it) => it.text), ['名前: タロウ', '好きなもの: カレー', '前に話したこと: カレーの話']);

    // 合鍵を付けた次の回は、新しい合鍵を作らず、同じ合鍵に足す
    const next = await chatEvents(server.base, 'ぼくはジロウ', { 'x-memory-key': ev.key });
    assert.ok(!next.some((e) => e.type === 'memory' && 'key' in e));
    assert.deepEqual(next.find((e) => e.type === 'memory')?.added.map((a) => a.text), ['名前: ジロウ']);

    // 作る回数は /api/memory/new と同じ上限(1 つの接続元で 1 分 10 回)。超えても会話は続き、覚えないだけ
    const keys = new Set([ev.key]);
    for (let i = 0; i < 9; i++) {
      const made = (await chatEvents(server.base, 'ぼくはサブロウ')).find((e) => e.type === 'memory')?.key;
      assert.match(made ?? '', KEY_RE, `${i + 2} 回目も作る`);
      keys.add(made);
    }
    assert.equal(keys.size, 10);
    const over = await chatEvents(server.base, 'ぼくはシロウ');
    assert.ok(!over.some((e) => e.type === 'memory'), '上限を超えた回は合鍵を作らない');
    assert.ok(over.some((e) => e.type === 'say'), '上限を超えても、話は続く');

    // 合鍵は、記録のファイルにもサーバーのログにも書かない
    for (const k of keys) {
      for (const f of readdirSync(memDir)) assert.ok(!readFileSync(join(memDir, f), 'utf8').includes(k));
      assert.ok(!server.log().includes(k));
    }
  } finally {
    server.proc.kill();
  }
});

test('合言葉を設定したサーバーでは、合言葉なしで番号を作らない', { timeout: 30_000 }, async () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-pass-'));
  const server = await startServer({ MEMORY_DIR: memDir, APP_PASSPHRASE: 'test-pass-only' });
  try {
    const { key } = await (await fetch(`${server.base}/api/memory/new`, { method: 'POST' })).json();
    const no = await fetch(`${server.base}/api/memory/pair`, { method: 'POST', headers: { 'x-memory-key': key } });
    assert.equal(no.status, 403);
    const bad = await fetch(`${server.base}/api/memory/pair`, { method: 'POST', headers: { 'x-memory-key': key, 'x-app-pass': 'wrong' } });
    assert.equal(bad.status, 403);
    const ok = await fetch(`${server.base}/api/memory/pair`, { method: 'POST', headers: { 'x-memory-key': key, 'x-app-pass': 'test-pass-only' } });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).code, /^[0-9]{6}$/);
  } finally {
    server.proc.kill();
  }
});
