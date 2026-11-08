// 接客モード(店の端末)の、サーバー側の決まり。DOM なし・通信なし(ファイルだけ)。
// - 設定(番号・ことば・お店のきまり・放っておく時間)は、サーバーだけが持つ。番号は塩つきの scrypt で logs の中に残し、平文は残さない
// - 札(QR に入れる短い文)= 短い中身 + サーバーの鍵の署名。期限は 12 時間。番号・鍵・記憶の番号は入れない
// - 抜ける時の番号の照合と、間違いの数え(5 回違うと 5 分とめる)もここ。数えるのはサーバーだけ(画面を読み込み直しても数え直せない)
//   数えは端末ごと(札ごと)。来場者の間違いで、店の人の端末まで止まらない。サーバー全体の安全の上限は、ふつうの使い方では届かない高さ
//   PC の窓で「今の番号」を間違えた分は、別に数える(店の端末の出る番号の数えには入らない)。店の PC の窓からは、止まっている分を解ける
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FACTS_MAX } from '../src/conversation/facts.js';
import { normalizeLangMode } from '../src/conversation/lang.js';
import { isSpecId } from '../src/character/urlSpec.js';

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const IDLE_DEFAULT_S = 90;
export const IDLE_MIN_S = 30;
export const IDLE_MAX_S = 600;
export const TOKEN_TTL_S = 12 * 60 * 60;
/** QR に入れてよい文字数(src/stage/qrCode.js の QR_MAX_BYTES と同じ) */
export const QR_LIMIT_BYTES = 213;
export const MAX_WRONG = 5;
export const LOCK_S = 5 * 60;
/** サーバー全体の安全の上限: この時間の中で、全部の端末の間違いがこの数に届いたら、全体を止める(ふつうの使い方では届かない高さ) */
export const GLOBAL_MAX_WRONG = 100;
export const GLOBAL_WINDOW_S = 10 * 60;
export const GLOBAL_LOCK_S = 5 * 60;
/** 数えを持つ端末の数の上限(超えたら、止まっていない古いものから捨てる) */
export const MAX_DEVICES = 256;
const ANON = 'anon';
export const KIOSK_PATH = '/?kiosk=';

const PIN_RE = /^\d{4,8}$/;
export const isPin = (v) => typeof v === 'string' && PIN_RE.test(v);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** 設定の欄を、決まりの形に直す(形の違う値は既定へ) */
export function normalizeSettings(raw = {}) {
  const lang = normalizeLangMode(raw?.lang) ?? 'ja';
  const facts = String(raw?.facts ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, FACTS_MAX);
  let idle = Math.round(Number(raw?.idleSec));
  if (!Number.isFinite(idle)) idle = IDLE_DEFAULT_S;
  idle = Math.min(IDLE_MAX_S, Math.max(IDLE_MIN_S, idle));
  const characterId = isSpecId(raw?.characterId) ? raw.characterId : '';
  return { lang, facts, idleSec: idle, characterId };
}

/**
 * @param {object} o
 * @param {string} o.file 設定のファイル(logs の中。git に入らない)
 * @param {string} [o.secret] 署名の鍵(無ければ、ファイルに作って持つ。どこにも出さない)
 * @param {()=>number} [o.now] 今の時刻(ms)
 */
export function createKiosk({ file, secret = '', now = Date.now } = {}) {
  let state = null;

  const load = () => {
    if (state) return state;
    let saved = {};
    try {
      if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      saved = {}; // 読めないファイルは、設定なしとして扱う(番号を決め直せば直る)
    }
    state = {
      key: typeof saved.key === 'string' && saved.key.length >= 32 ? saved.key : '',
      pin: saved.pin && typeof saved.pin.salt === 'string' && typeof saved.pin.hash === 'string' ? saved.pin : null,
      settings: normalizeSettings(saved.settings),
      wrong: new Map(), // 端末(札)ごとの間違い: key -> { count, lockedUntil, seen }
      wrongAll: { count: 0, since: 0, lockedUntil: 0 }, // サーバー全体の安全の上限
      wrongPc: { count: 0, lockedUntil: 0 }, // PC の窓の「今の番号」の間違い(店の端末の数えとは別)
    };
    if (!state.key) {
      state.key = b64u(randomBytes(32));
      save();
    }
    return state;
  };

  const save = () => {
    const { key, pin, settings } = state;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ key, pin, settings }), { mode: 0o600 });
    renameSync(tmp, file);
  };

  const mac = (payload) => {
    const k = secret ? Buffer.from(String(secret)) : fromB64u(load().key);
    return createHmac('sha256', k).update(payload).digest().subarray(0, 16);
  };

  const hashPin = (pin, salt) => scryptSync(pin, Buffer.from(salt, 'base64url'), 32);

  /** 番号が合うか(時間を一定に比べる) */
  const pinMatches = (pin) => {
    const s = load();
    if (!s.pin || !isPin(pin)) return false;
    const got = hashPin(pin, s.pin.salt);
    const want = fromB64u(s.pin.hash);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  /**
   * 札を確かめる(中身 + 確かめた署名のバイト列 sig)。決まりの綴り(payload.sig、どちらも余りのない base64url)でない札は、署名が合っても通さない。
   * 同じ札に別の綴りがあると、端末ごとの数えをすり抜けられるため
   */
  const checkToken = (token) => {
    const bad = { ok: false, expired: false };
    if (typeof token !== 'string') return bad;
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return bad;
    const got = fromB64u(sig);
    if (b64u(got) !== sig) return bad;
    const body = fromB64u(payload);
    if (b64u(body) !== payload) return bad;
    const want = mac(payload);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return bad;
    let claims;
    try {
      claims = JSON.parse(body.toString('utf8'));
    } catch {
      return bad;
    }
    if (claims?.v !== 1 || !Number.isFinite(claims.e)) return bad;
    if (claims.e * 1000 <= now()) return { ok: false, expired: true, sig: got };
    return { ok: true, claims, sig: got };
  };

  const leftS = (until) => {
    const left = Math.ceil((until - now()) / 1000);
    return left > 0 ? left : 0;
  };

  /** 端末の数えの名前。署名の合った札(期限切れでも)は、確かめた署名のバイト列から作る(綴りの違いで別の端末にならない)。札が無い・壊れている・正しい綴りでない端末は、まとめて 1 つ(anon) */
  const deviceKey = (token) => {
    const v = checkToken(token);
    if (!v.ok && !v.expired) return ANON;
    return `t:${createHash('sha256').update(v.sig).digest('base64url').slice(0, 22)}`;
  };

  /** 数えの箱を取る。多くなりすぎたら、止まっていない古いものから捨てる */
  const deviceBucket = (key) => {
    const s = load();
    let b = s.wrong.get(key);
    if (!b) {
      if (s.wrong.size >= MAX_DEVICES) {
        const idle = [...s.wrong].filter(([, v]) => leftS(v.lockedUntil) === 0).sort((a, c) => a[1].seen - c[1].seen);
        for (const [k] of idle.slice(0, Math.max(1, s.wrong.size - MAX_DEVICES + 1))) s.wrong.delete(k);
      }
      b = { count: 0, lockedUntil: 0, seen: 0 };
      s.wrong.set(key, b);
    }
    b.seen = now();
    return b;
  };

  /** 抜ける番号の間違いを数える入口(端末ごと + サーバー全体の安全の上限)。止めている間は照合せずに断る */
  const tryExit = (pin, token) => {
    const s = load();
    const key = deviceKey(token);
    const b = deviceBucket(key);
    const left = Math.max(leftS(b.lockedUntil), leftS(s.wrongAll.lockedUntil));
    if (left > 0) return { ok: false, status: 429, retryAfterS: left, locked: true };
    if (!s.pin) return { ok: false, status: 409, error: 'pin-unset' };
    if (pinMatches(pin)) {
      s.wrong.delete(key);
      return { ok: true, status: 200 };
    }
    b.count += 1;
    const all = s.wrongAll;
    if (!all.since || now() - all.since > GLOBAL_WINDOW_S * 1000) {
      all.count = 0;
      all.since = now();
    }
    all.count += 1;
    if (all.count >= GLOBAL_MAX_WRONG) {
      s.wrongAll = { count: 0, since: 0, lockedUntil: now() + GLOBAL_LOCK_S * 1000 };
      return { ok: false, status: 429, retryAfterS: GLOBAL_LOCK_S, locked: true };
    }
    if (b.count >= MAX_WRONG) {
      b.count = 0;
      b.lockedUntil = now() + LOCK_S * 1000;
      return { ok: false, status: 429, retryAfterS: LOCK_S, locked: true };
    }
    return { ok: false, status: 403, remaining: MAX_WRONG - b.count };
  };

  /** PC の窓で「今の番号」を確かめる(番号を変える時)。この窓だけの数え。店の端末の出る番号の数えには入らない */
  const tryPcPin = (pin) => {
    const s = load();
    const left = leftS(s.wrongPc.lockedUntil);
    if (left > 0) return { ok: false, status: 429, retryAfterS: left, locked: true };
    if (!s.pin) return { ok: false, status: 409, error: 'pin-unset' };
    if (pinMatches(pin)) {
      s.wrongPc = { count: 0, lockedUntil: 0 };
      return { ok: true, status: 200 };
    }
    s.wrongPc.count += 1;
    if (s.wrongPc.count >= MAX_WRONG) {
      s.wrongPc = { count: 0, lockedUntil: now() + LOCK_S * 1000 };
      return { ok: false, status: 429, retryAfterS: LOCK_S, locked: true };
    }
    return { ok: false, status: 403, remaining: MAX_WRONG - s.wrongPc.count };
  };

  const api = {
    /** PC の窓に見せてよい今の設定(番号は返さない) */
    publicSettings() {
      const s = load();
      return { hasPin: Boolean(s.pin), pinLength: s.pin?.len ?? 0, ...s.settings };
    },

    /**
     * 設定を書く(PC 自身からだけ。呼ぶ側が確かめる)。番号を決める・変えるには、同じ番号を 2 回(pin・pinConfirm)。
     * すでに番号がある時に変えるなら、今の番号(currentPin)も要る。ことば・きまり・時間は、番号がある時だけ書ける
     */
    update(body = {}) {
      const s = load();
      const next = { ...s.settings };
      let newPin = null;
      if (body.pin !== undefined && body.pin !== '') {
        if (!isPin(body.pin)) return { ok: false, status: 400, error: 'pin-form' };
        if (body.pin !== body.pinConfirm) return { ok: false, status: 400, error: 'pin-mismatch' };
        if (s.pin) {
          const r = tryPcPin(body.currentPin);
          if (!r.ok) return { ...r, error: r.error ?? 'pin-current' };
        }
        newPin = body.pin;
      } else if (!s.pin) {
        return { ok: false, status: 409, error: 'pin-unset' }; // 番号を決めるまで、何も決められない
      }
      for (const k of ['lang', 'facts', 'idleSec', 'characterId']) if (body[k] !== undefined) next[k] = body[k];
      s.settings = normalizeSettings(next);
      if (newPin) {
        const salt = b64u(randomBytes(16));
        s.pin = { salt, hash: b64u(hashPin(newPin, salt)), len: newPin.length };
        s.wrongPc = { count: 0, lockedUntil: 0 };
        s.wrong.clear(); // 新しい番号になったら、端末ごとの数えも戻す
        s.wrongAll = { count: 0, since: 0, lockedUntil: 0 };
      }
      save();
      return { ok: true, status: 200, settings: this.publicSettings() };
    },

    /** 札を作る。番号が決まっていない・作った札が QR に入らない時は null */
    issueToken(characterId = '') {
      const s = load();
      if (!s.pin) return null;
      const c = isSpecId(characterId) ? characterId : s.settings.characterId;
      const payload = b64u(JSON.stringify({ v: 1, c, l: s.settings.lang === 'multi' ? 'm' : 'j', e: Math.floor(now() / 1000) + TOKEN_TTL_S }));
      return `${payload}.${b64u(mac(payload))}`;
    },

    /** 札を確かめる。署名が合って、期限が切れていなければ中身を返す。古い・壊れた札は { ok:false, expired } */
    verifyToken(token) {
      const { sig, ...r } = checkToken(token);
      return r;
    },

    /** QR に入れる URL。origin は店の端末から開ける住所(KIOSK_ORIGIN)。入らない・住所が無い時は理由を返す */
    qr(origin, characterId = '') {
      const base = String(origin ?? '').replace(/\/+$/, '');
      if (!/^https?:\/\/[^/?#@\s]+$/i.test(base)) return { ok: false, reason: 'origin' };
      const token = this.issueToken(characterId);
      if (!token) return { ok: false, reason: 'pin-unset' };
      const url = `${base}${KIOSK_PATH}${token}`;
      const bytes = Buffer.byteLength(url);
      if (bytes > QR_LIMIT_BYTES) return { ok: false, reason: 'too-long', bytes };
      return { ok: true, url, bytes, secure: base.startsWith('https://'), expiresInS: TOKEN_TTL_S };
    },

    /** 店の端末へ見せてよい設定(番号は入れない)。札が合わない・古い時も、閉じる側に倒した既定を返す */
    configFor(token) {
      const v = this.verifyToken(token);
      const { lang, facts, idleSec, characterId } = load().settings;
      if (!v.ok) return { kiosk: true, valid: false, expired: v.expired, lang: 'ja', facts: '', idleSec: IDLE_DEFAULT_S, characterId: '' };
      // 出す子は、QR を作った時の舞台の子(札の c)が先。札に無ければ設定の子
      return { kiosk: true, valid: true, lang, facts, idleSec, characterId: isSpecId(v.claims.c) ? v.claims.c : characterId };
    },

    /** 抜ける。番号が合えば 200。その端末(札)が 5 回違うと、その端末だけ 5 分止める(429)。token は店の端末の札(x-kiosk-token) */
    exit(pin, token = '') {
      return tryExit(pin, token);
    },

    /** いま止まっている数(PC の窓に見せる)。端末ごとの止まりと、サーバー全体の止まり */
    lockInfo() {
      const s = load();
      const devices = [...s.wrong.values()].filter((b) => leftS(b.lockedUntil) > 0);
      const global = leftS(s.wrongAll.lockedUntil);
      return { lockedDevices: devices.length, globalLocked: global > 0, retryAfterS: Math.max(global, ...devices.map((b) => leftS(b.lockedUntil)), 0) };
    },

    /** 止まっている分を全部解く(店の PC の窓から。呼ぶ側が PC 自身かを確かめる)。数えも 0 に戻す。PC の窓の「今の番号」の数えは触らない */
    unlockAll() {
      const s = load();
      s.wrong.clear();
      s.wrongAll = { count: 0, since: 0, lockedUntil: 0 };
      return this.lockInfo();
    },
  };
  return api;
}
