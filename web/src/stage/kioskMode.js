// 接客モード(店の端末)の、画面側の決まり。DOM も通信も持たない小さな部品(node の試験で読む)。
// 店の人が PC の QR を店の端末で読むと、この端末は接客モードになる。来場者に見せるのは、キャラ・AI の表示・マイク・文字の欄・質問のボタン
// (多言語の時は、ことばの選びも)だけ。ほかは出さない・押せない。名前は覚えない。放っておくと空に戻る。出るのは、角の長押しと番号。
// 設定(番号・ことば・お店のきまり・放っておく時間)はサーバーだけが持つ。この端末は、札(QR に入っていた短い文)と、見せてよい設定の控えだけ持つ。

export const KIOSK_CLASS = 'is-kiosk';
export const KIOSK_PARAM = 'kiosk';
export const KIOSK_STORE = 'yc.kiosk.v1';
export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const IDLE_DEFAULT_S = 90;
export const IDLE_MIN_S = 30;
export const IDLE_MAX_S = 600;
export const HOLD_MS = 3000; // 角の長押しの長さ
export const FACTS_CAP = 2000;

/** 札の形(中身 . 署名。どちらも URL に入れてよい文字だけ)。形が合わなくても、接客モードのまま(閉じる側に倒す) */
export const TOKEN_RE = /^[A-Za-z0-9_-]{4,160}\.[A-Za-z0-9_-]{16,32}$/;

/** 来場者に隠す物(名前は本人の言い方。selector は style の kiosk.css が display:none にする所と同じ。試験が食い違いを見る) */
export const HIDDEN = Object.freeze([
  { name: 'かえる', selector: '#changeBtn' },
  { name: 'もっと', selector: '#moreBtn' },
  { name: '歯車(マイクとスピーカー)', selector: '.yc-audio-btn' },
  { name: 'カメラの入切', selector: '#camBtn' },
  { name: 'カメラの入切(テレビ)', selector: '#tvCam' },
  { name: '覚えていること', selector: '#memoryDrawer' },
  { name: 'VR', selector: '#questLink' },
  { name: 'テレビ', selector: '#tvBtn' },
  { name: 'テレビに映す', selector: '#tvCast' },
  { name: '見た目の切り替え', selector: '#lookSwitch' },
  { name: 'しつかん', selector: '#shitsukan' },
  { name: '作る入口', selector: '#modes' },
  { name: '考えの欄', selector: '#thought' },
  { name: '上の段', selector: '.top' },
  { name: 'アップデート', selector: '.yc-update-badge' },
  { name: '店の人の設定の入口', selector: '#kioskSetupBtn' },
  { name: '店の人の設定の窓', selector: '.yc-sheet' },
  { name: 'カメラの知らせ', selector: '#camAsk' },
  { name: '仮の頭脳の知らせ', selector: '#brainNotice' },
  { name: '店のバッジ', selector: '#shopBadge' },
  { name: '注意書き(カメラ・マイクの説明)', selector: '.privacy' },
]);

/** 来場者に見せる物。隠す一覧に入れない・kiosk.css で隠さない(試験が見る) */
export const SHOWN = Object.freeze([
  { name: 'キャラ', selector: '#stage' },
  { name: 'AI の表示', selector: '#aiNotice' },
  { name: 'マイク', selector: '#micBtn' },
  { name: '文字の欄', selector: '#textInput' },
  { name: '質問のボタン', selector: '#choices' },
  { name: '字幕', selector: '#caption' },
  { name: 'ことばの選び(多言語の時だけ中身が出る)', selector: '#hearLangBox' },
]);

/** ?kiosk= を読む。値が何であれ、付いていれば接客モード(壊れた札でも、閉じる側に倒す)。札の形が合う時だけ token が入る */
export function kioskFromSearch(search = '') {
  let p;
  try {
    p = new URLSearchParams(String(search));
  } catch {
    return { present: false, token: '' };
  }
  if (!p.has(KIOSK_PARAM)) return { present: false, token: '' };
  const raw = p.get(KIOSK_PARAM) ?? '';
  return { present: true, token: TOKEN_RE.test(raw) ? raw : '' };
}

/** アドレスから ?kiosk= だけ消した、相対の行き先(読み込み直しても札が URL に残らないように。history.replaceState に渡す) */
export function withoutKioskParam(href = '') {
  // 住所の部品を文字として扱う(origin は要らない。相対の行き先を返す)。http(s)://名前 の頭は落とす
  const rest = String(href).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const hashAt = rest.indexOf('#');
  const hash = hashAt >= 0 ? rest.slice(hashAt) : '';
  const noHash = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
  const qAt = noHash.indexOf('?');
  const path = (qAt >= 0 ? noHash.slice(0, qAt) : noHash) || '/';
  const q = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '');
  q.delete(KIOSK_PARAM);
  const s = q.toString();
  return `${path}${s ? `?${s}` : ''}${hash}`;
}

/** 札の中身を読む(署名は確かめない。確かめるのはサーバー)。読めなければ null。画面は、設定が届くまでの控えにだけ使う(キャラの id) */
export function claimsOf(token) {
  try {
    const body = String(token ?? '').split('.')[0];
    const c = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return c && typeof c === 'object' ? c : null;
  } catch {
    return null;
  }
}

/** この端末が出すキャラの id(設定の物 → 札の物。無ければ ''。?character= が付いていればそちらが先なので、呼ぶ側が決める) */
export function kioskCharacterId({ token = '', cfg = DEFAULT_CONFIG } = {}) {
  const ok = (v) => (typeof v === 'string' && /^[a-z0-9_]{1,32}$/.test(v) ? v : '');
  return ok(cfg?.characterId) || ok(claimsOf(token)?.c);
}

/** 番号の形(4〜8 けた・数字だけ) */
export function isPinForm(v) {
  return typeof v === 'string' && /^\d+$/.test(v) && v.length >= PIN_MIN && v.length <= PIN_MAX;
}

/** 番号を決める時の確かめ。ok でなければ、画面に出す一言(reason)も返す */
export function checkNewPin(pin, confirm) {
  if (!/^\d*$/.test(String(pin ?? ''))) return { ok: false, reason: '数字だけで きめてね' };
  if (!isPinForm(String(pin ?? ''))) return { ok: false, reason: `${PIN_MIN}〜${PIN_MAX} けたで きめてね` };
  if (pin !== confirm) return { ok: false, reason: '2 回とも おなじ ばんごうを いれてね' };
  return { ok: true, reason: '' };
}

/** サーバーが返した設定を、画面が使う形に直す(形の違う値は既定へ) */
export function normalizeKioskConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let idle = Math.round(Number(r.idleSec));
  if (!Number.isFinite(idle)) idle = IDLE_DEFAULT_S;
  idle = Math.min(IDLE_MAX_S, Math.max(IDLE_MIN_S, idle));
  return {
    lang: r.lang === 'multi' ? 'multi' : 'ja',
    facts: typeof r.facts === 'string' ? r.facts.slice(0, FACTS_CAP) : '',
    idleMs: idle * 1000,
    characterId: typeof r.characterId === 'string' && /^[a-z0-9_]{1,32}$/.test(r.characterId) ? r.characterId : '',
  };
}

export const DEFAULT_CONFIG = Object.freeze(normalizeKioskConfig({}));

/** この端末の控え({ token, cfg })を読む。無い・壊れている・使えない時は null */
export function loadKiosk(storage) {
  try {
    const v = JSON.parse(storage?.getItem(KIOSK_STORE) ?? 'null');
    if (!v || v.on !== true) return null;
    return { token: typeof v.token === 'string' && TOKEN_RE.test(v.token) ? v.token : '', cfg: normalizeKioskConfig(v.cfg) };
  } catch {
    return null;
  }
}

/** 控えを書く(使えない端末でも止まらない。書けなければ、その画面の間だけ接客モード) */
export function saveKiosk(storage, { token = '', cfg = DEFAULT_CONFIG } = {}) {
  try {
    storage?.setItem(KIOSK_STORE, JSON.stringify({ on: true, token, cfg: { ...cfg, idleSec: Math.round((cfg.idleMs ?? IDLE_DEFAULT_S * 1000) / 1000) } }));
    return true;
  } catch {
    return false;
  }
}

export function clearKiosk(storage) {
  try {
    storage?.removeItem(KIOSK_STORE);
  } catch {
    // 消せなくても、サーバーの確かめを通った後は、画面を読み直す(ふつうの画面に戻る)
  }
}

/**
 * 接客モードの今の状態を決める。URL に ?kiosk= があれば入る(札は控えに移す)。無くても、控えがあれば接客のまま。
 * @param {{search?:string, storage?:any}} o
 * @returns {{on:boolean, token:string, cfg:object, fromUrl:boolean}}
 */
export function resolveKiosk({ search = '', storage = null } = {}) {
  const url = kioskFromSearch(search);
  const saved = loadKiosk(storage);
  if (url.present) return { on: true, token: url.token || saved?.token || '', cfg: saved?.cfg ?? DEFAULT_CONFIG, fromUrl: true };
  if (saved) return { on: true, token: saved.token, cfg: saved.cfg, fromUrl: false };
  return { on: false, token: '', cfg: DEFAULT_CONFIG, fromUrl: false };
}

/**
 * 角の長押しの数え。down で数え始め、up で止める。tick(now) を呼ぶたびに進み具合(0〜1)を返し、HOLD_MS たったら 1 回だけ onFire。
 * 指を離す・外れる(cancel)と、数え直し。時計は渡せる(試験用)。
 */
export function createLongPress({ holdMs = HOLD_MS, onProgress = () => {}, onFire = () => {} } = {}) {
  let startedAt = null;
  let fired = false;
  const reset = () => {
    startedAt = null;
    fired = false;
    onProgress(0);
  };
  return {
    down(now) {
      startedAt = now;
      fired = false;
      onProgress(0);
    },
    up: reset,
    cancel: reset,
    tick(now) {
      if (startedAt === null || fired) return startedAt === null ? 0 : 1;
      const p = Math.min(1, Math.max(0, (now - startedAt) / holdMs));
      onProgress(p);
      if (p >= 1) {
        fired = true;
        onFire();
      }
      return p;
    },
    get active() {
      return startedAt !== null && !fired;
    },
  };
}

/** 番号の窓の入力(数字を足す・1 つ消す・全部消す)。PIN_MAX けたまで。入力欄を使わない(端末のキーボードを出さない) */
export function createPinPad() {
  let digits = '';
  return {
    push(d) {
      if (/^\d$/.test(String(d)) && digits.length < PIN_MAX) digits += String(d);
      return digits;
    },
    back() {
      digits = digits.slice(0, -1);
      return digits;
    },
    clear() {
      digits = '';
      return digits;
    },
    get value() {
      return digits;
    },
    get ready() {
      return digits.length >= PIN_MIN;
    },
  };
}

/** 抜ける時の知らせ(サーバーの答えから、画面に出す一言) */
export function exitMessage({ status, remaining = null, retryAfterS = 0 } = {}) {
  if (status === 429) {
    const min = Math.max(1, Math.ceil(Number(retryAfterS || 300) / 60));
    return `まちがいが つづいたので、${min} ぶん まってね`;
  }
  if (status === 403) return remaining ? `ばんごうが ちがうよ(あと ${remaining} かい)` : 'ばんごうが ちがうよ';
  if (status === 409) return 'この PC で ばんごうを きめてから つかってね';
  return 'つながらなかったよ。もういちど ためしてね';
}
