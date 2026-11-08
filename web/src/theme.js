// 画面の「いろ」(ひるの紙・あたたかい夜・ゆうやけの町・むらさき)。
// 選んだ色は、この端末(ブラウザ)が覚える。html の data-theme に入れると、ui/themes.css の変数が切り替わる。
// 3D の光・VR の空と板は CSS の変数を直接は使えないので、ここで変数を読んで数に直して渡す(読めないときは、むらさき = これまでの値)。
// 試験・確かめ用に、?theme=warm のように URL で決められる(覚えない)。

export const THEME_STORAGE_KEY = 'yc.theme';
export const DEFAULT_THEME = 'paper';
/** 設定の「いろ」に並べる順(いちばん上が、はじめの色) */
export const THEMES = Object.freeze([
  Object.freeze({ id: 'paper', label: 'ひるの紙' }),
  Object.freeze({ id: 'warm', label: 'あたたかい夜' }),
  Object.freeze({ id: 'dusk', label: 'ゆうやけの町' }),
  Object.freeze({ id: 'purple', label: 'むらさき' }),
]);
const IDS = THEMES.map((t) => t.id);

export function normalizeTheme(id) {
  return IDS.includes(id) ? id : DEFAULT_THEME;
}

function safeGet(storage) {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null; // 覚えた物が読めなくても、はじめの色で動く
  }
}

/** URL の ?theme=、なければ覚えた物、なければはじめの色 */
export function resolveTheme({ search = '', storage = null } = {}) {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(search).get('theme');
  } catch {
    fromUrl = null;
  }
  if (IDS.includes(fromUrl)) return fromUrl;
  return normalizeTheme(safeGet(storage));
}

// ---- 変数を数に直す(試験できるように、DOM を読まない部品) ----
/** '#rrggbb' か '#rgb' → 0xrrggbb。読めなければ fallback */
export function parseHex(value, fallback) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return parseInt(h, 16);
}
/** '12 10 22' → [12, 10, 22]。読めなければ fallback */
export function parseTriple(value, fallback) {
  const p = String(value ?? '').trim().split(/[\s,]+/).map(Number);
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? p : fallback;
}
export function parseNumber(value, fallback) {
  const n = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}
export const hexCss = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
export const rgbCss = (t, a = 1) => `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${a})`;

const listeners = new Set();
let current = DEFAULT_THEME;

function varReader(doc) {
  const root = doc?.documentElement;
  const cs = root && typeof getComputedStyle === 'function' ? getComputedStyle(root) : null;
  return (name) => (cs ? cs.getPropertyValue(name) : '');
}

/** 舞台(3D・2D)の光の色。three.js の Color にそのまま渡せる数 */
export function readStageColors(doc = typeof document === 'undefined' ? null : document) {
  const v = varReader(doc);
  return {
    hemiSky: parseHex(v('--stage-hemi-sky'), 0xfff1e0),
    hemiGround: parseHex(v('--stage-hemi-ground'), 0x2a2540),
    key: parseHex(v('--stage-key'), 0xffffff),
    rim: parseHex(v('--stage-rim'), 0x9fd8ff),
    rimShader: parseTriple(v('--stage-rim-shader'), [0.87, 0.92, 1]),
    floorRgb: parseTriple(v('--stage-floor-rgb'), [255, 214, 170]),
    floorRgb2: parseTriple(v('--stage-floor-rgb2'), [255, 170, 120]),
    floorA1: parseNumber(v('--stage-floor-a1'), 0.55),
    floorA2: parseNumber(v('--stage-floor-a2'), 0.16),
    haloRgb: parseTriple(v('--stage-halo-rgb'), [0, 0, 0]),
    haloA: parseNumber(v('--stage-halo-a'), 0),
  };
}

/** VR の空・床・輪・板の色(CSS の文字のまま = canvas にも three.js にも渡せる) */
export function readVrColors(doc = typeof document === 'undefined' ? null : document) {
  const v = varReader(doc);
  const hex = (name, fb) => hexCss(parseHex(v(name), fb));
  return {
    sky: [hex('--vr-sky-0', 0x191633), hex('--vr-sky-42', 0x3b2f63), hex('--vr-sky-50', 0xa9708f), hex('--vr-sky-53', 0x2a2440), hex('--vr-sky-100', 0x14121f)],
    floor: parseHex(v('--vr-floor'), 0x241f38),
    ring: parseHex(v('--vr-ring'), 0x4a4068),
    panelRgb: parseTriple(v('--vr-panel-rgb'), [20, 18, 31]),
    states: {
      off: hex('--vr-off', 0x8d86a8),
      idle: hex('--vr-idle', 0x9fd8ff),
      hearing: hex('--vr-hearing', 0x7fe3a8),
      thinking: hex('--vr-thinking', 0xffd27f),
      speaking: hex('--vr-speaking', 0xff9fc4),
    },
    error: hex('--vr-error', 0xff8d8d),
    user: hex('--vr-user', 0xb9b3d6),
    reply: hex('--vr-reply', 0xffffff),
  };
}

export function getTheme() {
  return current;
}

/** 色が切り替わった時に呼ぶ(舞台の光・VR の板が描き直す)。止める関数を返す */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function syncMeta(doc) {
  // ブラウザの上の帯の色: そのときの地の色(--ink)
  const meta = doc.querySelector?.('meta[name="theme-color"]');
  const ink = varReader(doc)('--ink').trim();
  if (meta && ink) meta.setAttribute('content', ink);
}

/** html の data-theme を替える。remember = true なら、この端末に覚える */
export function applyTheme(id, { remember = false, doc = typeof document === 'undefined' ? null : document, storage = null } = {}) {
  const next = normalizeTheme(id);
  if (doc?.documentElement) {
    doc.documentElement.setAttribute('data-theme', next);
    syncMeta(doc);
  }
  if (remember) {
    try {
      storage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 覚えられなくても、この画面の間は替わる
    }
  }
  const changed = next !== current;
  current = next;
  if (changed) for (const fn of [...listeners]) fn(next);
  return next;
}

function browserStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 設定から選んだ時(覚える) */
export function setTheme(id) {
  return applyTheme(id, { remember: true, storage: browserStorage() });
}

// 読み込んだ時に 1 回: 覚えた色(なければ、ひるの紙)を html に入れる(index.html の始めの小さな台本と同じ結果)
if (typeof document !== 'undefined') {
  applyTheme(resolveTheme({ search: typeof location === 'undefined' ? '' : location.search, storage: browserStorage() }));
}
