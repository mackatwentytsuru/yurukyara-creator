// /api/memory の入口。中身(合鍵・番号・一覧・わすれて)は S3 の記憶の入口(契約 K4)が持ち、ここは置き場と上限だけを渡す。
// S3 の入口がまだ無いときは 501 で「まだ無い」と正直に返す。
import { clientId } from './gate.mjs';
import { json } from './http.mjs';

export const MEMORY_PER_MINUTE_FACTOR = 3; // 記憶は 1 回の会話で数回呼ぶので、会話の上限の 3 倍まで

/**
 * @param {Request} request
 * @param {object} deps
 * @param {() => Promise<{handleMemory?: Function}|null>} deps.loadHandler S3 の入口を読む(無ければ null)
 */
export async function handleMemoryRoute(request, { cfg, store, loadHandler, now = Date.now }) {
  try {
    const n = await store.incr(`rlm:${clientId(request)}:${Math.floor(now() / 60000)}`, { ttlSeconds: 120 });
    if (n > cfg.perMinute * MEMORY_PER_MINUTE_FACTOR) return json(429, { error: '少し間をあけてから、もう一度どうぞ' }, { 'retry-after': '60' });
  } catch {
    return json(503, { error: '記憶の置き場につながりません' });
  }
  const mod = await loadHandler();
  if (!mod?.handleMemory) return json(501, { error: '記憶の入口はまだありません(契約 K4 の実装待ち)' });
  return mod.handleMemory(request, { store, cfg: { maxBodyBytes: cfg.maxBodyBytes }, now });
}
