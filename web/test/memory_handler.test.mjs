// 公開の関数の記憶の入口(K5 の handleMemory と chatMemory)の試験。置き場は K5 の関数の中のメモリ(S6 の store.mjs)。
// 本物の Upstash・本物の API は呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../api/_lib/store.mjs';
import { handleMemoryRoute } from '../api/_lib/memory.mjs';
import { PASS_FAILS_PER_MINUTE, PASS_SUBS, chatMemory, handleMemory, memoryConfig, memorySub } from '../server/memory/handler.mjs';
import { GLOBAL_FAIL_LIMIT, PAIR_TTL_MS, RETENTION_MS } from '../server/memory/store.mjs';

const PASS = 'pass-for-test-only';
const BASE = 'https://example.test';

/** 置き場に書かれた物を全部覚えておく(合鍵がそのまま書かれていないかを見るため) */
function watchedStore(clock) {
  const inner = createMemoryStore({ now: () => clock.t });
  const written = [];
  return {
    written,
    get: (k) => inner.get(k),
    set: (k, v, o) => (written.push(`${k}=${v}`), inner.set(k, v, o)),
    del: (k) => inner.del(k),
    incr: (k, o) => (written.push(k), inner.incr(k, o)),
  };
}

function setup({ passphrase = PASS } = {}) {
  const clock = { t: Date.parse('2026-11-07T01:00:00Z') };
  const store = watchedStore(clock);
  const cfg = { maxBodyBytes: 32768, pepper: 'pepper-for-test', passphrase };
  const call = async (path, { method = 'GET', key, body, pass, ip = '192.0.2.1' } = {}) => {
    const headers = { 'x-forwarded-for': ip };
    if (key) headers['x-memory-key'] = key;
    if (pass) headers['x-demo-pass'] = pass;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handleMemory(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { store, cfg, now: () => clock.t, env: {} });
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
  return { clock, store, call };
}

test('下の道は ?sub=(vercel.json の書き換え)と道の名前の両方から読む', () => {
  assert.equal(memorySub(new Request(`${BASE}/api/memory?sub=pair`)), 'pair');
  assert.equal(memorySub(new Request(`${BASE}/api/memory/claim`)), 'claim');
  assert.equal(memorySub(new Request(`${BASE}/api/memory`)), '');
  assert.equal(memorySub(new Request(`${BASE}/api/memory/new/`)), 'new');
});

test('合鍵を作る → 覚える → 一覧 → 1 つ消す → 全部わすれる。置き場に合鍵そのものは書かない', async () => {
  const { store, call } = setup();
  const made = await call('/api/memory?sub=new', { method: 'POST' });
  assert.equal(made.status, 200);
  assert.match(made.data.key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(made.data.retentionDays, 7);
  assert.equal(made.headers.get('cache-control'), 'no-store');
  const key = made.data.key;
  const r = await call('/api/memory/reflect', { method: 'POST', key, body: { text: 'ぼくはタロウです。カレーが好き' } });
  assert.deepEqual(r.data.added.map((a) => a.kind).sort(), ['like', 'name', 'topic']);
  const list = await call('/api/memory', { key });
  assert.equal(list.status, 200);
  assert.ok(list.data.items.some((it) => it.text === '名前: タロウ'));
  const one = list.data.items.find((it) => it.kind === 'like');
  assert.deepEqual((await call('/api/memory', { method: 'DELETE', key, body: { id: one.id } })).data, { ok: true, removed: true });
  assert.deepEqual((await call('/api/memory', { method: 'DELETE', key, body: {} })).data, { ok: true, forgotten: true });
  assert.equal((await call('/api/memory', { key })).status, 404);
  assert.ok(store.written.length > 0);
  assert.ok(!store.written.some((w) => w.includes(key)), '置き場に合鍵がそのまま無い');
});

test('合鍵の形が違えば 401、無い合鍵は 404、知らない道は 404、違う方法は 405', async () => {
  const { call } = setup();
  assert.equal((await call('/api/memory')).status, 401);
  assert.equal((await call('/api/memory', { key: 'short' })).status, 401);
  assert.equal((await call('/api/memory', { key: 'A'.repeat(43) })).status, 404);
  assert.equal((await call('/api/memory?sub=nope')).status, 404);
  assert.equal((await call('/api/memory?sub=new')).status, 405);
});

test('番号: 合言葉が無い設定では作らない。違う合言葉も作らない。合えば 6 けた', async () => {
  const none = setup({ passphrase: '' });
  const k0 = (await none.call('/api/memory/new', { method: 'POST' })).data.key;
  const r0 = await none.call('/api/memory/pair', { method: 'POST', key: k0, pass: 'anything' });
  assert.equal(r0.status, 403);
  assert.equal(r0.data.reason, 'no_pass');
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  assert.equal((await call('/api/memory/pair', { method: 'POST', key, pass: 'wrong' })).status, 403);
  const p = await call('/api/memory/pair', { method: 'POST', key, pass: PASS });
  assert.equal(p.status, 200);
  assert.match(p.data.code, /^[0-9]{6}$/);
  assert.equal(p.data.ttlSec, 600);
  assert.ok(!JSON.stringify(p.data).includes(PASS), '返事に合言葉を出さない');
});

test('番号で受け取る: 別の端末で同じ記憶が読める。1 回しか使えない', async () => {
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  await call('/api/memory/reflect', { method: 'POST', key, body: { text: 'ぼくはタロウです' } });
  const { code } = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data;
  const got = await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code }, ip: '198.51.100.7' });
  assert.equal(got.status, 200);
  assert.equal(got.data.key, key);
  assert.ok(got.data.items.some((it) => it.text === '名前: タロウ'));
  const again = await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code }, ip: '198.51.100.8' });
  assert.equal(again.status, 400);
});

test('番号: 10 分で切れる。新しく出すと前の番号は使えない。全部わすれると番号も消える', async () => {
  const { clock, call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  const first = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data.code;
  const second = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data.code;
  if (first !== second) assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: first }, ip: '203.0.113.1' })).status, 400);
  clock.t += PAIR_TTL_MS + 1000;
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: second }, ip: '203.0.113.2' })).status, 400, '切れた');
  const third = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data.code;
  await call('/api/memory', { method: 'DELETE', key, body: {} });
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: third }, ip: '203.0.113.3' })).status, 400, '消えた');
});

test('番号: 同じ接続元が 5 回間違えたら、正しい番号でも 10 分止める', async () => {
  const { clock, call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  const { code } = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data;
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: wrong }, ip: '192.0.2.50' })).status, 400);
  const locked = await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code }, ip: '192.0.2.50' });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.reason, 'locked');
  clock.t += 10 * 60 * 1000 + 1000;
  const fresh = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data.code;
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: fresh }, ip: '192.0.2.50' })).status, 200, '10 分たてば戻る');
});

test(`番号: 全部の接続元で合わせて ${GLOBAL_FAIL_LIMIT} 回間違えたら、今ある番号を全部取り消す`, async () => {
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  const { code } = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data;
  const wrong = code === '999999' ? '999998' : '999999';
  for (let i = 0; i < GLOBAL_FAIL_LIMIT; i++) await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: wrong }, ip: `10.0.${i}.1` });
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code }, ip: '10.9.9.9' })).status, 400);
});

test('記憶は最後に使ってから 7 日で消える', async () => {
  const { clock, call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  clock.t += RETENTION_MS - 1000;
  assert.equal((await call('/api/memory', { key })).status, 200, '7 日の手前は読める(読むと延びる)');
  clock.t += RETENTION_MS + 1000;
  assert.equal((await call('/api/memory', { key })).status, 404);
});

test('合鍵を作る回数: 接続元ごと 1 分 10 回まで', async () => {
  const { call } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await call('/api/memory/new', { method: 'POST', ip: '192.0.2.77' })).status, 200);
  assert.equal((await call('/api/memory/new', { method: 'POST', ip: '192.0.2.77' })).status, 429);
  assert.equal((await call('/api/memory/new', { method: 'POST', ip: '192.0.2.78' })).status, 200, 'ほかの接続元は作れる');
});

test('置き場が使えないときは 503(中身は返事に出さない)。console に何も書かない', async () => {
  const broken = { get: async () => { throw new Error('secret-url-in-error'); }, set: async () => { throw new Error('x'); }, del: async () => {}, incr: async () => { throw new Error('x'); } };
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  try {
    const res = await handleMemory(new Request(`${BASE}/api/memory`, { headers: { 'x-memory-key': 'A'.repeat(43) } }), { store: broken, cfg: {}, env: {} });
    assert.equal(res.status, 503);
    assert.doesNotMatch(await res.text(), /secret-url/);
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(logs, []);
});

test('会話の手伝い chatMemory: 合鍵なしは何もしない・「わすれて」は消して返事まで返す・ふつうの言葉は覚えて渡す', async () => {
  const { store, clock, call } = setup();
  const deps = { store, cfg: { pepper: 'pepper-for-test' }, now: () => clock.t, env: {} };
  const req = (key) => new Request(`${BASE}/api/chat`, { method: 'POST', headers: key ? { 'x-memory-key': key } : {} });
  assert.deepEqual(await chatMemory(req(''), 'こんにちは', deps), { handled: false, events: [], memory: null, learned: [] });
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  const a = await chatMemory(req(key), 'ぼくはタロウです。カレーが好き', deps);
  assert.equal(a.handled, false);
  assert.equal(a.events[0].type, 'memory');
  assert.equal(a.learned.length, 3);
  const b = await chatMemory(req(key), 'こんにちは', deps);
  assert.match(b.memory.text, /名前: タロウ/);
  const c = await chatMemory(req(key), 'わすれて', deps);
  assert.equal(c.handled, true);
  assert.deepEqual(c.events[0], { type: 'memory', forgotten: true, via: 'chat' }); // via: 'chat' は会話の言葉で消した印(画面の札が古い知らせを消す)
  assert.ok(c.events.some((e) => e.type === 'say'));
  assert.equal((await call('/api/memory', { key })).status, 404);
});

test('S6 の入口(handleMemoryRoute)から、この中身が呼べる(合言葉と塩は環境変数から)', async () => {
  const saved = { p: process.env.DEMO_PASSPHRASE, m: process.env.MEMORY_PEPPER };
  process.env.DEMO_PASSPHRASE = PASS;
  process.env.MEMORY_PEPPER = 'pepper-from-env';
  try {
    const store = createMemoryStore();
    const cfg = { perMinute: 10, maxBodyBytes: 32768 };
    const loadHandler = () => import('../server/memory/handler.mjs');
    const made = await handleMemoryRoute(new Request(`${BASE}/api/memory?sub=new`, { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.200' } }), { cfg, store, loadHandler });
    assert.equal(made.status, 200);
    const { key } = await made.json();
    const pair = await handleMemoryRoute(new Request(`${BASE}/api/memory?sub=pair`, { method: 'POST', headers: { 'x-forwarded-for': '192.0.2.200', 'x-memory-key': key, 'x-demo-pass': PASS } }), { cfg, store, loadHandler });
    assert.equal(pair.status, 200);
    assert.match((await pair.json()).code, /^[0-9]{6}$/);
  } finally {
    if (saved.p === undefined) delete process.env.DEMO_PASSPHRASE;
    else process.env.DEMO_PASSPHRASE = saved.p;
    if (saved.m === undefined) delete process.env.MEMORY_PEPPER;
    else process.env.MEMORY_PEPPER = saved.m;
  }
});

// ---- 11-07 CRITsec F9: 公開では、番号の受け取りにも合言葉が要る ----

test('番号の受け取り(F9): 合言葉が無い・違うと 403。合えば受け取れる。合言葉の決まっていない設定では受け取らない', async () => {
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  await call('/api/memory/reflect', { method: 'POST', key, body: { text: 'ぼくはタロウです' } });
  const { code } = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data;
  const none = await call('/api/memory/claim', { method: 'POST', body: { code }, ip: '198.51.100.20' });
  assert.equal(none.status, 403);
  assert.equal(none.data.reason, 'no_pass');
  assert.match(none.data.error, /受け取れません/);
  assert.ok(!JSON.stringify(none.data).includes(PASS), '返事に合言葉を出さない');
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: 'wrong', body: { code }, ip: '198.51.100.20' })).status, 403);
  const ok = await call('/api/memory/claim', { method: 'POST', pass: ` ${PASS} `, body: { code }, ip: '198.51.100.20' });
  assert.equal(ok.status, 200, '前後の空白は外して比べる');
  assert.equal(ok.data.key, key);
  const unset = setup({ passphrase: '' });
  const r = await unset.call('/api/memory/claim', { method: 'POST', pass: 'anything', body: { code: '123456' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.reason, 'no_pass');
});

test('番号の受け取り(F9): 合言葉を持たない人の当て試しは、全体の取り消しを起こせない(番号を試す所まで届かない)', async () => {
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  const { code } = (await call('/api/memory/pair', { method: 'POST', key, pass: PASS })).data;
  const wrong = code === '999999' ? '999998' : '999999';
  for (let i = 0; i < GLOBAL_FAIL_LIMIT + 5; i++) assert.equal((await call('/api/memory/claim', { method: 'POST', body: { code: wrong }, ip: `10.1.${i}.1` })).status, 403);
  assert.equal((await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code }, ip: '10.9.9.8' })).status, 200, '審査の人の番号は消えていない');
});

test('合言葉の間違い: 同じ接続元が 1 分に 5 回間違えたら、正しい合言葉でも比べずに 429。1 分たてば戻る。ほかの接続元は使える', async () => {
  const { clock, call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  for (let i = 0; i < PASS_FAILS_PER_MINUTE; i++) assert.equal((await call('/api/memory/pair', { method: 'POST', key, pass: `guess-${i}`, ip: '192.0.2.90' })).status, 403);
  const limited = await call('/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '192.0.2.90' });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.reason, 'pass_limited');
  const claimLimited = await call('/api/memory/claim', { method: 'POST', pass: PASS, body: { code: '123456' }, ip: '192.0.2.90' });
  assert.equal(claimLimited.status, 429, '受け取りも同じ数え');
  assert.equal((await call('/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '192.0.2.91' })).status, 200, 'ほかの接続元');
  clock.t += 61 * 1000;
  assert.equal((await call('/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '192.0.2.90' })).status, 200, '1 分たてば戻る');
});

test('合言葉を比べる下の道 PASS_SUBS は、番号を作る・受け取るの 2 つ(公開の入口は、この全部を会話と同じ間違いの数えに通す。CRITsec2 N2)', async () => {
  assert.deepEqual([...PASS_SUBS], ['pair', 'claim']);
  assert.ok(Object.isFrozen(PASS_SUBS), 'ほかから足したり消したりできない');
  const { call } = setup();
  const key = (await call('/api/memory/new', { method: 'POST' })).data.key;
  for (const sub of PASS_SUBS) {
    const r = await call(`/api/memory/${sub}`, { method: 'POST', key, body: { code: '123456' }, ip: '203.0.113.7' });
    assert.equal(r.status, 403, `${sub} は合言葉なしで断る`);
    assert.equal(r.data.reason, 'no_pass', sub);
  }
  assert.equal((await call('/api/memory', { key, ip: '203.0.113.7' })).status, 200, '一覧は合言葉を見ない');
});

test('合言葉の設定(環境変数)は、前後の空白と改行を外して比べる', () => {
  assert.equal(memoryConfig({}, { DEMO_PASSPHRASE: `  ${PASS}\n` }).passphrase, PASS);
  assert.equal(memoryConfig({ passphrase: ` ${PASS} ` }, {}).passphrase, PASS);
  assert.equal(memoryConfig({}, {}).passphrase, '');
});
