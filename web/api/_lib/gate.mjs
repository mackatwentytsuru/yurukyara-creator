// 入口の見張り: 合言葉(見出しで受ける。URL には入れない)と、回数の上限。
// 合言葉が無い・違う・上限を超えた、のどれでも、断らずに仮の頭脳で答える(デモが止まらないように)。
import { createHash, timingSafeEqual } from 'node:crypto';

export const PASS_HEADER = 'x-demo-pass';

// 合言葉がこれより短い設定では、本物の頭脳を使わない(辞書で当てられる短い言葉を防ぐ)
export const MIN_PASSPHRASE_LENGTH = 16;

// 合言葉の当て試しの守り。数えて止めるのは「間違えた回」と「間違えた接続元」だけ。
// - 接続元ごと: 枠の中で 5 回間違えた接続元は、しばらく比べない(その間は正しくても仮の頭脳。当たり外れを返さない)
// - 全体: 間違いが枠の中で 100 回に届いたら「強め」にする。強めの間は、1 回間違えた接続元をすぐ止める。
//   正しい合言葉は、全体の数えでは止めない(合言葉を知らない人が、全員の本物の頭脳を止めるボタンにならないように。CRITsec2 N1)
export const WRONG_PASS_LIMITS = Object.freeze({
  windowSeconds: 600, // 数える枠(10 分)
  perClient: 5, // 1 つの接続元が枠の中で間違えてよい回数。届いたら、その接続元は比べない
  clientWaitSeconds: 900, // その接続元を比べない時間(15 分)
  total: 100, // 全部の接続元を合わせた、枠の中の間違いの回数。届いたら「強め」にする
  totalWaitSeconds: 600, // 強めの時間(10 分。間違いが続く間は延びる)
  strictPerClient: 1, // 強めの間に、1 つの接続元が間違えてよい回数。届いたら、その接続元は比べない
});

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
 * 見出しの合言葉を確かめる(会話・記憶の番号づくり・番号の受け取りで同じ物を使う)。
 * - 送っていない人は数えない(当て試しではない)
 * - 止めた接続元は、比べもしない(passphrase-wait。当たり外れを返さない)
 * - 正しい合言葉は、止めていない接続元なら、全体の間違いの数に関わらず通す
 * - 間違えた回だけを接続元ごとと全体で数える。全体が多い間(強め)は、1 回間違えた接続元をすぐ止める
 * - 数えられない時は止める方へ倒す(counter-unavailable)
 * @returns {Promise<{ok: boolean, reason: ''|'passphrase'|'passphrase-wait'|'counter-unavailable'}>}
 */
export async function checkPassphrase(request, { cfg, store, now = Date.now, limits = WRONG_PASS_LIMITS }) {
  const given = String(request.headers.get(PASS_HEADER) ?? '').trim();
  if (!cfg.passphrase || !given) return { ok: false, reason: 'passphrase' };
  const client = clientId(request);
  try {
    if (await store.get(`pw:l:${client}`)) return { ok: false, reason: 'passphrase-wait' };
  } catch {
    return { ok: false, reason: 'counter-unavailable' };
  }
  if (samePass(given, cfg.passphrase)) return { ok: true, reason: '' };
  const slot = Math.floor(now() / (limits.windowSeconds * 1000));
  try {
    const strict = Boolean(await store.get('pw:all'));
    const mine = await store.incr(`pw:c:${client}:${slot}`, { ttlSeconds: limits.windowSeconds * 2 });
    const all = await store.incr(`pw:g:${slot}`, { ttlSeconds: limits.windowSeconds * 2 });
    if (!strict && all >= limits.total) await store.set('pw:all', '1', { ttlSeconds: limits.totalWaitSeconds });
    if (mine >= (strict ? limits.strictPerClient : limits.perClient)) await store.set(`pw:l:${client}`, '1', { ttlSeconds: limits.clientWaitSeconds });
  } catch {
    return { ok: false, reason: 'counter-unavailable' };
  }
  return { ok: false, reason: 'passphrase' };
}

/**
 * 本物の頭脳を使ってよいかを決める。使えないときは、その理由を返す(画面に「仮の頭脳です」と出すため)。
 * 回数は「使ってよい」と決めた時だけ数える(仮の頭脳の回は数えない)。
 * @returns {Promise<{brain: 'real'|'fallback', reason: string}>}
 */
export async function decideBrain(request, { cfg, store, now = Date.now, limits = WRONG_PASS_LIMITS }) {
  if (!cfg.hasBrainKey) return { brain: 'fallback', reason: 'no-key' };
  if (!cfg.passphrase) return { brain: 'fallback', reason: 'no-passphrase-set' };
  if (cfg.passphrase.length < MIN_PASSPHRASE_LENGTH) return { brain: 'fallback', reason: 'weak-passphrase' };
  const pass = await checkPassphrase(request, { cfg, store, now, limits });
  if (!pass.ok) return { brain: 'fallback', reason: pass.reason };
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

/**
 * BCV: 本物の頭脳へカメラの絵を送ってよいか(1 日の枚数。日本時間の日付ごと)。数えられない時は送らない方へ倒す。
 * 本物の頭脳と決めた回で、絵がついている時だけ呼ぶ(仮の頭脳の回は数えない)
 * @returns {Promise<boolean>}
 */
export async function takeImageSlot({ cfg, store, now = Date.now }) {
  try {
    const used = await store.incr(`img:${dayKey(now())}`, { ttlSeconds: 2 * 86400 });
    return used <= cfg.dailyImageCap;
  } catch {
    return false;
  }
}

/** 本文を上限つきで読む。大きすぎる・JSON でない物は null */
export async function readJson(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) return { error: 'too-large' };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return { error: 'too-large' };
  try {
    return { body: JSON.parse(new TextDecoder().decode(buf)), bytes: buf.byteLength }; // bytes: BCV(絵の無い本文は、元の上限で見る)
  } catch {
    return { error: 'not-json' };
  }
}
