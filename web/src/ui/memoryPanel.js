// 記憶の札(画面の部品)。覚えていることの一覧・1 つずつ消す・全部わすれる・別の端末へ渡す番号・番号を入れる。
// 使い方(S5 が main.js に 1 行で付ける): mountMemoryPanel(document.body) → 返り値の onChatEvent を会話のイベントに渡す。
// 文字は textContent だけで入れる(覚えた言葉に HTML が入っていても、そのまま文字として出す)。
// 札は合鍵を作らない(11-07 CRITsec F8): 開いただけ・全部わすれた後は空の一覧。合鍵は会話のイベント(key)か番号で受け取る。
import { adoptKey, claimCode, clearKey, emptyMemory, forgetAll, forgetItem, loadMemory, pairCode } from './memoryKey.js';

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
  // 出していた番号と、のこり時間の知らせを止める(全部わすれた後に、古い番号や「受け取りました」を残さない。CRITux 19)
  const clearCode = () => {
    clearInterval(timer);
    timer = null;
    codeOut.textContent = '';
  };
  const render = (data) => {
    notice.textContent = data.notice || emptyMemory().notice; // 合鍵が無い時も「7 日で消えます」を出す
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
  // 一覧の世代。全部わすれた・番号で受け取った時に上げ、その前に始めた読み直しの返事では描き直さない
  // (消した直後に、消す前の読み直しが遅れて届いて、古い一覧が戻るのを防ぐ)
  let generation = 0;
  const show = (data) => {
    generation += 1;
    render(data);
  };
  // 読み直し: 合鍵が無ければ聞かずに空、消えていれば合鍵を捨てて空(作り直さない)
  const refresh = async () => {
    const mine = generation;
    const data = await loadMemory();
    if (mine === generation) render(data);
  };
  // 消した直後: 知らせと同じ瞬間に一覧を空にする(新しい合鍵の通信を待たない。S4w8a で測った順の揺れ)
  const showForgotten = (text) => {
    clearCode();
    show(emptyMemory());
    say(text);
  };

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
      const r = await claimCode(codeIn.value, { pass: pass.value }); // 公開では受け取りにも合言葉が要る(札の欄か、会話の合言葉)
      codeIn.value = '';
      show(r);
      say('受け取りました。前の端末の続きから話せます');
    }),
  );
  forgetBtn.addEventListener('click', () =>
    run(async () => {
      await forgetAll(); // この端末の合鍵も捨てる。次に覚える事が出た時に、会話のイベントで新しい合鍵が届く
      showForgotten('全部わすれました');
    }),
  );

  // 開いた時: 合鍵がある時だけ一覧を読む(合鍵は作らない)
  const ready = run(async () => {
    await refresh();
    root.dataset.ready = '1';
  });

  return {
    root,
    ready,
    refresh: () => run(refresh),
    /**
     * 会話のイベントを渡す。覚えた・消したの知らせが来たら、一覧を読み直す。
     * 覚える事が出た最初の回は、サーバーが作った合鍵が key で届くので、持ってから読む(CRITsec F8)。
     * 会話の「わすれて」で消えた時(サーバーの印 via: 'chat')は、出していた番号と「受け取りました」などの古い知らせも消す(CRITux 19)。
     * 印の無い {type:'memory', forgotten:true} は、引き出しを開いた時の読み直し(main.js)なので、番号と知らせはそのまま
     */
    onChatEvent(ev) {
      if (ev?.type !== 'memory') return;
      if (ev.via === 'chat' && Object.hasOwn(ev, 'forgotten')) {
        // サーバーの記録はもう無いので、確かめに行かずに合鍵を捨てる(確かめると 404 が console に赤く出た)。新しい合鍵も作らない
        clearKey();
        showForgotten(ev.forgotten ? '全部わすれました' : '');
        return;
      }
      adoptKey(ev.key);
      run(refresh);
    },
    /** 合鍵を確かめて(消えていれば捨てて空に。作り直さない)、一覧を読み直す。番号と知らせはそのまま(引き出しを開いた時など) */
    resync: () => run(refresh),
  };
}
