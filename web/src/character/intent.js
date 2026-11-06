// 動きの意図(契約 K2 版 1。持ち主 S5)。説明は同じフォルダの INTENT.md。
// 「どう振る舞うか」を 2D と 3D に同じ形で渡し、キャラはそれぞれのやり方で表す。three も DOM も使わない(node --test とサーバーでも読める)。
//   意図: { emotion, intensity 0〜1, gesture, gaze, mouth 0〜1 }
//   受け手(キャラ)の 5 つの呼び方: lookAt・setExpression(setEmotion)・setMouth・play・update(CharacterBase と同じ)
// そのキャラに無い表情・動きは、近い物へ落とす。知らない名前でも例外は出さない(会話を止めない)。
import { STANDARD_EXPRESSIONS, nearestExpression } from './expressionNames.js';

export const INTENT_VERSION = 1;

/** 表情(感情)は 7 つ。K1 の looks.2d.expressions の名前もこれに合わせる */
export const EMOTIONS = Object.freeze([...STANDARD_EXPRESSIONS]); // neutral happy surprised sad angry relaxed think

/** 動きの言葉。3D の手続きの動き(gestures.js)と、rig の動きのファイルの名前の共通部分+jump */
export const INTENT_GESTURES = Object.freeze(['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point', 'jump']);

/** 受け手が持つ 5 つの呼び方 */
export const RECEIVER_METHODS = Object.freeze(['lookAt', 'setExpression', 'setMouth', 'play', 'update']);

/** 7 つの表情のうち、そのキャラが出せない時に代わりに試す順(左から)。最後はいつも neutral */
export const EMOTION_NEAR = Object.freeze({
  neutral: [],
  happy: ['relaxed'],
  relaxed: ['happy'],
  surprised: [],
  sad: [],
  angry: ['sad'], // 怒りは、同じ「いやな気持ち」の側の sad に寄せる
  think: ['relaxed'],
});

/** 動きが無い時に代わりに試す順(左から)。どれも無ければ動かない */
export const GESTURE_NEAR = Object.freeze({
  nod: [],
  bow: ['nod'],
  wave: ['nod'],
  think: ['tilt', 'nod'],
  tilt: ['nod'],
  shake: ['tilt'],
  shrug: ['tilt'],
  point: ['wave', 'nod'],
  jump: ['wave', 'nod'],
});

// 別名(英語の言いかえ・日本語)→ 7 つの表情。ここに無い名前は expressionNames.js の近い物の表で落とす
const EMOTION_ALIAS = {
  thinking: 'think', ponder: 'think', joy: 'happy', glad: 'happy', calm: 'relaxed', relax: 'relaxed', surprise: 'surprised',
  anger: 'angry', sadness: 'sad', normal: 'neutral', none: 'neutral',
  ふつう: 'neutral', うれしい: 'happy', 嬉しい: 'happy', 喜び: 'happy', 楽しい: 'happy', 驚き: 'surprised', びっくり: 'surprised',
  悲しい: 'sad', かなしい: 'sad', 怒り: 'angry', ぷんぷん: 'angry', 落ち着き: 'relaxed', のんびり: 'relaxed', 考え中: 'think', 考える: 'think',
};
const GESTURE_ALIAS = { nodding: 'nod', うなずく: 'nod', bowing: 'bow', おじぎ: 'bow', 手を振る: 'wave', hello: 'wave', 首をかしげる: 'tilt', headshake: 'shake', 指さす: 'point', 跳ねる: 'jump' };

const DEFAULT_USER = Object.freeze([0, 1.4, 2]); // 話し相手の位置が分からない時の既定(キャラの正面 2m、目の高さ)
const DEFAULT_GAZE_MS = 2400;

const clamp01 = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const word = (v) => (typeof v === 'string' ? v.trim() : '');

/** 視線の指定をそろえる。'user'(相手)・'away'・'landmark:<名前>'・[x,y,z]。それ以外は null(変えない) */
export function normalizeGaze(gaze) {
  if (Array.isArray(gaze)) return gaze.length === 3 && gaze.every((v) => typeof v === 'number' && Number.isFinite(v)) ? [...gaze] : null;
  if (gaze && typeof gaze === 'object') {
    const xyz = [gaze.x, gaze.y, gaze.z];
    return xyz.every((v) => typeof v === 'number' && Number.isFinite(v)) ? xyz : null;
  }
  const g = word(gaze);
  if (g === 'user' || g === 'person') return 'user';
  if (g === 'away') return 'away';
  if (g.startsWith('landmark:') && g.length > 'landmark:'.length) return g;
  return null;
}

/** 意図の形をそろえる。足りない欄・壊れた値は既定にする(例外は出さない) */
export function normalizeIntent(intent = {}) {
  const i = intent && typeof intent === 'object' ? intent : {};
  return {
    emotion: word(i.emotion) || 'neutral',
    intensity: clamp01(i.intensity, 1),
    gesture: word(i.gesture) || 'none',
    gaze: normalizeGaze(i.gaze),
    mouth: clamp01(i.mouth, 0),
  };
}

/** 名前を、7 つの表情のどれかに直す(別名・日本語・カスタムの表情 → 近い標準の表情)。分からなければ neutral */
export function toStandardEmotion(name) {
  const raw = word(name);
  if (!raw) return 'neutral';
  const lower = raw.toLowerCase();
  if (EMOTIONS.includes(lower)) return lower;
  if (EMOTION_ALIAS[lower]) return EMOTION_ALIAS[lower];
  return nearestExpression(raw, (n) => EMOTIONS.includes(n)) ?? 'neutral';
}

/**
 * そのキャラが出せる表情に直す。出せる名前ならそのまま(カスタムの表情も残す)。
 * @param {string} name
 * @param {(n:string)=>boolean} canShow
 */
export function resolveEmotion(name, canShow = () => true) {
  const raw = word(name);
  if (raw && canShow(raw)) return raw;
  const std = toStandardEmotion(raw);
  for (const n of [std, ...(EMOTION_NEAR[std] ?? []), 'neutral']) if (canShow(n)) return n;
  return 'neutral';
}

/** 動きを試す順。最初に頼まれた名前(キャラ独自の動きの名前もそのまま試す)、次に近い動き */
export function gestureOrder(name) {
  const raw = word(name);
  if (!raw || raw.toLowerCase() === 'none') return [];
  const key = GESTURE_ALIAS[raw] ?? GESTURE_ALIAS[raw.toLowerCase()] ?? raw.toLowerCase();
  const order = [raw, key, ...(GESTURE_NEAR[key] ?? [])];
  return [...new Set(order)];
}

/** キャラが出せる表情かを調べる関数。分からない時は「出せる」としてキャラに任せる(キャラの側でも近い物へ落とす) */
export function canShowFn(character) {
  if (typeof character?.canShow === 'function') return (n) => Boolean(character.canShow(n));
  const list = Array.isArray(character?.expressions) ? character.expressions : [];
  return list.length ? (n) => list.includes(n) : () => true;
}

/** 受け手が 5 つの呼び方を持っているか(足りない名前を返す。空なら OK) */
export function missingReceiverMethods(character) {
  return RECEIVER_METHODS.filter((m) => typeof character?.[m] !== 'function');
}

function applyGaze(character, gaze, ctx) {
  if (gaze === null) return null; // 変えない(いつもの視線: 人を追う・ぼんやり見る)
  if (typeof ctx.setGaze === 'function') {
    // 画面(main.js)は、毎コマ人を追って lookAt を上書きする。視線は画面の setGaze に渡して、しばらく保ってもらう
    const local = ctx.setGaze(gaze === 'user' ? 'person' : gaze, ctx.gazeMs ?? DEFAULT_GAZE_MS);
    return Array.isArray(local) ? local : null;
  }
  if (gaze === 'user') character.lookAt(ctx.userPosition ?? DEFAULT_USER);
  else if (gaze === 'away') character.lookAt(null);
  else if (Array.isArray(gaze)) character.lookAt(gaze);
  return null; // 'landmark:…' は、場所を知っている画面(ctx.setGaze)だけが扱える
}

function playGesture(character, gesture, opts) {
  for (const name of gestureOrder(gesture)) {
    if (character.play(name, opts)) return { gesture: name, played: true };
  }
  return { gesture: 'none', played: false };
}

/**
 * 意図を 1 つ、キャラに流す。返り値は、実際に何をしたか(試験と記録用)。
 * @param {object} character CharacterBase の 5 つの呼び方を持つ物(2D・3D・VRM)
 * @param {object} intent { emotion, intensity, gesture, gaze, mouth }
 * @param {object} [ctx]
 * @param {(spec:string|number[], ms:number) => (number[]|null)} [ctx.setGaze] 画面の視線(main.js)。あれば視線はこれに任せる
 * @param {number[]} [ctx.userPosition] setGaze が無い時、'user' で見る位置(ワールド座標)
 * @param {number} [ctx.gazeMs] setGaze に渡す、視線を保つ時間
 */
export function applyIntent(character, intent, ctx = {}) {
  const n = normalizeIntent(intent);
  const emotion = resolveEmotion(n.emotion, canShowFn(character));
  // neutral は「ほかの表情を全部戻す」。カスタムの表情(漫符の板つき)は値に比例して大きくなるので 1 で出す
  const weight = emotion === 'neutral' ? 0 : character.isCustomExpression?.(emotion) ? 1 : n.intensity;
  if (typeof character.setEmotion === 'function') character.setEmotion(emotion, weight);
  else character.setExpression(emotion, weight);
  character.setMouth(n.mouth);
  const target = applyGaze(character, n.gaze, ctx);
  const g = playGesture(character, n.gesture, target ? { dx: target[0], dz: target[2] } : {});
  return { asked: n, emotion, weight, gesture: g.gesture, played: g.played, gaze: n.gaze, mouth: n.mouth };
}

/**
 * 会話のサーバーの say のイベント { expression, motion, gaze } を意図にする。
 * 表情の強さは、今の会話の決まり(標準の表情は 0.9)に合わせる。口は声の大きさが動かすので 0。
 */
export function intentFromSay(ev = {}) {
  const e = ev && typeof ev === 'object' ? ev : {};
  return normalizeIntent({ emotion: e.expression, intensity: 0.9, gesture: e.motion, gaze: e.gaze, mouth: 0 });
}
