// 公開の関数の骨組みの試験(本物の頭脳も置き場も呼ばない)。web で `node --test` を流すと一緒に動く。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat } from '../_lib/chat.mjs';
import { readConfig } from '../_lib/config.mjs';
import { PASS_HEADER, samePass } from '../_lib/gate.mjs';
import { handleMemoryRoute } from '../_lib/memory.mjs';
import { createMemoryStore, createRedisStore } from '../_lib/store.mjs';
import { mockReply } from '../../server/brain.mjs';
import { sanitizeChatBody } from '../../server/validate.mjs';

const PASS = ['de', 'mo', '-pass'].join(''); // 試験だけの合言葉
const env = (over = {}) => ({ ANTHROPIC_API_KEY: 'x', DEMO_PASSPHRASE: PASS, DEMO_DAILY_CAP: '3', DEMO_PER_MINUTE: '2', ...over });

function req(body, { pass, ip = '203.0.113.5', method = 'POST', raw } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
  if (pass !== undefined) headers[PASS_HEADER] = pass;
  return new Request('https://example.test/api/chat', { method, headers, body: method === 'POST' ? raw ?? JSON.stringify(body) : undefined });
}

function deps(over = {}) {
  const calls = [];
  const runTurn = async (body, { onEvent }) => {
    calls.push(body);
    onEvent({ type: 'meta', brain: 'haiku' });
    onEvent({ type: 'say', text: '本物です', expression: 'happy', motion: 'nod', gaze: 'person' });
  };
  return { calls, d: { cfg: readConfig(env(over.env)), store: createMemoryStore(), runTurn, mockReply, sanitize: sanitizeChatBody, ...over.d } };
}

const read = async (res) => ({ status: res.status, data: await res.json(), headers: res.headers });

test('合言葉が合えば本物の頭脳で、まとめて 1 回で返す', async () => {
  const { calls, d } = deps();
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
  assert.equal(r.status, 200);
  assert.equal(r.data.brain, 'real');
  assert.equal(r.data.fallback, false);
  assert.deepEqual(r.data.events.at(-1).text, '本物です');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].useShop, false, '公開ではお店のデータを使わない');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('合言葉なし・違う合言葉は、断らずに仮の頭脳で答え、理由を出す', async () => {
  for (const pass of [undefined, 'wrong']) {
    const { calls, d } = deps();
    const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass }), d));
    assert.equal(r.status, 200);
    assert.equal(r.data.brain, 'fallback');
    assert.equal(r.data.reason, 'passphrase');
    assert.match(r.data.notice, /仮の頭脳です/);
    assert.ok(r.data.events.some((e) => e.type === 'say'), '仮の頭脳でも話す');
    assert.equal(calls.length, 0, '本物の頭脳を呼ばない');
  }
});

test('鍵が無い・合言葉が決まっていないときは、本物の頭脳を使わない', async () => {
  for (const [over, reason] of [[{ ANTHROPIC_API_KEY: '' }, 'no-key'], [{ DEMO_PASSPHRASE: '' }, 'no-passphrase-set']]) {
    const { calls, d } = deps({ env: over });
    const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
    assert.equal(r.data.reason, reason);
    assert.equal(calls.length, 0);
  }
});

test('1 分の上限を超えたら仮の頭脳。接続元が違えば別に数える', async () => {
  const { calls, d } = deps({ env: { DEMO_DAILY_CAP: '100' } });
  const reasons = [];
  for (let i = 0; i < 3; i++) reasons.push((await read(await handleChat(req({ text: 'やあ' }, { pass: PASS }), d))).data.reason);
  assert.deepEqual(reasons, ['', '', 'per-minute']);
  const other = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.7' }), d));
  assert.equal(other.data.brain, 'real');
  assert.equal(calls.length, 3);
});

test('1 日の上限(全体)を超えたら仮の頭脳', async () => {
  const { d } = deps({ env: { DEMO_PER_MINUTE: '100' } });
  const got = [];
  for (let i = 0; i < 4; i++) got.push((await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: `192.0.2.${i}` }), d))).data.reason);
  assert.deepEqual(got, ['', '', '', 'daily-cap']);
});

test('数を数えられないときは、本物の頭脳を止める', async () => {
  const broken = { kind: 'broken', incr: async () => { throw new Error('down'); } };
  const { calls, d } = deps({ d: { store: broken } });
  const r = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS }), d));
  assert.equal(r.data.reason, 'counter-unavailable');
  assert.equal(calls.length, 0);
});

test('本物の頭脳が落ちたら、仮の頭脳で答え直す(途中の返事は混ぜない)', async () => {
  const runTurn = async (_b, { onEvent }) => {
    onEvent({ type: 'say', text: '途中' });
    throw new Error('boom');
  };
  const { d } = deps({ d: { runTurn } });
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
  assert.equal(r.data.reason, 'brain-error');
  assert.ok(!r.data.events.some((e) => e.text === '途中'));
});

test('形の悪い本文・大きすぎる本文・POST 以外は断る', async () => {
  const { d } = deps();
  assert.equal((await handleChat(req(null, { raw: '{' }), d)).status, 400);
  assert.equal((await handleChat(req({ text: '' }), d)).status, 400);
  assert.equal((await handleChat(req({ text: 'a'.repeat(40000) }), d)).status, 413);
  assert.equal((await handleChat(req(null, { method: 'GET' }), d)).status, 405);
});

test('合言葉の比べ: 空・違う長さ・同じ', () => {
  assert.equal(samePass('', PASS), false);
  assert.equal(samePass(PASS, ''), false);
  assert.equal(samePass(`${PASS}x`, PASS), false);
  assert.equal(samePass(PASS, PASS), true);
});

test('記憶の入口: S3 の入口が無ければ 501、あれば置き場を渡して呼ぶ。1 分の上限で 429', async () => {
  const cfg = readConfig(env({ DEMO_PER_MINUTE: '1' }));
  const store = createMemoryStore();
  const r0 = await handleMemoryRoute(new Request('https://example.test/api/memory/new', { method: 'POST' }), { cfg, store, loadHandler: async () => null });
  assert.equal(r0.status, 501);
  let got = null;
  const loadHandler = async () => ({ handleMemory: async (_r, o) => { got = o; return new Response('{}', { status: 200 }); } });
  const r1 = await handleMemoryRoute(new Request('https://example.test/api/memory', { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler });
  assert.equal(r1.status, 200);
  assert.equal(got.store, store);
  for (let i = 0; i < 2; i++) await handleMemoryRoute(new Request('https://example.test/api/memory', { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler });
  const r2 = await handleMemoryRoute(new Request('https://example.test/api/memory', { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler });
  assert.equal(r2.status, 429);
});

test('置き場: メモリは期限で消え、Upstash の形の命令を送る(鍵は見出しだけ)', async () => {
  let t = 0;
  const m = createMemoryStore({ now: () => t });
  await m.set('k', 'v', { ttlSeconds: 1 });
  assert.equal(await m.get('k'), 'v');
  t = 1500;
  assert.equal(await m.get('k'), null);
  assert.equal(await m.incr('n', { ttlSeconds: 10 }), 1);
  assert.equal(await m.incr('n'), 2);

  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ result: sent.length === 1 ? 1 : 'OK' }), { status: 200 });
  };
  const tok = ['to', 'ken'].join('');
  const r = createRedisStore({ url: 'https://redis.example.test', token: tok, fetchImpl });
  assert.equal(await r.incr('c', { ttlSeconds: 60 }), 1);
  assert.deepEqual(JSON.parse(sent[0].init.body), ['INCR', 'c']);
  assert.deepEqual(JSON.parse(sent[1].init.body), ['EXPIRE', 'c', '60']);
  assert.equal(sent[0].init.headers.authorization, `Bearer ${tok}`);
  assert.ok(!sent[0].url.includes(tok), '鍵を URL に入れない');
});
