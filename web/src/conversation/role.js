// キャラの役目(第 12 波 b・B3。性格の画面の「何役か」= B4 と組。欄の決まりは board の B12/role_field.md)。
// おうち・お店の案内・駅や町の案内・学校や施設 の 4 つ。役目で話し方が変わる(web/server/prompt.mjs の指示文):
// - おうち: 受付や係の人の言い回しを出さない。分からない時は正直に「わからない」と言うだけ
// - お店・駅や町・学校や施設: 置く場所の設定(目印か説明)がある時だけ、分からない時に係の人へ聞くように案内してよい
// 役目の無い前からのキャラは、おうち。サーバーと画面が同じ決まりで読む小さな部品(DOM も通信も使わない)。

/** 役目の id(character.json の "role"・/api/chat の character.role・性格の画面の設定に、この id で書く) */
export const ROLES = Object.freeze(['home', 'shop', 'station', 'facility']);
export const DEFAULT_ROLE = 'home';

/** 画面の言葉(性格の画面が並べる・人格の文の「- 役目:」の行に書ける) */
export const ROLE_LABELS = Object.freeze({ home: 'おうち', shop: 'お店の案内', station: '駅や町の案内', facility: '学校や施設' });

/** 人格の文の行や画面の言葉で受ける言いかえ(短い形も) */
const ROLE_WORDS = Object.freeze({
  home: ['おうち', 'お家', '家'],
  shop: ['お店の案内', 'お店', '店'],
  station: ['駅や町の案内', '駅や町', '駅', '町'],
  facility: ['学校や施設', '学校', '施設'],
});

export const isRole = (v) => ROLES.includes(v);

/**
 * 役目の値をそろえる。id(home など)か画面の言葉(おうち など)を受ける。分からない値・空は null。
 * @param {unknown} value
 * @returns {'home'|'shop'|'station'|'facility'|null}
 */
export function normalizeRole(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (isRole(lower)) return lower;
  for (const id of ROLES) if (ROLE_WORDS[id].includes(v)) return id;
  return null;
}

// 人格の文の「- 役目: お店の案内」の行(行の頭の記号はあってもなくてもよい)
const ROLE_LINE = /^(?:[-*・]\s*)?役目\s*[::]\s*([^\s。、(（]+)/u;

/** 人格の文に書いてある役目(「- 役目: 」の行)。無ければ null。CRLF でもよい */
export function roleFromPersona(persona) {
  for (const line of String(persona ?? '').split(/\r\n|\r|\n/)) {
    const m = ROLE_LINE.exec(line.trim());
    if (m) {
      const r = normalizeRole(m[1]);
      if (r) return r;
    }
  }
  return null;
}

/** キャラから character.json の中身を取り出す(読み込んだキャラは lookSource.json、そのままの設計図ならそれ自身) */
const characterJson = (character) => character?.lookSource?.json ?? character ?? null;

// 性格の画面(S4・B4)が人格の文の後ろに足す節の見出し。ここより後ろは、使う人がこの端末で選んだ設定
const SETTINGS_HEAD = /^#\s*性格と話し方/u;

/** 人格の文を、その子の文(own)と、性格の画面が足した節(settings)に分ける */
export function splitPersona(persona) {
  const lines = String(persona ?? '').split(/\r\n|\r|\n/);
  const at = lines.findIndex((l) => SETTINGS_HEAD.test(l.trim()));
  return at < 0 ? { own: lines.join('\n'), settings: '' } : { own: lines.slice(0, at).join('\n'), settings: lines.slice(at).join('\n') };
}

/**
 * そのキャラの今の役目。使う人が選んだ値(settings.role・性格の画面の節の「- 役目:」の行)> character.json の "role"
 * > その子の人格の文の「- 役目:」の行 > おうち。
 * @param {{settings?: {role?: string}|null, character?: object|null, persona?: string}} [o]
 * @returns {'home'|'shop'|'station'|'facility'}
 */
export function roleOf({ settings = null, character = null, persona = '' } = {}) {
  const parts = splitPersona(persona);
  return normalizeRole(settings?.role) ?? roleFromPersona(parts.settings) ?? normalizeRole(characterJson(character)?.role) ?? roleFromPersona(parts.own) ?? DEFAULT_ROLE;
}

/**
 * 分からない時に、係の人(スタッフ)へ聞くように案内してよいか。お店・駅や町・学校や施設で、置く場所の設定がある時だけ。
 * おうちは、場所の設定があっても案内しない(正直に「わからない」と言うだけ)。
 * @param {string} role
 * @param {boolean} withPlace 本物の場所の情報(目印か説明)があるか(prompt.mjs の hasPlaceInfo)
 */
export function canSendToStaff(role, withPlace) {
  return Boolean(withPlace) && isRole(role) && role !== 'home';
}
