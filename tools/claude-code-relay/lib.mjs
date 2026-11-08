// Claude Code 中継の部品。HTTP と子のプロセスに触らない関数だけを置く(試験しやすいように)。
// アプリが送る形(会話 = ストリームの Messages API、絵を描く道 = 絵つきの Messages API)だけを受け、ほかは断る。
import { DRAW_MODEL_DEFAULT, MODEL_DEFAULTS, isModelName } from '../../web/src/conversation/models.js';

export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
  }
}

// ---- 受けてよい物 ----
/** 本文の最上位で使ってよい項目(アプリが送る物 + 無害な指定)。道具・MCP などは入れない */
export const ALLOWED_KEYS = ['model', 'max_tokens', 'stream', 'thinking', 'system', 'messages', 'temperature', 'top_p', 'top_k', 'stop_sequences', 'metadata'];
export const MAX_TOKENS_LIMIT = 16000;
/** 絵(base64。実物 5MB まで、4 枚まで。png・jpeg・webp) */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 4;
/** 絵を描く道など、長く書く呼び出しの目安(これ以上の max_tokens か絵つきは、待つ時間を長くする) */
export const LONG_MAX_TOKENS = 4000;

/** 使ってよいモデル: 会話の既定・描く道の既定と、環境変数で替えた物(形が正しい時だけ) */
export function allowedModels(env = process.env) {
  const pick = (v, fallback) => (isModelName(String(v ?? '').trim()) ? String(v).trim() : fallback);
  return [...new Set([pick(env.CLAUDE_MODEL, MODEL_DEFAULTS.brain), pick(env.YC_DRAW_MODEL, DRAW_MODEL_DEFAULT)])];
}

const textBlocks = (blocks, where) =>
  blocks.map((b, i) => {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') throw new RequestError(`${where}[${i}] は text の段だけ使えます`);
    return b.text;
  });

const isImageBlock = (b) => Boolean(b) && typeof b === 'object' && b.type === 'image';

/** 絵の段を確かめて { media_type, data } にする */
export function readImageBlock(b, where) {
  const src = b?.source;
  if (!src || src.type !== 'base64' || typeof src.data !== 'string') throw new RequestError(`${where} の絵は base64 の形だけ使えます`);
  if (!IMAGE_TYPES.includes(src.media_type)) throw new RequestError(`${where} の絵の種類は png・jpeg・webp だけです`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(src.data)) throw new RequestError(`${where} の絵が base64 ではありません`);
  if (src.data.length * 0.75 > IMAGE_MAX_BYTES) throw new RequestError(`${where} の絵が大きすぎます(5MB まで)`);
  return { media_type: src.media_type, data: src.data };
}

/** 中身から絵の段と文の段を分ける(文字列は文だけ) */
export function splitContent(content, where = 'content') {
  if (typeof content === 'string') return { images: [], text: content };
  if (!Array.isArray(content)) throw new RequestError(`${where} は文字列か段の列にしてください`);
  const images = [];
  const texts = [];
  content.forEach((b, i) => {
    if (isImageBlock(b)) images.push(readImageBlock(b, `${where}[${i}]`));
    else texts.push(...textBlocks([b], `${where}[${i}]`));
  });
  if (images.length > IMAGE_MAX_COUNT) throw new RequestError(`絵は ${IMAGE_MAX_COUNT} 枚までです`);
  return { images, text: texts.join('\n\n') };
}

/** system(文字列か text の段の列)を 1 つの文にする。段のあいだは空行 */
export function systemText(system) {
  if (system === undefined || system === null) return '';
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) throw new RequestError('system は文字列か段の列にしてください');
  return textBlocks(system, 'system').join('\n\n');
}

/**
 * messages を claude -p に渡す 1 つの文にする。前の往復は記録(<conversation_so_far>)にし、最後の使う人の発言をそのまま最後に置く。
 * 絵は最後の使う人の発言のぶんだけ(前の往復の絵は断る)。
 */
export function buildInput(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new RequestError('messages が空です');
  const turns = messages.map((m, i) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new RequestError(`messages[${i}].role は user か assistant にしてください`);
    const where = `messages[${i}].content`;
    const isLast = i === messages.length - 1;
    if (isLast && m.role === 'user') return { role: m.role, ...splitContent(m.content, where) };
    const { images, text } = splitContent(m.content, where);
    if (images.length) throw new RequestError(`${where} の絵は、最後の使う人の発言だけに付けられます`);
    return { role: m.role, text, images };
  });
  const last = turns[turns.length - 1];
  if (last.role !== 'user') throw new RequestError('最後のメッセージは user にしてください');
  const earlier = turns.slice(0, -1);
  if (earlier.length === 0) return { prompt: last.text, images: last.images };
  const transcript = earlier.map((t) => `<${t.role}>\n${t.text}\n</${t.role}>`).join('\n');
  return { prompt: `<conversation_so_far>\n${transcript}\n</conversation_so_far>\n\n${last.text}`, images: last.images };
}

/** claude -p --input-format stream-json に渡す 1 行(使う人の発言 1 つ。絵の段のあとに文の段) */
export function streamInputLine(prompt, images) {
  const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: prompt }];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

/** 本文(Messages API の形)を確かめて、claude -p に渡す形にする。使えない物は RequestError */
export function parseRequest(body, { models = allowedModels() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('本文は JSON のオブジェクトにしてください');
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
  if (extra.length) throw new RequestError(`対応していない項目があります: ${extra.slice(0, 5).join('・')}(道具や MCP は使えません)`);
  if (!models.includes(body.model)) throw new RequestError(`この中継で使えるモデルは ${models.join('・')} だけです`);
  if ((body.thinking?.type ?? 'disabled') !== 'disabled') throw new RequestError('この中継は thinking: disabled だけに対応します');
  if (body.max_tokens !== undefined && !(Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= MAX_TOKENS_LIMIT)) {
    throw new RequestError(`max_tokens は 1〜${MAX_TOKENS_LIMIT} の整数にしてください`);
  }
  const { prompt, images } = buildInput(body.messages);
  const long = images.length > 0 || (body.max_tokens ?? 0) >= LONG_MAX_TOKENS;
  return { model: body.model, stream: body.stream === true, system: systemText(body.system), prompt, images, long };
}

// ---- 返す形(Messages API と同じ。使った量は 0) ----
export const zeroUsage = () => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 });

/** SSE の 1 つの区切り(event の行 + data の行 + 空行) */
export const sseFrame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export const events = {
  messageStart: (id, model) => ({
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: zeroUsage() },
  }),
  blockStart: () => ({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  textDelta: (text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
  blockStop: () => ({ type: 'content_block_stop', index: 0 }),
  messageDelta: () => ({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: zeroUsage() }),
  messageStop: () => ({ type: 'message_stop' }),
  error: (type, message) => ({ type: 'error', error: { type, message } }),
};

export const messageJson = (id, model, text) => ({
  id,
  type: 'message',
  role: 'assistant',
  model,
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: zeroUsage(),
});

export const errorJson = (type, message) => ({ type: 'error', error: { type, message } });

// ---- claude -p --output-format stream-json の 1 行を読む ----
export function readCliLine(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return { kind: 'junk' };
  }
  if (!obj || typeof obj !== 'object') return { kind: 'junk' };
  if (obj.type === 'stream_event') {
    const ev = obj.event ?? {};
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') return { kind: 'text', text: ev.delta.text };
    return { kind: 'event' };
  }
  if (obj.type === 'assistant') {
    const blocks = Array.isArray(obj.message?.content) ? obj.message.content : [];
    return { kind: 'assistant', text: blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('') };
  }
  if (obj.type === 'result') {
    return {
      kind: 'result',
      ok: obj.subtype === 'success' && obj.is_error !== true,
      subtype: String(obj.subtype ?? ''),
      text: typeof obj.result === 'string' ? obj.result : '',
      errors: Array.isArray(obj.errors) ? obj.errors.map(String) : null,
    };
  }
  return { kind: 'other' };
}

// ---- 子のプロセスに渡す環境変数 ----
// 渡さない物: API の行き先と鍵(ANTHROPIC*)、声の鍵(ELEVEN*)、この中継の設定(RELAY_*)、Claude Code の会話の物(CLAUDE* ただし下の 2 つは残す)、
// 名前に KEY・TOKEN・SECRET・PASSWORD・CREDENTIAL を含む物。鍵はこの中継を通らない。
const DROP_ENV = [/^ANTHROPIC/i, /^ELEVEN/i, /^RELAY_/i, /^CLAUDE/i, /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i];
/** 残す物(場所を指すだけで、秘密ではない): ログインの設定の場所、Windows で Git Bash を探す場所 */
const KEEP_ENV = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH'];

/** env から上の物を外し、extra を足した新しいオブジェクトを返す(元の env は変えない) */
export function cleanEnv(env, extra = {}) {
  const kept = Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && (KEEP_ENV.includes(k) || !DROP_ENV.some((re) => re.test(k)))));
  return { ...kept, ...extra };
}
