// 接客モードの、PC 側の窓(店の人用)。「もっと」の中の「接客モード」から開く。
//   1. 番号(4〜8 けた)を決める(2 回)。決めるまで QR は出さない(最初から入っている番号は作らない)
//   2. ことば・お店のきまり・放っておく時間を決める
//   3. QR が出る。店の端末のカメラで読むと、その端末が接客モードになる
// 設定はサーバーだけが持つ(書けるのはこの PC の中からだけ)。QR には番号・鍵・記憶の番号は入らない(短い札だけ)。文字は textContent だけで入れる。
import { LANG_MODE_LABELS } from '../conversation/lang.js';
import { IDLE_DEFAULT_S, PIN_MAX, PIN_MIN, checkNewPin } from '../stage/kioskMode.js';
import { createSheet, el } from './sheet.js';

export const KIOSK_WORDS = Object.freeze({
  button: '接客モード',
  lead: 'お店の端末で、キャラが ひとりで 接客できるように します。お客さんに出るのは、キャラ・AI の表示・マイク・文字の欄・質問ボタンだけです。',
  pinTitle: '1. ばんごうを きめる', // 番号を決める前の見出し。決めた後は QR を上に出すので、番号は付けない
  pinTitleHave: 'ばんごう',
  pinLead: `お店の人が 接客モードを やめる ときの ばんごうです(${PIN_MIN}〜${PIN_MAX} けた・数字)。きめるまで QR は 出ません。`,
  pin1: 'ばんごう',
  pin2: 'もういちど',
  pinSet: 'ばんごうを きめる',
  pinChange: 'ばんごうを かえる',
  pinCurrent: 'いまの ばんごう',
  pinHave: (n) => `ばんごうは きまっています(${n} けた)`,
  settingsTitle: 'お店の きまり',
  lang: 'ことば',
  facts: 'お店の きまり・お知らせ(あれば)',
  idle: 'お客さんが さわらなく なってから、画面を 空に するまで',
  save: 'ほぞんして、QR を つくりなおす',
  saved: 'ほぞんしました',
  qrTitle: '店の端末で QR を 読む',
  qrHow: '店の端末の カメラで この QR を 読むと、その端末が 接客モードに なります。QR は 12 じかん つかえます。',
  qrNoOrigin: '店の端末から 開ける https の住所を 設定してね(サーバーの KIOSK_ORIGIN)。設定すると QR が 出ます。',
  qrInsecure: 'この住所は https では ありません。店の端末では マイクが ひらかないことが あります。',
  qrTooLong: '住所が 長くて QR に 入りません。もっと 短い住所に してね。',
  qrFail: 'QR を つくれませんでした。',
  offline: 'この PC の サーバーに つながりません。',
  locked: (min) => `まちがいが つづいたので、${min} ぶん まってね`,
  lockedDevices: (n) => `店の端末が まちがいで とまっています(${n} だい)`,
  lockedAll: '店の端末が まちがいで ぜんぶ とまっています',
  unlock: 'とまっているのを ぜんぶ とく',
  unlocked: 'とめていたのを といたよ',
});

const ERROR_TEXT = Object.freeze({
  'pin-form': `${PIN_MIN}〜${PIN_MAX} けたの 数字で きめてね`,
  'pin-mismatch': '2 回とも おなじ ばんごうを いれてね',
  'pin-current': 'いまの ばんごうが ちがうよ',
  'pin-unset': 'さきに ばんごうを きめてね',
});

const IDLE_CHOICES = Object.freeze([30, 60, 90, 120, 180, 300]);

/** PC の窓の、サーバーとの通信(この PC の中からだけ通る。書く時は x-yc-local を付ける) */
async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-yc-local': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

/** QR を canvas に描く(白い地と 4 マスの縁)。外の画像・SVG の名前空間を使わない */
export function drawQr(canvas, matrix, px = 224) {
  const margin = 4;
  const cells = matrix.length + margin * 2;
  const scale = Math.max(1, Math.floor(px / cells));
  const size = cells * scale;
  canvas.width = size;
  canvas.height = size;
  canvas.style.maxWidth = `${px}px`; // 見える大きさは kiosk.css が窓の高さに合わせて決める
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  matrix.forEach((row, r) => row.forEach((v, c) => v && g.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale)));
}

/**
 * 上の段(.top-row)に「接客モード」のボタンを足し、押すと窓を開く。この PC の中で開いた画面(手元のサーバーが答える)だけ。
 * @param {object} o
 * @param {object} o.app main.js の app(status を読む)
 * @param {boolean} o.local この PC の中で開いた頁か(isLoopbackPage の答え)
 * @param {()=>Promise<{encodeQr: Function}>} [o.loadQr]
 */
export function mountKioskSetup({ app, local, loadQr = () => import('../stage/qrCode.js') } = {}) {
  const row = document.querySelector('.top-row');
  if (!row || !local || document.getElementById('kioskSetupBtn')) return null;
  const btn = el('button', { type: 'button', id: 'kioskSetupBtn', class: 'kiosk-setup-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'ycKiosk', text: KIOSK_WORDS.button });
  row.append(btn);
  const sheet = createSheet({ id: 'ycKiosk', title: KIOSK_WORDS.button });

  const msg = el('p', { class: 'yc-au-msg', id: 'kioskMsg', role: 'status', 'aria-live': 'polite' });
  const lead = el('p', { class: 'yc-au-lead', text: KIOSK_WORDS.lead });
  const body = el('div', { class: 'kq-body' });
  sheet.body.append(body);
  let cur = null;
  let renderSeq = 0;

  const say = (text) => {
    msg.textContent = text;
    msg.hidden = !text;
  };
  const errorText = (r) => {
    if (r.status === 429) return KIOSK_WORDS.locked(Math.max(1, Math.ceil(Number(r.data?.retryAfterS ?? 300) / 60)));
    return ERROR_TEXT[r.data?.error] ?? KIOSK_WORDS.offline;
  };
  const field = (label, input) => el('label', { class: 'yc-field' }, el('span', { text: label }), input);
  const pinInput = (id, label) => field(label, el('input', { id, class: 'kq-pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: String(PIN_MAX), autocomplete: 'off', 'aria-label': label }));

  async function load() {
    const r = await call('/api/kiosk/settings').catch(() => ({ status: 0, data: {} }));
    if (r.status !== 200) {
      cur = null;
      say(r.status === 403 ? 'この PC の中の画面から ひらいてね' : KIOSK_WORDS.offline);
      body.replaceChildren(msg);
      return;
    }
    cur = r.data;
    say('');
    render();
  }

  function pinSection() {
    const have = Boolean(cur.hasPin);
    const nodes = [el('h3', { text: have ? KIOSK_WORDS.pinTitleHave : KIOSK_WORDS.pinTitle })];
    if (have) nodes.push(el('p', { class: 'kq-note', id: 'kioskPinHave', text: KIOSK_WORDS.pinHave(cur.pinLength) }));
    else nodes.push(el('p', { class: 'kq-note', text: KIOSK_WORDS.pinLead }));
    const cu = have ? pinInput('kioskPinCur', KIOSK_WORDS.pinCurrent) : null;
    const p1 = pinInput('kioskPin1', KIOSK_WORDS.pin1);
    const p2 = pinInput('kioskPin2', KIOSK_WORDS.pin2);
    const go = el('button', { type: 'button', class: 'yc-btn yc-btn-main', id: 'kioskPinGo', text: have ? KIOSK_WORDS.pinChange : KIOSK_WORDS.pinSet });
    go.addEventListener('click', async () => {
      const a = p1.querySelector('input').value;
      const b = p2.querySelector('input').value;
      const check = checkNewPin(a, b);
      if (!check.ok) return say(check.reason);
      go.disabled = true;
      const r = await call('/api/kiosk/settings', { method: 'POST', body: { pin: a, pinConfirm: b, ...(have ? { currentPin: cu.querySelector('input').value } : {}) } }).catch(() => ({ status: 0, data: {} }));
      go.disabled = false;
      if (r.status !== 200) return say(errorText(r));
      cur = r.data;
      say(KIOSK_WORDS.saved);
      render();
    });
    nodes.push(...(cu ? [cu] : []), p1, p2, go);
    return nodes;
  }

  function settingsSection() {
    const lang = el('select', { id: 'kioskLang', class: 'yc-select' }, Object.entries(LANG_MODE_LABELS).map(([v, label]) => el('option', { value: v, text: label })));
    lang.value = cur.lang === 'multi' ? 'multi' : 'ja';
    const facts = el('textarea', { id: 'kioskFacts', class: 'yc-select kq-facts', rows: '3', maxlength: '2000', 'aria-label': KIOSK_WORDS.facts });
    facts.value = cur.facts ?? '';
    const idleNow = Number(cur.idleSec) || IDLE_DEFAULT_S;
    const idle = el('select', { id: 'kioskIdle', class: 'yc-select' }, [...new Set([...IDLE_CHOICES, idleNow])].sort((a, b) => a - b).map((s) => el('option', { value: String(s), text: s >= 60 && s % 60 === 0 ? `${s / 60} ふん` : `${s} びょう` })));
    idle.value = String(idleNow);
    const save = el('button', { type: 'button', class: 'yc-btn yc-btn-main', id: 'kioskSave', text: KIOSK_WORDS.save });
    save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await call('/api/kiosk/settings', { method: 'POST', body: { lang: lang.value, facts: facts.value, idleSec: Number(idle.value) } }).catch(() => ({ status: 0, data: {} }));
      save.disabled = false;
      if (r.status !== 200) return say(errorText(r));
      cur = r.data;
      say(KIOSK_WORDS.saved);
      void renderQr();
    });
    return [el('h3', { text: KIOSK_WORDS.settingsTitle }), field(KIOSK_WORDS.lang, lang), field(KIOSK_WORDS.facts, facts), field(KIOSK_WORDS.idle, idle), save];
  }

  const qrBox = el('div', { class: 'kq-qr', id: 'kioskQrBox' });

  async function renderQr() {
    const seq = ++renderSeq;
    qrBox.replaceChildren(el('p', { class: 'kq-note', text: 'QR を つくっています…' }));
    delete qrBox.dataset.url;
    if (!cur?.originSet) {
      qrBox.replaceChildren(el('p', { class: 'yc-au-msg', id: 'kioskQrNote', text: KIOSK_WORDS.qrNoOrigin }));
      return;
    }
    const r = await call(`/api/kiosk/qr${app?.character?.id ? `?character=${encodeURIComponent(app.character.id)}` : ''}`).catch(() => ({ status: 0, data: {} }));
    if (seq !== renderSeq) return;
    if (!r.data?.ok) {
      qrBox.replaceChildren(el('p', { class: 'yc-au-msg', id: 'kioskQrNote', text: r.data?.reason === 'too-long' ? KIOSK_WORDS.qrTooLong : r.data?.reason === 'origin' ? KIOSK_WORDS.qrNoOrigin : KIOSK_WORDS.qrFail }));
      return;
    }
    const lib = await loadQr().catch(() => null);
    if (seq !== renderSeq) return;
    const qr = lib?.encodeQr(r.data.url) ?? null;
    if (!qr) {
      qrBox.replaceChildren(el('p', { class: 'yc-au-msg', id: 'kioskQrNote', text: KIOSK_WORDS.qrTooLong }));
      return;
    }
    const canvas = el('canvas', { id: 'kioskQrCanvas', class: 'kq-canvas', role: 'img', 'aria-label': '接客モードの QR コード' });
    drawQr(canvas, qr.matrix);
    qrBox.dataset.url = r.data.url; // QR に入れた文(確かめの道具が読む。画面に出す URL と同じ)
    qrBox.replaceChildren(canvas, el('p', { class: 'kq-note', text: KIOSK_WORDS.qrHow }), ...(r.data.secure ? [] : [el('p', { class: 'yc-au-msg', text: KIOSK_WORDS.qrInsecure })]), el('p', { class: 'kq-url', id: 'kioskQrUrl', text: r.data.url }));
  }

  /** 店の端末が間違いで止まっている時だけ出る、止まりを解く所(店の PC のこの窓からだけ。サーバーが PC 自身かを確かめる) */
  function lockSection() {
    if (!cur?.lockedDevices && !cur?.globalLocked) return [];
    const go = el('button', { type: 'button', class: 'yc-btn yc-btn-small', id: 'kioskUnlock', text: KIOSK_WORDS.unlock });
    go.addEventListener('click', async () => {
      go.disabled = true;
      const r = await call('/api/kiosk/unlock', { method: 'POST', body: {} }).catch(() => ({ status: 0, data: {} }));
      go.disabled = false;
      if (r.status !== 200) return say(errorText(r));
      cur = { ...cur, lockedDevices: r.data.lockedDevices ?? 0, globalLocked: Boolean(r.data.globalLocked) };
      say(KIOSK_WORDS.unlocked);
      render();
    });
    const note = cur.globalLocked ? KIOSK_WORDS.lockedAll : KIOSK_WORDS.lockedDevices(cur.lockedDevices);
    return [el('div', { class: 'kq-lock', id: 'kioskLockBox' }, el('p', { class: 'yc-au-msg', id: 'kioskLockNote', text: note }), go)];
  }

  /** 番号を決めた後は、QR を窓の一番上に置く(スクロールしないで見えるように。窓の高さ 720〜800 でも)。番号・お店のきまりは、その下 */
  function render() {
    if (!cur) return;
    body.replaceChildren(
      ...(cur.hasPin
        ? [...lockSection(), el('h3', { text: KIOSK_WORDS.qrTitle }), qrBox, msg, lead, ...pinSection(), ...settingsSection()]
        : [lead, msg, ...pinSection()]),
    );
    if (cur.hasPin) void renderQr();
  }

  btn.addEventListener('click', () => {
    if (sheet.isOpen()) return sheet.hide();
    sheet.show(btn);
    void load();
  });
  return { sheet, button: btn, reload: load };
}
