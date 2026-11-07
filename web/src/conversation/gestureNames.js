// 返事の仕草の名前(第 12 波 b・B3。名前の持ち主は B5G の「かわいい仕草の層」。約束は board の B12/K2_gesture_names.md)。
// 会話の側は、返事の 1 文ごとの motion にこの名前を入れる。画面は同じ名前で、3D・VRM・2D のどれでも動かす。
// - 指示文の説明は、約束の表の「何をする」と「どんな返事の時」の言葉(MOTION_DESCRIPTIONS)
// - 例と説明に出すのは、そのキャラが使える名前(画面が motions で送る)だけ。画面が自分で出す仕草(待つ・聞く・考える・話す)は送らない
// - 1 つの返事で仕草を頼むのは 2 回まで(残りの文は none)。前からの jump は cheer と同じ
// DOM も通信も使わない(サーバーの指示文・頭脳と、node --test が読む)。

/** 返事で頼める仕草(約束の表 2)。jump は前からの名前(cheer と同じに動く) */
export const REPLY_GESTURES = Object.freeze(['none', 'greet', 'happy', 'cheer', 'shy', 'surprised', 'think', 'nod', 'tilt', 'droop', 'bow', 'wave', 'shake', 'shrug', 'point', 'jump']);

/** 画面が自分で出す仕草(約束の表 1)。返事では送らない・指示文にも出さない */
export const SCREEN_GESTURES = Object.freeze(['idle', 'listening', 'thinking', 'talking', 'talk']);

/** 1 つの返事の中で、仕草を頼む文の数の上限(約束の表 2 の下の決まり) */
export const MAX_GESTURES_PER_REPLY = 2;

/** 指示文に渡す説明(体がすること + どんな返事の時)。説明の無い名前(キャラ独自の動き)は名前だけで渡す */
export const MOTION_DESCRIPTIONS = Object.freeze({
  none: '動かない(落ち着いた返事・長い説明)',
  greet: '手をふって小さく弾む(会った時・名乗る時・はじめまして・またね)',
  happy: '小さく弾んで体をゆらす(ほめられた・お礼を言われた・楽しい話・好きな物の話)',
  cheer: '両手を上げて弾む(すごい・おめでとう・やったね。いちばん強いうれしさ)',
  shy: '少しうつむいて目をそらし、体をゆらす(ほめられて照れる・かわいいと言われた)',
  surprised: '体が小さく上へはねる(思いがけない話・ええっ・知らなかった)',
  think: '首をかしげて上を見る(考えてから答える・思い出す)',
  nod: 'うなずく(そうだね・わかった・はい・いいね)',
  tilt: '首をかしげる(なあに?・聞き返す・よくわからない)',
  droop: 'しょんぼりする(残念・ごめんね・悲しい話を聞いた)',
  bow: 'おじぎをする(ていねいなお礼・おわび・ていねいなはじめまして)',
  wave: '片手をふる(バイバイ・こっちだよ)',
  shake: '首を横にふる(いいえ・ちがうよ・だめだよ)',
  shrug: '肩をすくめる(さあ?・わからないなあ)',
  point: '指さして方向を示す(場所の目印があって、あっちだよ と言う時)',
  jump: '両手を上げて弾む(すごい・おめでとう・やったね)',
});

// 前からの名前・言いかえ → 約束の名前
const ALIAS = Object.freeze({ jump: 'cheer', hello: 'greet', bye: 'wave', sad: 'droop', joy: 'happy', glad: 'happy', thinking: 'think', surprise: 'surprised' });

// そのキャラに無い仕草を頼まれた時に、代わりに試す順(約束の表 3 と、前からの近い物の表に合わせる。どれも無ければ動かない)
const NEAR = Object.freeze({
  greet: ['wave', 'bow', 'nod'],
  cheer: ['jump', 'greet', 'happy', 'wave', 'nod'],
  jump: ['cheer', 'greet', 'happy', 'wave', 'nod'],
  happy: ['nod'],
  shy: ['tilt', 'nod'],
  surprised: ['nod'],
  droop: ['nod'],
  think: ['tilt', 'nod'],
  tilt: ['nod'],
  bow: ['nod'],
  wave: ['greet', 'nod'],
  shake: ['tilt'],
  shrug: ['tilt'],
  point: ['wave', 'nod'],
});

const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * 指示文に出す仕草の名前。画面が自分で出す物を外し、jump と cheer の両方があれば cheer だけにする(同じ名前は 1 回)。
 * @param {string[]} motions 画面が送った、そのキャラが使える名前
 * @returns {string[]}
 */
export function promptMotions(motions) {
  const names = [...new Set((Array.isArray(motions) ? motions : []).map(lower).filter(Boolean))].filter((n) => !SCREEN_GESTURES.includes(n));
  return names.includes('cheer') ? names.filter((n) => n !== 'jump') : names;
}

/**
 * 頭脳が選んだ仕草を、そのキャラが使える名前にする。使える名前ならそのまま。無ければ言いかえ → 近い物の順で探す。
 * 画面が自分で出す仕草・知らない名前・空は none。
 * @param {unknown} name
 * @param {string[]} available そのキャラが使える名前(promptMotions の後でも前でもよい)
 */
export function resolveMotion(name, available) {
  const raw = lower(name);
  const can = (n) => Boolean(n) && n !== 'none' && available.includes(n) && !SCREEN_GESTURES.includes(n);
  if (!raw || raw === 'none' || SCREEN_GESTURES.includes(raw)) return 'none';
  if (can(raw)) return raw;
  const key = ALIAS[raw] ?? raw;
  for (const n of [key, ...(NEAR[key] ?? [])]) if (can(n)) return n;
  return 'none';
}

/**
 * 返事の 1 文目の気持ち(K2 の emotion = 表情・会話の段)から、頭脳が仕草を選ばなかった時の仕草を決める。
 * あいさつの段は greet。ほかの気持ちは none(表情に合う小さな仕草は、画面が自動で付ける。約束の表 2 の下)。
 * @param {{stage?: string, expression?: string}} say
 * @param {string[]} available
 */
export function gestureForIntent({ stage, expression } = {}, available = []) {
  if (stage === 'greet') return resolveMotion('greet', available);
  if (expression === 'surprised') return resolveMotion('surprised', available);
  return 'none';
}

/**
 * 1 つの返事の中の仕草を数える係。2 回を超えた文は none にする。
 * @returns {(motion: string) => string}
 */
export function gestureBudget(max = MAX_GESTURES_PER_REPLY) {
  let used = 0;
  return (motion) => {
    if (!motion || motion === 'none') return 'none';
    if (used >= max) return 'none';
    used += 1;
    return motion;
  };
}
