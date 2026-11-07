// 小窓(第 12 波 b・BUX): 「マイクとスピーカー」と「アプリの アップデート」の窓の共通の決まり。
// - 窓は下の帯(.bottom)の中、入力の列の上に入れる。幅 1100 未満では帯の一部になるので、帯の高さが増え、main.js の fitBottom が
//   キャラを窓の上へ置き直す(キャラに重ならない・形は変えない)。幅 1100 以上では右に浮かせる(キャラは真ん中なので重ならない)。
// - 開くのは 1 つずつ。Esc か「とじる」で閉じ、開いたボタンへ戻る。会話(入力の列・字幕)は、窓を開いていても使える。
const open = new Set();

/** 文字だけの要素を作る(innerHTML を使わない) */
export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}

/**
 * 小窓を作って下の帯に入れる。
 * @param {{id:string, title:string, onClose?:()=>void}} o
 * @returns {{root:HTMLElement, body:HTMLElement, show:(opener?:HTMLElement)=>void, hide:()=>void, isOpen:()=>boolean}}
 */
export function createSheet({ id, title, onClose = () => {} }) {
  const titleId = `${id}Title`;
  const closeBtn = el('button', { type: 'button', class: 'yc-sheet-close', text: 'とじる' });
  const body = el('div', { class: 'yc-sheet-body' });
  const root = el('section', { id, class: 'yc-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, tabindex: '-1', hidden: true },
    el('header', { class: 'yc-sheet-head' }, el('h2', { id: titleId, text: title }), closeBtn),
    body);
  const bottom = document.querySelector('.bottom');
  const composer = document.getElementById('composer');
  if (bottom && composer && composer.parentElement === bottom) bottom.insertBefore(root, composer);
  else document.body.append(root);
  let opener = null;
  const api = {
    root,
    body,
    isOpen: () => !root.hidden,
    show(from) {
      for (const other of [...open]) if (other !== api) other.hide();
      opener = from ?? null;
      root.hidden = false;
      open.add(api);
      opener?.setAttribute('aria-expanded', 'true');
      root.focus({ preventScroll: true });
    },
    hide() {
      if (root.hidden) return;
      root.hidden = true;
      open.delete(api);
      opener?.setAttribute('aria-expanded', 'false');
      opener?.focus?.({ preventScroll: true });
      onClose();
    },
  };
  closeBtn.addEventListener('click', () => api.hide());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.hide();
    }
  });
  return api;
}

/** 字幕の上に出す、短い知らせ(押せるボタンを 1 つ付けられる)。ms 後に消える(0 なら消えない) */
export function createNote(id) {
  const text = el('span', { class: 'yc-note-text' });
  const action = el('button', { type: 'button', class: 'yc-note-action', hidden: true });
  const node = el('p', { id, class: 'ui-notice yc-note', role: 'status', hidden: true }, text, action);
  (document.querySelector('.subs') ?? document.body).prepend(node);
  let timer = null;
  let onAction = null;
  action.addEventListener('click', () => {
    node.hidden = true;
    onAction?.();
  });
  return {
    node,
    show(message, { button = '', onClick = null, ms = 9000 } = {}) {
      text.textContent = message;
      action.textContent = button;
      action.hidden = !button;
      onAction = onClick;
      node.hidden = false;
      clearTimeout(timer);
      if (ms > 0) timer = setTimeout(() => (node.hidden = true), ms);
    },
    hide() {
      clearTimeout(timer);
      node.hidden = true;
    },
  };
}
