// 入口の見張り: 合言葉(見出しで受ける。URL には入れない)と、回数の上限。
// 合言葉が無い・違う・上限を超えた、のどれでも、断らずに仮の頭脳で答える(デモが止まらないように)。
import { createHash, timingSafeEqual } from 'node:crypto';

export const PASS_HEADER = 'x-demo-pass';

/** 長さの違いも漏らさない比べ方(両方を同じ長さのハッシュにしてから比べる) */
export function samePass(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** 接続元の目印。Vercel が付ける見出しの最初の値。そのままは保存せず、ハッシュの頭だけを使う */
export function clientId(request) {
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(`yc:${raw}`).digest('hex').slice(0, 16);
}

const dayKey = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll('-', ''); // 日本時間の日付

/**
 * 本物の頭脳を使ってよいかを決める。使えないときは、その理由を返す(画面に「仮の頭脳です」と出すため)。
 * 回数は「使ってよい」と決めた時だけ数える(仮の頭脳の回は数えない)。
 * @returns {Promise<{brain: 'real'|'fallback', reason: string}>}
 */
export async function decideBrain(request, { cfg, store, now = Date.now }) {
  if (!cfg.hasBrainKey) return { brain: 'fallback', reason: 'no-key' };
  if (!cfg.passphrase) return { brain: 'fallback', reason: 'no-passphrase-set' };
  if (!samePass(request.headers.get(PASS_HEADER), cfg.passphrase)) return { brain: 'fallback', reason: 'passphrase' };
  const t = now();
  try {
    const perMin = await store.incr(`rl:${clientId(request)}:${Math.floor(t / 60000)}`, { ttlSeconds: 120 });
    if (perMin > cfg.perMinute) return { brain: 'fallback', reason: 'per-minute' };
    const daily = await store.incr(`cap:${dayKey(t)}`, { ttlSeconds: 2 * 86400 });
    if (daily > cfg.dailyCap) return { brain: 'fallback', reason: 'daily-cap' };
  } catch {
    // 数えられないときは、使いすぎを防ぐ方に倒す
    return { brain: 'fallback', reason: 'counter-unavailable' };
  }
  return { brain: 'real', reason: '' };
}

/** 本文を上限つきで読む。大きすぎる・JSON でない物は null */
export async function readJson(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) return { error: 'too-large' };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return { error: 'too-large' };
  try {
    return { body: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { error: 'not-json' };
  }
}
