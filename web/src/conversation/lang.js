// 「ことば」の設定(多言語。ML1)。日本語だけ(いつもの。既定)と、多言語(日本語・English・中文・한국어)の 2 つ。
// 日本語だけの時は、指示文・決まった返事・声・聞き取り・画面が、今までと 1 字も変わらない(この部品は何も足さない)。
// 役目(role.js)と同じ作りの小さな部品: DOM も通信も使わない。サーバーと画面が同じ決まりで読む。

/** 「ことば」の id(性格の画面の設定・/api/chat の本文の lang・人格の文の「- ことば:」の行に、この id で書く) */
export const LANG_MODES = Object.freeze(['ja', 'multi']);
export const DEFAULT_LANG_MODE = 'ja';

/** 画面の言葉(性格の画面が並べる) */
export const LANG_MODE_LABELS = Object.freeze({ ja: '日本語だけ(いつもの)', multi: '多言語(英語・中国語・韓国語にも答える)' });
/** 画面の下に出す 1 行 */
export const LANG_MODE_NOTE = '日本語だけの方が、日本語の聞き取りと話し方が正確です';

/** 人格の文の行や画面の言葉で受ける言いかえ(短い形も) */
const LANG_WORDS = Object.freeze({
  ja: ['日本語だけ', '日本語のみ', '日本語', 'ja'],
  multi: ['多言語', '多国語', 'multi', 'multilingual'],
});

/** 話す・聞く言葉の id(4 つ) */
export const HEAR_LANGS = Object.freeze(['ja', 'en', 'zh', 'ko']);
export const DEFAULT_HEAR_LANG = 'ja';
/** マイクの横の選びに出す名前(その言葉で書く) */
export const HEAR_LANG_LABELS = Object.freeze({ ja: '日本語', en: 'English', zh: '中文', ko: '한국어' });
/** ブラウザの聞き取り(SpeechRecognition)の lang。日本語は今までの 'ja-JP' のまま */
export const SR_LANG = Object.freeze({ ja: 'ja-JP', en: 'en-US', zh: 'zh-CN', ko: 'ko-KR' });
/** サーバーの聞き取り(whisper)への言葉。'auto' は自動で見分ける */
export const STT_LANGS = Object.freeze(['auto', ...HEAR_LANGS]);
/** 読み上げのサービス(ElevenLabs)の language_code */
export const VOICE_LANG_CODE = Object.freeze({ ja: 'ja', en: 'en', zh: 'zh', ko: 'ko' });

export const isLangMode = (v) => LANG_MODES.includes(v);
export const isHearLang = (v) => HEAR_LANGS.includes(v);

/**
 * 「ことば」の値をそろえる。id(ja・multi)か画面の言葉(多言語 など)を受ける。分からない値・空は null。
 * @param {unknown} value
 * @returns {'ja'|'multi'|null}
 */
export function normalizeLangMode(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (isLangMode(lower)) return lower;
  for (const id of LANG_MODES) if (LANG_WORDS[id].some((w) => w.toLowerCase() === lower)) return id;
  return null;
}

/** 聞く言葉の値をそろえる(ja・en・zh・ko)。分からない値は null */
export function normalizeHearLang(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return isHearLang(v) ? v : null;
}

// 人格の文の「- ことば: 多言語」の行(行の頭の記号はあってもなくてもよい)
const LANG_LINE = /^(?:[-*・]\s*)?ことば\s*[::]\s*([^\s。、(（]+)/u;

/** 人格の文に書いてある「ことば」(「- ことば: 」の行)。無ければ null。CRLF でもよい */
export function langModeFromPersona(persona) {
  for (const line of String(persona ?? '').split(/\r\n|\r|\n/)) {
    const m = LANG_LINE.exec(line.trim());
    if (m) {
      const r = normalizeLangMode(m[1]);
      if (r) return r;
    }
  }
  return null;
}

// 性格の画面(S4・B4)が人格の文の後ろに足す節の見出し(role.js と同じ)。ここより後ろは、使う人がこの端末で選んだ設定
const SETTINGS_HEAD = /^#\s*性格と話し方/u;

function splitAtSettings(persona) {
  const lines = String(persona ?? '').split(/\r\n|\r|\n/);
  const at = lines.findIndex((l) => SETTINGS_HEAD.test(l.trim()));
  return at < 0 ? { own: lines.join('\n'), settings: '' } : { own: lines.slice(0, at).join('\n'), settings: lines.slice(at).join('\n') };
}

/**
 * そのキャラの今の「ことば」。使う人が選んだ値(settings.lang)> 性格の画面の節の「- ことば:」の行 > その子の persona.md の行 > 日本語だけ。
 * @param {{settings?: {lang?: string}|null, persona?: string}} [o]
 * @returns {'ja'|'multi'}
 */
export function langModeOf({ settings = null, persona = '' } = {}) {
  const parts = splitAtSettings(persona);
  return normalizeLangMode(settings?.lang) ?? langModeFromPersona(parts.settings) ?? langModeFromPersona(parts.own) ?? DEFAULT_LANG_MODE;
}

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/gu;
const KANA = /[ぁ-ゖゝ-ゟァ-ヺー-ヿｦ-ﾟ]/gu;
const HAN = /[㐀-䶿一-鿿豈-﫿]/gu;
const LATIN = /[A-Za-zÀ-ɏ]/gu;
const count = (s, re) => (s.match(re) ?? []).length;

/**
 * 文の言葉を見分ける(ja・en・zh・ko)。声の言葉の指定と、安全の網の選びに使う。
 * ハングルがあれば ko、かなを含めば ja、漢字だけ(2 字以上)なら zh、英字が文字の 6 割以上なら en、ほかは fallback(既定は ja)。
 * @param {unknown} text
 * @param {string} [fallback]
 * @returns {'ja'|'en'|'zh'|'ko'}
 */
export function detectLang(text, fallback = DEFAULT_HEAR_LANG) {
  const s = String(text ?? '');
  const hangul = count(s, HANGUL);
  if (hangul > 0) return 'ko';
  const kana = count(s, KANA);
  if (kana > 0) return 'ja';
  const han = count(s, HAN);
  const latin = count(s, LATIN);
  if (han >= 2) return 'zh'; // 「我是Norrie」のように英字の名前が混ざる中国語も zh
  if (latin > 0 && latin / (latin + han) >= 0.6) return 'en';
  return isHearLang(fallback) ? fallback : DEFAULT_HEAR_LANG;
}

/**
 * 話す文の言葉。日本語だけの時は、いつも 'ja'(今までと同じ)。多言語の時だけ、文から見分ける。
 * @param {string} text
 * @param {'ja'|'multi'} mode
 */
export const spokenLang = (text, mode) => (mode === 'multi' ? detectLang(text) : 'ja');
