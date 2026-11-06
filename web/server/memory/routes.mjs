// 記憶の入口(K4。くわしくは API.md)。合鍵はヘッダー x-memory-key で受ける(URL に入れない。記録にも書かない)。
import { MemoryError, isKey, samePass } from './store.mjs';
import { extractFacts } from './reflect.mjs';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const FORGET_RE = /^(?:ぜんぶ|全部|みんな)?\s*(?:わすれて|忘れて|わすれてね|忘れてね|わすれてください|忘れてください)[。!！]?$/;

/** 「わすれて」だけの言葉か(会話から全部消す) */
export function isForgetRequest(text) {
  return FORGET_RE.test(String(text ?? '').trim());
}

/**
 * 番号を作ってよいか。合言葉が設定されていれば、合っている時だけ。
 * 合言葉が無いときは、この端末だけで待ち受けている時(開発)だけ作る。公開のときに合言葉が無ければ作らない。
 */
export function canPair({ host, appPass, givenPass }) {
  if (appPass) return samePass(givenPass, appPass);
  return LOOPBACK.has(host);
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store.mjs').createMemoryStore>} deps.store
 * @param {{host:string, appPass:string}} deps.config
 * @param {{take:(client:string)=>{ok:boolean,message?:string}}} deps.limiter 合鍵を作る回数の上限
 * @param {(req:any)=>Promise<any>} deps.readBody
 */
export function createMemoryRoutes({ store, config, limiter, readBody }) {
  const keyOf = (req) => {
    const k = req.headers['x-memory-key'];
    return typeof k === 'string' ? k : '';
  };
  const send = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(obj));

  /** 当たれば true(応答済み)。当たらなければ false */
  return async function handle(req, res, path, url) {
    if (!path.startsWith('/api/memory')) return false;
    const client = req.socket.remoteAddress ?? 'unknown';
    try {
      if (req.method === 'POST' && path === '/api/memory/new') {
        const slot = limiter.take(client);
        if (!slot.ok) return send(res, 429, { error: slot.message }), true;
        return send(res, 200, store.create()), true;
      }
      if (req.method === 'GET' && path === '/api/memory') return send(res, 200, store.list(keyOf(req))), true;
      if (req.method === 'DELETE' && path === '/api/memory') {
        const id = url.searchParams.get('id');
        if (id) return send(res, 200, { ok: true, removed: store.forgetItem(keyOf(req), id) }), true;
        return send(res, 200, { ok: true, forgotten: store.forgetAll(keyOf(req)) }), true;
      }
      if (req.method === 'POST' && path === '/api/memory/pair') {
        if (!isKey(keyOf(req))) throw new MemoryError('合鍵の形が違います', 401, 'bad_key');
        if (!canPair({ host: config.host, appPass: config.appPass, givenPass: req.headers['x-app-pass'] })) {
          throw new MemoryError(config.appPass ? '合言葉が違うので、番号は作りません' : '合言葉が設定されていないので、番号は作りません', 403, 'no_pass');
        }
        return send(res, 200, store.pair(keyOf(req))), true;
      }
      if (req.method === 'POST' && path === '/api/memory/claim') {
        const body = await readBody(req);
        const { key } = store.claim(String(body.code ?? ''), client);
        return send(res, 200, { key, ...store.list(key) }), true;
      }
      if (req.method === 'POST' && path === '/api/memory/reflect') {
        const body = await readBody(req);
        return send(res, 200, { added: store.add(keyOf(req), extractFacts(String(body.text ?? '').slice(0, 500))) }), true;
      }
      return send(res, 405, { error: 'この方法は使えません' }), true;
    } catch (err) {
      if (err instanceof MemoryError) return send(res, err.status, { error: err.message, reason: err.reason }), true;
      throw err;
    }
  };
}
