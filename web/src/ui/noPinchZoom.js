// スマホの画面を、指(つまむ・2 回タップ)で拡大縮小させない。
// 11-08 本人の iPhone: 「拡大縮小をしようとしたらなんか固まった」。つまむと、キャラも札も拡大されて右が切れたまま戻らなかった。
// この画面は、いつもスマホの幅にぴったり収まる作り(字は 16px 以上)なので、拡大しなくても読める。
// 守り 3 つ:
//   1. viewport の meta で拡大を止める(Chrome の Android などが守る)。iPhone の Safari 系は meta だけでは止まらないので、
//   2. gesturestart / gesturechange(Safari の 2 本指の合図)を止める・指が 2 本以上の touchmove を止める・CSS の touch-action(style.css)
//   3. それでも拡大されてしまった時(visualViewport.scale が 1 より大きいまま)は、viewport の meta を書き直して 1 倍へ戻す
// DOM を直接読む小さな部品(node の試験では偽の document・window で確かめる)。

export const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover';
import { isZoomed } from './keyboardInset.js'; // 拡大の判定は 1 か所(keyboardInset.js)にそろえる
const RESET_DELAY_MS = 120; // つまんでいる最中は戻さない(指が離れて少しして戻す)

/** 拡大率が 1 を超えているか */
export const isPinchZoomed = isZoomed;

/**
 * @param {Document} [doc]
 * @param {Window} [win]
 * @returns {() => void} 外す関数
 */
export function installNoPinchZoom(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win) return () => {};
  const vv = win.visualViewport;
  let timer = null;
  const stop = (e) => {
    try {
      if (e.cancelable !== false) e.preventDefault();
    } catch {
      // 止められない合図は、そのまま
    }
  };
  const onTouchMove = (e) => {
    if ((e.touches?.length ?? 0) > 1) stop(e); // 2 本以上の指(つまむ動き)
  };
  const lockMeta = () => {
    const meta = doc.querySelector?.('meta[name="viewport"]');
    if (meta && meta.getAttribute('content') !== LOCKED_VIEWPORT) meta.setAttribute('content', LOCKED_VIEWPORT);
    return meta;
  };
  // 拡大されたまま残った時に 1 倍へ戻す: meta を一度ゆるめて、すぐ閉じ直す(Safari 系は、書き直しの時に拡大率を取り直す)
  const resetZoom = () => {
    timer = null;
    if (!isPinchZoomed(win.visualViewport)) return;
    const meta = lockMeta();
    if (!meta) return;
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1.0001, viewport-fit=cover');
    const again = () => {
      meta.setAttribute('content', LOCKED_VIEWPORT);
      win.scrollTo?.(0, 0);
    };
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(again);
    else setTimeout(again, 0);
  };
  const schedule = () => {
    if (timer !== null || !isPinchZoomed(win.visualViewport)) return;
    timer = setTimeout(resetZoom, RESET_DELAY_MS);
  };

  lockMeta();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, stop, { passive: false });
  doc.addEventListener('touchmove', onTouchMove, { passive: false });
  doc.addEventListener('touchend', schedule, { passive: true });
  vv?.addEventListener('resize', schedule);
  win.addEventListener('pageshow', schedule);
  schedule();
  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.removeEventListener(type, stop);
    doc.removeEventListener('touchmove', onTouchMove);
    doc.removeEventListener('touchend', schedule);
    vv?.removeEventListener('resize', schedule);
    win.removeEventListener('pageshow', schedule);
  };
}
