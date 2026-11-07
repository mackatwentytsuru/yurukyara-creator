// 端末をまたぐ記憶。アカウントを作らせず、長い乱数の「合鍵」だけで読み書きする。
// - 合鍵は 32 バイトの乱数(base64url で 43 字)。サーバーには合鍵そのものを置かず、ハッシュを名前にして保存する
// - 別の端末へ渡すときは 6 桁の番号を使う(10 分で切れる・1 回しか使えない・5 回間違えたら止める)
// - 記憶は 7 日で消える(最後に使ってから 7 日、1 つずつの事も書いてから 7 日)
// - 「わすれて」で、その合鍵の記憶を全部消す
// 保存先は差し替えられる(既定はファイル。公開のときは KV などに替える。backend の形は下の fileBackend)。
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_NOTICE, RETENTION_DAYS } from '../../src/conversation/memoryNotice.js'; // 画面の札と同じ文と日数

export { RETENTION_DAYS };
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const PAIR_TTL_MS = 10 * 60 * 1000;
export const MAX_FAILS = 5;
export const LOCK_MS = 10 * 60 * 1000;
export const GLOBAL_FAIL_LIMIT = 30; // 10 分の間に、全部の接続元で合わせてこれだけ間違えたら、今ある番号を全部取り消す
export const MAX_ITEMS = 40;
export const ITEM_TEXT_MAX = 80;
export const NOTICE = MEMORY_NOTICE;

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[0-9]{6}$/;

export class MemoryError extends Error {
  constructor(message, status = 400, reason = 'bad_request') {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/** 新しい合鍵を作る(推測できない長さの乱数) */
export function newKey() {
  return randomBytes(32).toString('base64url');
}

export function isKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** ファイルに保存する backend。名前はハッシュなので、ファイル名から合鍵は分からない */
export function fileBackend(dir) {
  const path = (id) => join(dir, `${id}.json`);
  return {
    get(id) {
      try {
        return JSON.parse(readFileSync(path(id), 'utf8'));
      } catch {
        return null;
      }
    },
    set(id, rec) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path(id), JSON.stringify(rec));
    },
    del(id) {
      rmSync(path(id), { force: true });
    },
  };
}

/** 試験用: 覚えるだけの backend */
export function mapBackend() {
  const m = new Map();
  return { get: (id) => (m.has(id) ? structuredClone(m.get(id)) : null), set: (id, rec) => m.set(id, structuredClone(rec)), del: (id) => m.delete(id), size: () => m.size };
}

/**
 * @param {object} o
 * @param {{get:Function,set:Function,del:Function}} o.backend
 * @param {string} [o.pepper] ハッシュに混ぜる秘密(環境変数 MEMORY_PEPPER。無くても動く)
 * @param {() => number} [o.now]
 */
export function createMemoryStore({ backend, pepper = '', now = Date.now }) {
  const idOf = (key) => createHash('sha256').update(`${pepper}:${key}`).digest('hex');
  const codes = new Map(); // 番号 → { key, expiresAt }
  const byKey = new Map(); // 合鍵のハッシュ → 番号(1 つの合鍵につき、有効な番号は 1 つ)
  const fails = new Map(); // 接続元 → { count, lockedUntil }
  let globalFails = [];

  const requireKey = (key) => {
    if (!isKey(key)) throw new MemoryError('合鍵の形が違います', 401, 'bad_key');
  };

  /** 古い事を落とし、期限の切れた記録は消す。無ければ null */
  const load = (key) => {
    const id = idOf(key);
    const rec = backend.get(id);
    if (!rec) return null;
    const t = now();
    if (t - (rec.lastUsedAt ?? 0) > RETENTION_MS) {
      backend.del(id);
      return null;
    }
    rec.items = (rec.items ?? []).filter((it) => t - it.at <= RETENTION_MS);
    return rec;
  };

  const save = (key, rec) => backend.set(idOf(key), rec);

  const sweepCodes = () => {
    const t = now();
    for (const [code, c] of codes) {
      if (c.expiresAt <= t) {
        codes.delete(code);
        if (byKey.get(idOf(c.key)) === code) byKey.delete(idOf(c.key));
      }
    }
    globalFails = globalFails.filter((at) => t - at < PAIR_TTL_MS);
  };

  const view = (rec) => ({
    items: (rec?.items ?? []).map(({ id, kind, text, at }) => ({ id, kind, text, at })),
    notice: NOTICE,
    retentionDays: RETENTION_DAYS,
    expiresAt: rec ? new Date((rec.lastUsedAt ?? now()) + RETENTION_MS).toISOString() : null,
  });

  return {
    /** 新しい合鍵と、空の記録を作る */
    create() {
      const key = newKey();
      const t = now();
      save(key, { v: 1, createdAt: t, lastUsedAt: t, items: [] });
      return { key, ...view({ lastUsedAt: t, items: [] }) };
    },

    /** 一覧(使うたびに、7 日の数え始めが延びる) */
    list(key) {
      requireKey(key);
      const rec = load(key);
      if (!rec) throw new MemoryError('この合鍵の記憶はありません(消えたか、7 日たちました)', 404, 'not_found');
      rec.lastUsedAt = now();
      save(key, rec);
      return view(rec);
    },

    /** 頭脳に渡す「覚えていること」の文。記録が無ければ空 */
    recall(key) {
      if (!isKey(key)) return { text: '', items: [] };
      const rec = load(key);
      if (!rec) return { text: '', items: [] };
      return { text: rec.items.map((it) => `- ${it.text}`).join('\n'), items: rec.items };
    },

    /** 事を書き足す。同じ種類の 1 つだけの事(名前など)は置き換える */
    add(key, facts) {
      requireKey(key);
      const rec = load(key);
      if (!rec) throw new MemoryError('この合鍵の記憶はありません', 404, 'not_found');
      const t = now();
      const added = [];
      for (const f of facts) {
        const text = String(f.text ?? '').trim().slice(0, ITEM_TEXT_MAX);
        if (!text) continue;
        const kind = ['name', 'age', 'like', 'topic', 'note'].includes(f.kind) ? f.kind : 'note';
        if (kind === 'name' || kind === 'age' || kind === 'topic') rec.items = rec.items.filter((it) => it.kind !== kind);
        if (rec.items.some((it) => it.kind === kind && it.text === text)) continue;
        const item = { id: randomBytes(6).toString('base64url'), kind, text, at: t };
        rec.items.push(item);
        added.push(item);
      }
      if (rec.items.length > MAX_ITEMS) rec.items = rec.items.slice(-MAX_ITEMS);
      rec.lastUsedAt = t;
      save(key, rec);
      return added;
    },

    /** 1 つだけ消す */
    forgetItem(key, itemId) {
      requireKey(key);
      const rec = load(key);
      if (!rec) throw new MemoryError('この合鍵の記憶はありません', 404, 'not_found');
      const before = rec.items.length;
      rec.items = rec.items.filter((it) => it.id !== itemId);
      save(key, rec);
      return before !== rec.items.length;
    },

    /** 全部消す。その合鍵の番号も取り消す */
    forgetAll(key) {
      requireKey(key);
      const id = idOf(key);
      const existed = Boolean(backend.get(id));
      backend.del(id);
      const code = byKey.get(id);
      if (code) {
        codes.delete(code);
        byKey.delete(id);
      }
      return existed;
    },

    /** 別の端末へ渡す 6 桁の番号を作る。前の番号は取り消す */
    pair(key) {
      requireKey(key);
      if (!load(key)) throw new MemoryError('この合鍵の記憶はありません', 404, 'not_found');
      sweepCodes();
      const id = idOf(key);
      const old = byKey.get(id);
      if (old) codes.delete(old);
      let code;
      do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      while (codes.has(code));
      const expiresAt = now() + PAIR_TTL_MS;
      codes.set(code, { key, expiresAt });
      byKey.set(id, code);
      return { code, expiresAt: new Date(expiresAt).toISOString(), ttlSec: PAIR_TTL_MS / 1000 };
    },

    /** 番号から合鍵を受け取る。1 回しか使えない。同じ接続元が 5 回間違えたら 10 分止める */
    claim(code, client = 'unknown') {
      sweepCodes();
      const t = now();
      const f = fails.get(client) ?? { count: 0, lockedUntil: 0 };
      if (f.lockedUntil > t) throw new MemoryError('間違いが続いたので、少し止めています。10 分ほどたってから試してね', 429, 'locked');
      const hit = typeof code === 'string' && CODE_RE.test(code) ? codes.get(code) : null;
      if (!hit) {
        f.count += 1;
        if (f.count >= MAX_FAILS) Object.assign(f, { count: 0, lockedUntil: t + LOCK_MS });
        fails.set(client, f);
        globalFails.push(t);
        if (globalFails.length >= GLOBAL_FAIL_LIMIT) {
          codes.clear();
          byKey.clear();
          globalFails = [];
        }
        throw new MemoryError('番号が違うか、切れています', 400, 'bad_code');
      }
      // 合っていた: その番号はもう使えない
      codes.delete(code);
      byKey.delete(idOf(hit.key));
      fails.delete(client);
      return { key: hit.key };
    },

    /** 試験用: 今ある番号の数 */
    activeCodes: () => (sweepCodes(), codes.size),
  };
}

/** 合言葉を比べる(時間で中身が分からないように) */
export function samePass(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}
