// 小窓(第 12 波 b・BUX): 「マイクとスピーカー」と「アプリの アップデート」の窓の共通の決まり。
// - 窓は body の直下に置き、浮かせる。幅 1100 未満は画面の上(上の段の上にかぶせる)、幅 1100 以上は右(キャラは真ん中なので重ならない)。
//   開いている間は main.js の頭の線(topGuard)に窓の下の端を足す(sheetGuard)ので、キャラは窓の下へ置き直される(重ならない・形は変えない)。
//   下の帯は動かさない(初めは帯の中に入れたが、本物の iPhone の Safari で、帯の上の注意書きと字幕まで押し上げてキャラに重なった)。
// - 開くのは 1 つずつ。Esc か「とじる」で閉じ、開いたボタンへ戻る。会話(入力の列・字幕)は、窓を開いていても使える。
const open = new Set();
// 文字の入力欄に触れたら、開いている窓を閉じる(スマホでキーボードが出ると、帯と一緒に窓が上へ押し上げられて見えなくなるため)
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    if (e.target?.id === 'textInput') for (const s of [...open]) s.hide({ restoreFocus: false }); // 入力欄から目を離さない
  });
}

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

const SHEET_GAP_PX = 14; // 窓の下の端とキャラの頭のすき間(main.js の開いた窓と同じ)
const SIDE_MIN_W = 1100; // これより広い画面では、窓は右に浮かぶ(キャラの横の範囲に重ならない)
const MIN_SHEET_PX = 150;
let layoutHook = () => {};
let roomFn = () => Infinity;
/** 窓が開いた・閉じた・大きさが変わった時に呼ぶ(main.js がキャラを置き直す関数を入れる) */
export function setSheetLayoutHook(fn) {
  layoutHook = typeof fn === 'function' ? fn : () => {};
}
/**
 * 上に浮かぶ窓の下の端が来てよい、いちばん下の線(px)を返す関数を入れる。キャラの置き方は、画面の高さの一定の割合(framing.js の MIN_USABLE)を
 * 必ずキャラに使うので、窓がそれより下まで来ると、キャラが窓と下の帯にはみ出す(本物の iPhone の Safari で 9px 重なった)。中身は窓の中で動かして見る
 */
export function setSheetRoom(fn) {
  roomFn = typeof fn === 'function' ? fn : () => Infinity;
}
function fitRoom(root) {
  if (root.hidden) return;
  if (window.innerWidth >= SIDE_MIN_W) {
    root.style.maxHeight = '';
    return;
  }
  const top = root.getBoundingClientRect().top || 12;
  const room = Number(roomFn());
  const cap = Math.min(430, window.innerHeight * 0.46);
  root.style.maxHeight = `${Math.round(Math.max(MIN_SHEET_PX, Math.min(cap, Number.isFinite(room) ? room - top - SHEET_GAP_PX : cap)))}px`;
}

/**
 * 開いている窓の下の端 + すき間(px)。[left, right](キャラの横の範囲)に横で重なる窓だけ数える。無ければ 0。
 * main.js の頭の線(topGuard)に足す(右に浮かせた PC の窓は、キャラの横の範囲に重ならないので数えない)
 */
export function sheetGuard(left = -Infinity, right = Infinity, rects = [...open].map((s) => s.root.getBoundingClientRect())) {
  let bottom = 0;
  for (const r of rects) {
    if (!(r.width > 0) || !(r.height > 0) || r.right <= left || r.left >= right) continue;
    bottom = Math.max(bottom, r.bottom);
  }
  return bottom > 0 ? bottom + SHEET_GAP_PX : 0;
}

/**
 * 小窓を作って body の直下に入れる(浮かせる。置き方は style.css の .yc-sheet)。
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
  document.body.append(root);
  // 中身が増えた・減った(一覧が出た・進み具合の行が増えた)時も、キャラを置き直す。画面の大きさが変わったら、窓の高さを決め直す
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => !root.hidden && layoutHook()).observe(root);
  window.addEventListener('resize', () => {
    if (root.hidden) return;
    fitRoom(root);
    layoutHook();
  });
  let opener = null;
  const api = {
    root,
    body,
    isOpen: () => !root.hidden,
    show(from) {
      for (const other of [...open]) if (other !== api) other.hide({ restoreFocus: false });
      opener = from ?? null;
      root.hidden = false;
      open.add(api);
      opener?.setAttribute('aria-expanded', 'true');
      fitRoom(root);
      root.focus({ preventScroll: true });
      layoutHook();
    },
    hide({ restoreFocus = true } = {}) {
      if (root.hidden) return;
      root.hidden = true;
      open.delete(api);
      opener?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) opener?.focus?.({ preventScroll: true });
      onClose();
      layoutHook();
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
