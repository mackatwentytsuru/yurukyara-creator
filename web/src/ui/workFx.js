// 「いま はたらいているよ」の見た目(work.js の知らせを受けて描く)。
//  - 舞台のまわり: やさしいきらきらの粒(星と丸)が、ふわっと上へ昇って消える。キャラを覆わない・押せる物の邪魔をしない(pointer-events なし)
//  - 小さな印: くるくる回る輪の中で、星がはずむ。文(いまの歩み)と、動く点(…)・流れる細い線を添える
//  - 作る札の中の 1 行(onboarding/view.js)も、同じ印と同じ見た目を使う
// 軽さ: 動かすのは transform と opacity だけ。粒は、スマホ(指で触る端末・狭い画面)は 9 個、PC は 16 個。出ていない間は display: none で、動きの計算をしない。
// 動きを止める設定(prefers-reduced-motion)では、粒も輪も止めて、やわらかい光と文だけにする。
// 場所が動かない: きらきらの層・小さな印は position: fixed(ページの高さを変えない)。作る札の 1 行は、札の中の会話の最後に足すだけ(高さは先に決めてある)。
// 「AI の キャラクターと話しています」の知らせ(.ai-notice)は、きらきらの層より手前に出したまま(粒は小さく薄い。知らせの文字は隠れない)。
import { currentWorkNote, currentWorkText, work } from './work.js';

/** 粒の数(スマホは軽く) */
export const SPARKLES_PHONE = 9;
export const SPARKLES_DESKTOP = 16;

export const WORK_CSS = `
.wk-fx { position: fixed; pointer-events: none; overflow: hidden; contain: layout paint style; }
.wk-fx[hidden] { display: none; }
.wk-sp { position: absolute; left: var(--x); top: var(--y); width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
  background: var(--c); border-radius: 50%; opacity: 0; box-shadow: 0 0 10px var(--c); animation: wk-twinkle var(--t) ease-in-out var(--d) infinite; }
.wk-sp.wk-star { border-radius: 0; box-shadow: none; clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%); }
@keyframes wk-twinkle {
  0% { opacity: 0; transform: translate3d(0, 8px, 0) scale(0.5); }
  35% { opacity: 0.95; transform: translate3d(0, -4px, 0) scale(1); }
  70% { opacity: 0.7; transform: translate3d(var(--dx), -18px, 0) scale(0.85); }
  100% { opacity: 0; transform: translate3d(var(--dx), -30px, 0) scale(0.4); }
}
@media (pointer: coarse), (max-width: 720px) { .wk-sp { box-shadow: none; } }

.wk-mark { position: relative; flex: none; display: block; width: 28px; height: 28px; }
.wk-ring { position: absolute; inset: 0; border-radius: 50%; border: 3px solid rgba(183, 168, 255, 0.28); border-top-color: var(--mint, #7be0c3); border-right-color: var(--lav, #b7a8ff); animation: wk-spin 1.05s linear infinite; }
.wk-star { position: absolute; left: 50%; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; background: var(--warn, #ffd37a);
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%); animation: wk-bounce 1.05s ease-in-out infinite; }
@keyframes wk-spin { to { transform: rotate(360deg); } }
@keyframes wk-bounce { 0%, 100% { transform: translateY(2px) scale(0.85); } 50% { transform: translateY(-3px) scale(1.12); } }

.wk-body { position: relative; display: grid; gap: 2px; min-width: 0; padding-bottom: 5px; }
.wk-line { display: flex; align-items: center; flex-wrap: wrap; min-width: 0; }
.wk-text { font-size: 16px; line-height: 1.4; font-weight: 700; color: var(--text, #f4f1fb); overflow-wrap: anywhere; }
.wk-note { display: block; min-height: 1.4em; font-size: 13px; line-height: 1.4; color: var(--muted, #b2abc9); }
.wk-note:empty::before { content: "\\00a0"; }
.wk-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 3px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.wk-bar i { display: block; width: 38%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--mint, #7be0c3), var(--lav, #b7a8ff)); animation: wk-slide 1.6s ease-in-out infinite; }
@keyframes wk-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(290%); } }

/* 舞台の小さな印(作る札が開いていない時。札が開いている間は、札の中の 1 行が同じ物を出す) */
.wk-pill { position: fixed; z-index: 9; left: 50%; top: var(--wk-top, max(96px, 16vh)); transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  width: min(92vw, 340px); min-height: 48px; padding: 8px 18px 8px 12px; border-radius: 999px; box-sizing: border-box;
  background: rgba(12, 10, 22, 0.78); border: 1px solid rgba(183, 168, 255, 0.4); pointer-events: none; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.wk-pill[hidden] { display: none; }
.wk-pill .wk-body { padding-bottom: 6px; }

/* 作る札の中の 1 行 */
.fr-working { display: flex; align-items: center; gap: 12px; margin: 8px 4px; padding: 10px 16px 10px 12px; min-height: 56px; border-radius: 18px; box-sizing: border-box;
  background: rgba(183, 168, 255, 0.1); border: 1px solid rgba(183, 168, 255, 0.34); }
.fr-working .wk-body { flex: 1 1 auto; }

html.gate-up .wk-fx, html.gate-up .wk-pill, html.tv-mode .wk-fx, html.tv-mode .wk-pill, html.is-led .wk-fx, html.is-led .wk-pill, html.is-headset .wk-fx, html.is-headset .wk-pill, html.fr-open .wk-pill { display: none; }

@media (prefers-reduced-motion: reduce) {
  .wk-sp { animation: none; opacity: 0.45; transform: none; }
  .wk-sp:nth-child(2n) { display: none; }
  .wk-ring { animation: none; }
  .wk-star { animation: none; }
  .wk-bar i { animation: none; width: 100%; opacity: 0.55; }
}
`;

/** 使う画面に、見た目を 1 回だけ入れる */
export function ensureWorkStyles(doc = globalThis.document) {
  const head = doc?.head;
  if (!head || head.querySelector?.('style[data-work-fx]')) return;
  const s = doc.createElement('style');
  s.dataset.workFx = '1';
  s.textContent = WORK_CSS;
  head.append(s);
}

const el = (doc, tag, props = {}, ...kids) => {
  const n = Object.assign(doc.createElement(tag), props);
  n.append(...kids.filter(Boolean));
  return n;
};

/** くるくる回る輪の中で、星がはずむ小さな印 */
export function workMark(doc = globalThis.document) {
  const m = el(doc, 'span', { className: 'wk-mark', ariaHidden: 'true' }, el(doc, 'i', { className: 'wk-ring' }), el(doc, 'i', { className: 'wk-star' }));
  m.setAttribute('aria-hidden', 'true');
  return m;
}

/** 文・動く点(…)・一言・流れる細い線 の 1 かたまり。返り値の set(text, note) で文を替える(高さは変わらない) */
export function workBody(doc = globalThis.document) {
  const text = el(doc, 'b', { className: 'wk-text' });
  const dots = el(doc, 'span', { className: 'wd' }, el(doc, 'i'), el(doc, 'i'), el(doc, 'i'));
  dots.setAttribute('aria-hidden', 'true');
  const note = el(doc, 'small', { className: 'wk-note' });
  const bar = el(doc, 'span', { className: 'wk-bar' }, el(doc, 'i'));
  bar.setAttribute('aria-hidden', 'true');
  const root = el(doc, 'span', { className: 'wk-body' }, el(doc, 'span', { className: 'wk-line' }, text, dots), note, bar);
  return {
    root,
    set(t, n = '') {
      if (text.textContent !== t) text.textContent = t;
      if (note.textContent !== n) note.textContent = n;
    },
  };
}

const COLORS = ['#b7a8ff', '#7be0c3', '#ffd37a', '#ff8f7a', '#ffffff'];

/** 粒の置き方: キャラのまわりの楕円(中心から 0.30〜0.48 の幅・高さの輪)に、ばらして置く。決まった並び(毎回同じ。乱数を使わない) */
export function sparkleSpecs(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (i % 2 ? 0.35 : 0);
    const r = 0.3 + ((i * 37) % 19) / 100; // 0.30〜0.48
    out.push({
      x: Math.round((0.5 + Math.cos(a) * r) * 100),
      y: Math.round((0.5 + Math.sin(a) * r * 1.05) * 100),
      s: 5 + ((i * 7) % 6), // 5〜10 px
      t: (2.6 + ((i * 5) % 14) / 10).toFixed(1), // 2.6〜3.9 秒
      d: (-((i * 53) % 30) / 10).toFixed(1), // 始めの位置をずらす(負の遅れ。全部が同時に始まらない)
      dx: ((i % 2 ? 1 : -1) * (4 + ((i * 3) % 9))), // 横のゆれ -12〜12 px
      c: COLORS[i % COLORS.length],
      star: i % 3 !== 1,
    });
  }
  return out;
}

const phoneLike = (win) => {
  try {
    return Boolean(win?.matchMedia?.('(pointer: coarse)')?.matches) || (win?.innerWidth ?? 1024) < 720;
  } catch {
    return false;
  }
};

/**
 * 舞台のきらきらと小さな印を付ける。work の知らせが「見せる」の間だけ出る。
 * @param {object} [o]
 * @param {Document} [o.doc]
 * @param {HTMLElement|null} [o.stage] 舞台の canvas(この大きさと場所に、きらきらを重ねる)
 * @param {typeof work} [o.tracker]
 * @returns {{destroy:()=>void, layer:HTMLElement, pill:HTMLElement}}
 */
export function mountWorkFx({ doc = globalThis.document, stage = doc?.getElementById?.('stage') ?? null, tracker = work } = {}) {
  ensureWorkStyles(doc);
  const win = doc.defaultView ?? globalThis;
  const layer = el(doc, 'div', { className: 'wk-fx', hidden: true, id: 'workFx' });
  layer.setAttribute('aria-hidden', 'true');
  const count = phoneLike(win) ? SPARKLES_PHONE : SPARKLES_DESKTOP;
  for (const sp of sparkleSpecs(count)) {
    const i = el(doc, 'i', { className: sp.star ? 'wk-sp wk-star' : 'wk-sp' });
    i.style.cssText = `--x:${sp.x}%;--y:${sp.y}%;--s:${sp.s}px;--t:${sp.t}s;--d:${sp.d}s;--dx:${sp.dx}px;--c:${sp.c}`;
    layer.append(i);
  }
  const body = workBody(doc);
  const pill = el(doc, 'p', { className: 'wk-pill', id: 'workPill', hidden: true }, workMark(doc), body.root);
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  // きらきらの層は、舞台のすぐ後ろ(下の帯・字幕・上の段より前の並び)に置く。重なりの段は上げない(z-index なし)ので、
  // 「AI キャラクターと話しています」を含む画面の部品は、いつもきらきらより手前に描かれる
  if (stage?.parentNode === doc.body) stage.after(layer);
  else doc.body.prepend(layer);
  doc.body.append(pill);

  /** 舞台の canvas と同じ場所に重ねる(作る札で舞台が狭まっても、その中に収まる) */
  const place = () => {
    const r = stage?.getBoundingClientRect?.();
    const w = r?.width || win.innerWidth || 0;
    const h = r?.height || win.innerHeight || 0;
    // 広い舞台でも、キャラのまわりに集まるように、舞台の真ん中の細めの範囲に置く(PC の横に長い画面で、粒が両端へ散らない)
    const lw = Math.min(w, h * 0.85);
    const lh = Math.min(h, lw * 1.6);
    Object.assign(layer.style, { left: `${(r?.left ?? 0) + (w - lw) / 2}px`, top: `${(r?.top ?? 0) + (h - lh) / 2}px`, width: `${lw}px`, height: `${lh}px` });
  };
  const render = (s) => {
    const on = Boolean(s.visible);
    if (on) place();
    layer.hidden = !on;
    const showPill = on && s.pill;
    if (showPill) body.set(currentWorkText(s), currentWorkNote(s));
    pill.hidden = !showPill;
  };
  const off = tracker.subscribe(render);
  const onResize = () => tracker.state.visible && place();
  win.addEventListener?.('resize', onResize);
  return {
    layer,
    pill,
    destroy() {
      off();
      win.removeEventListener?.('resize', onResize);
      layer.remove();
      pill.remove();
    },
  };
}
