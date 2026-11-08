// お店のきまり・町のお知らせ(ML1)。お店や町の人が日本語で書いた「本当のこと」を、頭脳に渡す事実にする。
// 書く所は 2 つ: (1) キャラの persona.md の見出し「## お店のきまり」「## 町のお知らせ」、(2) 性格の画面の文字の欄「お店のきまり・お知らせ」(その端末だけ)。
// 両方あれば両方を使う。DOM も通信も使わない小さな部品(サーバーと画面が同じ決まりで読む)。

/** persona.md の見出し(「## 」のあとに、この言葉で始まる行) */
export const FACT_HEADINGS = Object.freeze(['お店のきまり', '町のお知らせ']);
/** 性格の画面の欄の字数(その端末の localStorage) */
export const FACTS_SCREEN_MAX = 1000;
/** サーバーが受ける、事実の全部の字数(画面の欄 + persona.md の節) */
export const FACTS_MAX = 2000;

const HEADING = /^#{1,6}\s*(.*)$/u;
const BULLET = /^(?:[-*・]\s*)/u;

/** 見出しの行が、事実の見出しか */
const isFactHeading = (line) => {
  const m = HEADING.exec(line.trim());
  return Boolean(m) && FACT_HEADINGS.some((h) => m[1].trim().startsWith(h));
};

/**
 * 人格の文から、事実の節(「## お店のきまり」「## 町のお知らせ」。次の見出しの手前まで)を取り出す。
 * 節が無ければ、元の文をそのまま返す(1 字も変えない)。節があれば、その節を外した文を返す(指示文に同じ節を 2 回入れないため)。
 * @param {string} persona
 * @returns {{rest: string, lines: string[]}} lines は節の中の行(行頭の「- 」を外した物。空行は除く)
 */
export function splitFactSections(persona) {
  const text = String(persona ?? '');
  const all = text.split(/\r\n|\r|\n/);
  if (!all.some(isFactHeading)) return { rest: text, lines: [] };
  const kept = [];
  const lines = [];
  let inFacts = false;
  for (const line of all) {
    if (HEADING.test(line.trim())) {
      inFacts = isFactHeading(line);
      if (!inFacts) kept.push(line);
      continue;
    }
    if (!inFacts) {
      kept.push(line);
      continue;
    }
    const t = line.replace(BULLET, '').replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }
  return { rest: kept.join('\n').trim(), lines };
}

/**
 * 画面の欄の文字(何行か)を、行の列にする。行頭の「- 」を外し、空行を除き、字数の上限で切る。
 * 安全の決まりを上書きする行を外すのは、サーバー側(safety.mjs の sanitizeLines)。ここは形だけ。
 * @param {unknown} value
 * @param {number} [max]
 */
export function factLines(value, max = FACTS_MAX) {
  if (typeof value !== 'string') return [];
  const out = [];
  let used = 0;
  for (const raw of value.split(/\r\n|\r|\n/)) {
    const t = raw.replace(BULLET, '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const chars = Array.from(t);
    if (used + chars.length > max) {
      const rest = max - used;
      if (rest > 0) out.push(chars.slice(0, rest).join(''));
      break;
    }
    out.push(t);
    used += chars.length;
  }
  return out;
}

/** 性格の画面の欄に入れてよい形にする(字数の上限・行頭の記号は残す。改行は LF) */
export const clipFactsText = (value) =>
  Array.from(String(value ?? '').replace(/\r\n?/g, '\n'))
    .slice(0, FACTS_SCREEN_MAX)
    .join('');
