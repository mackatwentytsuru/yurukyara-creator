// 「本物の Claude で話すには」の案内。仮の頭脳で話している間だけ、字幕の列(#brainGuide)に小さなリンクを出し、
// 押すと短い手順(鍵を作る・起こす命令・鍵はファイルに保存しない)をその場にたたんで開く。
// - 字幕の列の中(AI の表示の上)に出すので、AI の表示には重ならない。閉じるのは、もう一度押す・Escape
// - 文字は textContent だけで入れる。外のページは新しいタブ(noopener)
// - 鍵はここでは扱わない(入れ方の説明だけ)
import { KEY_LINKS, START_COMMANDS } from './keyLinks.js';

export const GUIDE_BUTTON_LABEL = '本物の Claude で話すには';
export const GUIDE_KEY_LINK_LABEL = 'Claude の鍵を作る(公式ページ・新しいタブで開きます)';
export const GUIDE_SAFE_LINE = '鍵はファイルに保存されません。この画面にも書きません。';

/**
 * 案内のリンクを出すか。仮の頭脳('mock')で、理由つきの知らせ(上限・合言葉・答えられなかった、など)が無い時だけ = 鍵が入っていない時。
 * 本物の頭脳('haiku')や、まだ分からない間は出さない
 */
export function shouldShowGuide(brain, noticeText) {
  return brain === 'mock' && noticeText === null;
}

function el(doc, tag, props = {}, ...kids) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') e.className = v;
    else if (k === 'textContent') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter(Boolean));
  return e;
}

function commandRow(doc, label, command) {
  return el(doc, 'div', { className: 'bg-cmd' }, el(doc, 'span', { className: 'bg-cmd-label', textContent: label }), el(doc, 'code', { textContent: command }));
}

/**
 * @param {{root: HTMLElement, doc?: Document}} o root は #brainGuide(最初は hidden)
 * @returns {{show(visible: boolean): void, toggle(open?: boolean): void, readonly isOpen: boolean}}
 */
export function mountBrainGuide({ root, doc = root.ownerDocument }) {
  const button = el(doc, 'button', { type: 'button', className: 'brain-guide-btn', 'aria-expanded': 'false', 'aria-controls': 'brainGuidePanel', textContent: GUIDE_BUTTON_LABEL });
  const keyLink = el(doc, 'a', { className: 'bg-link', href: KEY_LINKS.claudeKeys, target: '_blank', rel: 'noopener noreferrer', textContent: GUIDE_KEY_LINK_LABEL });
  const panel = el(
    doc,
    'div',
    { id: 'brainGuidePanel', className: 'brain-guide-panel', role: 'region', 'aria-label': GUIDE_BUTTON_LABEL, hidden: '' },
    el(doc, 'p', { className: 'bg-step' }, el(doc, 'b', { textContent: '1. ' }), keyLink),
    el(doc, 'p', { className: 'bg-step', textContent: '2. 鍵を入れて、アプリを起こし直します(web のフォルダで)。' }),
    commandRow(doc, 'かんたん(鍵を聞かれます。入力は画面に出ません)', START_COMMANDS.easy),
    commandRow(doc, 'Mac / Linux', START_COMMANDS.unix),
    commandRow(doc, 'Windows PowerShell', START_COMMANDS.windows),
    el(doc, 'p', { className: 'bg-safe', textContent: `3. ${GUIDE_SAFE_LINE}` }),
  );
  root.replaceChildren(button, panel);
  let open = false;

  function toggle(next = !open) {
    open = Boolean(next);
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }
  button.addEventListener('click', () => toggle());
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      toggle(false);
      button.focus();
    }
  });

  return {
    /** 仮の頭脳で、理由が「つながっていない」の時だけ true。隠す時は案内も閉じる */
    show(visible) {
      root.hidden = !visible;
      if (!visible) toggle(false);
    },
    toggle,
    get isOpen() {
      return open;
    },
  };
}
