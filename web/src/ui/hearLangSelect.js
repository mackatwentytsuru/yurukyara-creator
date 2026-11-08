// マイクの横の小さな選び「聞く言葉」(多言語。ML1)。多言語の時だけ出す(日本語だけの時は、画面に新しい物を何も出さない)。
// 選べるのは 日本語・English・中文・한국어。選んだ値は、この端末に覚える(conversation/hearLang.js)。聞き取りは、選びを替えた時に始め直す(main.js)。
import { HEAR_LANGS, HEAR_LANG_LABELS } from '../conversation/lang.js';

/**
 * @param {object} o
 * @param {HTMLElement} o.box 選びを包む箱(hidden で出し入れする)
 * @param {HTMLSelectElement} o.select
 * @param {()=>'ja'|'multi'} o.getMode いまのことば
 * @param {()=>string} o.getLang いまの聞く言葉
 * @param {(lang:string)=>void} o.setLang 選んだ時に呼ぶ(覚える・聞き取りを始め直す)
 */
export function mountHearLangSelect({ box, select, getMode, getLang, setLang }) {
  select.replaceChildren(
    ...HEAR_LANGS.map((id) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = HEAR_LANG_LABELS[id];
      return o;
    }),
  );
  select.addEventListener('change', () => setLang(select.value));
  const refresh = () => {
    box.hidden = getMode() !== 'multi';
    select.value = getLang();
  };
  refresh();
  return { refresh };
}
