// 会話から「覚えておく事」を取り出す(決まった形の言葉だけを拾う、軽い取り出し)。
// 仮の頭脳でも本物の頭脳でも同じに動く。つらい話・安全の層が止めた話は覚えない。
// 本物の頭脳で要点を書かせる道は、後で足す(試験は、この決まった取り出しで通す)。
import { classifyInput, looksPersonal } from '../safety.mjs';

const NAME_RE = /(?:わたしの名前は|私の名前は|ぼくの名前は|僕の名前は|おれの名前は|俺の名前は|あたしの名前は|あたしは|わたしは|私は|ぼくは|僕は|おれは|俺は)\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:です|だよ|だ|って言います|っていいます|と言います|といいます|って呼んで|と呼んで|[。、!！?？\s]|$)/u;
const CALL_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)(?:って呼んで|と呼んで)/u;
// 「好きな食べ物はカレーです」の形(好きな + 名前 + は + 好きなもの)。「好きなものは何?」のような問いは QUESTION_RE が先に外す
const FAVORITE_RE = /好きな([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,8}?)(?:は|が)\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー0-9A-Za-z]{1,12}?)(?:です|だよ|だね|だ|[。、!！\s]|$)/u;
const LIKE_RE = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー0-9A-Za-z]{1,12}?)(?:が|も)(?:大好き|だいすき|好き|すき)/u;
// 年: 「7さい」「8歳です」。使う人自身の年だけ(「いもうとは3さい」「3さいのとき」は覚えない)
const AGE_RE = /([0-9]{1,2})\s*(?:さい|歳|才)(?:です|だよ|だね|だ|になった|になるよ|になりました|[。、!！\s]|$)/u;
const OTHER_PERSON = /(いもうと|おとうと|あに|あね|お兄|お姉|おにい|おねえ|妹|弟|兄|姉|ママ|パパ|お母|お父|おかあ|おとう|ともだち|友だち|友達|先生|せんせい|いぬ|犬|ねこ|猫|おじい|おばあ|祖父|祖母|赤ちゃん|あかちゃん)/u;
// 「ぼく たろう 7さい」(「は」の無い言い方)
const NAME_AGE_RE = /^(?:わたし|私|ぼく|僕|おれ|俺|あたし)\s+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{1,10}?)\s*[、,\s]\s*[0-9]{1,2}\s*(?:さい|歳|才)/u;
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

/** 文の中の、使う人自身の年(数字)。無ければ 0。数字は全角でもよい */
function ageOf(sentence) {
  const s = sentence.normalize('NFKC');
  const m = s.match(AGE_RE);
  if (!m) return 0;
  const before = s.slice(0, m.index);
  if (OTHER_PERSON.test(before)) return 0;
  // 主語が「は」で別の人になっていないか(「たろうくんは9さい」は、使う人の年とは限らない)。一人称が前にあるか、主語なしだけ受ける
  const subject = before.match(/([^、,\s]+)は/u)?.[1] ?? '';
  const firstPerson = /(?:わたし|私|ぼく|僕|おれ|俺|あたし)/u.test(before);
  if (subject && !firstPerson) return 0;
  const n = Number(m[1]);
  return n >= 2 && n <= 99 ? n : 0;
}

/**
 * @param {string} text 使う人の 1 回の言葉
 * @param {{selfNames?: string[]}} [opts] selfNames = 話しかけているキャラの名前(「ノリー」を、使う人の名前や好きなものとして覚えない)
 * @returns {{kind:'name'|'like'|'topic', text:string}[]}
 */
export function extractFacts(text, { selfNames = [] } = {}) {
  const whole = String(text ?? '').trim();
  // 本名・学校・住所・電話番号・メールの入った言葉は覚えない(BSF 11-08 子どもの決まり。名前はニックネームでよい)
  if (!whole || classifyInput(whole) || looksPersonal(whole)) return [];
  const selves = new Set(selfNames.map((v) => String(v ?? '').trim()).filter(Boolean));
  const out = [];
  // 問いの形の文は読まない(「好きなものを教えて」「ノリーは何が好き?」は、使う人の好きなものではない)
  for (const s of sentencesOf(whole).filter((t) => !QUESTION_RE.test(t.replace(/[。.!！]+$/u, '')))) {
    const call = s.match(CALL_RE);
    const name = call ?? s.match(NAME_RE) ?? s.match(NAME_AGE_RE);
    const age = ageOf(s);
    if (age && !out.some((f) => f.kind === 'age')) out.push({ kind: 'age', text: `年: ${age}さい` });
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
  const age = items.findLast?.((it) => it.kind === 'age')?.text.replace(/^年: /, '').replace(/さい$/, '') ?? '';
  return age ? { name, topic, age } : { name, topic };
}

/**
 * 覚えた事を画面に知らせるイベント(手元のサーバーも公開の関数も同じ形)。
 * 画面の札(S5)は fresh: true を見て、新しく覚えた事を光らせる。kinds = 覚えた種類('name'・'age'・'like'・'topic'。重ならない)。
 * @param {{id:string, kind:string, text:string}[]} learned store.add が返した物
 * @param {object} [extra] key・notice など(手元のサーバーが最初の回に足す)
 */
export function memoryAddedEvent(learned, extra = {}) {
  const added = learned.map(({ id, kind, text }) => ({ id, kind, text }));
  return { type: 'memory', added, fresh: added.length > 0, kinds: [...new Set(added.map((it) => it.kind))], ...extra };
}
