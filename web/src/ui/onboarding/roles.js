// この子は、どこで だれと?(作る道の最初に聞く「役目」。B4。11/8 第 12 波 b)
// 値は 4 つだけ(B3 の会話と同じ。work/B12/role_field.md): home・shop・station・facility。知らない値は home(おうち)。
// 画面の札の言葉(子ども向け)と、人格の文に書く言葉(B3 の ROLE_LABELS と同じ文字)を、ここ 1 か所に置く。DOM も通信も使わない。

export const ROLES = ['home', 'shop', 'station', 'facility'];
export const DEFAULT_ROLE = 'home';

/** 人格の文の「- 役目: 〜」に書く言葉(会話の側がこの文字で読む。変えるときは B3 と合わせる) */
export const ROLE_LABELS = { home: 'おうち', shop: 'お店の案内', station: '駅や町の案内', facility: '学校や施設' };

/** 札の言葉(ひらがな多め) */
export const ROLE_CHIPS = { home: 'おうち', shop: 'おみせの あんない', station: 'えきや まちの あんない', facility: 'がっこうや しせつ' };

/** その役目で、絵を描く段に渡す「どこで だれと」の一文 */
export const ROLE_SCENES = {
  home: 'おうちで、家族と話す',
  shop: 'お店で、来た人に お店の ことを 案内する',
  station: '駅や町で、来た人に 道や 町の ことを 案内する',
  facility: '学校や施設で、来た人と 話して 案内する',
};

/** 場所の名前を聞く役目(お店と駅だけ。1〜2 問で終える) */
export const ASKS_PLACE = new Set(['shop', 'station']);
export const PLACE_MAX = 30;

/** 英語の id でも画面の言葉でも受ける。知らない値は おうち */
export function normalizeRole(v) {
  const s = String(v ?? '').trim();
  if (ROLES.includes(s)) return s;
  for (const id of ROLES) if (s === ROLE_LABELS[id] || s === ROLE_CHIPS[id]) return id;
  return DEFAULT_ROLE;
}

/** 置く場所の短い説明(名前と、案内すること)。どちらも空なら '' */
export function placeLine(place) {
  const name = [...String(place?.name ?? '').trim()].slice(0, PLACE_MAX).join('');
  const about = [...String(place?.about ?? '').trim()].slice(0, PLACE_MAX).join('');
  if (!name && !about) return '';
  return [name, about && `案内すること: ${about}`].filter(Boolean).join('。');
}
