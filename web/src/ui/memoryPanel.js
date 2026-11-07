// 記憶の札(画面の部品)。覚えていることの一覧・1 つずつ消す・全部わすれる・別の端末へ渡す番号(と QR)・番号を入れる。
// 使い方(S5 が main.js に 1 行で付ける): mountMemoryPanel(document.body) → 返り値の onChatEvent を会話のイベントに渡す。
// 文字は textContent だけで入れる(覚えた言葉に HTML が入っていても、そのまま文字として出す)。
// 札は合鍵を作らない(11-07 CRITsec F8): 開いただけ・全部わすれた後は空の一覧。合鍵は会話のイベント(key)か番号で受け取る。
// QR(本人の案 11/7 18:0x「一回パソコンで立ち上げれば、QR を読んでスマホでも進められるように」): 番号の横に、この画面の場所と
// '#pair=' + 番号だけの QR を出す(決まりは conversation/pairLink.js、絵は S5 の stage/qrCode.js)。QR で開いた端末は、
// この部品を読んだすぐ後にアドレスの欄から # を消し、札を付けた時に「パソコンの つづきを はじめる?」と 1 回だけ聞く。
import { adoptKey, claimCode, clearKey, emptyMemory, forgetAll, forgetItem, loadMemory, pairCode } from './memoryKey.js';
import { setDemoPass } from '../conversation/demoPass.js';
import { PAIR_TEXT, isLoopbackLink, pageLook, pairErrorText, pairLinkUrl, takePairFromLocation } from '../conversation/pairLink.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};
/** 見た目を、この部品の中だけで付ける(style.css は S5 の物。偽の DOM の試験では style が無いので何もしない) */
const css = (n, s) => (n?.style ? Object.assign(n.style, s) : null);
/** hidden と display を一緒に替える(display を書いた物は、hidden だけでは隠れない) */
const shown = (n, on, display = 'block') => {
  n.hidden = !on;
  css(n, { display: on ? display : 'none' });
};

const KIND_LABEL = { name: '名前', like: '好きなもの', topic: '前の話', note: 'メモ' };
const HAS_HEAD = /^[^\s:：]{1,10}(?::\s|：)/u; // 「名前: タロウ」「名前：タロウ」のように、見出しがもう付いている文(「12:30」は見出しではない)

/** QR の 1 マスの大きさ(CSS の px)。版 4(33 マス)に縁 4 マスずつで 164px。端末の画素の細かさに合わせて描く */
const QR_MODULE_PX = 4;
const QR_MARGIN = 4;

// QR で開いた時の番号(#pair=)。この部品を読んだすぐ後(main.js がキャラを読み始める前)にアドレスの欄から消し、札を付けた時に 1 回だけ聞く
let linkedPair = takePairFromLocation();

/** QR で開いた時の番号を 1 回だけ渡す({ code } か { code: '', bad: true }。2 回目からと、QR で開いていない時は null) */
export function takeLinkedPair() {
  const v = linkedPair;
  linkedPair = null;
  return v;
}

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
 * QR の絵(canvas に白い地と 4 マスの縁・暗いマスを描く。外の画像・通信は使わない)。描けない時(試験の偽の DOM など)は null
 * @param {number[][]} matrix S5 の encodeQr の matrix(1 = 暗い)
 */
function qrCanvas(matrix) {
  const canvas = el('canvas', { className: 'mem-qr-pic', role: 'img', ariaLabel: PAIR_TEXT.qrLabel });
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  const n = matrix.length + QR_MARGIN * 2;
  const dpr = Math.min(3, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
  const px = Math.max(1, Math.round(QR_MODULE_PX * dpr));
  canvas.width = n * px;
  canvas.height = n * px;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, n * px, n * px);
  ctx.fillStyle = '#000';
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect((c + QR_MARGIN) * px, (r + QR_MARGIN) * px, px, px);
    }),
  );
  css(canvas, { width: `${n * QR_MODULE_PX}px`, height: `${n * QR_MODULE_PX}px`, imageRendering: 'pixelated', display: 'block', borderRadius: '6px', flex: '0 0 auto', background: '#fff' });
  canvas.dataset.modules = String(matrix.length);
  canvas.dataset.margin = String(QR_MARGIN);
  return canvas;
}

/**
 * @param {HTMLElement} parent
 * @param {object} [o]
 * @param {boolean} [o.askPass] 合言葉の入力欄を出すか(公開の URL のとき)
 * @param {{code: string, bad?: boolean}|null} [o.linked] QR で開いた時の番号(既定: この部品を読んだ時にアドレスから取った物)
 * @param {() => Promise<{encodeQr: Function}>} [o.loadQr] QR の部品(S5 の stage/qrCode.js。番号を初めて出した時に読む)
 * @param {HTMLElement|null} [o.dialogHost] 確かめの窓を付ける所(既定: document.body)
 */
export function mountMemoryPanel(parent, { askPass = false, linked = takeLinkedPair(), loadQr = () => import('../stage/qrCode.js'), dialogHost = globalThis.document?.body ?? null } = {}) {
  const status = el('p', { className: 'mem-status', role: 'status' });
  const notice = el('p', { className: 'mem-notice' });
  const list = el('ul', { className: 'mem-list' });
  const codeOut = el('output', { className: 'mem-code', ariaLive: 'polite' });
  const pass = el('input', { type: 'password', placeholder: '合言葉', autocomplete: 'off', className: 'mem-pass', hidden: !askPass });
  const pairBtn = el('button', { type: 'button', className: 'mem-pair', textContent: '別の端末で続ける(番号を出す)' });
  const qrBox = el('div', { className: 'mem-qr', hidden: true });
  const codeIn = el('input', { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]{6}', placeholder: '6 けたの番号', className: 'mem-code-in', autocomplete: 'one-time-code' });
  const claimBtn = el('button', { type: 'button', className: 'mem-claim', textContent: '番号で受け取る' });
  const forgetBtn = el('button', { type: 'button', className: 'mem-forget', textContent: '全部わすれる' });
  css(qrBox, { display: 'none', flexWrap: 'wrap', alignItems: 'center', gap: '10px' });
  const root = el(
    'section',
    { className: 'memory-panel', ariaLabel: '覚えていること' },
    el('h2', { textContent: '覚えていること' }),
    notice,
    list,
    el('div', { className: 'mem-row' }, pass, pairBtn, codeOut),
    qrBox,
    el('div', { className: 'mem-row' }, codeIn, claimBtn),
    forgetBtn,
    status,
  );
  root.dataset.ready = '0';
  parent.append(root);
  let timer = null;

  const say = (t) => (status.textContent = t);
  // QR は番号と同じ時に出し、同じ時に消す(番号が切れた・全部わすれた・出し直した)。作っている間に消えたら出さない
  let qrTurn = 0;
  const hideQr = () => {
    qrTurn += 1;
    qrBox.replaceChildren();
    delete qrBox.dataset.qrText;
    shown(qrBox, false);
  };
  const showQr = async (code) => {
    const turn = ++qrTurn;
    const loc = globalThis.location;
    const text = pairLinkUrl(loc, code, pageLook(loc)); // この画面の場所 + '#pair=' + 番号だけ(害の無い ?character= と ?look= はそのまま)
    if (!text) return hideQr();
    const lib = await loadQr().catch(() => null);
    if (turn !== qrTurn) return;
    const qr = lib?.encodeQr?.(text) ?? null;
    const pic = qr ? qrCanvas(qr.matrix) : null;
    if (!pic) return hideQr(); // 描けない時は、番号だけ(今までどおり)
    const how = el('div', { className: 'mem-qr-how' }, el('p', { textContent: PAIR_TEXT.qrHow }));
    if (isLoopbackLink(loc)) how.append(el('p', { className: 'mem-qr-local', textContent: PAIR_TEXT.qrLoopback }));
    css(how, { flex: '1 1 140px', minWidth: '0', fontSize: '12px', lineHeight: '1.5', color: 'var(--muted)' });
    for (const p of how.children ?? []) css(p, { margin: '0' });
    qrBox.replaceChildren(pic, how);
    qrBox.dataset.qrText = text; // QR に入れた文(確かめの道具が読む。番号は画面にも出ている)
    shown(qrBox, true, 'flex');
    qrBox.scrollIntoView?.({ block: 'nearest' }); // 引き出しの中で、QR が下に隠れないように
    return true;
  };
  // 出していた番号と QR と、のこり時間の知らせを止める(全部わすれた後に、古い番号や「受け取りました」を残さない。CRITux 19)
  const clearCode = () => {
    clearInterval(timer);
    timer = null;
    codeOut.textContent = '';
    hideQr();
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
  // 番号で受け取る(打った時も、QR で開いた時の確かめの「はじめる」も、この 1 つ)
  const claimWith = async (code, passValue = pass.value) => {
    const r = await claimCode(code, { pass: passValue }); // 公開では受け取りにも合言葉が要る(札の欄か、会話の合言葉)
    show(r);
    say('受け取りました。前の端末の続きから話せます');
    return r;
  };

  pairBtn.addEventListener('click', () =>
    run(async () => {
      const r = await pairCode({ pass: pass.value });
      codeOut.textContent = r.code;
      clearInterval(timer);
      const end = Date.parse(r.expiresAt);
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const how = qrBox.hidden ? 'この番号を入れてね' : 'この番号を入れるか、QR を読み取ってね'; // QR を描けない端末では、番号だけ
        say(left ? `別の端末で、${how}(のこり ${Math.floor(left / 60)} 分 ${left % 60} 秒・1 回だけ使えます)` : '番号の時間が切れました。もう一度出してね');
        if (!left) {
          codeOut.textContent = '';
          hideQr();
          clearInterval(timer);
        }
      };
      tick();
      const mine = setInterval(tick, 1000);
      timer = mine;
      // QR は番号のすぐ後に出す(部品は初めての時だけ読む)。出たら、知らせも「QR を読み取ってね」にする(その間に消した・出し直した時は何もしない)
      void showQr(r.code).then((ok) => {
        if (ok && timer === mine) tick();
      });
    }),
  );
  claimBtn.addEventListener('click', () =>
    run(async () => {
      await claimWith(codeIn.value);
      codeIn.value = '';
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

  const ask = askLinked(linked, { host: dialogHost, claimWith, panelPass: pass, say });

  return {
    root,
    ready,
    /** QR で開いた時の確かめの窓(開いていなければ null) */
    ask,
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

/**
 * QR で開いた時の確かめ(子どもにも分かる 1 つの窓と、大きなボタン 2 つ)。「はじめる」で、番号を打った時と同じ受け取りをする。
 * 番号が違う・切れた・使った(400)と、間違いが続いた(429)は、言葉を出して「とじる」だけにする。公開の URL で合言葉が要る(403)時は、
 * 窓の中に合言葉の欄を出す(合った時だけ、会話の合言葉にも入れる)。番号は URL にも保存にも残さない(この窓の間だけ持つ)。
 * @param {{code: string, bad?: boolean}|null} linked
 * @param {{host: HTMLElement|null, claimWith: (code: string, pass?: string) => Promise<any>, panelPass: HTMLInputElement, say: (t: string) => void}} o
 * @returns {HTMLElement|null} 窓(dialog)
 */
function askLinked(linked, { host, claimWith, panelPass, say }) {
  if (!linked || !host || typeof document === 'undefined') return null;
  const dlg = el('dialog', { className: 'mem-pair-ask', ariaLabel: PAIR_TEXT.ask });
  const title = el('p', { className: 'mem-pair-title', textContent: PAIR_TEXT.ask });
  const lead = el('p', { className: 'mem-pair-lead', textContent: PAIR_TEXT.lead });
  const passIn = el('input', { type: 'password', placeholder: PAIR_TEXT.passLabel, ariaLabel: PAIR_TEXT.passLabel, autocomplete: 'off', className: 'mem-pair-pass' });
  const msg = el('p', { className: 'mem-pair-msg', role: 'status' });
  const yes = el('button', { type: 'button', className: 'mem-pair-yes', textContent: PAIR_TEXT.yes });
  const no = el('button', { type: 'button', className: 'mem-pair-no', textContent: PAIR_TEXT.no });
  const box = el('div', { className: 'mem-pair-box' }, title, lead, passIn, msg, yes, no);
  dlg.append(box);
  // 見た目(style.css は S5 の物なので、この窓の分はここで付ける。幅 390 でも PC でも、ボタンは横いっぱい・高さ 64px)
  css(dlg, { width: 'min(92vw, 440px)', maxWidth: '92vw', padding: '0', border: '1px solid var(--line, #444)', borderRadius: '22px', background: 'var(--ink-2, #1d1a2e)', color: 'var(--text, #f4f1fb)', boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' });
  css(box, { display: 'grid', gap: '14px', padding: '24px 20px', fontFamily: 'var(--font, system-ui)', textAlign: 'center' });
  css(title, { margin: '0', fontSize: '26px', fontWeight: '800', lineHeight: '1.35' });
  css(lead, { margin: '0', fontSize: '17px', lineHeight: '1.6', color: 'var(--muted, #b2abc9)' });
  css(msg, { margin: '0', fontSize: '18px', lineHeight: '1.6', fontWeight: '700' });
  css(passIn, { font: 'inherit', fontSize: '18px', minHeight: '56px', padding: '8px 14px', borderRadius: '14px', border: '1px solid var(--line, #444)', background: 'rgba(255, 255, 255, 0.08)', color: 'inherit', width: '100%', boxSizing: 'border-box' });
  const bigButton = (b, primary) =>
    css(b, {
      font: 'inherit', fontSize: '22px', fontWeight: '800', width: '100%', minHeight: '64px', padding: '10px 16px', borderRadius: '18px', cursor: 'pointer',
      border: primary ? '0' : '2px solid var(--line, #555)', background: primary ? 'var(--mint, #7be0c3)' : 'rgba(255, 255, 255, 0.08)', color: primary ? 'var(--ink, #14121f)' : 'inherit',
    });
  bigButton(yes, true);
  bigButton(no, false);
  shown(passIn, false);
  shown(msg, false);

  const setMsg = (text) => {
    msg.textContent = text;
    shown(msg, Boolean(text));
  };
  // もう押しても同じ時: 言葉を出し、「とじる」だけにする
  const end = (text, state) => {
    setMsg(text);
    shown(yes, false);
    shown(passIn, false);
    no.textContent = PAIR_TEXT.close;
    dlg.dataset.state = state;
    no.focus?.();
  };
  const close = () => {
    if (dlg.open && typeof dlg.close === 'function') dlg.close();
    dlg.remove?.();
  };
  dlg.dataset.state = 'ask';
  let busy = false;
  yes.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    yes.disabled = true;
    setMsg(PAIR_TEXT.busy);
    const typed = String(passIn.value ?? '').trim();
    try {
      await claimWith(linked.code, typed || panelPass.value);
      if (typed) {
        setDemoPass(typed); // 合った合言葉は、このタブの会話にも使う(URL には入れない)
        panelPass.value = typed;
      }
      end(PAIR_TEXT.done, 'done');
    } catch (err) {
      say(err.message);
      const e = pairErrorText(err);
      if (e.final) end(e.text, 'gone');
      else {
        setMsg(e.text);
        dlg.dataset.state = e.needPass ? 'pass' : 'retry';
        if (e.needPass) {
          shown(passIn, true);
          passIn.focus?.();
        }
      }
    } finally {
      busy = false;
      yes.disabled = false;
    }
  });
  no.addEventListener('click', close);
  dlg.addEventListener('close', () => dlg.remove?.()); // Escape で閉じた時も外す
  if (linked.bad) end(PAIR_TEXT.gone, 'gone'); // # の番号の形が違う(読み取りの途中で切れた QR など)。通信はしない
  host.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.open = true;
  if (!linked.bad) yes.focus?.();
  return dlg;
}
