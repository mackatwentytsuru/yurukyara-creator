// キャラを、画面の上の段(札・ボタン・「Claude の考え」の見出し)と下の帯(字幕・入力)の間に収める計算。
// three を読まない小さな部品にして、node の試験でも読めるようにしてある(scene.js の frameCharacter が使う)。

/** 上の段に使ってよい高さの上限(画面の高さに対する割合)。これより高い段でも、キャラは画面に残す */
export const MAX_TOP_FRACTION = 0.45;
/** 下の帯に使ってよい高さの上限(画面の高さに対する割合) */
export const MAX_BOTTOM_FRACTION = 0.5;
/** キャラに残す高さの下限(横向きのスマホなど、上下の段で画面がほとんど埋まる時) */
export const MIN_USABLE = 0.3;
/** 画面のキーボードが出ている間の上限と下限(見える範囲の外 = キーボードの裏も、下の帯として数えるため) */
export const KB_MAX_BOTTOM_FRACTION = 0.85;
export const KB_MIN_USABLE = 0.17;
/**
 * 上の段の下の端とキャラのいちばん上(耳を含む)の間に、必ず空けるすき間(画面の高さに対する割合)。
 * 11/7 本人「頭が切れちゃってる」: PC では上の段がキャラの横に重ならないので、耳が画面の上の端まで出ていた。
 * 上の段は横の位置にかかわらず数え、その下の端からこの割合だけ下げてキャラを置く(カメラを引く)。
 */
export const TOP_CLEAR_FRACTION = 0.06;

/** 全身(view = 'full')で、足元の下と頭の上に空ける余白(キャラの高さに対する割合。前からの値 = 見える高さ 1.18 倍) */
export const FULL_PAD = 0.09;
/** 上の段の線(+ すき間)で置き直す時の、頭の上の余白の下限(キャラの高さに対する割合) */
export const GUARDED_TOP_PAD = 0.03;
/** 動きの出っ張り(キャラの読み込みで測った値)に足す余り(キャラの高さに対する割合。測る時刻と点の間引きの分と、視線で頭を上げる分) */
export const MOTION_MARGIN = 0.03;
/** 遠近の確かめ(scene.js の pointsTop)で、測った出っ張りに足す見込み違いの分(キャラの高さに対する割合。跳ねる頂点の測り漏れ) */
export const MOTION_TOLERANCE = 0.01;

/**
 * 頭の上の余白(キャラの高さに対する割合)。
 * rise は、動き(idle・talk・手を振る・おじぎ・跳ねる)で止まった形のいちばん上より上へ出る分(rig の読み込みで測る。creator/viewer/rigRuntime.js の
 * measureMotionRise)。測れないキャラ(VRM・2D の板)は前のまま FULL_PAD。
 * 上の段の線で置き直す時(guarded)は rise + MOTION_MARGIN(下限 GUARDED_TOP_PAD。動かないキャラは前より大きく見せる)。
 * 置き直さない時は FULL_PAD より小さくしない(跳ねるキャラだけ広げる)
 */
export function topPad(rise, guarded) {
  if (!Number.isFinite(rise) || rise < 0) return FULL_PAD;
  const need = rise + MOTION_MARGIN;
  return guarded ? Math.max(GUARDED_TOP_PAD, need) : Math.max(FULL_PAD, need);
}

/** 全身の時の見える高さと真ん中(キャラの高さ h に対する割合)。足元の下は FULL_PAD、頭の上は padTop */
export function fullSpan(padTop = FULL_PAD) {
  const top = Number.isFinite(padTop) && padTop >= 0 ? padTop : FULL_PAD;
  return { visible: 1 + top + FULL_PAD, center: (1 + top - FULL_PAD) / 2 };
}

/** 上の段の下の端に足すすき間(px)。画面の高さの TOP_CLEAR_FRACTION(小さい画面でも minPx は空ける) */
export function topClearance(viewH, minPx = 8) {
  return Math.max(minPx, Math.ceil((viewH > 0 ? viewH : 0) * TOP_CLEAR_FRACTION));
}

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
 * @param {number} [o.maxBottomFraction] 下の帯に使ってよい高さの上限の割合(既定 MAX_BOTTOM_FRACTION。画面のキーボードが出ている間は広げる)
 * @param {number} [o.minUsable] キャラに残す高さの下限の割合(既定 MIN_USABLE。画面のキーボードが出ている間は下げる)
 * @returns {{ neededH: number, usable: number, shift: number, top: number, bottom: number }}
 *   neededH は画面の縦いっぱいに見える高さ(世界の長さ)。shift は、帯の真ん中が画面の真ん中よりどれだけ下か(見える高さに対する割合。正 = 下)。
 *   カメラの見る高さ = キャラの真ん中の高さ + shift × 見える高さ にすると、キャラが帯の真ん中に来る。
 */
export function fitBand({ viewH, topPx = 0, bottomPx = 0, needH, needW = 0, aspect, maxBottomFraction = MAX_BOTTOM_FRACTION, minUsable = MIN_USABLE }) {
  const h = viewH > 0 ? viewH : 1;
  const top = clamp(topPx, 0, h * MAX_TOP_FRACTION);
  const bottom = clamp(bottomPx, 0, h * maxBottomFraction);
  const usable = Math.max(minUsable, 1 - (top + bottom) / h);
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

/**
 * キャラの頭を置いてよいいちばん上の線(px)。main.js の topGuard が使う。
 * - bar: 上の段(札・ボタン・見た目の切り替え)の四角。**横の位置にかかわらず**数え、下の端 + clear の下に置く
 * - side: スマホで上の段のすぐ下に並ぶ物(畳んだ「Claude の考え」の見出しなど)。キャラの横の範囲に重なる時だけ、同じ clear
 * - panels: 開いた窓(「Claude の考え」・QR の箱)。重なる時だけ、下の端 + panelGap(窓は自分で開いた物なので、すき間は小さくてよい)
 * @returns {number} 0 なら、避ける物が無い
 */
export function topLimit({ bar = [], side = [], panels = [], left, right, clear = 0, panelGap = 0 }) {
  const line = Math.max(guardBottom(bar, -Infinity, Infinity), guardBottom(side, left, right));
  const open = guardBottom(panels, left, right, panelGap);
  return Math.max(line > 0 ? line + clear : 0, open);
}

/**
 * テレビ表示の線(px)。上の段は隠すので、画面の上の端から clear(画面の高さの 6%)を空ける(上の段が無くても 0 にしない)。
 * 隅の小さな「もどる」(corner)がキャラの横の範囲に重なる時だけ、その下の端から clear
 * @returns {number}
 */
export function tvTopLimit({ corner = [], left, right, clear = 0 }) {
  return guardBottom(corner, left, right) + Math.max(0, Number(clear) || 0);
}
