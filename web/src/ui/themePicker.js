// 設定(歯車の窓)の「いろ」: ひるの紙・あたたかい夜・ゆうやけの町・むらさき から選ぶ。選んだ色は、この端末が覚える(theme.js)。
// 見た目は ui/themes.css の .yc-theme-*。文字だけの要素で作る(innerHTML は使わない)。
import { THEMES, getTheme, onThemeChange, setTheme } from '../theme.js';
import { el } from './sheet.js';

export const THEME_WORDS = Object.freeze({
  label: 'いろ',
  group: 'がめんの いろ',
});

/** 「いろ」の選び(4 つのボタン)の箱を返す。窓の中に足す */
export function createThemePicker() {
  const buttons = THEMES.map((t) =>
    el(
      'button',
      { type: 'button', class: 'yc-theme-opt', 'data-theme-id': t.id, 'aria-pressed': 'false', onclick: () => setTheme(t.id) },
      el('span', { class: 'yc-theme-sw', 'aria-hidden': 'true' }),
      el('span', { text: t.label }),
    ),
  );
  const sync = () => {
    const now = getTheme();
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.themeId === now));
  };
  sync();
  onThemeChange(sync);
  return el('div', { class: 'yc-theme', id: 'ycTheme' }, el('span', { text: THEME_WORDS.label }), el('div', { class: 'yc-theme-row', role: 'group', 'aria-label': THEME_WORDS.group }, buttons));
}
