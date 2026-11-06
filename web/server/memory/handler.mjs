// 公開の関数 /api/memory の中身(契約 K5。S6 の web/api/memory.mjs が呼ぶ)。標準の Request を受けて Response を返す。
// 決まりは手元のサーバー(routes.mjs・store.mjs)と同じ。置き場は K5 の store(Upstash か、関数の中のメモリ)。
// 合鍵は見出し x-memory-key で受ける(URL に入れない)。返事にも記録にも、合鍵・合言葉を書かない(console も使わない)。
import { createHash } from 'node:crypto';
import { createKvMemory } from './kv.mjs';
import { MemoryError, samePass } from './store.mjs';
import { extractFacts } from './reflect.mjs';
import { forgetReplyEvents, isForgetRequest } from './routes.mjs';
import { redactSecrets } from '../../src/conversation/secrets.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const SUBS = new Set(['', 'new', 'pair', 'claim', 'reflect']);
export const NEW_PER_MINUTE = 10; // 合鍵を作る回数(接続元ごと・1 分)
export const NEW_PER_DAY = 2000; // 合鍵を作る回数(全体・1 日)

const reply = (status, data, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });

/** 設定。S6 が cfg で渡した物を先に使い、無ければ環境変数(値はどこにも書かない) */
export function memoryConfig(cfg = {}, env = process.env) {
  return {
    pepper: cfg.pepper ?? env.MEMORY_PEPPER ?? '',
    // 番号づくりの合言葉。公開では DEMO_PASSPHRASE(会話と同じ合言葉)。無ければ番号を作らない
    passphrase: cfg.passphrase ?? env.DEMO_PASSPHRASE ?? env.APP_PASSPHRASE ?? '',
    maxBodyBytes: Number(cfg.maxBodyBytes) > 0 ? Number(cfg.maxBodyBytes) : 32768,
  };
}

/** 接続元の目印(見出しの値はそのまま使わず、ハッシュの頭だけ) */
export function memoryClient(request) {
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`ycm:${raw}`).digest('hex').slice(0, 16);
}

/** 下の道(new・pair・claim・reflect)。vercel.json の書き換えの ?sub= を先に見て、無ければ道の名前から */
export function memorySub(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('sub');
  const raw = q ?? url.pathname.replace(/^.*\/api\/memory\/?/, '');
  return raw.replace(/^\/+|\/+$/g, '');
}

async function readBody(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new MemoryError('本文が大きすぎます', 413, 'too_large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new MemoryError('本文が大きすぎます', 413, 'too_large');
  if (!buf.byteLength) return {};
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new MemoryError('本文が JSON ではありません', 400, 'not_json');
  }
}

const dayKey = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll('-', ''); // 日本時間の日付

/**
 * @param {Request} request
 * @param {object} deps
 * @param {{get:Function,set:Function,del:Function,incr:Function}} deps.store K5 の置き場
 * @param {object} [deps.cfg] { maxBodyBytes, pepper?, passphrase? }
 * @param {() => number} [deps.now]
 * @param {Record<string,string|undefined>} [deps.env]
 */
export async function handleMemory(request, { store, cfg = {}, now = Date.now, env = process.env }) {
  const conf = memoryConfig(cfg, env);
  const sub = memorySub(request);
  if (!SUBS.has(sub)) return reply(404, { error: 'この道はありません' });
  const mem = createKvMemory({ store, pepper: conf.pepper, now });
  const key = request.headers.get('x-memory-key') ?? '';
  const client = memoryClient(request);
  const m = request.method;
  try {
    if (m === 'POST' && sub === 'new') {
      const t = now();
      const perMin = await store.incr(`ycm:n:${client}:${Math.floor(t / 60000)}`, { ttlSeconds: 120 });
      const perDay = await store.incr(`ycm:nd:${dayKey(t)}`, { ttlSeconds: 2 * 86400 });
      if (perMin > NEW_PER_MINUTE || perDay > NEW_PER_DAY) return reply(429, { error: '合鍵を作る回数の上限です。少し待ってね', reason: 'limited' }, { 'retry-after': '60' });
      return reply(200, await mem.create());
    }
    if (m === 'GET' && sub === '') return reply(200, await mem.list(key));
    if (m === 'DELETE' && sub === '') {
      const body = await readBody(request, conf.maxBodyBytes);
      const id = typeof body.id === 'string' && body.id ? body.id : new URL(request.url).searchParams.get('id');
      if (id) return reply(200, { ok: true, removed: await mem.forgetItem(key, id) });
      return reply(200, { ok: true, forgotten: await mem.forgetAll(key) });
    }
    if (m === 'POST' && sub === 'pair') {
      if (!conf.passphrase) throw new MemoryError('合言葉が設定されていないので、番号は作りません', 403, 'no_pass');
      const given = request.headers.get('x-demo-pass') ?? request.headers.get('x-app-pass') ?? '';
      if (!samePass(given, conf.passphrase)) throw new MemoryError('合言葉が違うので、番号は作りません', 403, 'no_pass');
      return reply(200, await mem.pair(key));
    }
    if (m === 'POST' && sub === 'claim') {
      const body = await readBody(request, conf.maxBodyBytes);
      const { key: got } = await mem.claim(String(body.code ?? ''), client);
      return reply(200, { key: got, ...(await mem.list(got)) });
    }
    if (m === 'POST' && sub === 'reflect') {
      const body = await readBody(request, conf.maxBodyBytes);
      return reply(200, { added: await mem.add(key, extractFacts(redactSecrets(String(body.text ?? '').slice(0, 500)).text)) });
    }
    return reply(405, { error: 'この方法は使えません' });
  } catch (err) {
    if (err instanceof MemoryError) return reply(err.status, { error: err.message, reason: err.reason });
    // 中身(置き場の住所・鍵)を返事に出さない
    return reply(503, { error: '記憶の置き場につながりません', reason: 'store' });
  }
}

/**
 * 公開の /api/chat で記憶を使うための手伝い(S6 の handleChat が、頭脳を呼ぶ前に 1 回呼ぶ)。
 * - 合鍵が無ければ何もしない
 * - 「わすれて」だけの言葉なら全部消し、返事のイベントまで返す(handled: true。頭脳は呼ばない)
 * - それ以外は、覚えていること(memory)とこの回に覚えた事(learned)を返す。runTurn にそのまま渡す
 * 置き場が使えないときは、記憶なしで話を続ける(会話を止めない)。
 * @returns {Promise<{handled:boolean, events:object[], memory:{text:string,items:object[]}|null, learned:object[]}>}
 */
export async function chatMemory(request, rawText, { store, cfg = {}, now = Date.now, env = process.env }) {
  const key = request.headers.get('x-memory-key') ?? '';
  const text = redactSecrets(String(rawText ?? '')).text; // 鍵らしい文字は覚えない
  const none = { handled: false, events: [], memory: null, learned: [] };
  if (!key) return none;
  const mem = createKvMemory({ store, pepper: memoryConfig(cfg, env).pepper, now });
  try {
    if (isForgetRequest(text)) return { ...none, handled: true, events: forgetReplyEvents(await mem.forgetAll(key)) };
    const memory = await mem.recall(key);
    let learned = [];
    try {
      learned = await mem.add(key, extractFacts(text));
    } catch {
      learned = []; // 合鍵の記憶が無い(消えた・7 日たった)ときは、覚えずに話す
    }
    const events = learned.length ? [{ type: 'memory', added: learned.map(({ id, kind, text: t }) => ({ id, kind, text: t })) }] : [];
    return { handled: false, events, memory, learned };
  } catch {
    return none;
  }
}
