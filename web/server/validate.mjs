// サーバーの入口の検査。Claude を呼ぶ枠(お金)を使う前に、型・長さ・数の範囲を確かめ、きれいにした物だけを先へ渡す。
// 順番は「回数の上限 → 型と値 → 状態」ではなく、安い検査から: ここ(型と値)を通った物だけが、枠を使う。
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export const LIMITS = {
  text: 500, // 1 回の発言(声でも文字でも)
  historyItems: 12,
  historyText: 2000,
  scene: 1000,
  persona: 6000,
  placeInfo: 4000,
  name: 100,
  landmarks: 32,
  landmarkText: 200,
  choices: 32, // 表情・動きの名前の数
  choiceName: 40,
};

function choiceList(v, max = LIMITS.choices) {
  return list(v, max).filter((s) => typeof s === 'string' && s.length > 0).map((s) => s.slice(0, LIMITS.choiceName));
}

/** /api/chat の本文を、決まった形・長さにして返す。形が根本から違う物は ValidationError */
export function sanitizeChatBody(raw) {
  if (!isObject(raw)) throw new ValidationError('本文が JSON のオブジェクトではありません');
  const trigger = raw.trigger === 'approach' ? 'approach' : null;
  const text = str(raw.text, LIMITS.text).trim();
  if (!text && trigger !== 'approach') throw new ValidationError('text が空です');

  const history = list(raw.history, 200)
    .filter((m) => isObject(m) && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0)
    .slice(-LIMITS.historyItems)
    .map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.historyText) }));

  const character = isObject(raw.character) ? raw.character : {};
  const place = isObject(raw.place) ? raw.place : {};
  const landmarks = list(place.landmarks, LIMITS.landmarks)
    .filter((l) => isObject(l) && typeof l.name === 'string' && l.name)
    .map((l) => ({ name: str(l.name, LIMITS.name), where: str(l.where, LIMITS.landmarkText), note: str(l.note, LIMITS.landmarkText) }));

  const clean = {
    history,
    text,
    trigger,
    scene: str(raw.scene, LIMITS.scene),
    character: { name: str(character.name, LIMITS.name) || undefined, persona: str(character.persona, LIMITS.persona) },
    place: { name: str(place.name, LIMITS.name) || undefined, info: str(place.info, LIMITS.placeInfo), landmarks },
    expressions: choiceList(raw.expressions),
    motions: choiceList(raw.motions, 24),
  };
  // 試験用の遅延の指定は、有限の数で範囲内の物だけ
  if (Number.isFinite(raw.hedgeMs)) clean.hedgeMs = Math.min(Math.max(raw.hedgeMs, 0), 10_000);
  return clean;
}

const METRIC_NUMBERS = ['totalMs', 'sendToFirstSayMs', 'ttsFirstByteMs', 't0ToSendMs', 'fillerMs', 'fillerEndMs'];

/** /api/metrics の本文から、知っている項目だけを取り出す(ログに好きな物を書き込ませない) */
export function sanitizeMetric(raw) {
  if (!isObject(raw)) throw new ValidationError('本文が JSON のオブジェクトではありません');
  const entry = {
    mode: raw.mode === 'voice' ? 'voice' : 'text',
    brain: raw.brain === 'haiku' ? 'haiku' : 'mock',
    tts: raw.tts === 'eleven' ? 'eleven' : 'silent',
    valid: raw.valid === true,
  };
  for (const k of METRIC_NUMBERS) {
    const v = raw[k];
    entry[k] = Number.isFinite(v) && v >= 0 && v < 600_000 ? Math.round(v) : null;
  }
  return entry;
}
