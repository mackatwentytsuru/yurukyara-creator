// 名前の読み方(11-08 b13-yomi)。お店・駅・場所・キャラ自身の名前に、漢字・英字・記号が入っていると、声のサービスが読み違える。
// 使う人に「なんて よむの?」と聞いて、{ 書いてある字: かな } の表(readings)を、その子といっしょに覚える。
// - 覚える所: 性格の設定(settings.readings。この端末)、人格の文の「- 名前の読み方: 辰三=たつぞう」の行、character.json の readings
// - 声に渡す文だけ、表の字をかなに替える(speechReading.js の toSpeechText が使う)。字幕・文字送り・履歴は、もとの字のまま
// - 読みは かな だけ。書いてある字は、かなを 1 字も含まない字(漢字・英字などを 1 字は含む)だけを受ける。
//   読みは かな だけなので、表の字を含まず、画面とサーバーの両方で通しても同じになる
// DOM も通信も使わない(node の試験で読む)。

export const READING_MAX = 20; // 読みの字数の上限(入力欄)
export const SURFACE_MAX = 20; // 書いてある字の上限
export const READINGS_MAX = 8; // 1 人の子が覚える数の上限
export const READINGS_LINE = '名前の読み方';

const KANA = /[ぁ-ゖァ-ヺーゝゞヽヾ]/u;
const KANA_ONLY = /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/u;
const HAN = /[㐀-䶿一-鿿豈-﫿々〆]/u;
const OTHER = /[\p{L}\p{N}\p{S}&＆]/u; // 英字・数字・記号(かなと漢字は、先に分ける)
const isKana = (ch) => KANA.test(ch);
const isHan = (ch) => HAN.test(ch);
const isOther = (ch) => !isKana(ch) && !isHan(ch) && OTHER.test(ch);

/**
 * 読みとして受ける かな を整える。かな(ひらがな・カタカナ・のばす棒)だけ、READING_MAX 字まで。空白は取る。だめなら null
 * @param {unknown} raw
 * @returns {string|null}
 */
export function cleanReading(raw) {
  const s = String(raw ?? '').normalize('NFKC').replace(/[\s　]+/g, '');
  if (!s || [...s].length > READING_MAX) return null;
  return KANA_ONLY.test(s) ? s : null;
}

/** 書いてある字(表のキー)として受けるか。かなだけ・空・長すぎ・区切りの記号が入った字は受けない */
function cleanSurface(raw) {
  const s = String(raw ?? '').trim();
  if (!s || [...s].length > SURFACE_MAX) return null;
  if (/[=＝、,,;;\r\n()()「」『』]/u.test(s)) return null;
  return [...s].some((ch) => isHan(ch) || isOther(ch)) ? s : null; // かなだけの字は、読み違えない(表に入れない)
}

/**
 * 表を整えた、新しい物を返す(元は変えない)。入れ物は { 字: 読み } でも [[字, 読み], …] でもよい。
 * 形の違う行は捨てる。空なら空のオブジェクト
 * @param {unknown} input
 * @returns {Record<string,string>}
 */
export function normalizeReadings(input) {
  const pairs = Array.isArray(input) ? input : input && typeof input === 'object' ? Object.entries(input) : [];
  const out = {};
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const surface = cleanSurface(pair[0]);
    const reading = cleanReading(pair[1]);
    if (!surface || !reading || surface in out) continue;
    if (Object.keys(out).length >= READINGS_MAX) break;
    out[surface] = reading;
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 声に渡す文の、表の字をかなに替える。長い字から先に当てて、1 回だけ通す(通した後の文は、もう替えない)
 * @param {unknown} text
 * @param {Record<string,string>|null|undefined} readings
 * @returns {string}
 */
export function applyReadings(text, readings) {
  const s = String(text ?? '');
  const table = normalizeReadings(readings);
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  if (!keys.length) return s;
  return s.replace(new RegExp(keys.map(escapeRe).join('|'), 'gu'), (m) => table[m] ?? m);
}

/**
 * 名前から、声が読み違えそうな字の並びを取り出す(上から順に。先に出てきた物から、いくつでも。重なりなし)。
 * - 英字・数字・記号の並び
 * - 漢字が 2 字以上つづく並び(辰三・山田屋)。1 字だけ、かなに挟まれた漢字(たこ焼き・みどり駅)は、ふつうに読めるので数えない。
 *   ただし、名前がその 1 字だけの時は数える
 * かなだけの名前は、空の並びを返す
 * @param {unknown} name
 * @returns {string[]}
 */
export function riskyRuns(name) {
  const chars = [...String(name ?? '').trim()];
  const kind = (ch) => (isHan(ch) ? 'han' : isOther(ch) ? 'other' : 'plain');
  const runs = [];
  for (let i = 0; i < chars.length; ) {
    const k = kind(chars[i]);
    let j = i;
    if (k === 'plain') {
      i += 1;
      continue;
    }
    while (j < chars.length && kind(chars[j]) === k) j += 1;
    const run = chars.slice(i, j).join('');
    const alone = j - i === chars.length;
    if (k === 'other' || j - i >= 2 || alone) runs.push(run);
    i = j;
  }
  return runs.filter((r, n) => runs.indexOf(r) === n && cleanSurface(r));
}

/** 名前に、読み違えそうな字があるか */
export const needsReading = (name) => riskyRuns(name).length > 0;

// 安全に当てられる、よくある言葉の読み(名前の並びが、この言葉だけでできている時だけ「ひとつの案」として出す。ほかは案を出さない)
const COMMON = Object.freeze({
  駅: 'えき',
  駅前: 'えきまえ',
  学校: 'がっこう',
  公園: 'こうえん',
  病院: 'びょういん',
  図書館: 'としょかん',
  食堂: 'しょくどう',
  商店: 'しょうてん',
  神社: 'じんじゃ',
  郵便局: 'ゆうびんきょく',
  市役所: 'しやくしょ',
  薬局: 'やっきょく',
  花屋: 'はなや',
  本屋: 'ほんや',
});

/**
 * 並びの読みの案(0 か 1 つ)。よくある言葉だけでできている時だけ。声のサービスも頭脳も呼ばない
 * @param {string} run
 * @returns {string[]}
 */
export function guessReadings(run) {
  const s = String(run ?? '');
  const memo = new Map();
  const walk = (at) => {
    if (at === s.length) return '';
    if (memo.has(at)) return memo.get(at);
    let found = null;
    for (const [word, yomi] of Object.entries(COMMON)) {
      if (!s.startsWith(word, at)) continue;
      const rest = walk(at + word.length);
      if (rest !== null) {
        found = yomi + rest;
        break;
      }
    }
    memo.set(at, found);
    return found;
  };
  const guess = s ? walk(0) : null;
  return guess ? [guess] : [];
}

/** 人格の文に足す 1 行の中身。「辰三=たつぞう、ABC=えーびーしー」。空の表は '' */
export function readingsText(readings) {
  return Object.entries(normalizeReadings(readings))
    .map(([surface, reading]) => `${surface}=${reading}`)
    .join('、');
}

/**
 * 人格の文の「- 名前の読み方: 辰三=たつぞう(…)」の行を読む。行が複数あれば、全部足す(後の行が先)。
 * 行の終わりのかっこの説明は読まない
 * @param {unknown} persona
 * @returns {Record<string,string>}
 */
export function readingsFromPersona(persona) {
  const re = new RegExp(`^\\s*(?:[-*・]\\s*)?${READINGS_LINE}\\s*[::]\\s*(.+)$`, 'u');
  const pairs = [];
  for (const line of String(persona ?? '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const body = m[1].replace(/[((].*$/u, '');
    for (const part of body.split(/[、,,]/u)) {
      const at = part.search(/[=＝]/u);
      if (at > 0) pairs.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
    }
  }
  return normalizeReadings(pairs.reverse());
}

/**
 * 今の子の表。character.json の readings → 人格の文の行 → 性格の設定(この端末)→ 初めての会話の途中の表、の順に重ねる(後ろが勝つ)
 * @param {{character?: {readings?: unknown}|null, persona?: string, settings?: {readings?: unknown}|null, session?: unknown}} [o]
 * @returns {Record<string,string>}
 */
export function readingsOf({ character = null, persona = '', settings = null, session = null } = {}) {
  return normalizeReadings({
    ...normalizeReadings(character?.readings),
    ...readingsFromPersona(persona),
    ...normalizeReadings(settings?.readings),
    ...normalizeReadings(session),
  });
}
