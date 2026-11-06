// 会話から「覚えておく事」を取り出す(決まった形の言葉だけを拾う、軽い取り出し)。
// 仮の頭脳でも本物の頭脳でも同じに動く。つらい話・安全の層が止めた話は覚えない。
// 本物の頭脳で要点を書かせる道は、後で足す(試験は、この決まった取り出しで通す)。
import { classifyInput } from '../safety.mjs';

const NAME_RE = /(?:わたしの名前は|私の名前は|ぼくの名前は|僕の名前は|名前は|わたしは|私は|ぼくは|僕は|おれは|俺は)\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:です|だよ|だ|って言います|っていいます|と言います|といいます|って呼んで|と呼んで|[。、!！?？\s]|$)/u;
const CALL_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:って呼んで|と呼んで)/u;
const LIKE_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー0-9A-Za-z]{1,12}?)(?:が|も)(?:大好き|だいすき|好き|すき)/u;
// 名前に見えても、名前でない言葉
const NOT_NAME = new Set(['今日', 'きょう', '元気', 'げんき', '学生', '大人', '子ども', 'ここ', 'それ', 'あれ', 'これ', '何', 'なに', '大丈夫', 'だいじょうぶ', '好き', 'すき', '人間', 'AI']);

/**
 * @param {string} text 使う人の 1 回の言葉
 * @returns {{kind:'name'|'like'|'topic', text:string}[]}
 */
export function extractFacts(text) {
  const s = String(text ?? '').trim();
  if (!s || classifyInput(s)) return [];
  const out = [];
  const call = s.match(CALL_RE);
  const name = call ?? s.match(NAME_RE);
  if (name && !NOT_NAME.has(name[1]) && !/好き|すき/.test(name[1])) out.push({ kind: 'name', text: `名前: ${name[1]}` });
  const like = s.match(LIKE_RE);
  const liked = like ? like[1].replace(/^.*(?:は|を|、|って)/u, '') : '';
  if (liked && !NOT_NAME.has(liked)) {
    out.push({ kind: 'like', text: `好きなもの: ${liked}` });
    out.push({ kind: 'topic', text: `前に話したこと: ${liked}の話` });
  }
  return out;
}

/** 覚えている事から、呼び名と話の続きを取り出す(仮の頭脳の返事に使う) */
export function summarize(items = []) {
  const name = items.findLast?.((it) => it.kind === 'name')?.text.replace(/^名前: /, '') ?? '';
  const topic = items.findLast?.((it) => it.kind === 'topic')?.text.replace(/^前に話したこと: /, '').replace(/の話$/, '') ?? '';
  return { name, topic };
}
