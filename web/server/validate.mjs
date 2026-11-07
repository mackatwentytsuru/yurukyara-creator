// サーバーの入口の検査。Claude を呼ぶ枠(お金)を使う前に、型・長さ・数の範囲を確かめ、きれいにした物だけを先へ渡す。
// 順番は「回数の上限 → 型と値 → 状態」ではなく、安い検査から: ここ(型と値)を通った物だけが、枠を使う。
// 鍵らしい文字(声の鍵を会話の欄に貼った時など)は、ここで消す。頭脳・記憶・記録のどこにも届かない。
// 11-07(CRITsec F6・F7): 指示文の 2 段目に入る欄(名前・場所の説明・目印・表情の説明)は、人格と同じ上書き止めを通して 1 行にする。
// 表情と動きの名前は決まった形だけ。履歴の返事(assistant)に恋人役・独り占めの言葉があれば、その返事は受けない。
// 公開の関数では、履歴の返事を「この画面が送る形」(1 行 1 つの say の JSON・4 行まで・1 文 60 字まで・合わせて 600 字まで)だけ受ける。
import { redactSecrets } from '../src/conversation/secrets.js';
import { isUnsafeOutput, oneLine, sanitizeBlock, sanitizeLine } from './safety.mjs';
import { STAGES, isChoiceName } from './prompt.mjs';
import { readCameraImage } from './camera.mjs'; // BCV: カメラの絵の形と大きさ

const clean = (s) => redactSecrets(s).text;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
// 改行を LF にそろえる。Windows の取り出し(core.autocrlf=true)では characters/<id>/persona.md が CRLF になり、
// 画面はそれをそのまま読んで送る。長さで切る前にそろえて、どの取り出しでも頭脳に 1 文字も違わない文が渡るようにする
const lf = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : v);

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
  hintText: 60, // 表情の「いつ使うか」の説明
  publicAssistantChars: 600, // 公開の関数で受ける、履歴の返事 1 つの長さ(この画面が送る形は 3〜4 行で 500 字ほど)
  publicAssistantLines: 4,
  publicAssistantText: 60, // 返事の 1 文(指示文の決まりは 40 字。少し余裕を見る)
};

/** 表情と動きの名前: 決まった形(英小文字・数字・_ : -、40 字まで)の物だけ。改行や文の入った名前は捨てる */
function choiceList(v, max = LIMITS.choices) {
  return [...new Set(list(v, max).filter(isChoiceName))];
}

/** 表情の説明。一覧にある名前の物だけ、文字の物だけを、1 行・短くして残す。上書きの言葉の入った説明は捨てる */
function hintMap(v, names) {
  const out = {};
  if (!isObject(v)) return out;
  for (const n of names) {
    const h = Object.hasOwn(v, n) ? sanitizeLine(v[n], LIMITS.hintText) : '';
    if (h) out[n] = h;
  }
  return out;
}

/** 公開の関数の、履歴の返事 1 つ。この画面が送る形(1 行 1 つの say の JSON)だけを受け、決まった形に組み直す。受けない時は null */
function publicAssistantContent(content) {
  if (Array.from(content).length > LIMITS.publicAssistantChars) return null;
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > LIMITS.publicAssistantLines) return null;
  const out = [];
  for (const [i, line] of lines.entries()) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isObject(obj) || obj.type !== 'say' || typeof obj.text !== 'string') return null;
    const text = oneLine(obj.text); // 1 行にする
    if (!text || Array.from(text).length > LIMITS.publicAssistantText) return null;
    const say = { type: 'say', text };
    if (isChoiceName(obj.expression)) say.expression = obj.expression;
    if (isChoiceName(obj.motion)) say.motion = obj.motion;
    const gaze = sanitizeLine(obj.gaze, 60);
    if (gaze) say.gaze = gaze;
    if (i === 0) {
      const intent = sanitizeLine(obj.intent, 20);
      if (intent) say.intent = intent;
      if (STAGES.includes(obj.stage)) say.stage = obj.stage;
      if (typeof obj.handoff === 'boolean') say.handoff = obj.handoff;
    }
    out.push(JSON.stringify(say));
  }
  return out.join('\n');
}

/** 履歴: 形と長さをそろえ、恋人役・独り占めの言葉の入った返事を外し、同じ側が続いたら 1 つにまとめ、user から始める */
function historyList(raw, { publicPath }) {
  const out = [];
  for (const m of list(raw, 200).filter((x) => isObject(x) && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content.length > 0).slice(-LIMITS.historyItems)) {
    let content = clean(lf(m.content).slice(0, LIMITS.historyText));
    if (m.role === 'assistant') {
      if (isUnsafeOutput(content)) continue; // キャラが言ったことになっている恋人役・独り占めの言葉は、頭脳に渡さない(F7)
      if (publicPath) {
        content = publicAssistantContent(content);
        if (content === null) continue;
      }
    }
    const last = out.at(-1);
    if (last && last.role === m.role) last.content = `${last.content}\n${content}`.slice(0, LIMITS.historyText);
    else out.push({ role: m.role, content });
  }
  // Claude に渡す会話は user から始める。直近 N 件で切ると assistant から始まることがある(返事が無かった回があると、ずれる)
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 公開の関数(Vercel)で動いているか。Vercel は関数の環境に VERCEL を入れる。手元のサーバーと試験には無い */
export const isPublicRuntime = (env = process.env) => Boolean(env.VERCEL);

/**
 * /api/chat の本文を、決まった形・長さにして返す。形が根本から違う物は ValidationError。
 * @param {object} raw
 * @param {{publicPath?:boolean}} [o] publicPath: 公開の関数の決まり(履歴の返事は、この画面が送る形だけ)。既定は Vercel の上なら true
 */
export function sanitizeChatBody(raw, { publicPath = isPublicRuntime() } = {}) {
  if (!isObject(raw)) throw new ValidationError('本文が JSON のオブジェクトではありません');
  const trigger = raw.trigger === 'approach' ? 'approach' : null;
  const text = clean(str(raw.text, LIMITS.text)).trim();
  if (!text && trigger !== 'approach') throw new ValidationError('text が空です');

  const history = historyList(raw.history, { publicPath });

  const character = isObject(raw.character) ? raw.character : {};
  const place = isObject(raw.place) ? raw.place : {};
  // 目印の名前・場所・メモは 1 行にし、上書きの言葉の入った欄は外す(名前が外れたら目印ごと外す)
  const landmarks = list(place.landmarks, LIMITS.landmarks)
    .filter((l) => isObject(l) && typeof l.name === 'string' && l.name)
    .map((l) => ({ name: sanitizeLine(clean(str(l.name, LIMITS.name)), LIMITS.name), where: sanitizeLine(clean(str(l.where, LIMITS.landmarkText))), note: sanitizeLine(clean(str(l.note, LIMITS.landmarkText))) }))
    .filter((l) => l.name);

  const out = {
    history,
    text,
    trigger,
    interview: raw.interview === true,
    scene: clean(str(raw.scene, LIMITS.scene)),
    character: { name: sanitizeLine(clean(str(character.name, LIMITS.name))) || undefined, persona: clean(str(lf(character.persona), LIMITS.persona)) },
    place: { name: sanitizeLine(clean(str(place.name, LIMITS.name))) || undefined, info: sanitizeBlock(clean(str(lf(place.info), LIMITS.placeInfo))).text, landmarks },
    expressions: choiceList(raw.expressions),
    motions: choiceList(raw.motions, 24),
  };
  out.expressionHints = hintMap(raw.expressionHints, out.expressions);
  // BCV: カメラの絵(使う人がカメラを入れて話しかけた回だけ。近づいた合図の回は受けない)。JPEG の頭と大きさを、枠を使う前に確かめる(server/camera.mjs)
  const image = trigger === 'approach' ? null : readCameraImage(raw.image, (m) => new ValidationError(m));
  if (image) out.image = image;
  // 試験用の遅延の指定は、有限の数で範囲内の物だけ
  if (Number.isFinite(raw.hedgeMs)) out.hedgeMs = Math.min(Math.max(raw.hedgeMs, 0), 10_000);
  return out;
}

/** 公開の関数の決まりで点検する(履歴の返事は、この画面が送る形だけ)。S6 の web/api/chat.mjs が sanitize に渡せる形 */
export const sanitizePublicChatBody = (raw) => sanitizeChatBody(raw, { publicPath: true });

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
