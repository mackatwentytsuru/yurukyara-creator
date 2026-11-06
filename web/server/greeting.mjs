// 人格の文(characters/<id>/persona.md)の「初めてのあいさつ」の節から、はじめて会った人に言う文を取り出す。
// - 本物の頭脳には、人格の文ごと渡るので、この節を手本にして名乗る(言い回しは頭脳に任せる)
// - 仮の頭脳(鍵なし・上限・公開のリンクで合言葉なし)は、ここで取り出した文をそのまま言う
// - 人格の欄から安全の決まりを上書きしようとする行は、先に sanitizePersona で外す(どの文も安全の層の下)
import { sanitizePersona } from './safety.mjs';

export const GREETING_MAX_LINES = 3;
export const GREETING_LINE_MAX = 40; // 指示文の決まり(1 文は 40 字以内)と同じ

const HEAD = /^#{1,6}\s*初めてのあいさつ/u;
const ITEM = /^[-*・]\s*(.+)$/u;

/**
 * @param {string} persona 人格の文(画面が足す「性格と話し方」の節が後ろに付いていてもよい)
 * @returns {string[]} 言う文(無ければ空)
 */
export function firstGreeting(persona) {
  const lines = sanitizePersona(persona).text.split('\n');
  const at = lines.findIndex((l) => HEAD.test(l.trim()));
  if (at < 0) return [];
  const out = [];
  for (const raw of lines.slice(at + 1)) {
    const line = raw.trim();
    if (line.startsWith('#')) break; // 次の見出しで終わり
    const m = line.match(ITEM);
    if (!m) continue;
    const text = Array.from(m[1].trim()).slice(0, GREETING_LINE_MAX).join('');
    if (text) out.push(text);
    if (out.length >= GREETING_MAX_LINES) break;
  }
  return out;
}
