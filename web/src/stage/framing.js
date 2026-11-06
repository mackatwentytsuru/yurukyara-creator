// キャラを、画面の上の段(札・ボタン・「Claude の考え」の見出し)と下の帯(字幕・入力)の間に収める計算。
// three を読まない小さな部品にして、node の試験でも読めるようにしてある(scene.js の frameCharacter が使う)。

/** 上の段に使ってよい高さの上限(画面の高さに対する割合)。これより高い段でも、キャラは画面に残す */
export const MAX_TOP_FRACTION = 0.45;
/** 下の帯に使ってよい高さの上限(画面の高さに対する割合) */
export const MAX_BOTTOM_FRACTION = 0.5;
/** キャラに残す高さの下限(横向きのスマホなど、上下の段で画面がほとんど埋まる時) */
export const MIN_USABLE = 0.3;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/**
 * 上下の段を除いた帯に、キャラの見せたい高さ(needH)を収める。横の幅(needW)も画面の幅に収める。
 * @param {object} o
 * @param {number} o.viewH 画面の高さ(px)
 * @param {number} [o.topPx] 上の段の下の端(px)。キャラの横の範囲に重なる物だけ
 * @param {number} [o.bottomPx] 下の帯の高さ(px)
 * @param {number} o.needH 見せたい高さ(世界の長さ。余白を含む)
 * @param {number} [o.needW] 見せたい幅(世界の長さ。余白を含む)
 * @param {number} o.aspect 画面の横 / 縦
 * @returns {{ neededH: number, usable: number, shift: number, top: number, bottom: number }}
 *   neededH は画面の縦いっぱいに見える高さ(世界の長さ)。shift は、帯の真ん中が画面の真ん中よりどれだけ下か(見える高さに対する割合。正 = 下)。
 *   カメラの見る高さ = キャラの真ん中の高さ + shift × 見える高さ にすると、キャラが帯の真ん中に来る。
 */
export function fitBand({ viewH, topPx = 0, bottomPx = 0, needH, needW = 0, aspect }) {
  const h = viewH > 0 ? viewH : 1;
  const top = clamp(topPx, 0, h * MAX_TOP_FRACTION);
  const bottom = clamp(bottomPx, 0, h * MAX_BOTTOM_FRACTION);
  const usable = Math.max(MIN_USABLE, 1 - (top + bottom) / h);
  const neededH = Math.max(needH / usable, aspect > 0 ? needW / aspect : 0);
  return { neededH, usable, shift: (top - bottom) / 2 / h, top, bottom };
}

/**
 * 上の段の要素の四角から、画面の横の範囲 [left, right] に重なる物の下の端(px)を返す。重なる物が無ければ 0。
 * @param {{left:number, right:number, top?:number, bottom:number, width?:number, height?:number}[]} rects getBoundingClientRect の値
 * @param {number} left
 * @param {number} right
 * @param {number} [gap] 下の端に足すすき間(px)
 */
export function guardBottom(rects, left, right, gap = 0) {
  let bottom = 0;
  for (const r of rects) {
    const w = r.width ?? r.right - r.left;
    const ht = r.height ?? r.bottom - (r.top ?? r.bottom);
    if (!(w > 0) || !(ht > 0)) continue; // 隠れている物(display: none)は 0 の四角
    if (r.right <= left || r.left >= right) continue;
    bottom = Math.max(bottom, r.bottom);
  }
  return bottom > 0 ? bottom + gap : 0;
}
