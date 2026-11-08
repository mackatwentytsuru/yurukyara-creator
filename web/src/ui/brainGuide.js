// 「本物の Claude で話すには」の案内の窓。おためしモード(鍵が入っていない)の帯の「本物の Claude にする」を押すと開く。
// 本物の Claude と話す道は 2 つ: ① Claude の鍵を入れる(公式の頁・起こす命令)② 自分の PC の Claude Code につなぐ(鍵は要らない)。
// - 開く窓は、画面いっぱいの板の中の 1 枚の札。閉じるのは「とじる」・板のところを押す・Escape。閉じたら、押したボタンへ戻る
// - 文字は textContent だけで入れる。外のページは新しいタブ(noopener)
// - 鍵はここでは扱わない(入れ方の説明だけ)
import { KEY_LINKS, START_COMMANDS } from './keyLinks.js';

export const GUIDE_TITLE = '本物の Claude で話すには';
export const GUIDE_LEAD = 'いまは おためしモード(決まった台本で話します)です。次の どちらかで、本物の Claude と話せます。';
export const GUIDE_KEY_LINK_LABEL = 'Claude の鍵を作る(公式ページ・新しいタブで開きます)';
export const GUIDE_SAFE_LINE = '鍵はファイルに保存されません。この画面にも書きません。';
export const GUIDE_CLOSE_LABEL = 'とじる';

/**
 * 案内を出すか(= おためしモードの帯を出すか)。仮の頭脳('mock')で、理由つきの知らせ(上限・合言葉・答えられなかった、など)が無い時だけ = 鍵が入っていない時。
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
 * @param {{root: HTMLElement, doc?: Document}} o root は #brainGuide(最初は hidden。画面いっぱいの板)
 * @returns {{open(opener?: HTMLElement): void, close(): void, toggle(): void, readonly isOpen: boolean}}
 */
export function mountBrainGuide({ root, doc = root.ownerDocument }) {
  const keyLink = el(doc, 'a', { className: 'bg-link', href: KEY_LINKS.claudeKeys, target: '_blank', rel: 'noopener noreferrer', textContent: GUIDE_KEY_LINK_LABEL });
  const closeBtn = el(doc, 'button', { type: 'button', className: 'bg-close', textContent: GUIDE_CLOSE_LABEL });
  const card = el(
    doc,
    'div',
    { id: 'brainGuidePanel', className: 'brain-guide-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'brainGuideTitle', tabindex: '-1' },
    el(doc, 'h2', { id: 'brainGuideTitle', className: 'bg-title', textContent: GUIDE_TITLE }),
    el(doc, 'p', { className: 'bg-lead', textContent: GUIDE_LEAD }),
    el(
      doc,
      'section',
      { className: 'bg-way', 'data-way': 'key' },
      el(doc, 'h3', { className: 'bg-way-title', textContent: '1. Claude の鍵を入れる' }),
      el(doc, 'p', { className: 'bg-step' }, keyLink),
      el(doc, 'p', { className: 'bg-step', textContent: '鍵を入れて、アプリを起こし直します(web のフォルダで)。' }),
      commandRow(doc, 'かんたん(鍵を聞かれます。入力は画面に出ません)', START_COMMANDS.easy),
      commandRow(doc, 'Mac / Linux', START_COMMANDS.unix),
      commandRow(doc, 'Windows PowerShell', START_COMMANDS.windows),
      el(doc, 'p', { className: 'bg-safe', textContent: GUIDE_SAFE_LINE }),
    ),
    el(
      doc,
      'section',
      { className: 'bg-way', 'data-way': 'claude-code' },
      el(doc, 'h3', { className: 'bg-way-title', textContent: '2. 自分の Claude Code とつなぐ(鍵は要りません)' }),
      el(doc, 'p', { className: 'bg-step', textContent: 'この PC で Claude Code にログインしておき、web のフォルダで流します。' }),
      commandRow(doc, 'Claude Code とつないで起こす', START_COMMANDS.claudeCode),
    ),
    closeBtn,
  );
  root.replaceChildren(card);
  let open = false;
  let opener = null;

  function close() {
    if (!open) return;
    open = false;
    root.hidden = true;
    const back = opener;
    opener = null;
    back?.setAttribute?.('aria-expanded', 'false');
    back?.focus?.({ preventScroll: true });
  }
  function openGuide(from = null) {
    open = true;
    opener = from;
    root.hidden = false;
    from?.setAttribute?.('aria-expanded', 'true');
    card.scrollTop = 0;
    closeBtn.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close(); // 札の外(板のところ)を押したら閉じる
  });
  doc.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // 開いている間は、札の中だけで Tab をまわす(後ろの画面へ出ない)
      const items = [...card.querySelectorAll('a[href], button')];
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  return {
    open: openGuide,
    close,
    toggle() {
      if (open) close();
      else openGuide();
    },
    get isOpen() {
      return open;
    },
  };
}
