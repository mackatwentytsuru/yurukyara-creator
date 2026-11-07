// 読み上げの読み方の表(11-07 第 11b 波)。声のサービスが読み違える言葉を、声に渡す直前に、かなへ置き換える。
// - どのキャラにも同じ表を使う(声の役・声の id によらない)
// - 置き換えるのは声に渡す文だけ。画面に出す字幕・文字送り・会話の履歴は、もとの文のまま(speaker.js と web/server/tts.mjs が使う)
// - 例: ノリーの声(司令室 Q-0103 = D)は「執事」を「ひつじ」と読むことがあるので、「しつじ」と渡す
// 足す時は、[書いてある言葉, 読み] の 1 行を足し、web/test/voice_reading.test.mjs の見込みにも 1 行足す。
// 読みには、書いてある言葉を含めない(2 回通しても同じになるように。画面とサーバーの両方で通す)。DOM も通信も使わない。

// BSF 11-08: 安全の層の決まった返事の電話番号は、数字の区切りどおり 1 字ずつ読ませる(大きな数として読まないように)
export const SPEECH_READINGS = Object.freeze([
  Object.freeze(['執事', 'しつじ']),
  Object.freeze(['0120-0-78310', 'ぜろいちにーぜろのぜろのななはちさんいちぜろ']),
  Object.freeze(['189 にも', 'いちはちきゅうにも']),
]);

/**
 * 声のサービスに渡す文。表の言葉を読みに置き換える(字幕には使わない)。
 * @param {unknown} text 話す 1 文(文字でなければ文字にする。null・undefined は空)
 * @returns {string}
 */
export function toSpeechText(text) {
  let out = String(text ?? '');
  for (const [written, spoken] of SPEECH_READINGS) out = out.split(written).join(spoken);
  return out;
}
