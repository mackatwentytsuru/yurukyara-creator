// 人格の文(characters/<id>/persona.md)の節から、仮の頭脳が言う文を取り出す。
// - 「## 初めてのあいさつ」: はじめて会った人に言う文(3 文まで)
// - 「## 話し方の例」: 1 行に 1 つ、左の「」が使う人の言葉の例(合図)、→ の右の「」が返事。仮の頭脳は、合図の言葉が入っていればその返事を言う
// - 「## あいづち」: 話がよく分からないときの返事(仮の頭脳の、最後の返事)
// - 「## 覚えている時の言い方」: 覚えていることを話す時の文(「- 合図: 文」。文の {名前}・{好きなもの}・{話題} に覚えた言葉が入る)。11-07 CRITux 23
// - 本物の頭脳には、人格の文ごと渡るので、どの節も手本にして話す(言い回しは頭脳に任せる)
// - 仮の頭脳(鍵なし・上限・公開のリンクで合言葉なし)は、ここで取り出した文をそのまま言う
// - 人格の欄から安全の決まりを上書きしようとする行は、先に sanitizePersona で外す(どの文も安全の層の下)。返事の文は出力の確かめも通す
import { isUnsafeOutput, sanitizePersona } from './safety.mjs';

export const GREETING_MAX_LINES = 3;
export const GREETING_LINE_MAX = 40; // 指示文の決まり(1 文は 40 字以内)と同じ
export const EXAMPLES_MAX = 8;
export const AIZUCHI_MAX_LINES = 2;

const ITEM = /^[-*・]\s*(.+)$/u;
const QUOTED = /「([^「」]+)」/gu;
const clip = (s) => Array.from(String(s).trim()).slice(0, GREETING_LINE_MAX).join('');

/** 節の中の行(見出しの次から、次の見出しの前まで)。節が無ければ空 */
function sectionLines(persona, name) {
  const lines = sanitizePersona(persona).text.split('\n');
  const head = new RegExp(`^#{1,6}\\s*${name}`, 'u');
  const at = lines.findIndex((l) => head.test(l.trim()));
  if (at < 0) return [];
  const out = [];
  for (const raw of lines.slice(at + 1)) {
    const line = raw.trim();
    if (line.startsWith('#')) break; // 次の見出しで終わり
    out.push(line);
  }
  return out;
}

/** 節の「- 」の行の中身を、max 文まで・1 文 40 字までで返す */
function sectionItems(persona, name, max) {
  const out = [];
  for (const line of sectionLines(persona, name)) {
    const m = line.match(ITEM);
    if (!m) continue;
    const text = clip(m[1]);
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * @param {string} persona 人格の文(画面が足す「性格と話し方」の節が後ろに付いていてもよい)
 * @returns {string[]} 言う文(無ければ空)
 */
export function firstGreeting(persona) {
  return sectionItems(persona, '初めてのあいさつ', GREETING_MAX_LINES);
}

// 合図の言葉を比べるときの揺れ(漢字とかな)をそろえる。少しだけ。外れたら、あいづちになるだけ
const FOLD = [['誰', 'だれ'], ['何', 'なに'], ['貴方', 'あなた'], ['君', 'きみ'], ['好き', 'すき'], ['物', 'もの'], ['疲れ', 'つかれ'], ['眠', 'ねむ'], ['天気', 'てんき']];

/** 比べるための形: 全角と半角をそろえ、漢字の揺れを少しそろえ、空白と記号を外す */
export function foldForMatch(s) {
  let t = String(s ?? '').normalize('NFKC').toLowerCase();
  for (const [a, b] of FOLD) t = t.split(a).join(b);
  return t.replace(/[\s、。,.!?…・「」『』()~〜]/gu, '');
}

/**
 * 「## 話し方の例」の手本。合図は 2 字以上、返事は 3 文まで・1 文 40 字まで。安全の決まりに反する返事の文は外す。
 * @returns {{cues:string[], replies:string[]}[]}
 */
export function talkExamples(persona) {
  const out = [];
  for (const line of sectionLines(persona, '話し方の例')) {
    const m = line.match(ITEM);
    const arrow = m ? m[1].indexOf('→') : -1;
    if (arrow < 0) continue;
    const cues = [...m[1].slice(0, arrow).matchAll(QUOTED)].map((q) => foldForMatch(q[1])).filter((c) => Array.from(c).length >= 2);
    const replies = [...m[1].slice(arrow + 1).matchAll(QUOTED)]
      .map((q) => clip(q[1]))
      .filter((t) => t && !isUnsafeOutput(t))
      .slice(0, GREETING_MAX_LINES);
    if (cues.length && replies.length) out.push({ cues, replies });
    if (out.length >= EXAMPLES_MAX) break;
  }
  return out;
}

/** 使う人の言葉に合図が入っている、最初の手本の返事。無ければ空 */
export function exampleReply(persona, text) {
  const said = foldForMatch(text);
  if (!said) return [];
  return talkExamples(persona).find((ex) => ex.cues.some((c) => said.includes(c)))?.replies ?? [];
}

/** 「## あいづち」の文(話がよく分からないとき)。無ければ空 */
export function aizuchi(persona) {
  return sectionItems(persona, 'あいづち', AIZUCHI_MAX_LINES).filter((t) => !isUnsafeOutput(t));
}

/** 「## 覚えている時の言い方」の合図(仮の頭脳が使う場面) */
export const MEMORY_CUES = ['また会えた', '話の続き', '名前を覚えた', '好きなものを覚えた', '全部わすれた', 'まだ覚えていない'];
const SLOT = /\{(名前|好きなもの|話題)\}/gu;

/**
 * 「## 覚えている時の言い方」から、その場面の 1 文を作る。行の形は「- 合図: 文」。
 * 同じ合図の行が何本かあれば、入れる言葉がそろう最初の行を使う(例: 名前を知らない時の言い方を 2 本目に書く)。
 * 入れる言葉の改行・かぎかっこは外し、できた文は 40 字まで。安全の決まりに反する文は使わない。無ければ空(決まった文を使う)。
 * @param {string} persona
 * @param {string} cue MEMORY_CUES のどれか
 * @param {{名前?:string, 好きなもの?:string, 話題?:string}} [words]
 */
export function memoryLine(persona, cue, words = {}) {
  for (const line of sectionLines(persona, '覚えている時の言い方')) {
    const m = line.match(ITEM);
    const colon = m ? m[1].search(/[:：]/u) : -1;
    if (colon < 0 || m[1].slice(0, colon).trim() !== cue) continue;
    let missing = false;
    const filled = m[1].slice(colon + 1).trim().replace(SLOT, (_, slot) => {
      const v = String(words[slot] ?? '').replace(/[\r\n「」『』{}]/gu, '').trim();
      if (!v) missing = true;
      return v;
    });
    if (missing || !filled || Array.from(filled).length > GREETING_LINE_MAX) continue; // 途中で切れた文は言わない(次の行か、決まった文)
    if (!isUnsafeOutput(filled)) return filled;
  }
  return '';
}
