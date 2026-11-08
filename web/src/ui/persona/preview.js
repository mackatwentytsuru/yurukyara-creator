// 返事の試し。本物の頭脳(Claude Haiku)のときは、設定の文を Claude に渡して、その返事をそのまま見せる。
// 仮の頭脳(鍵なし・上限)のときは、返事の中身は決まった文なので、話し方(口調・語尾・元気さ・長さ・性格の一言)だけを
// この端末の中で設定に合わせる。画面には「おためしモードです」と必ず出す(できない事を、できるように見せない)。
// 口調が own(この子の話し方)のときは、言い回しも語尾も変えない(人格の文の手本の文が、そのままその子の話し方)。
import { normalize, PRESETS } from './settings.js';

const END = /([。!?！？…]*)$/u;

/** 1 文を、ていねいな言い方にする(仮の頭脳の決まった文に合わせた置きかえ) */
export function toPolite(sentence) {
  const rules = [
    [/しようか(?=[。!?！？…]*$)/u, 'しましょうか'],
    [/くれる(?=[?？]$)/u, 'くれますか'],
    [/っていうんだね(?=[。!?！？…]*$)/u, 'というんですね'],
    [/なんだ(?=[。!?！？…]*$)/u, 'なんですね'],
    [/会えたね(?=[。!?！？…]*$)/u, '会えましたね'],
    [/おくね(?=[。!?！？…]*$)/u, 'おきますね'],
    [/したよ(?=[。!?！？…]*$)/u, 'しました'],
    [/かったよ(?=[。!?！？…]*$)/u, 'かったです'],
    [/だね(?=[。!?！？…]*$)/u, 'ですね'],
    [/だよ(?=[。!?！？…]*$)/u, 'です'],
    [/遊ぼう(?=[。!?！？…]*$)/u, '遊びましょう'],
  ];
  for (const [re, to] of rules) if (re.test(sentence)) return sentence.replace(re, to);
  return sentence;
}

/** 文の終わりに語尾を付ける。「だよ」「だね」は「だ」に、終わりの「よ」「ね」は外してから付ける */
export function withEnding(sentence, ending) {
  if (!ending) return sentence;
  const m = sentence.match(END);
  const tail = m ? m[1] : '';
  let body = sentence.slice(0, sentence.length - tail.length);
  if (body.endsWith(ending)) return sentence;
  if (/だ[よね]$/u.test(body)) body = body.slice(0, -1);
  else if (/[^だ][よね]$/u.test(body)) body = body.slice(0, -1);
  return `${body}${ending}${tail || '。'}`;
}

/** 元気さ: 4 以上は「。」を「!」に、2 以下は「!」を「。」に、1 は「…」にする(問いの「?」はそのまま) */
export function withEnergy(sentence, energy) {
  if (energy >= 4) return sentence.replace(/。$/u, '!');
  if (energy === 1) return sentence.replace(/[。!！]$/u, '…');
  if (energy <= 2) return sentence.replace(/[!！]$/u, '。');
  return sentence;
}

const hash = (text) => [...String(text)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7);

/**
 * 仮の頭脳の返事(文の配列)を、設定の話し方にそろえる。安全の決まった返事には使わない(呼ぶ側が外す)。
 * @param {string[]} lines
 * @param {object} settings
 * @returns {string[]}
 */
export function styleLines(lines, settings) {
  const s = normalize(settings);
  const p = PRESETS[s.preset];
  // 1 つの返事に 2 文が入っていることがある(「好きなんだ。覚えておくね。」)。文に分けてから数える
  let out = lines
    .flatMap((t) => String(t ?? '').split(/(?<=[。!?！？…])/u))
    .map((t) => t.trim())
    .filter(Boolean);
  if (!out.length) return out;
  const count = s.length === 'short' ? 1 : s.length === 'normal' ? 2 : 3;
  out = out.slice(0, count);
  // 型の一言(extra)はフレンドリーかていねいの言い回し。「この子の話し方」(own)の子には足さない(その子の話し方とぶつかる)
  if (s.length === 'long' && out.length < count && s.tone !== 'own') out.push(p.extra[s.tone === 'polite' ? 'polite' : 'friendly']);
  out = out.map((t) => (s.tone === 'polite' ? toPolite(t) : t));
  out = out.map((t) => (s.tone === 'ending' ? withEnding(t, s.ending) : t));
  out = out.map((t) => withEnergy(t, s.energy));
  const lead = p.lead[hash(out[0]) % p.lead.length];
  if (!out[0].startsWith(lead)) out[0] = `${lead}${out[0]}`;
  return out;
}

export const MOCK_NOTICE = 'おためしモードです。返事の中身は決まった文で、話し方だけを設定に合わせています(本物の頭脳では、設定の文を Claude に渡します)。';
export const MOCK_NOTICE_SHORT = 'おためしモードです(中身は決まった文。話し方だけ設定どおり)。';
