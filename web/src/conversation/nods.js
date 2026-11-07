// 相づちの短い声(第 12 波 b・B3)。サーバーが前もって録っておく声(web/server/fillers.mjs のあいづちの声)の言葉と、
// 指示文が「相づちだけの文は、このどれかをそのまま書く」と教える言葉を、ここ 1 か所にそろえる。
// 返事の文がこのどれかと同じなら、画面(dialogue.js)は録ってある声で話す(声のサービスに頼まない = 声の文字数を使わない・すぐ出る)。
// DOM も通信も使わない(サーバー・画面・node --test のどれでも読める)。

/** 録っておく相づちの声の言葉(サーバーのあいづちの声は、この順に作る) */
export const FILLER_PHRASES = Object.freeze(['はい。', 'ええ。', 'なるほど。', 'そうですね。', 'はい、はい。']);

/** 指示文が返事の相づちとして教える言葉(録ってある声の中から、返事の 1 文に向く物) */
export const NOD_PHRASES = Object.freeze(['はい。', 'ええ。', 'なるほど。', 'そうですね。']);

/** 比べるための形(前後の空白を外し、全角と半角をそろえる。「!」で終わっても「。」と同じに見る) */
const fold = (s) => String(s ?? '').normalize('NFKC').trim().replace(/[!！]$/u, '。');

/**
 * 返事の文が、録ってある相づちの声のどれかと同じなら、その言葉(声の名前)を返す。違えば null。
 * @param {string} text 返事の 1 文
 * @param {string[]} [have] 録ってある声の言葉(画面が読み込めた物。省くと FILLER_PHRASES)
 */
export function recordedNod(text, have = FILLER_PHRASES) {
  const t = fold(text);
  if (!t) return null;
  return have.find((p) => fold(p) === t) ?? null;
}
