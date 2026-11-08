// 公開の関数の試験(本物の頭脳も Upstash も呼ばない)。web で `node --test` を流すと一緒に動く。
// 仮の頭脳は本物の runTurn(brain: 'mock')を通す。本物の頭脳の回だけ、偽の runTurn に替える。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleChat } from '../_lib/chat.mjs';
import { readConfig } from '../_lib/config.mjs';
import { MIN_PASSPHRASE_LENGTH, PASS_HEADER, WRONG_PASS_LIMITS, checkPassphrase, samePass } from '../_lib/gate.mjs';
import { handleMemoryRoute } from '../_lib/memory.mjs';
import { rememberForChat } from '../_lib/memoryChat.mjs';
import { createMemoryStore, createRedisStore, storeFor } from '../_lib/store.mjs';
import { runTurn as realRunTurn } from '../../server/brain.mjs';
import { sanitizeChatBody } from '../../server/validate.mjs';

const PASS = ['de', 'mo', '-pass', '-for-tests', '-only'].join(''); // 試験だけの合言葉(16 字以上)
const env = (over = {}) => ({ ANTHROPIC_API_KEY: 'x', DEMO_PASSPHRASE: PASS, DEMO_DAILY_CAP: '3', DEMO_PER_MINUTE: '2', ...over });
const NORRIE_PERSONA = readFileSync(new URL('../../../characters/norrie/persona.md', import.meta.url), 'utf8');
const BASE = 'https://example.test';

function req(body, { pass, ip = '203.0.113.5', method = 'POST', raw, key } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
  if (pass !== undefined) headers[PASS_HEADER] = pass;
  if (key) headers['x-memory-key'] = key;
  return new Request(`${BASE}/api/chat`, { method, headers, body: method === 'POST' ? raw ?? JSON.stringify(body) : undefined });
}

/** 本物の頭脳の回は偽物で数え、仮の頭脳の回(brain: 'mock')は本物の runTurn を通す */
function deps(over = {}) {
  const calls = [];
  const runTurn = async (body, opts) => {
    if (opts.brain === 'mock') return realRunTurn(body, opts);
    calls.push({ body, opts });
    opts.onEvent({ type: 'meta', brain: 'haiku' });
    opts.onEvent({ type: 'say', text: '本物です', expression: 'happy', motion: 'nod', gaze: 'person' });
  };
  const store = createMemoryStore();
  return { calls, store, d: { cfg: readConfig(env(over.env)), store, runTurn, sanitize: sanitizeChatBody, remember: rememberForChat, ...over.d } };
}

const read = async (res) => ({ status: res.status, data: await res.json(), headers: res.headers });
const said = (data) => data.events.filter((e) => e.type === 'say').map((e) => e.text);
const loadHandler = () => import('../../server/memory/handler.mjs');
const memCall = (d, path, { method = 'GET', key, pass, ip = '203.0.113.5', body } = {}) => {
  const headers = { 'x-forwarded-for': ip };
  if (key) headers['x-memory-key'] = key;
  if (pass !== undefined) headers[PASS_HEADER] = pass;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return handleMemoryRoute(r, { cfg: d.cfg, store: d.store, loadHandler, ...(d.now ? { now: d.now } : {}) });
};
// 数えの枠(1 分・10 分)の切れ目で数が割れないように、時計を止める試験で使う時刻(10 分の枠の途中・1 分の途中)
const FIXED_T = 1_800_000_000_000 + 330_000;
const fixedClock = () => FIXED_T;

test('合言葉が合えば本物の頭脳で、まとめて 1 回で返す', async () => {
  const { calls, d } = deps();
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
  assert.equal(r.status, 200);
  assert.equal(r.data.brain, 'real');
  assert.equal(r.data.fallback, false);
  assert.deepEqual(r.data.events.at(-1).text, '本物です');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.useShop, false, '公開ではお店のデータを使わない');
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
    assert.ok(r.data.events.some((e) => e.type === 'meta' && e.brain === 'mock'), '仮の頭脳の印は runTurn が出す');
    assert.ok(said(r.data).length > 0, '仮の頭脳でも話す');
    assert.equal(calls.length, 0, '本物の頭脳を呼ばない');
  }
});

test('鍵が無い・合言葉が決まっていない・合言葉が短いときは、本物の頭脳を使わない', async () => {
  const short = PASS.slice(0, MIN_PASSPHRASE_LENGTH - 1);
  for (const [over, reason, pass] of [
    [{ ANTHROPIC_API_KEY: '' }, 'no-key', PASS],
    [{ DEMO_PASSPHRASE: '' }, 'no-passphrase-set', PASS],
    [{ DEMO_PASSPHRASE: short }, 'weak-passphrase', short],
  ]) {
    const { calls, d } = deps({ env: over });
    const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass }), d));
    assert.equal(r.data.reason, reason);
    assert.match(r.data.notice, /仮の頭脳です/);
    assert.equal(calls.length, 0);
  }
});

test('合言葉は前後の空白・改行を落として比べる(貼った時の改行で全員が仮の頭脳にならない)', async () => {
  const { calls, d } = deps({ env: { DEMO_PASSPHRASE: `  ${PASS}\n` } });
  assert.equal(d.cfg.passphrase, PASS);
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: ` ${PASS} ` }), d));
  assert.equal(r.data.brain, 'real');
  assert.equal(calls.length, 1);
});

test('合言葉の間違いは接続元ごとに数え、多すぎたら、しばらく比べない(正しくても仮の頭脳)。送っていない回は数えない', async () => {
  const { calls, d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '100' } });
  for (let i = 0; i < 8; i++) await handleChat(req({ text: 'やあ' }, { ip: '198.51.100.1' }), d); // 合言葉なしは当て試しではない
  assert.equal((await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.1' }), d))).data.brain, 'real');
  const reasons = [];
  for (let i = 0; i < WRONG_PASS_LIMITS.perClient; i++) reasons.push((await read(await handleChat(req({ text: 'やあ' }, { pass: `wrong-${i}`, ip: '198.51.100.2' }), d))).data.reason);
  assert.deepEqual(reasons, Array(WRONG_PASS_LIMITS.perClient).fill('passphrase'));
  const locked = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.2' }), d));
  assert.equal(locked.data.reason, 'passphrase-wait', '止めている間は、正しい合言葉でも比べない');
  assert.match(locked.data.notice, /しばらく/);
  const other = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.3' }), d));
  assert.equal(other.data.brain, 'real', '別の接続元は使える');
  assert.equal(calls.length, 2);
});

test('合言葉の間違いは全体でも数える。多い間(強め)も正しい合言葉は通し、間違えた接続元だけを 1 回で止める。時間がたてば戻る(CRITsec2 N1)', async () => {
  let t = 1_000_000;
  const store = createMemoryStore({ now: () => t });
  const cfg = readConfig(env());
  const limits = { ...WRONG_PASS_LIMITS, total: 3 };
  const check = (pass, ip) => checkPassphrase(req({ text: 'x' }, { pass, ip }), { cfg, store, now: () => t, limits });
  for (let i = 0; i < 3; i++) assert.equal((await check('wrong', `192.0.2.${i}`)).reason, 'passphrase');
  assert.deepEqual(await check(PASS, '192.0.2.99'), { ok: true, reason: '' }, '全体の間違いが多くても、正しい合言葉は止めない');
  assert.deepEqual(await check('wrong-again', '192.0.2.50'), { ok: false, reason: 'passphrase' });
  assert.deepEqual(await check(PASS, '192.0.2.50'), { ok: false, reason: 'passphrase-wait' }, '強めの間は、1 回間違えた接続元をすぐ止める(当たり外れを返さない)');
  assert.deepEqual(await check(PASS, '192.0.2.51'), { ok: true, reason: '' }, 'ほかの接続元の正しい合言葉は通る');
  t += Math.max(limits.totalWaitSeconds, limits.clientWaitSeconds, limits.windowSeconds * 2) * 1000 + 1;
  assert.deepEqual(await check(PASS, '192.0.2.50'), { ok: true, reason: '' }, '止めた接続元も、時間がたてば戻る');
  assert.deepEqual(await check('wrong', '192.0.2.60'), { ok: false, reason: 'passphrase' });
  assert.deepEqual(await check(PASS, '192.0.2.60'), { ok: true, reason: '' }, '強めが終われば、1 回の間違いでは止めない');
});

test('20 か所から 5 回ずつ間違えても、審査の人の正しい合言葉は会話・番号づくり・受け取りで通る。間違えた接続元は止めたまま(CRITsec2 N1)', async () => {
  const { calls, d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '1000' }, d: { now: fixedClock } });
  const reasons = new Set();
  for (let ip = 0; ip < 20; ip++) {
    for (let i = 0; i < WRONG_PASS_LIMITS.perClient; i++) reasons.add((await read(await handleChat(req({ text: 'やあ' }, { pass: `guess-${ip}-${i}`, ip: `203.0.113.${100 + ip}` }), d))).data.reason);
  }
  assert.deepEqual([...reasons], ['passphrase']);
  const judge = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS, ip: '198.51.100.70' }), d));
  assert.equal(judge.data.brain, 'real', '審査の人は本物の頭脳で話せる');
  const key = (await (await memCall(d, '/api/memory/new', { method: 'POST', ip: '198.51.100.71' })).json()).key;
  await memCall(d, '/api/memory/reflect', { method: 'POST', key, ip: '198.51.100.71', body: { text: 'ぼくはタロウです' } });
  const pair = await memCall(d, '/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '198.51.100.71' });
  assert.equal(pair.status, 200, '番号づくりも止まらない');
  const { code } = await pair.json();
  const claim = await memCall(d, '/api/memory/claim', { method: 'POST', pass: PASS, ip: '198.51.100.72', body: { code } });
  assert.equal(claim.status, 200, '番号の受け取りも止まらない');
  assert.equal((await claim.json()).key, key);
  const attacker = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '203.0.113.100' }), d));
  assert.equal(attacker.data.reason, 'passphrase-wait', '間違えた接続元は、正しい合言葉でも比べない(接続元ごとの止めは残す)');
  const once = await read(await handleChat(req({ text: 'やあ' }, { pass: 'one-more-guess', ip: '198.51.100.73' }), d));
  assert.equal(once.data.reason, 'passphrase');
  const after = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.73' }), d));
  assert.equal(after.data.reason, 'passphrase-wait', '全体が多い間は、1 回間違えた接続元をすぐ止める');
  assert.equal(calls.length, 1, '本物の頭脳は審査の人の 1 回だけ');
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
  const broken = { kind: 'broken', get: async () => { throw new Error('down'); }, incr: async () => { throw new Error('down'); } };
  const { calls, d } = deps({ d: { store: broken } });
  const r = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS }), d));
  assert.equal(r.data.reason, 'counter-unavailable');
  assert.ok(said(r.data).length > 0, '仮の頭脳で話し続ける');
  assert.equal(calls.length, 0);
});

test('Vercel の上で Upstash が無い時は、本物の頭脳を counter-unavailable で止め、記憶は 503(手元の PC はメモリのまま)', async () => {
  const onVercel = readConfig(env({ VERCEL: '1' }));
  assert.equal(onVercel.onVercel, true);
  assert.equal(storeFor(onVercel).kind, 'none');
  assert.equal(storeFor(readConfig(env())).kind, 'memory', '手元(VERCEL なし)は前と同じ');
  assert.equal(storeFor(readConfig(env({ VERCEL: '1', KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 't' }))).kind, 'redis');

  const { calls, d } = deps({ d: { cfg: onVercel, store: storeFor(onVercel) } });
  const r = await read(await handleChat(req({ text: 'わたしはタロウ。カレーが好き' }, { pass: PASS }), d));
  assert.equal(r.data.reason, 'counter-unavailable');
  assert.ok(!r.data.events.some((e) => e.type === 'memory'), '記憶は使わない');
  assert.ok(said(r.data).length > 0);
  assert.equal(calls.length, 0);
  for (const [path, method] of [['/api/memory/new', 'POST'], ['/api/memory', 'GET'], ['/api/memory/claim', 'POST']]) {
    assert.equal((await memCall(d, path, { method })).status, 503, path);
  }
});

test('本物の頭脳が落ちたら、仮の頭脳で答え直す(途中の返事は混ぜない)', async () => {
  const runTurn = async (body, opts) => {
    if (opts.brain === 'mock') return realRunTurn(body, opts);
    opts.onEvent({ type: 'say', text: '途中' });
    throw new Error('boom');
  };
  const { d } = deps({ d: { runTurn } });
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
  assert.equal(r.data.reason, 'brain-error');
  assert.ok(!r.data.events.some((e) => e.text === '途中'));
  assert.ok(said(r.data).length > 0);
});

test('B13S: 本物の頭脳が 429 などで答えられず runTurn が自分で仮の頭脳に替えた回も、返事の印は「仮の頭脳」(二重に答えない)', async () => {
  let mockRuns = 0;
  const runTurn = async (body, opts) => {
    if (opts.brain === 'mock') { mockRuns += 1; return realRunTurn(body, opts); }
    opts.onBrainFailed?.(new Error('Claude の呼び出しに失敗しました (429)'));
    opts.onEvent({ type: 'say', text: '替えた後の返事', expression: 'happy', motion: 'nod', gaze: 'person' });
  };
  const { d } = deps({ d: { runTurn } });
  const r = await read(await handleChat(req({ text: 'こんにちは' }, { pass: PASS }), d));
  assert.equal(r.data.brain, 'fallback');
  assert.equal(r.data.reason, 'brain-error');
  assert.match(r.data.notice, /仮の頭脳/);
  assert.deepEqual(said(r.data), ['替えた後の返事']);
  assert.equal(mockRuns, 0, '仮の頭脳をもう一度回さない');
});

test('仮の頭脳は人格の言葉で話す(ノリーが名乗る)', async () => {
  const { d } = deps();
  const body = { text: 'こんにちは', history: [], character: { name: 'ノリー', persona: NORRIE_PERSONA } };
  const r = await read(await handleChat(req(body), d));
  assert.equal(r.data.brain, 'fallback');
  assert.deepEqual(said(r.data), ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリー、がんばりマス! なにをお手伝いしまショウ?']);
});

test('仮の頭脳でも安全の層が先: つらい話は決まった案内(あいづちにしない)', async () => {
  const { d } = deps();
  const r = await read(await handleChat(req({ text: 'もう死にたい', character: { name: 'ノリー', persona: NORRIE_PERSONA } }), d));
  assert.ok(r.data.events.some((e) => e.type === 'meta' && e.brain === 'mock' && e.safety === 'distress'));
  assert.ok(!said(r.data).some((t) => /そうなんだ|もう少し聞かせて/.test(t)));
});

test('公開のリンクでも記憶が通る: 覚える → 一覧 → 番号で別の端末 → 続き → 「わすれて」で消える(頭脳は呼ばない)', async () => {
  const { calls, d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '100' } });
  const keyA = (await (await memCall(d, '/api/memory/new', { method: 'POST' })).json()).key;
  const taught = await read(await handleChat(req({ text: 'わたしはタロウ。カレーが好き' }, { key: keyA }), d));
  assert.equal(taught.data.events[0].type, 'memory', '覚えた事を返事の頭に並べる');
  assert.deepEqual(taught.data.events[0].added.map((a) => a.text), ['名前: タロウ', '好きなもの: カレー', '前に話したこと: カレーの話']);
  assert.ok(said(taught.data).includes('タロウさんっていうんだね。'));
  const listA = await (await memCall(d, '/api/memory', { key: keyA })).json();
  assert.equal(listA.items.length, 3);

  const code = (await (await memCall(d, '/api/memory/pair', { method: 'POST', key: keyA, pass: PASS })).json()).code;
  assert.match(code, /^[0-9]{6}$/);
  const keyB = (await (await memCall(d, '/api/memory/claim', { method: 'POST', ip: '198.51.100.20', pass: PASS, body: { code } })).json()).key;
  assert.notEqual(keyB, undefined);
  const cont = await read(await handleChat(req({ text: 'こんにちは', history: [] }, { key: keyB, ip: '198.51.100.20' }), d));
  assert.ok(said(cont.data).includes('タロウさん、また会えたね。'), '別の端末で続きから話す');

  const forget = await read(await handleChat(req({ text: 'わすれて' }, { key: keyA }), d));
  assert.equal(forget.data.brain, 'none');
  assert.equal(forget.data.fallback, false);
  assert.deepEqual(forget.data.events[0], { type: 'memory', forgotten: true, via: 'chat' });
  assert.ok(said(forget.data).includes('わかった、覚えていたことは全部消したよ。'));
  assert.equal((await memCall(d, '/api/memory', { key: keyA })).status, 404);
  assert.equal(calls.length, 0, 'どの回も本物の頭脳は呼ばない(合言葉なし・わすれて)');
});

test('合鍵は、覚える事が出た最初の回に作る(開いただけ・あいさつだけでは作らない)', async () => {
  const { d, store } = deps();
  const writes = [];
  const spy = { ...store, set: async (k, v, o) => (writes.push(k), store.set(k, v, o)) };
  const dd = { ...d, store: spy };
  await handleChat(req({ text: 'こんにちは' }), dd);
  assert.ok(!writes.some((k) => k.startsWith('ycm:r:')), 'あいさつだけでは記録を作らない');
  const r = await read(await handleChat(req({ text: 'ぼくはケンタ。ラーメンが好き' }), dd));
  const ev = r.data.events[0];
  assert.equal(ev.type, 'memory');
  assert.match(ev.key, /^[A-Za-z0-9_-]{43}$/, '画面に渡す合鍵');
  assert.equal(ev.retentionDays, 7);
  assert.ok(said(r.data).includes('ケンタさんっていうんだね。'));
  const list = await (await memCall({ ...d, store }, '/api/memory', { key: ev.key })).json();
  assert.deepEqual(list.items.map((i) => i.text), ['名前: ケンタ', '好きなもの: ラーメン', '前に話したこと: ラーメンの話']);
});

test('記憶の入口: 無い道は置き場を使う前に 404。S3 の入口が無ければ 501。1 分の上限で 429', async () => {
  const cfg = readConfig(env({ DEMO_PER_MINUTE: '1' }));
  const broken = { incr: async () => { throw new Error('should not be called'); } };
  assert.equal((await handleMemoryRoute(new Request(`${BASE}/api/memory/nothing`, { method: 'POST' }), { cfg, store: broken, loadHandler })).status, 404);
  assert.equal((await handleMemoryRoute(new Request(`${BASE}/api/memory?sub=../x`), { cfg, store: broken, loadHandler })).status, 404);
  const store = createMemoryStore();
  const r0 = await handleMemoryRoute(new Request(`${BASE}/api/memory/new`, { method: 'POST' }), { cfg, store, loadHandler: async () => null });
  assert.equal(r0.status, 501);
  let got = null;
  const fake = async () => ({ handleMemory: async (_r, o) => { got = o; return new Response('{}', { status: 200 }); } });
  const r1 = await handleMemoryRoute(new Request(`${BASE}/api/memory`, { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler: fake });
  assert.equal(r1.status, 200);
  assert.equal(got.store, store);
  assert.equal(got.cfg.passphrase, PASS, '合言葉は前後を落とした物を渡す');
  for (let i = 0; i < 2; i++) await handleMemoryRoute(new Request(`${BASE}/api/memory`, { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler: fake });
  const r2 = await handleMemoryRoute(new Request(`${BASE}/api/memory`, { headers: { 'x-forwarded-for': '192.0.2.9' } }), { cfg, store, loadHandler: fake });
  assert.equal(r2.status, 429);
});

test('番号づくりの合言葉も当て試しの守りを通す(間違いを数え、多すぎたら比べない)', async () => {
  const { d } = deps({ env: { DEMO_PER_MINUTE: '100' } });
  const key = (await (await memCall(d, '/api/memory/new', { method: 'POST' })).json()).key;
  for (let i = 0; i < WRONG_PASS_LIMITS.perClient; i++) {
    const r = await memCall(d, '/api/memory/pair', { method: 'POST', key, pass: `wrong-${i}`, ip: '198.51.100.30' });
    assert.equal(r.status, 403);
  }
  const locked = await memCall(d, '/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '198.51.100.30' });
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).reason, 'wait');
  const ok = await memCall(d, '/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '198.51.100.31' });
  assert.equal(ok.status, 200);
});

test('番号の受け取りも、会話と同じ合言葉の数えを通る(間違いを数え、止めた接続元は会話も受け取りも比べない。CRITsec2 N2)', async () => {
  const { d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '100' }, d: { now: fixedClock } });
  for (let i = 0; i < WRONG_PASS_LIMITS.perClient; i++) {
    const r = await memCall(d, '/api/memory/claim', { method: 'POST', pass: `wrong-${i}`, ip: '198.51.100.80', body: { code: '123456' } });
    assert.equal(r.status, 403);
    const data = await r.json();
    assert.equal(data.reason, 'no_pass');
    assert.match(data.error, /受け取れません/);
  }
  const locked = await memCall(d, '/api/memory/claim', { method: 'POST', pass: PASS, ip: '198.51.100.80', body: { code: '123456' } });
  assert.equal(locked.status, 429, '止めた接続元は、正しい合言葉でも当たり外れを返さない');
  const lockedData = await locked.json();
  assert.equal(lockedData.reason, 'wait');
  assert.match(lockedData.error, /受け取れません/);
  const chat = await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.80' }), d));
  assert.equal(chat.data.reason, 'passphrase-wait', '受け取りの間違いで、同じ接続元の会話も止まる(同じ数え)');
  assert.equal((await memCall(d, '/api/memory/claim', { method: 'POST', ip: '198.51.100.81', body: { code: '123456' } })).status, 403, '合言葉なしは比べずに断る');
});

test('受け取りの間違いも全体で数える: 20 か所 × 5 回の後は強め(1 回間違えた接続元をすぐ止める)。正しい合言葉の受け取りは通る(CRITsec2 N2)', async () => {
  const { d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '100' }, d: { now: fixedClock } });
  const key = (await (await memCall(d, '/api/memory/new', { method: 'POST', ip: '198.51.100.90' })).json()).key;
  await memCall(d, '/api/memory/reflect', { method: 'POST', key, ip: '198.51.100.90', body: { text: 'ぼくはタロウです' } });
  const { code } = await (await memCall(d, '/api/memory/pair', { method: 'POST', key, pass: PASS, ip: '198.51.100.90' })).json();
  const statuses = new Set();
  for (let ip = 0; ip < 20; ip++) {
    for (let i = 0; i < WRONG_PASS_LIMITS.perClient; i++) statuses.add((await memCall(d, '/api/memory/claim', { method: 'POST', pass: `g-${ip}-${i}`, ip: `203.0.113.${150 + ip}`, body: { code } })).status);
  }
  assert.deepEqual([...statuses], [403]);
  assert.equal((await read(await handleChat(req({ text: 'やあ' }, { pass: 'a-guess', ip: '198.51.100.91' }), d))).data.reason, 'passphrase');
  assert.equal((await read(await handleChat(req({ text: 'やあ' }, { pass: PASS, ip: '198.51.100.91' }), d))).data.reason, 'passphrase-wait', '受け取りの間違いで全体が強めになっている');
  const ok = await memCall(d, '/api/memory/claim', { method: 'POST', pass: PASS, ip: '198.51.100.92', body: { code } });
  assert.equal(ok.status, 200, '正しい合言葉なら、強めの間も受け取れる(番号が当たっていれば)');
  assert.equal((await ok.json()).key, key);
});

/** 置き場の呼び出しを順に覚える(合言葉と上限を、記憶の置き場より先に見ているかを見るため) */
function spyStore(inner = createMemoryStore()) {
  const ops = [];
  const wrap = (op) => async (k, ...rest) => {
    ops.push(`${op} ${k}`);
    return inner[op](k, ...rest);
  };
  return { ops, store: { kind: 'spy', get: wrap('get'), set: wrap('set'), del: wrap('del'), incr: wrap('incr') } };
}

test('公開の /api/chat は、合言葉と回数の上限を見てから記憶の置き場を使う(CRITsec2 N3)', async () => {
  const fake = 'A'.repeat(43); // 形だけ合う合鍵
  for (const [pass, first] of [['wrong', 'pw:'], [PASS, 'rl:']]) {
    const { ops, store } = spyStore();
    const { d } = deps({ env: { DEMO_PER_MINUTE: '100', DEMO_DAILY_CAP: '100' }, d: { store, now: fixedClock } });
    await handleChat(req({ text: 'ぼくはタロウ。カレーが好き' }, { pass, key: fake, ip: '198.51.100.100' }), d);
    const at = (prefix) => ops.findIndex((o) => o.split(' ')[1].startsWith(prefix));
    assert.equal(at('pw:'), 0, '最初に合言葉の止めを見る');
    assert.ok(at(first) >= 0 && at(first) < at('rlm:'), `${first} の数え(合言葉・回数)は記憶の数えより先`);
    assert.ok(at('rlm:') >= 0 && at('rlm:') < at('ycm:'), '記憶の置き場(ycm:)は、接続元ごとの数え(rlm:)の後');
  }
});

test('記憶の置き場は接続元ごとの 1 分の上限で止まる。超えた回は記憶なしで話し続け、/api/memory と同じ数え(CRITsec2 N3)', async () => {
  const { ops, store } = spyStore();
  const { d } = deps({ env: { DEMO_PER_MINUTE: '10' }, d: { store, now: fixedClock } }); // 記憶の上限は 1 分に 10 × 3 = 30 回
  const fake = 'B'.repeat(43);
  const used = [];
  for (let i = 0; i < 40; i++) {
    const before = ops.length;
    const r = await handleChat(req({ text: 'わすれて' }, { key: fake, ip: '198.51.100.110' }), d);
    assert.equal(r.status, 200, '会話は止めない');
    used.push(ops.slice(before).filter((o) => o.split(' ')[1].startsWith('ycm:')).length);
  }
  assert.ok(used.slice(0, 30).every((n) => n > 0), '上限までは記憶を使う');
  assert.deepEqual(used.slice(30), Array(10).fill(0), '上限を超えた回は、記憶の置き場を使わない');
  assert.equal((await memCall({ ...d, store }, '/api/memory', { key: fake, ip: '198.51.100.110' })).status, 429, '/api/memory と同じ数え');
  const other = await read(await handleChat(req({ text: 'わすれて' }, { key: fake, ip: '198.51.100.111' }), d));
  assert.equal(other.data.brain, 'none', 'ほかの接続元は使える');
});

test('公開の「わすれて」は、その子の人格の言い方で答える(手元のサーバーと同じ。CRITsec2 F1 の残り)', async () => {
  const { d } = deps({ env: { DEMO_PER_MINUTE: '100' } });
  const norrie = { name: 'ノリー', persona: NORRIE_PERSONA };
  const taught = await read(await handleChat(req({ text: 'わたしはハナコ。おすしが好き', character: norrie }, { ip: '198.51.100.120' }), d));
  const key = taught.data.events[0].key;
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const forget = await read(await handleChat(req({ text: 'わすれて', character: norrie }, { key, ip: '198.51.100.120' }), d));
  assert.equal(forget.data.brain, 'none');
  assert.deepEqual(said(forget.data), ['わかりマシタ。覚えていたことは、全部わすれマシタ。']);
  const again = await read(await handleChat(req({ text: 'わすれて', character: norrie }, { key, ip: '198.51.100.120' }), d));
  assert.deepEqual(said(again.data), ['ノリー、まだなにも覚えていなかったデス。']);
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

test('Vercel の関数の入口(chat.mjs)が、記憶と仮の頭脳につながっている', async () => {
  const saved = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'DEMO_PASSPHRASE', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[k];
  try {
    const { POST } = await import('../chat.mjs');
    const r = await read(await POST(req({ text: 'こんにちは', history: [], character: { name: 'ノリー', persona: NORRIE_PERSONA } })));
    assert.equal(r.data.reason, 'no-key');
    assert.equal(said(r.data)[0], 'はじめまして! ノリーと申しマス。');
    const learned = await read(await POST(req({ text: 'わたしはハナコ。おすしが好き' }, { ip: '198.51.100.40' })));
    assert.equal(learned.data.events[0].type, 'memory');
    assert.match(learned.data.events[0].key, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('公開の入口(chat.mjs)は、公開の決まりの本文の点検をはっきり渡す(環境変数 VERCEL の有り無しに頼らない。CRITsec F7 の残り)', () => {
  const src = readFileSync(new URL('../chat.mjs', import.meta.url), 'utf8');
  assert.match(src, /sanitize:\s*sanitizePublicChatBody\b/);
  assert.doesNotMatch(src, /sanitize:\s*sanitizeChatBody\b/);
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
