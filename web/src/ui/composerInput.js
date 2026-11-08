// 文字の入力窓(下の帯の「文字で話しかける」)。11-08 本人の iPhone: 「文字の窓がちっちゃすぎる」。
// 押しやすい大きさ(style.css。スマホでは全幅の 1 行目)にしたうえで、長い文を打つと 3 行まで伸びる。
//   - 字は 16px 以上(iPhone が、入力欄に触れた時に画面を拡大しないため。style.css)
//   - Enter(キーボードの「送信」)で送る。Shift+Enter は改行。変換中の Enter(確定)では送らない
//   - 送った・消した後は 1 行に戻す(main.js が input の合図を出す)
// DOM を直接読む小さな部品(node の試験では偽の入力欄で確かめる)。

export const MAX_ROWS = 3;

/** 入力欄の高さ(px)。中身の高さ(scrollHeight)を、最大の高さで切る。純粋な計算 */
export function fitHeight(scrollHeight, maxHeight, borders = 0) {
  const content = Number(scrollHeight);
  if (!(content > 0)) return 0;
  const want = content + (Number(borders) || 0);
  return Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(want, maxHeight) : want;
}

/** この Enter で送るか(Shift・変換中・修飾キー付きは送らない) */
export function shouldSubmitOnEnter(e, composing = false) {
  if (e.key !== 'Enter') return false;
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
  if (composing || e.isComposing || e.keyCode === 229) return false;
  return true;
}

/**
 * @param {{input: HTMLTextAreaElement, form?: HTMLFormElement}} o
 * @param {Window} [win]
 * @returns {{fit: () => void, off: () => void}}
 */
export function installComposerInput({ input, form }, win = globalThis.window) {
  if (!input) return { fit: () => {}, off: () => {} };
  let composing = false;
  const maxHeight = () => {
    const cs = win?.getComputedStyle?.(input);
    const v = cs ? Number.parseFloat(cs.maxHeight) : NaN;
    return Number.isFinite(v) ? v : Infinity;
  };
  const fit = () => {
    input.style.height = 'auto';
    const borders = Math.max(0, (input.offsetHeight || 0) - (input.clientHeight || 0));
    const h = fitHeight(input.scrollHeight, maxHeight(), borders);
    if (h > 0) input.style.height = `${Math.round(h)}px`;
    else input.style.removeProperty('height');
  };
  const onKeyDown = (e) => {
    if (!shouldSubmitOnEnter(e, composing)) return;
    e.preventDefault();
    if (typeof form?.requestSubmit === 'function') form.requestSubmit();
    else form?.dispatchEvent?.(new Event('submit', { cancelable: true, bubbles: true }));
  };
  const onStart = () => {
    composing = true;
  };
  // iPhone は、確定の Enter の keydown が compositionend の後に来ることがある。1 拍おいてから戻す
  const onEnd = () => {
    setTimeout(() => {
      composing = false;
      fit();
    }, 0);
  };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('compositionstart', onStart);
  input.addEventListener('compositionend', onEnd);
  win?.addEventListener?.('resize', fit);
  fit();
  return {
    fit,
    off() {
      input.removeEventListener('input', fit);
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('compositionstart', onStart);
      input.removeEventListener('compositionend', onEnd);
      win?.removeEventListener?.('resize', fit);
    },
  };
}
