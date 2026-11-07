// 画面のキーボードが入力窓を隠さないようにする(11/7 本人の iPhone: 「文字の入力をしようとすると、キーボードで入力窓が隠れて、全然使えなかった」)。
// iOS の Safari は、キーボードが出ても「ページの高さ(layout viewport)」を変えず、見える範囲(visual viewport)だけを縮める。
// すると、下に貼り付けた帯(position: fixed; bottom: 0)はキーボードの下に残る。ここで、見える範囲の下端とページの下端の差を測り、
// CSS の変数にして、下に貼り付いた物(style.css の translate)をその分だけ持ち上げる。
//   --kb  : ページの下端から、見える範囲の下端までの差(px)。キーボードが無ければ 0
//   --kbt : 見える範囲の上端のずれ(px。iOS が入力欄を見せようとページごとずらした分)
//   --vvh : 見える範囲の高さ(px)
// 見える高さが低い間は、html に kb-tight(640px 未満)・kb-short(400px 未満)も付ける(style.css が、字幕を 1 行にし、余分な札を隠す)
// キーボードが出ている間だけ html に kb-open が付く。PC・テレビ・VR・Chrome の Android(キーボードで画面ごと縮む)では差が 0 で、何も変わらない。
const MIN_KB = 80; // これより小さい差は、アドレスバーの出入りとみなして、キーボードとは数えない
const TIGHT_VVH = 640; // 見える高さがこれ未満(px)なら kb-tight(縦持ちの iPhone 全般)
const SHORT_VVH = 400; // 見える高さがこれ未満(px)なら kb-short(横向きの iPhone・高さの低い縦持ちのキーボード。上の段が見える範囲の半分を占めて、キャラが入力欄の下に隠れた)
const SETTLE_MS = [60, 250, 600]; // iOS はキーボードのアニメーションの後に見える範囲を確定するので、あとから測り直す

/** 文字を打つ欄か */
export function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color', 'image', 'hidden'].includes((el.type || 'text').toLowerCase());
}

/** 見える範囲(visualViewport)から、キーボードの高さ・ずれ・見える高さを出す。純粋な計算(試験用に外へ出す) */
export function measureInset(inner, vv) {
  if (!vv || !(vv.height > 0)) return { kb: 0, top: 0, height: inner };
  const top = Math.max(0, Math.round(vv.offsetTop || 0));
  const kb = Math.max(0, Math.round(inner - vv.height - top));
  return { kb: kb >= MIN_KB ? kb : 0, top: kb >= MIN_KB ? top : 0, height: Math.round(vv.height) };
}

/**
 * @param {Document} [doc]
 * @param {Window} [win]
 * @returns {() => void} 外す関数
 */
export function installKeyboardInset(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win) return () => {};
  const root = doc.documentElement;
  const vv = win.visualViewport;
  let last = '';
  let timers = [];

  const apply = () => {
    const m = measureInset(win.innerHeight, vv);
    const key = `${m.kb}|${m.top}|${m.height}`;
    if (key === last) return;
    last = key;
    root.style.setProperty('--kb', `${m.kb}px`);
    root.style.setProperty('--kbt', `${m.top}px`);
    root.style.setProperty('--vvh', `${m.height}px`);
    root.classList.toggle('kb-open', m.kb > 0);
    root.classList.toggle('kb-tight', m.kb > 0 && m.height < TIGHT_VVH); // 縦持ちのキーボード: 字幕は入力欄の上の 1 行・余分な札を隠す
    root.classList.toggle('kb-short', m.kb > 0 && m.height < SHORT_VVH); // 横向きのキーボード: さらに上の段も隠す
    win.dispatchEvent(new Event('yc-kb')); // main.js が下の帯の高さを測り直す
  };
  const keepFocusVisible = () => {
    const a = doc.activeElement;
    if (!isEditable(a)) return;
    try { a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* 古い WebKit は何もしない */ }
  };
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const onFocusIn = (e) => {
    if (!isEditable(e.target)) return;
    clear();
    apply();
    timers = SETTLE_MS.map((ms) => setTimeout(() => { apply(); keepFocusVisible(); }, ms));
  };
  const onFocusOut = (e) => {
    if (!isEditable(e?.target)) return; // ボタンなどのフォーカスが外れただけの時は何もしない(キーボードが無い間は何も変えない)
    clear();
    timers = SETTLE_MS.map((ms) => setTimeout(() => {
      apply();
      // キーボードが閉じた後に、iOS がページを上にずらしたまま残すことがある。戻す
      if (!isEditable(doc.activeElement) && win.scrollY !== 0) win.scrollTo(0, 0);
    }, ms));
  };

  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  win.addEventListener('resize', apply);
  win.addEventListener('orientationchange', apply);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  apply();
  return () => {
    clear();
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    win.removeEventListener('resize', apply);
    win.removeEventListener('orientationchange', apply);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
  };
}
