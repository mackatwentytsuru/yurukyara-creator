// /api/chat の本文に足す、多言語(ML1)の欄を決める。日本語だけ・ふつうの端末・事実の欄が空の時は、何も足さない(本文は今日と同じ)。
// - lang: 多言語の時だけ 'multi'。画面の設定が「日本語だけ」で、人格の文(persona.md)の行が「多言語」の時だけ 'ja'(その行を打ち消す)
// - hearLang: 多言語の時だけ(マイクの横の選びの値。声の聞き取りが決まらない時の、安全の 1 行の言葉にも使う)
// - facts: お店・駅や町・学校や施設の時だけ、画面の欄(お店のきまり・お知らせ)の文字
// - memory: お店の端末の時だけ 'off'
// DOM も通信も使わない。
import { langModeOf, normalizeHearLang } from './lang.js';

/**
 * @param {object} o
 * @param {string} [o.lang] 今のことば('ja' | 'multi')。画面の設定・人格の文から決めた値(lang.js の langModeOf)
 * @param {string} [o.hearLang] 聞く言葉(ja・en・zh・ko)
 * @param {string} [o.facts] 画面の欄の文字
 * @param {boolean} [o.shopDevice] お店の端末か
 * @param {string} [o.role] 今の役目(home・shop・station・facility)
 * @param {string} [o.persona] 頭脳に渡す人格の文(画面の設定の節つき)
 * @returns {{lang?: 'multi'|'ja', hearLang?: string, facts?: string, memory?: 'off'}}
 */
export function mlBodyFields({ lang = 'ja', hearLang = 'ja', facts = '', shopDevice = false, role = 'home', persona = '' } = {}) {
  const out = {};
  if (lang === 'multi') {
    out.lang = 'multi';
    const h = normalizeHearLang(hearLang);
    if (h) out.hearLang = h;
  } else if (langModeOf({ persona }) === 'multi') {
    out.lang = 'ja'; // 画面で「日本語だけ」を選んだのに、persona.md の行が多言語: 選んだ方を伝える
  }
  if (role !== 'home' && typeof facts === 'string' && facts.trim()) out.facts = facts;
  if (shopDevice) out.memory = 'off';
  return out;
}
