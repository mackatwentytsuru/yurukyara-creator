// 接客モードから出る入口(店の端末)。左上の角を 3 秒長押し(輪が満ちる)→ 数字のボタンの窓 → サーバーで番号を確かめる。
// 入力欄は使わない(端末のキーボードを出さない)。間違いはサーバーが数える(5 回違うと 5 分止める)。合えば onExit を呼ぶ。
// 決まり(長押しの数え・番号の入力・一言)は stage/kioskMode.js。文字は textContent だけで入れる。
import { HOLD_MS, createLongPress, createPinPad, exitMessage } from '../stage/kioskMode.js';
import { el } from './sheet.js';

const CLOSE_AFTER_MS = 30_000; // 窓を出したまま放っておいたら閉じる(来場者が触れる所に出しっぱなしにしない)
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

/**
 * @param {object} o
 * @param {()=>void} o.onExit 番号が合った時(接客モードを終える)
 * @param {Document} [o.doc]
 * @param {(pin:string)=>Promise<{status:number, remaining?:number|null, retryAfterS?:number}>} [o.post] 番号をサーバーへ(試験で替えられる)
 * @param {()=>number} [o.now]
 * @param {(cb:FrameRequestCallback)=>number} [o.raf]
 * @param {(id:number)=>void} [o.caf]
 */
export function mountKioskExit({ onExit, doc = document, post = postPin, now = () => performance.now(), raf = (cb) => requestAnimationFrame(cb), caf = (id) => cancelAnimationFrame(id) } = {}) {
  const pad = createPinPad();
  const ring = el('span', { class: 'kx-ring' });
  const zone = el('div', { id: 'kioskExitZone', class: 'kx-zone', role: 'presentation' }, ring);
  const dots = el('div', { class: 'kx-dots', 'aria-hidden': 'true' });
  const msg = el('p', { class: 'kx-msg', role: 'status', 'aria-live': 'polite' });
  const keyButtons = KEYS.map((k) => {
    const label = k === 'back' ? '消す' : k === 'ok' ? 'ひらく' : k;
    return el('button', { type: 'button', class: `kx-key${k === 'ok' ? ' kx-ok' : ''}${k === 'back' ? ' kx-back' : ''}`, 'data-k': k, text: label, 'aria-label': k === 'back' ? '1 つ消す' : k === 'ok' ? '番号を送る' : k });
  });
  const cancel = el('button', { type: 'button', class: 'kx-cancel', text: 'もどる' });
  const dialog = el(
    'div',
    { id: 'kioskExit', class: 'kx', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kioskExitTitle', hidden: true },
    el('div', { class: 'kx-card' }, el('h2', { id: 'kioskExitTitle', text: '接客モードを やめる' }), el('p', { class: 'kx-lead', text: 'ばんごうを いれてね' }), dots, msg, el('div', { class: 'kx-pad' }, keyButtons), cancel),
  );
  doc.body.append(zone, dialog);

  let busy = false;
  let closeTimer = null;
  const drawDots = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(4, pad.value.length) }, (_, i) => el('i', { class: i < pad.value.length ? 'on' : '' })));
    dialog.querySelector('.kx-ok').disabled = !pad.ready || busy;
  };
  const armClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => close(), CLOSE_AFTER_MS);
  };
  function open() {
    pad.clear();
    msg.textContent = '';
    dialog.hidden = false;
    drawDots();
    armClose();
    dialog.querySelector('.kx-key')?.focus({ preventScroll: true });
  }
  function close() {
    clearTimeout(closeTimer);
    pad.clear();
    dialog.hidden = true;
    busy = false;
  }

  async function submit() {
    if (busy || !pad.ready) return;
    busy = true;
    drawDots();
    armClose();
    msg.textContent = 'たしかめているよ…';
    let r;
    try {
      r = await post(pad.value);
    } catch {
      r = { status: 0 };
    }
    busy = false;
    if (r.status === 200) {
      close();
      onExit();
      return;
    }
    pad.clear();
    msg.textContent = exitMessage(r);
    dialog.classList.remove('kx-shake');
    void dialog.offsetWidth; // 揺れをもう一度かける
    dialog.classList.add('kx-shake');
    drawDots();
  }

  dialog.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    armClose();
    if (btn === cancel) return close();
    const k = btn.dataset.k;
    if (k === 'ok') void submit();
    else if (k === 'back') pad.back();
    else if (k && !busy) pad.push(k);
    if (k !== 'ok') msg.textContent = '';
    drawDots();
  });
  doc.addEventListener('keydown', (e) => {
    if (dialog.hidden) return;
    if (/^\d$/.test(e.key)) pad.push(e.key);
    else if (e.key === 'Backspace') pad.back();
    else if (e.key === 'Enter') return void submit();
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    armClose();
    drawDots();
  });

  // 角の長押し: 輪が満ちる(--p)。3 秒続けた時だけ窓が開く。指を離す・外れる・画面が裏に回ると、数え直し
  let frame = 0;
  const press = createLongPress({
    holdMs: HOLD_MS,
    onProgress: (p) => zone.style.setProperty('--p', String(p)),
    onFire: () => {
      caf(frame);
      zone.classList.remove('holding');
      open();
    },
  });
  const loop = () => {
    press.tick(now());
    if (press.active) frame = raf(loop);
  };
  zone.addEventListener('pointerdown', (e) => {
    if (!dialog.hidden) return;
    try {
      zone.setPointerCapture?.(e.pointerId);
    } catch {
      // 取れなくても、離した時の知らせで止まる
    }
    zone.classList.add('holding');
    press.down(now());
    caf(frame);
    frame = raf(loop);
  });
  const release = () => {
    caf(frame);
    zone.classList.remove('holding');
    press.up();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(type, release);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') release();
  });

  return {
    zone,
    dialog,
    open,
    close,
    get isOpen() {
      return !dialog.hidden;
    },
  };
}

/** 番号をサーバーへ送る(サーバーが照合して数える。番号はここに残さない) */
async function postPin(pin) {
  const res = await fetch('/api/kiosk/exit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, remaining: data.remaining ?? null, retryAfterS: data.retryAfterS ?? 0 };
}
