// 記憶の札(画面の部品)。覚えていることの一覧・1 つずつ消す・全部わすれる・別の端末へ渡す番号・番号を入れる。
// 使い方(S5 が main.js に 1 行で付ける): mountMemoryPanel(document.body) → 返り値の onChatEvent を会話のイベントに渡す。
// 文字は textContent だけで入れる(覚えた言葉に HTML が入っていても、そのまま文字として出す)。
import { claimCode, ensureKey, forgetAll, forgetItem, listMemory, pairCode } from './memoryKey.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

const KIND_LABEL = { name: '名前', like: '好きなもの', topic: '前の話', note: 'メモ' };
const HAS_HEAD = /^[^\s:：]{1,10}(?::\s|：)/u; // 「名前: タロウ」「名前：タロウ」のように、見出しがもう付いている文(「12:30」は見出しではない)

/**
 * 一覧の 1 行に出す文。覚えた文がもう見出し(「名前: 」「好きなもの: 」「前に話したこと: 」)で始まっていれば、そのまま出す。
 * 見出しの無い文だけ、種類の名前を前に付ける(「名前 名前: タロウ」と 2 回出さない。覚える文の形は変えない)。
 * @param {{kind?:string, text?:string}} it
 */
export function itemLine(it) {
  const text = String(it?.text ?? '').trim();
  const label = KIND_LABEL[it?.kind];
  return !text || !label || HAS_HEAD.test(text) ? text : `${label}: ${text}`;
}

/**
 * @param {HTMLElement} parent
 * @param {object} [o]
 * @param {boolean} [o.askPass] 合言葉の入力欄を出すか(公開の URL のとき)
 */
export function mountMemoryPanel(parent, { askPass = false } = {}) {
  const status = el('p', { className: 'mem-status', role: 'status' });
  const notice = el('p', { className: 'mem-notice' });
  const list = el('ul', { className: 'mem-list' });
  const codeOut = el('output', { className: 'mem-code', ariaLive: 'polite' });
  const pass = el('input', { type: 'password', placeholder: '合言葉', autocomplete: 'off', className: 'mem-pass', hidden: !askPass });
  const pairBtn = el('button', { type: 'button', className: 'mem-pair', textContent: '別の端末で続ける(番号を出す)' });
  const codeIn = el('input', { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]{6}', placeholder: '6 けたの番号', className: 'mem-code-in', autocomplete: 'one-time-code' });
  const claimBtn = el('button', { type: 'button', className: 'mem-claim', textContent: '番号で受け取る' });
  const forgetBtn = el('button', { type: 'button', className: 'mem-forget', textContent: '全部わすれる' });
  const root = el(
    'section',
    { className: 'memory-panel', ariaLabel: '覚えていること' },
    el('h2', { textContent: '覚えていること' }),
    notice,
    list,
    el('div', { className: 'mem-row' }, pass, pairBtn, codeOut),
    el('div', { className: 'mem-row' }, codeIn, claimBtn),
    forgetBtn,
    status,
  );
  root.dataset.ready = '0';
  parent.append(root);
  let timer = null;

  const say = (t) => (status.textContent = t);
  const render = (data) => {
    notice.textContent = data.notice ?? '';
    list.replaceChildren(
      ...(data.items ?? []).map((it) => {
        const x = el('button', { type: 'button', className: 'mem-item-forget', textContent: '消す', ariaLabel: `${it.text} を消す` });
        x.addEventListener('click', () => run(async () => (await forgetItem(it.id), refresh())));
        return el('li', { className: 'mem-item' }, el('span', { textContent: itemLine(it) }), x);
      }),
    );
    if (!data.items?.length) list.append(el('li', { className: 'mem-empty', textContent: 'まだ何も覚えていません' }));
  };
  const run = async (fn) => {
    try {
      await fn();
    } catch (err) {
      say(err.message);
    }
  };
  const refresh = async () => render(await listMemory());

  pairBtn.addEventListener('click', () =>
    run(async () => {
      const r = await pairCode({ pass: pass.value });
      codeOut.textContent = r.code;
      clearInterval(timer);
      const end = Date.parse(r.expiresAt);
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        say(left ? `別の端末で、この番号を入れてね(のこり ${Math.floor(left / 60)} 分 ${left % 60} 秒・1 回だけ使えます)` : '番号の時間が切れました。もう一度出してね');
        if (!left) {
          codeOut.textContent = '';
          clearInterval(timer);
        }
      };
      tick();
      timer = setInterval(tick, 1000);
    }),
  );
  claimBtn.addEventListener('click', () =>
    run(async () => {
      const r = await claimCode(codeIn.value);
      codeIn.value = '';
      render(r);
      say('受け取りました。前の端末の続きから話せます');
    }),
  );
  forgetBtn.addEventListener('click', () =>
    run(async () => {
      await forgetAll();
      render(await ensureKey()); // 新しい空の合鍵で始め直す
      codeOut.textContent = '';
      say('全部わすれました');
    }),
  );

  const ready = run(async () => {
    render(await ensureKey());
    root.dataset.ready = '1';
  });

  return {
    root,
    ready,
    refresh: () => run(refresh),
    /** 会話のイベントを渡す。覚えた・消したの知らせが来たら、一覧を読み直す */
    onChatEvent(ev) {
      if (ev?.type === 'memory') {
        if (ev.forgotten) run(async () => render(await ensureKey()));
        else run(refresh);
      }
    },
  };
}
