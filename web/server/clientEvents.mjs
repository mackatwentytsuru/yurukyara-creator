// 画面からの小さな報告(声の聞き取りを始められなかった原因)を、記録の 1 行にする。
// 受けるのは決まった欄だけ(失敗の名前・短い message・提供元・カメラの入・https か・ブラウザの短い分類)。
// 音も、話した文字も、UA の全文も、接続元の住所も受けない・記録しない。本文の大きさ・1 分の回数・記録の大きさに上限がある。
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactSecrets } from '../src/conversation/secrets.js';
import { BROWSER_FAMILIES } from '../src/conversation/clientEvents.js';
import { ValidationError } from './validate.mjs';

export const MAX_BODY_BYTES = 2048; // 本文の上限
export const MAX_LOG_BYTES = 512 * 1024; // 記録のファイルの上限(超えたら書かない)
export const PER_MINUTE = 6; // 1 つの接続元から、1 分に受ける回数
export const KINDS = ['voice-start-failed', 'voice-fallback', 'sheet-blank'];
export const BROWSERS = BROWSER_FAMILIES; // 画面側の一覧と同じ物(1 か所)
export const PROVIDERS = ['web', 'server'];

const name = (v, max) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max) : '');
const line = (v, max) => (typeof v === 'string' ? redactSecrets(v.replace(/[\u0000-\u001f\u007f]+/g, ' ')).text.trim().slice(0, max) : '');

/** 受けた本文を、決まった欄だけのきれいな 1 件にする。形の違う本文は ValidationError */
export function sanitizeClientEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('本文が JSON のオブジェクトではありません');
  if (!KINDS.includes(raw.kind)) throw new ValidationError('報告の種類が違います');
  return {
    kind: raw.kind,
    name: name(raw.name, 60),
    message: line(raw.message, 120),
    stage: name(raw.stage, 24),
    provider: PROVIDERS.includes(raw.provider) ? raw.provider : 'web',
    camera: raw.camera === true,
    secure: raw.secure === true,
    browser: BROWSERS.includes(raw.browser) ? raw.browser : 'other',
    fellBack: raw.fellBack === true,
  };
}

/**
 * @param {object} o
 * @param {string} o.file 1 行ずつ足す記録(logs/client_events.jsonl)
 * @param {() => number} [o.now]
 * @param {number} [o.perMinute]
 * @param {number} [o.maxLogBytes]
 */
export function createClientEvents({ file, now = Date.now, perMinute = PER_MINUTE, maxLogBytes = MAX_LOG_BYTES }) {
  const recent = new Map(); // 接続元 → 直近 1 分の時刻の列(記録には書かない)
  return {
    /** 1 件を受ける。{ status, json } を返す(記録は、通った時だけ) */
    accept(raw, client = 'local') {
      const event = sanitizeClientEvent(raw);
      const t = now();
      const times = (recent.get(client) ?? []).filter((x) => t - x < 60_000);
      if (times.length >= perMinute) {
        recent.set(client, times);
        return { status: 429, json: { error: '少し間をおいてください' } };
      }
      times.push(t);
      recent.set(client, times);
      if (recent.size > 500) recent.delete(recent.keys().next().value); // 接続元の控えが増え続けない
      try {
        if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
        if (existsSync(file) && statSync(file).size >= maxLogBytes) return { status: 200, json: { ok: true, kept: false } };
        appendFileSync(file, JSON.stringify({ date: new Date(t).toISOString(), ...event }) + '\n');
      } catch {
        return { status: 200, json: { ok: true, kept: false } }; // 記録できなくても、画面には何も起こさない
      }
      return { status: 200, json: { ok: true, kept: true } };
    },
  };
}
