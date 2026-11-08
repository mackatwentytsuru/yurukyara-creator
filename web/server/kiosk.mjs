// 接客モード(店の端末)の、サーバー側の決まり。DOM なし・通信なし(ファイルだけ)。
// - 設定(番号・ことば・お店のきまり・放っておく時間)は、サーバーだけが持つ。番号は塩つきの scrypt で logs の中に残し、平文は残さない
// - 札(QR に入れる短い文)= 短い中身 + サーバーの鍵の署名。期限は 12 時間。番号・鍵・記憶の番号は入れない
// - 抜ける時の番号の照合と、間違いの数え(5 回違うと 5 分とめる)もここ。数えるのはサーバーだけ(画面を読み込み直しても数え直せない)
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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
      wrong: { count: 0, lockedUntil: 0 },
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

  const lockLeftS = () => {
    const s = load();
    const left = Math.ceil((s.wrong.lockedUntil - now()) / 1000);
    return left > 0 ? left : 0;
  };

  /** 間違いを数える入口(抜ける・番号を変える)。止めている間は照合せずに断る */
  const tryPin = (pin) => {
    const s = load();
    const left = lockLeftS();
    if (left > 0) return { ok: false, status: 429, retryAfterS: left, locked: true };
    if (!s.pin) return { ok: false, status: 409, error: 'pin-unset' };
    if (pinMatches(pin)) {
      s.wrong = { count: 0, lockedUntil: 0 };
      return { ok: true, status: 200 };
    }
    s.wrong.count += 1;
    if (s.wrong.count >= MAX_WRONG) {
      s.wrong = { count: 0, lockedUntil: now() + LOCK_S * 1000 };
      return { ok: false, status: 429, retryAfterS: LOCK_S, locked: true };
    }
    return { ok: false, status: 403, remaining: MAX_WRONG - s.wrong.count };
  };

  return {
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
          const r = tryPin(body.currentPin);
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
        s.wrong = { count: 0, lockedUntil: 0 };
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
      const [payload, sig, extra] = String(token ?? '').split('.');
      if (!payload || !sig || extra !== undefined) return { ok: false, expired: false };
      const want = mac(payload);
      const got = fromB64u(sig);
      if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, expired: false };
      let claims;
      try {
        claims = JSON.parse(fromB64u(payload).toString('utf8'));
      } catch {
        return { ok: false, expired: false };
      }
      if (claims?.v !== 1 || !Number.isFinite(claims.e)) return { ok: false, expired: false };
      if (claims.e * 1000 <= now()) return { ok: false, expired: true };
      return { ok: true, claims };
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

    /** 抜ける。番号が合えば 200。5 回違うと 5 分止める(429) */
    exit(pin) {
      return tryPin(pin);
    },
  };
}
