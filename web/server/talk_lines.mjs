// 仮の頭脳(鍵なし・上限・公開のリンクで合言葉なし)が言う、決まった言い回しの置き場(UW3 11-08)。
// - 返事は 1 つの決まった文にしない(同じ文が続くと、中身が無いのが見える)。ただし本物の頭脳のふりはしない:
//   分からない時は、短く「分からない・かんたんなお返事しかできない」と言う。事実や天気や案内を作らない。
// - 「AI かどうか」「何を覚えるか」「書かないでね」は、子どもの言葉で正直に。どの文も出力の確かめ(safety.mjs)の網に当たらない言葉だけ。
// どの文も、画面の字幕とキャラの声に出る。数字は入れない(出力の確かめが電話番号と見るため)。日数だけは覚える決まり(RETENTION_DAYS)から入れる。
import { RETENTION_DAYS } from '../src/conversation/memoryNotice.js';

/** 比べるための形(全角・半角をそろえ、英字は小文字) */
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

/** 数えやすい、軽い数(同じ言葉は同じ数になる。試験で決まった答えを確かめられる) */
export function hashText(text) {
  let h = 0;
  for (const ch of String(text ?? '')) h = (h * 31 + ch.codePointAt(0)) % 100003;
  return h;
}

// ---- 人間か AI かを聞かれた時 ----
const ASKS_TARGET = /(人間|にんげん|ろぼっと|ロボット|ai|えーあい|人工知能|じんこうちのう|本物|ほんもの|生き物|いきもの|生きて|いきてる|中の人|なかのひと|中に(?:人|ひと)|人が入|ひとが入|人が話|ひとが話|機械|きかい|こんぴゅーた|コンピュータ|ぷろぐらむ|プログラム)/u;
const ASKS_FORM = /([?？]|ですか|でしょ|かな|なの|じゃない|じゃないの|なんだ(?!よ)|か$|いるの|あるの|なんでしょ)/u;

/** 相手が何者か(人間か・AI か・本物か)を聞いている言葉か */
export function asksIfAI(text) {
  const s = norm(text);
  return ASKS_TARGET.test(s) && ASKS_FORM.test(s);
}

const AI_FIRST = 'AI のキャラクターだよ。人間じゃないんだ。'; // 安全の決まり 5 と同じ言い方(試験と画面の確かめが同じ文を見る)
const AI_SECOND = ['でも、お話はちゃんと聞くよ。', 'コンピューターの中で、お話ししているんだ。', '生きものではないけど、なかよくしてね。', 'ほんとうの人ではないけど、お話は大すきだよ。'];

/** AI かと聞かれた時の言葉(2 文。1 文目は決まった言い方、2 文目はくり返さないよう替わる) */
export function aiAnswer(text, turn = 0) {
  return [AI_FIRST, AI_SECOND[(turn + hashText(text)) % AI_SECOND.length]];
}

// ---- 何を覚えるか ----
const ASKS_MEMORY = /(覚え|おぼえ|憶え|忘れ|わすれ|記憶|きおく|メモ)/u;
const ASK_FORM = /([?？]|ですか|ますか|かな|でしょ|てくれ|ておいて|てね|てよ|おしえて|教えて|なに|何|どれ|どんな|ちゃう|ない$|の$|か$)/u;

/** 「何を覚えてる?」「覚えててね」など、覚えることについて話している言葉か */
export function asksMemory(text) {
  const s = norm(text);
  return ASKS_MEMORY.test(s) && ASK_FORM.test(s);
}

/** 覚えること・覚えないことの、子どもの言葉の説明(3 文)。本物の頭脳の指示文(prompt.mjs)にも同じ中身を書く */
export const MEMORY_PLAIN_LINES = Object.freeze([
  `名前と年と好きなものを、${RETENTION_DAYS}日のあいだ覚えているよ。`,
  'おうちの場所や電話、学校の名前は、覚えないよ。',
  '「わすれて」と言えば、ぜんぶ消すよ。',
]);

/** 覚えた時にそえる、短い 1 文(はじめて覚えた回だけ) */
export const MEMORY_FIRST_NOTE = 'おうちの場所や電話は、覚えないから あんしんしてね。';

// ---- 個人のことを書いた時 ----
const PERSONAL_HEAD = {
  address: 'おうちの場所は、ここには書かないでね。',
  phone: '電話ばんごうは、ここには書かないでね。',
  email: 'メールのアドレスは、ここには書かないでね。',
  school: '学校の名前は、ここには書かないでね。',
  name: '本当の名前は、ここには書かないでね。あだ名でだいじょうぶだよ。',
};
const PERSONAL_TAIL = ['この話は、覚えないから あんしんしてね。', 'ほかのお話なら、いつでも聞くよ。'];

/** 住所・電話・学校などを書いた時の、やさしい 3 文(止める・覚えない・ほかの話は続ける) */
export function personalLines(kind) {
  return [PERSONAL_HEAD[kind] ?? PERSONAL_HEAD.address, ...PERSONAL_TAIL];
}

/** 履歴に残った、個人のことを書いた発言の代わりの文(頭脳にも渡さない) */
export const PERSONAL_HISTORY_MASK = '(おうちのことを書いたので、消したよ)';

// ---- ふつうの返事(仮の頭脳。同じ 1 文にしない) ----
const QUESTIONISH = /([?？]|ですか|ますか|かな$|か$|の$|教えて|おしえて|なに|何|どう|なんで|どうして|だれ|誰|いつ|どこ|どれ|どっち)/u;

// 受けとめる 1 文目と、続きをうながす 2 文目。組み合わせが数十とおりになる
const LISTEN_FIRST = ['そうなんだ。', 'へえ、そうなんだ。', 'なるほどね。', 'うんうん。', 'そっか。'];
const LISTEN_SECOND = ['もう少し聞かせてくれる?', 'それで、どうなったの?', 'ほかにもあるかな?', 'どんなところが よかった?', 'もっと聞きたいな。'];
// 聞かれたけれど、仮の頭脳は答えを知らない: 知っているふりをせず、正直に言う
const ASKED_FIRST = ['うーん、いい質問だね。', 'ちょっと考えてみるね。', 'うーん、なんだろうね。'];
const ASKED_SECOND = ['でも、いまは かんたんなお返事しか できないんだ。', 'くわしいことは、まだ わからないな。', 'きみは どう思う?'];

/**
 * 仮の頭脳の、ふつうの返事(2 文)。同じ言葉でも、会話が進む(turn が増える)と替わる。
 * @param {string} text 使う人の言葉
 * @param {number} [turn] 何回目の話しかけか(履歴の数 ÷ 2)
 * @returns {{lines: [string, string], asked: boolean}}
 */
export function standinReply(text, turn = 0) {
  const asked = QUESTIONISH.test(String(text ?? '').trim());
  const [a, b] = asked ? [ASKED_FIRST, ASKED_SECOND] : [LISTEN_FIRST, LISTEN_SECOND];
  const h = hashText(text);
  return { lines: [a[(turn + h) % a.length], b[(turn * 2 + h) % b.length]], asked };
}

/** どの文が仮の頭脳の言い回しか(試験が、本物のふりをする文が無いことを確かめるために読む) */
export const STANDIN_POOLS = Object.freeze({ LISTEN_FIRST, LISTEN_SECOND, ASKED_FIRST, ASKED_SECOND, AI_SECOND, PERSONAL_HEAD });
