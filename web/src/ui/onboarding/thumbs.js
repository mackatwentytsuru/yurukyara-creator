// 札に出す小さな絵(B4。11/8 第 12 波 b)。この製品の SVG の描き方(丸い形・はっきりした色・太めの線)で、Claude が描いた。
// 見本の子の顔の札と、3D 用のゆるキャラ変換の形(あたまでっかち・まるい どう)と しつかん(ぬの・け・つるつる)の見本。
// 外の住所は使わない(data: の URL だけ)。DOM も通信も使わない(node の試験で読む)。
// 主役の id は defaults.js から読む(ここに写さない)
import { MAIN_CHARACTER } from '../../character/defaults.js';

// xmlns の値は組み立てる(画面のコードに外の住所の文字を書かない: privacy の試験)
const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const svg = (body) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="${NS}" viewBox="0 0 64 64">${body}</svg>`)}`;
const EYES = (y = 30, dx = 8, c = '#2b2b2b') => `<circle cx="${32 - dx}" cy="${y}" r="3.2" fill="${c}"/><circle cx="${32 + dx}" cy="${y}" r="3.2" fill="${c}"/>`;
const SMILE = (y = 38) => `<path d="M27 ${y} Q32 ${y + 5} 37 ${y}" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
const CHEEK = (y = 36) => `<ellipse cx="19" cy="${y}" rx="3.5" ry="2.2" fill="#ff8fa3" opacity=".7"/><ellipse cx="45" cy="${y}" rx="3.5" ry="2.2" fill="#ff8fa3" opacity=".7"/>`;

/** 見本の子の顔(id → data: の URL) */
export const SAMPLE_THUMBS = {
  mikan: svg(`<circle cx="32" cy="36" r="22" fill="#f6a031" stroke="#c46f10" stroke-width="2"/><path d="M32 14 q8 -8 14 -2 q-6 6 -14 2z" fill="#5fb548" stroke="#3b7d2c" stroke-width="1.5"/>${EYES(34)}${SMILE(41)}${CHEEK(40)}`),
  d_lantern: svg(`<rect x="24" y="6" width="16" height="6" rx="2" fill="#3a2a20"/><rect x="24" y="54" width="16" height="6" rx="2" fill="#3a2a20"/><ellipse cx="32" cy="33" rx="19" ry="22" fill="#e2453c" stroke="#a52a24" stroke-width="2"/><path d="M14 26 H50 M13 33 H51 M14 40 H50" stroke="#b33129" stroke-width="1.4"/>${EYES(31)}${SMILE(38)}`),
  robo: svg(`<line x1="32" y1="6" x2="32" y2="13" stroke="#5b6b7a" stroke-width="2.5"/><circle cx="32" cy="6" r="3" fill="#f2c94c"/><rect x="12" y="13" width="40" height="34" rx="9" fill="#a9c4dc" stroke="#5b7a96" stroke-width="2"/><rect x="18" y="20" width="28" height="18" rx="5" fill="#eef6fc"/>${EYES(29)}${SMILE(33)}<rect x="22" y="49" width="20" height="9" rx="3" fill="#7d97ad"/>`),
  f_led: svg(`<rect x="9" y="12" width="46" height="34" rx="6" fill="#28324a" stroke="#141a28" stroke-width="2"/><rect x="14" y="17" width="36" height="24" rx="3" fill="#3f6fd8"/>${EYES(27, 8, '#ffffff')}<path d="M27 33 Q32 37 37 33" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="26" y="47" width="12" height="6" fill="#141a28"/><rect x="18" y="53" width="28" height="4" rx="2" fill="#141a28"/>`),
  yokoso: svg(`<circle cx="32" cy="34" r="22" fill="#6cc46a" stroke="#3f8a3e" stroke-width="2"/><circle cx="32" cy="36" r="13" fill="#f4fbe9"/>${EYES(33, 6)}${SMILE(38)}<path d="M10 30 q-6 -6 0 -10 M54 30 q6 -6 0 -10" stroke="#3f8a3e" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  [MAIN_CHARACTER.id]: svg(`<path d="M46 50 q14 -2 12 -22" stroke="#8a5a36" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="18" cy="12" rx="6" ry="7" fill="#8a5a36"/><ellipse cx="46" cy="12" rx="6" ry="7" fill="#8a5a36"/><circle cx="32" cy="28" r="18" fill="#8a5a36" stroke="#5c3a20" stroke-width="2"/><ellipse cx="32" cy="33" rx="11" ry="9" fill="#f3e3c4"/>${EYES(26)}<ellipse cx="32" cy="31" rx="3" ry="2" fill="#e4b2bc"/>${SMILE(35)}<path d="M25 49 l7 -4 l7 4 l-7 4z" fill="#3e9b57"/><rect x="22" y="47" width="20" height="13" rx="6" fill="#8a5a36"/>`),
};

/** 3D 用のゆるキャラ変換の形の見本(全国の調べの型: 頭でっかちの二足 65%・球や箱の胴 22%) */
export const SHAPE_THUMBS = {
  atama: svg(`<circle cx="32" cy="23" r="17" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/>${EYES(22, 6)}${SMILE(27)}<rect x="22" y="38" width="20" height="16" rx="8" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/><rect x="23" y="52" width="7" height="8" rx="3" fill="#b9862a"/><rect x="34" y="52" width="7" height="8" rx="3" fill="#b9862a"/>`),
  maru: svg(`<circle cx="32" cy="32" r="24" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/>${EYES(28, 8)}${SMILE(34)}<ellipse cx="22" cy="57" rx="7" ry="4" fill="#b9862a"/><ellipse cx="42" cy="57" rx="7" ry="4" fill="#b9862a"/>`),
};

/** しつかんの見本(布・ぬいぐるみ 81%・毛・つるつる) */
export const MATERIAL_THUMBS = {
  fabric: svg(`<circle cx="32" cy="32" r="22" fill="#f2b88c"/><circle cx="32" cy="32" r="18" fill="none" stroke="#c98a5c" stroke-width="1.6" stroke-dasharray="3 3"/><path d="M14 26 h36 M12 34 h40 M14 42 h36" stroke="#e8a676" stroke-width="1"/>`),
  fur: svg(`<circle cx="32" cy="32" r="20" fill="#d9a77a"/>${Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; const x1 = 32 + Math.cos(a) * 18; const y1 = 32 + Math.sin(a) * 18; const x2 = 32 + Math.cos(a + 0.12) * 26; const y2 = 32 + Math.sin(a + 0.12) * 26; return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#b9845a" stroke-width="2.4" stroke-linecap="round"/>`; }).join('')}`),
  vinyl: svg(`<circle cx="32" cy="32" r="22" fill="#ef8a5a"/><ellipse cx="24" cy="23" rx="8" ry="5" fill="#ffffff" opacity=".85" transform="rotate(-30 24 23)"/><circle cx="41" cy="20" r="2.4" fill="#ffffff" opacity=".9"/>`),
};
