// 聞き取りの手がかり: 今話しかけているキャラの名前。聞き取り(PC の faster-whisper)に渡すと、
// 「ノリー」が「乗り」「おのり」と聞き違えられるのが減る。会話(dialogue.js)が、キャラが決まるたびに入れる。
// main.js から Listener の hint に直接渡してもよい(Listener の opts.hint が先)。DOM も通信も使わない小さな部品。
let current = '';

/** 名前を入れる。文字・数字・伸ばす棒だけを 40 字まで(サーバーも同じ形に整える)。空・文字でない値は「手がかり無し」 */
export function setSttHint(name) {
  current = Array.from(String(name ?? ''))
    .filter((ch) => /[\p{L}\p{N}ー]/u.test(ch))
    .slice(0, 40)
    .join('');
  return current;
}

export const getSttHint = () => current;

/** /api/stt に付ける見出し(手がかりが無ければ何も付けない) */
export function sttHintHeaders(hint = current) {
  return hint ? { 'x-stt-hint': encodeURIComponent(hint) } : {};
}
