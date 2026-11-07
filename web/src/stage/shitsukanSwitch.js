// 上の段の「しつかん」の切り替え(見た目の 3D・2D の となり)。押すとすぐ替わる。選んだ物は、このブラウザで覚える(main.js の B5M の塊)。
//  - 幅の広い画面(style.css の 1100px 以上): 「しつかん」と 4 つのボタンを並べる
//  - せまい画面(スマホ・タブレット): 「しつかん」のボタン 1 つ。押すと 4 つの札が開く(選ぶと閉じる。外を押す・Esc でも閉じる)
// 言葉と並びは shitsukan.js の SHITSUKAN。毛は、スマホと弱い端末では 2 行目を「おもいよ」にする
import { SHITSUKAN, labelOf, subOf } from './shitsukan.js';

/**
 * @param {{ root: HTMLElement, heavyNote?: boolean, onPick: (id: string) => void, onToggle?: (open: boolean) => void }} o
 * 戻り値: set(id)(押された方を合わせる)・show(on)・close()・isOpen()・openRect()(開いた札の箱。閉じていれば null)
 */
export function mountShitsukanSwitch({ root, heavyNote = false, onPick, onToggle = null }) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  const open = doc.createElement('button');
  open.type = 'button';
  open.className = 'sk-open';
  open.id = 'shitsukanOpen';
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', 'shitsukanList');
  open.title = '3D の さわった かんじ(しつかん)を えらぶ';
  open.textContent = 'しつかん';
  const list = doc.createElement('div');
  list.className = 'sk-list';
  list.id = 'shitsukanList';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'しつかん(3D の さわった かんじ)');
  const title = doc.createElement('span');
  title.className = 'sk-title';
  title.setAttribute('aria-hidden', 'true');
  title.textContent = 'しつかん';
  list.append(title);
  const buttons = SHITSUKAN.map((s) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.shitsukan = s.id;
    b.setAttribute('aria-pressed', 'false');
    const sub = subOf(s.id, { heavyNote });
    b.title = `${s.label}(${sub})`;
    b.setAttribute('aria-label', `しつかん: ${s.label}(${sub})`);
    const main = doc.createElement('span');
    main.className = 'sk-main';
    main.textContent = s.label;
    const small = doc.createElement('small');
    small.className = 'sk-sub';
    small.textContent = sub;
    b.append(main, small);
    list.append(b);
    return b;
  });
  root.append(open, list);

  let isOpenNow = false;
  /** 開いた札が画面の横の端からはみ出す時は、端から 8px の所まで横へずらす(ボタンが行の左に回った時など) */
  const keepInside = () => {
    list.style.translate = '';
    if (!isOpenNow) return;
    const r = list.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth || r.right;
    const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
    if (dx) list.style.translate = `${Math.round(dx)}px 0`;
  };
  const setOpen = (on) => {
    if (isOpenNow === on) return;
    isOpenNow = on;
    root.classList.toggle('open', on);
    open.setAttribute('aria-expanded', String(on));
    keepInside();
    onToggle?.(on);
  };
  open.addEventListener('click', () => setOpen(!isOpenNow));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-shitsukan]');
    if (!b || b.disabled) return;
    onPick(b.dataset.shitsukan);
    setOpen(false);
  });
  // 外を押す・Esc で閉じる(札を開いたままにしない。SIM1: 閉じる道の無い箱が下のボタンを覆った)
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (isOpenNow && !root.contains(e.target)) setOpen(false);
    },
    true,
  );
  doc.addEventListener('keydown', (e) => {
    if (isOpenNow && e.key === 'Escape') {
      setOpen(false);
      open.focus({ preventScroll: true });
    }
  });

  return {
    set(id) {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.shitsukan === id));
      open.setAttribute('aria-label', `しつかん(いまは ${labelOf(id) || 'いつもの'})`);
      root.dataset.now = id;
    },
    show(on) {
      if (!on) setOpen(false);
      root.hidden = !on;
    },
    close: () => setOpen(false),
    isOpen: () => isOpenNow,
    /** 開いた札の箱(せまい画面で、ボタンの下に出ている時だけ)。キャラを札の下へ置き直すのに使う */
    openRect() {
      if (!isOpenNow || root.hidden) return null;
      const r = list.getBoundingClientRect();
      return r.height > 0 && getComputedStyle(list).position !== 'static' ? r : null;
    },
  };
}
