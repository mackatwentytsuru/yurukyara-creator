// 作る画面(スマホだけで作る時)の、3D 用のゆるキャラ変換の見本の絵(B4。11/8 第 12 波 b)。この製品の SVG の描き方で Claude が描いた。
// 会話の画面の web/src/ui/onboarding/thumbs.js と同じ絵(作る画面は別のサーバーが配るので、ここにも置く)。data: の URL だけ。
const NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
const svg = (body) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="${NS}" viewBox="0 0 64 64">${body}</svg>`)}`;
const EYES = (y, dx) => `<circle cx="${32 - dx}" cy="${y}" r="3.2" fill="#2b2b2b"/><circle cx="${32 + dx}" cy="${y}" r="3.2" fill="#2b2b2b"/>`;
const SMILE = (y) => `<path d="M27 ${y} Q32 ${y + 5} 37 ${y}" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

export const SHAPES = [
  { id: "atama", label: "あたまでっかち", img: svg(`<circle cx="32" cy="23" r="17" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/>${EYES(22, 6)}${SMILE(27)}<rect x="22" y="38" width="20" height="16" rx="8" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/><rect x="23" y="52" width="7" height="8" rx="3" fill="#b9862a"/><rect x="34" y="52" width="7" height="8" rx="3" fill="#b9862a"/>`) },
  { id: "maru", label: "まるい どう", img: svg(`<circle cx="32" cy="32" r="24" fill="#f6c86e" stroke="#b9862a" stroke-width="2"/>${EYES(28, 8)}${SMILE(34)}<ellipse cx="22" cy="57" rx="7" ry="4" fill="#b9862a"/><ellipse cx="42" cy="57" rx="7" ry="4" fill="#b9862a"/>`) },
];

const fur = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const p = (r, d = 0) => `${(32 + Math.cos(a + d) * r).toFixed(1)} ${(32 + Math.sin(a + d) * r).toFixed(1)}`;
  return `<path d="M${p(18)} L${p(26, 0.12)}" stroke="#b9845a" stroke-width="2.4" stroke-linecap="round"/>`;
}).join("");

export const MATERIALS = [
  { id: "fabric", label: "ぬの", img: svg(`<circle cx="32" cy="32" r="22" fill="#f2b88c"/><circle cx="32" cy="32" r="18" fill="none" stroke="#c98a5c" stroke-width="1.6" stroke-dasharray="3 3"/>`) },
  { id: "fur", label: "け", img: svg(`<circle cx="32" cy="32" r="20" fill="#d9a77a"/>${fur}`) },
  { id: "vinyl", label: "つるつる", img: svg(`<circle cx="32" cy="32" r="22" fill="#ef8a5a"/><ellipse cx="24" cy="23" rx="8" ry="5" fill="#ffffff" opacity=".85" transform="rotate(-30 24 23)"/><circle cx="41" cy="20" r="2.4" fill="#ffffff" opacity=".9"/>`) },
];
