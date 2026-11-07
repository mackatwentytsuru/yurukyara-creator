// 会話から「覚えておく事」を取り出す(決まった形の言葉だけを拾う、軽い取り出し)。
// 仮の頭脳でも本物の頭脳でも同じに動く。つらい話・安全の層が止めた話は覚えない。
// 本物の頭脳で要点を書かせる道は、後で足す(試験は、この決まった取り出しで通す)。
import { classifyInput } from '../safety.mjs';

const NAME_RE = /(?:わたしの名前は|私の名前は|ぼくの名前は|僕の名前は|わたしは|私は|ぼくは|僕は|おれは|俺は)\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:です|だよ|だ|って言います|っていいます|と言います|といいます|って呼んで|と呼んで|[。、!！?？\s]|$)/u;
const CALL_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:って呼んで|と呼んで)/u;
// 「好きな食べ物はカレーです」の形(好きな + 名前 + は + 好きなもの)。「好きなものは何?」のような問いは QUESTION_RE が先に外す
const FAVORITE_RE = /好きな([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,8}?)(?:は|が)\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー0-9A-Za-z]{1,12}?)(?:です|だよ|だね|だ|[。、!！\s]|$)/u;
const LIKE_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー0-9A-Za-z]{1,12}?)(?:が|も)(?:大好き|だいすき|好き|すき)/u;
// 名前に見えても、名前でない言葉
const NOT_NAME = new Set(['今日', 'きょう', '元気', 'げんき', '学生', '大人', '子ども', 'ここ', 'それ', 'あれ', 'これ', '何', 'なに', '大丈夫', 'だいじょうぶ', '好き', 'すき', '人間', 'AI']);

// 問いの形の文は、覚えない(11-07 本物の試し: 「ノリーが好きなものを教えて」から「好きなもの: ノリー」を覚えた)
const QUESTION_RE = /[?？]|教えて|おしえて|聞かせて|きかせて|何が|なにが|何を|なにを|どんな|どれ|どっち|だれ|誰|いつ(?!も)|どこ|ですか|ますか|でしょうか|かな$|かい$|か$/u;
// 「好きなもの」「好きなこと」の形(好きな + 名詞)。「〜が好きなもの」は、好きな物の名前ではなく、好きな物を指す言い方
const LIKE_NOUN_RE = /^な(?:もの|こと|物|食べ物|たべもの|食べもの|飲み物|のみもの|色|いろ|歌|曲|遊び|あそび|本|映画|動物|場所|人|ひと|やつ)/u;

/** 文に分ける(。!!?? と改行で) */
const sentencesOf = (s) => s.split(/(?<=[。.!！?？\n])/u).map((t) => t.trim()).filter(Boolean);

/** 話しかけているキャラの名前(人格の文の見出し「# 名前」・名前の欄)。覚える事には使わない */
export function selfNamesOf({ name = '', persona = '' } = {}) {
  const heading = /^#\s*(.+?)\s*$/mu.exec(String(persona ?? ''))?.[1] ?? '';
  return [name, heading].map((v) => String(v ?? '').replace(/[「」『』\s]/g, '').trim()).filter(Boolean);
}

/**
 * @param {string} text 使う人の 1 回の言葉
 * @param {{selfNames?: string[]}} [opts] selfNames = 話しかけているキャラの名前(「ノリー」を、使う人の名前や好きなものとして覚えない)
 * @returns {{kind:'name'|'like'|'topic', text:string}[]}
 */
export function extractFacts(text, { selfNames = [] } = {}) {
  const whole = String(text ?? '').trim();
  if (!whole || classifyInput(whole)) return [];
  const selves = new Set(selfNames.map((v) => String(v ?? '').trim()).filter(Boolean));
  const out = [];
  // 問いの形の文は読まない(「好きなものを教えて」「ノリーは何が好き?」は、使う人の好きなものではない)
  for (const s of sentencesOf(whole).filter((t) => !QUESTION_RE.test(t.replace(/[。.!！]+$/u, '')))) {
    const call = s.match(CALL_RE);
    const name = call ?? s.match(NAME_RE);
    if (name && !NOT_NAME.has(name[1]) && !selves.has(name[1]) && !/好き|すき/.test(name[1]) && !out.some((f) => f.kind === 'name')) out.push({ kind: 'name', text: `名前: ${name[1]}` });
    const fav = s.match(FAVORITE_RE);
    if (fav && !NOT_NAME.has(fav[2]) && !selves.has(fav[2]) && !out.some((f) => f.kind === 'like')) {
      out.push({ kind: 'like', text: `好きなもの: ${fav[2]}` });
      out.push({ kind: 'topic', text: `前に話したこと: ${fav[2]}の話` });
      continue;
    }
    const like = s.match(LIKE_RE);
    if (!like || out.some((f) => f.kind === 'like')) continue;
    const liked = like[1].replace(/^.*(?:は|を|、|って)/u, '');
    const after = s.slice(like.index + like[0].length);
    if (liked && !NOT_NAME.has(liked) && !selves.has(liked) && !LIKE_NOUN_RE.test(after)) {
      out.push({ kind: 'like', text: `好きなもの: ${liked}` });
      out.push({ kind: 'topic', text: `前に話したこと: ${liked}の話` });
    }
  }
  return out;
}

/** 覚えている事から、呼び名と話の続きを取り出す(仮の頭脳の返事に使う) */
export function summarize(items = []) {
  const name = items.findLast?.((it) => it.kind === 'name')?.text.replace(/^名前: /, '') ?? '';
  const topic = items.findLast?.((it) => it.kind === 'topic')?.text.replace(/^前に話したこと: /, '').replace(/の話$/, '') ?? '';
  return { name, topic };
}
