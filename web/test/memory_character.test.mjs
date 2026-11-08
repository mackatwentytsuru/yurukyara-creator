// 記憶は、話している子ごとに分ける(見出し x-yc-character)。1 つの合鍵の中で、子ごとに覚える・見せる・消す。
// 手元のサーバー(store.mjs・routes.mjs・index.mjs)と、公開の関数(kv.mjs・handler.mjs)の両方で同じ決まり。
// - 子を指さない呼び方(前の画面・道具)は、今までと同じ(全部が見える・全部消える)
// - 子の印の無い前の記憶は、主役の物
// - その子の分だけ消すと、合鍵・ほかの子の記憶は残る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore as createKvBackend } from '../api/_lib/store.mjs';
import { chatMemory, handleMemory } from '../server/memory/handler.mjs';
import { createKvMemory } from '../server/memory/kv.mjs';
import { characterOf, createMemoryStore, mapBackend, trimItems, MAX_ITEMS } from '../server/memory/store.mjs';
import { forgetReplyEvents } from '../server/memory/routes.mjs';
import { MAIN_CHARACTER } from '../src/character/defaults.js';

const WEB = join(import.meta.dirname, '..');
const facts = (...pairs) => pairs.map(([kind, text]) => ({ kind, text }));
const texts = (items) => items.map((it) => it.text).sort();

test('子の id の形: 英小文字・数字・_ の 32 字まで。ほかは ""(子を分けない)', () => {
  assert.equal(characterOf('yb261108_339426'), 'yb261108_339426');
  assert.equal(characterOf('norrie'), 'norrie');
  for (const bad of ['', 'Norrie', 'a-b', '../x', 'あ', 'x'.repeat(33), null, undefined, 5]) assert.equal(characterOf(bad), '', String(bad));
});

test('手元の記憶: 同じ合鍵でも、子ごとに別の記憶(名前も別に覚える)', () => {
  const s = createMemoryStore({ backend: mapBackend(), pepper: 'p' });
  const { key } = s.create();
  s.add(key, facts(['name', '名前: タロウ'], ['like', '好きなもの: カレー']), 'yb261108_aaaaaa');
  s.add(key, facts(['name', '名前: ハナ'], ['like', '好きなもの: りんご']), 'yb261108_bbbbbb');
  assert.deepEqual(texts(s.recall(key, 'yb261108_aaaaaa').items), ['名前: タロウ', '好きなもの: カレー']);
  assert.deepEqual(texts(s.recall(key, 'yb261108_bbbbbb').items), ['名前: ハナ', '好きなもの: りんご']);
  assert.match(s.recall(key, 'yb261108_aaaaaa').text, /タロウ/);
  assert.doesNotMatch(s.recall(key, 'yb261108_aaaaaa').text, /ハナ|りんご/, 'ほかの子の事は、頭脳に渡さない');
  assert.deepEqual(texts(s.list(key, 'yb261108_bbbbbb').items), ['名前: ハナ', '好きなもの: りんご'], '札の一覧もその子の分だけ');
  assert.deepEqual(s.recall(key, 'yb261108_cccccc').items, [], '会ったことのない子は、何も覚えていない');
  // 同じ子の名前は置き換わる(ほかの子の名前は残る)
  s.add(key, facts(['name', '名前: タロウくん']), 'yb261108_aaaaaa');
  assert.deepEqual(texts(s.recall(key, 'yb261108_aaaaaa').items), ['名前: タロウくん', '好きなもの: カレー']);
  assert.ok(s.recall(key, 'yb261108_bbbbbb').items.some((it) => it.text === '名前: ハナ'));
});

test('手元の記憶: 子を指さない呼び方は前と同じ(全部が見える)。印の無い前の記憶は主役の物', () => {
  const s = createMemoryStore({ backend: mapBackend(), pepper: 'p' });
  const { key } = s.create();
  s.add(key, facts(['name', '名前: タロウ'])); // 前の画面: 子の印なし
  s.add(key, facts(['like', '好きなもの: カレー']), 'yb261108_aaaaaa');
  assert.equal(s.recall(key).items.length, 2, '子を指さなければ全部');
  assert.equal(s.list(key).items.length, 2);
  assert.deepEqual(texts(s.recall(key, MAIN_CHARACTER.id).items), ['名前: タロウ'], '印の無い記憶は主役の物');
  assert.deepEqual(texts(s.recall(key, 'yb261108_aaaaaa').items), ['好きなもの: カレー']);
});

test('手元の記憶: その子の分だけ消す(合鍵・ほかの子・番号は残る)。子を指さない全部消しは前と同じ', () => {
  const s = createMemoryStore({ backend: mapBackend(), pepper: 'p' });
  const { key } = s.create();
  s.add(key, facts(['name', '名前: タロウ']), 'yb261108_aaaaaa');
  s.add(key, facts(['name', '名前: ハナ']), 'yb261108_bbbbbb');
  const { code } = s.pair(key);
  assert.equal(s.forgetAll(key, 'yb261108_aaaaaa'), true);
  assert.equal(s.forgetAll(key, 'yb261108_aaaaaa'), false, '消す物が無ければ false');
  assert.deepEqual(s.recall(key, 'yb261108_aaaaaa').items, []);
  assert.deepEqual(texts(s.recall(key, 'yb261108_bbbbbb').items), ['名前: ハナ'], 'ほかの子は残る');
  assert.equal(s.list(key, 'yb261108_bbbbbb').items.length, 1, '合鍵も残る');
  assert.equal(s.claim(code).key, key, '番号も残る');
  assert.equal(s.forgetAll(key), true, '子を指さない全部消し');
  assert.throws(() => s.list(key), (e) => e.status === 404);
});

test('1 つの合鍵に残す数は、子ごとに MAX_ITEMS。1 人が溢れても、ほかの子の記憶を押し出さない', () => {
  const s = createMemoryStore({ backend: mapBackend(), pepper: 'p' });
  const { key } = s.create();
  s.add(key, facts(['like', '好きなもの: 1']), 'yb261108_bbbbbb');
  for (let i = 0; i < MAX_ITEMS + 10; i++) s.add(key, facts(['like', `好きなもの: ${i}`]), 'yb261108_aaaaaa');
  assert.equal(s.recall(key, 'yb261108_aaaaaa').items.length, MAX_ITEMS);
  assert.equal(s.recall(key, 'yb261108_bbbbbb').items.length, 1);
  assert.equal(trimItems([]).length, 0);
});

test('公開の関数の記憶(kv): 子ごとに分ける・その子の分だけ消す', async () => {
  const mem = createKvMemory({ store: createKvBackend(), pepper: 'p' });
  const { key } = await mem.create();
  await mem.add(key, facts(['name', '名前: タロウ']), 'yb261108_aaaaaa');
  await mem.add(key, facts(['name', '名前: ハナ']), 'yb261108_bbbbbb');
  assert.deepEqual(texts((await mem.recall(key, 'yb261108_aaaaaa')).items), ['名前: タロウ']);
  assert.deepEqual(texts((await mem.list(key, 'yb261108_bbbbbb')).items), ['名前: ハナ']);
  assert.equal((await mem.recall(key)).items.length, 2, '子を指さなければ全部');
  assert.equal(await mem.forgetAll(key, 'yb261108_aaaaaa'), true);
  assert.deepEqual((await mem.recall(key, 'yb261108_aaaaaa')).items, []);
  assert.deepEqual(texts((await mem.recall(key, 'yb261108_bbbbbb')).items), ['名前: ハナ']);
  assert.equal(await mem.forgetAll(key), true);
  await assert.rejects(() => mem.list(key), (e) => e.status === 404);
});

test('公開の関数の入口(handleMemory・chatMemory): 見出し x-yc-character で子ごとに覚えて・見せて・消す', async () => {
  const store = createKvBackend();
  const cfg = { maxBodyBytes: 32768, pepper: 'p', passphrase: 'pw' };
  const call = async (path, { method = 'GET', key, ch, body } = {}) => {
    const headers = { 'x-forwarded-for': '192.0.2.1' };
    if (key) headers['x-memory-key'] = key;
    if (ch) headers['x-yc-character'] = ch;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handleMemory(new Request(`https://example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { store, cfg, env: {} });
    return { status: res.status, data: await res.json() };
  };
  const { data: made } = await call('/api/memory?sub=new', { method: 'POST' });
  const key = made.key;
  await call('/api/memory/reflect', { method: 'POST', key, ch: 'yb261108_aaaaaa', body: { text: 'ぼくはタロウです' } });
  await call('/api/memory/reflect', { method: 'POST', key, ch: 'yb261108_bbbbbb', body: { text: 'ぼくはハナです' } });
  assert.deepEqual((await call('/api/memory', { key, ch: 'yb261108_aaaaaa' })).data.items.map((i) => i.text), ['名前: タロウ']);
  assert.deepEqual((await call('/api/memory', { key, ch: 'yb261108_bbbbbb' })).data.items.map((i) => i.text), ['名前: ハナ']);
  // 会話の側: その子の分だけ読み、その子の分として覚える。「わすれて」もその子の分だけ(scoped の印が付く)
  const req = (ch) => new Request('https://example.test/api/chat', { method: 'POST', headers: { 'x-memory-key': key, ...(ch ? { 'x-yc-character': ch } : {}) } });
  const heard = await chatMemory(req('yb261108_aaaaaa'), 'こんにちは', { store, cfg, env: {} });
  assert.match(heard.memory.text, /タロウ/);
  assert.doesNotMatch(heard.memory.text, /ハナ/);
  await chatMemory(req('yb261108_aaaaaa'), '好きなものはカレー', { store, cfg, env: {} });
  assert.ok((await call('/api/memory', { key, ch: 'yb261108_aaaaaa' })).data.items.some((i) => i.text.includes('カレー')));
  assert.ok(!(await call('/api/memory', { key, ch: 'yb261108_bbbbbb' })).data.items.some((i) => i.text.includes('カレー')), 'ほかの子には入らない');
  const forgot = await chatMemory(req('yb261108_aaaaaa'), 'わすれて', { store, cfg, env: {} });
  assert.equal(forgot.handled, true);
  assert.equal(forgot.events[0].scoped, true, 'その子の分だけ消した印');
  assert.deepEqual((await call('/api/memory', { key, ch: 'yb261108_aaaaaa' })).data.items, []);
  assert.deepEqual((await call('/api/memory', { key, ch: 'yb261108_bbbbbb' })).data.items.map((i) => i.text), ['名前: ハナ'], 'ほかの子は残る');
  const del = await call('/api/memory', { method: 'DELETE', key, ch: 'yb261108_bbbbbb', body: {} });
  assert.deepEqual(del.data, { ok: true, forgotten: true, scoped: true });
  assert.equal((await call('/api/memory', { key, ch: 'yb261108_bbbbbb' })).status, 200, '合鍵は残っている');
});

test('「わすれて」の返事: 子を指さなければ scoped の印を付けない(前と同じ形)', () => {
  assert.equal(Object.hasOwn(forgetReplyEvents(true)[0], 'scoped'), false);
  assert.equal(forgetReplyEvents(true, '', { scoped: true })[0].scoped, true);
});

// ---- 手元のサーバーを本当に立てて、通しで(仮の頭脳。本物の API は呼ばない) ----
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
  const env = { ...process.env, LOG_DIR: mkdtempSync(join(tmpdir(), 'mem-ch-log-')), MEMORY_DIR: mkdtempSync(join(tmpdir(), 'mem-ch-mem-')), PORT: String(port), HOST: '127.0.0.1' };
  delete env.ANTHROPIC_API_KEY;
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

async function chatEvents(base, text, headers = {}) {
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text, history: [], character: { name: 'テスト' } }) });
  assert.equal(r.status, 200);
  return (await r.text())
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(5)));
}

test('通し(手元のサーバー): 子 A に名前を話す → 子 B は知らない → A に戻ると覚えている → A の分だけ消せる', async (t) => {
  const { proc, base } = await startServer();
  t.after(() => proc.kill());
  const A = { 'x-yc-character': 'yb261108_aaaaaa' };
  const B = { 'x-yc-character': 'yb261108_bbbbbb' };
  // 初めて覚える事が出た回に、合鍵が届く(A の記憶として)
  const first = await chatEvents(base, 'ぼくはタロウです', A);
  const key = first.find((e) => e.type === 'memory')?.key;
  assert.match(key ?? '', /^[A-Za-z0-9_-]{43}$/);
  const list = async (h) => (await (await fetch(`${base}/api/memory`, { headers: { 'x-memory-key': key, ...h } })).json()).items.map((i) => i.text);
  assert.deepEqual(await list(A), ['名前: タロウ']);
  assert.deepEqual(await list(B), [], '子 B は、タロウを知らない');
  // B に別の名前を話す(B の分として覚える。A の名前は変わらない)
  await chatEvents(base, 'ぼくはハナです', { ...B, 'x-memory-key': key });
  assert.deepEqual(await list(B), ['名前: ハナ']);
  assert.deepEqual(await list(A), ['名前: タロウ']);
  // B に話した時、A の名前は頭脳に渡らない(仮の頭脳の返事の中に出ない)
  const bSays = (await chatEvents(base, 'こんにちは', { ...B, 'x-memory-key': key })).filter((e) => e.type === 'say').map((e) => e.text).join('');
  assert.doesNotMatch(bSays, /タロウ/);
  // A の「わすれて」は、A の分だけ(scoped)
  const gone = await chatEvents(base, 'わすれて', { ...A, 'x-memory-key': key });
  assert.equal(gone.find((e) => e.type === 'memory')?.scoped, true);
  assert.deepEqual(await list(A), []);
  assert.deepEqual(await list(B), ['名前: ハナ'], 'B は残る');
  // 子を指さずに(前の道具)DELETE すると、前と同じく全部消える
  const del = await (await fetch(`${base}/api/memory`, { method: 'DELETE', headers: { 'x-memory-key': key, 'content-type': 'application/json' }, body: '{}' })).json();
  assert.deepEqual(del, { ok: true, forgotten: true });
});
