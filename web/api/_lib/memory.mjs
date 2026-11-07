// /api/memory の入口。中身(合鍵・番号・一覧・わすれて)は S3 の記憶の入口(契約 K4)が持ち、ここは置き場と上限だけを渡す。
// S3 の入口がまだ無いときは 501 で「まだ無い」と正直に返す。
import { WRONG_PASS_LIMITS, checkPassphrase, clientId } from './gate.mjs';
import { json } from './http.mjs';

export const MEMORY_PER_MINUTE_FACTOR = 3; // 記憶は 1 回の会話で数回呼ぶので、会話の上限の 3 倍まで
export const MEMORY_SUBS = new Set(['', 'new', 'pair', 'claim', 'reflect']); // 契約 K4 の下の道(S3 の handler.mjs と同じ)
// 合言葉を比べる下の道(番号づくりと番号の受け取り)。返事で当たり外れが分かるので、会話と同じ当て試しの守りを通す(CRITsec2 N2)
export const PASS_SUBS = new Set(['pair', 'claim']);

/** 下の道。vercel.json の書き換えの ?sub= を先に見て、無ければ道の名前から */
export function memorySubOf(request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('sub') ?? url.pathname.replace(/^.*\/api\/memory\/?/, '');
  return raw.replace(/^\/+|\/+$/g, '');
}

/**
 * 記憶の置き場を使う前の、接続元ごとの 1 分の数え。/api/memory と、/api/chat の記憶(memoryChat.mjs)で同じ数えを使う。
 * @returns {Promise<'ok'|'limited'|'unavailable'>}
 */
export async function countMemoryUse(request, { cfg, store, now = Date.now }) {
  try {
    const n = await store.incr(`rlm:${clientId(request)}:${Math.floor(now() / 60000)}`, { ttlSeconds: 120 });
    return n > cfg.perMinute * MEMORY_PER_MINUTE_FACTOR ? 'limited' : 'ok';
  } catch {
    return 'unavailable';
  }
}

/** 合言葉が通らなかった時の返事(番号づくり・受け取り。会話と同じ当て試しの守りを通す) */
function passRefused(reason, cfg, sub) {
  const verb = sub === 'claim' ? '受け取れません' : '作りません';
  if (reason === 'counter-unavailable') return json(503, { error: '記憶の置き場につながりません', reason: 'store' });
  if (reason === 'passphrase-wait') return json(429, { error: `合言葉の間違いが続いたので、しばらく番号は${verb}`, reason: 'wait' }, { 'retry-after': String(WRONG_PASS_LIMITS.clientWaitSeconds) });
  const error = cfg.passphrase ? `合言葉が違うので、番号は${verb}` : `合言葉が設定されていないので、番号は${verb}`;
  return json(403, { error, reason: 'no_pass' });
}

/**
 * @param {Request} request
 * @param {object} deps
 * @param {() => Promise<{handleMemory?: Function}|null>} deps.loadHandler S3 の入口を読む(無ければ null)
 */
export async function handleMemoryRoute(request, { cfg: given, store, loadHandler, now = Date.now, env = process.env }) {
  // 合言葉は cfg を先に、無ければ環境変数(S3 の memoryConfig と同じ決まり。前後の空白は落とす)
  const cfg = { ...given, passphrase: typeof given.passphrase === 'string' ? given.passphrase : String(env.DEMO_PASSPHRASE ?? '').trim() };
  // 無い道は、置き場を使う前に断る(意味の無い呼び出しで、置き場の枠を減らさない)
  const sub = memorySubOf(request);
  if (!MEMORY_SUBS.has(sub)) return json(404, { error: 'この道はありません' });
  const use = await countMemoryUse(request, { cfg, store, now });
  if (use === 'unavailable') return json(503, { error: '記憶の置き場につながりません' });
  if (use === 'limited') return json(429, { error: '少し間をあけてから、もう一度どうぞ' }, { 'retry-after': '60' });
  // 番号づくりと受け取りは合言葉を比べる。会話と同じく間違いを数え、止めた接続元は比べない
  if (request.method === 'POST' && PASS_SUBS.has(sub)) {
    const pass = await checkPassphrase(request, { cfg, store, now });
    if (!pass.ok) return passRefused(pass.reason, cfg, sub);
  }
  const mod = await loadHandler();
  if (!mod?.handleMemory) return json(501, { error: '記憶の入口はまだありません(契約 K4 の実装待ち)' });
  return mod.handleMemory(request, { store, cfg: { maxBodyBytes: cfg.maxBodyBytes, passphrase: cfg.passphrase }, now });
}
