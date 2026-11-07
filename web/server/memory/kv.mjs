// 端末をまたぐ記憶の、公開の関数の版(契約 K4・K5)。決まりは store.mjs と同じで、置き場だけが違う。
// 置き場は K5 の store(get・set(期限つき)・del・incr(期限つき)の 4 つ。値は文字)。Upstash でも、関数の中のメモリでも動く。
// - 記録の名前は sha256(MEMORY_PEPPER + ":" + 合鍵)。合鍵そのものは置かない
// - 記録には 7 日の期限を付ける(使うたびに延びる)。置き場の期限でも、読むときの確かめでも消える
// - 番号は 10 分・1 回だけ(INCR で 1 回目だけ通す)・同じ接続元が 5 回間違えたら 10 分止める・10 分の間に全体で 30 回間違えたら全部取り消す(世代を上げる)
// - 番号の置き場には、合鍵を「番号と塩」から作った鍵で暗号にして置く(置き場が漏れても、番号と塩が無ければ読めない)
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import {
  GLOBAL_FAIL_LIMIT,
  ITEM_TEXT_MAX,
  LOCK_MS,
  MAX_FAILS,
  MAX_ITEMS,
  MemoryError,
  NOTICE,
  PAIR_TTL_MS,
  RETENTION_DAYS,
  RETENTION_MS,
  isKey,
  newKey,
} from './store.mjs';

const CODE_RE = /^[0-9]{6}$/;
const P = 'ycm:'; // ほかの数(会話の上限など)と混ざらないよう、名前の頭をそろえる
const sec = (ms) => Math.ceil(ms / 1000);

/**
 * @param {object} o
 * @param {{get:Function,set:Function,del:Function,incr:Function}} o.store K5 の置き場
 * @param {string} [o.pepper] 環境変数 MEMORY_PEPPER(無くても動くが、公開では入れる)
 * @param {() => number} [o.now]
 */
export function createKvMemory({ store, pepper = '', now = Date.now }) {
  const idOf = (key) => createHash('sha256').update(`${pepper}:${key}`).digest('hex');
  const codeId = (code) => createHash('sha256').update(`${pepper}:code:${code}`).digest('hex').slice(0, 40);
  const cipherKey = (code) => createHash('sha256').update(`${pepper}:pair:${code}`).digest();

  const requireKey = (key) => {
    if (!isKey(key)) throw new MemoryError('合鍵の形が違います', 401, 'bad_key');
  };

  const readJson = async (name) => {
    const raw = await store.get(name);
    if (raw == null) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  };

  /** 古い事を落とし、期限の切れた記録は消す。無ければ null */
  const load = async (key) => {
    const name = `${P}r:${idOf(key)}`;
    const rec = await readJson(name);
    if (!rec) return null;
    const t = now();
    if (t - (rec.lastUsedAt ?? 0) > RETENTION_MS) {
      await store.del(name);
      return null;
    }
    rec.items = (rec.items ?? []).filter((it) => t - it.at <= RETENTION_MS);
    return rec;
  };

  const save = (key, rec) => store.set(`${P}r:${idOf(key)}`, JSON.stringify(rec), { ttlSeconds: sec(RETENTION_MS) });

  const view = (rec) => ({
    items: (rec?.items ?? []).map(({ id, kind, text, at }) => ({ id, kind, text, at })),
    notice: NOTICE,
    retentionDays: RETENTION_DAYS,
    expiresAt: rec ? new Date((rec.lastUsedAt ?? now()) + RETENTION_MS).toISOString() : null,
  });

  const generation = async () => String((await store.get(`${P}gen`)) ?? '0');

  /** その合鍵の番号を取り消す */
  const revokeCode = async (id) => {
    const cid = await store.get(`${P}k:${id}`);
    if (cid) await store.del(`${P}c:${cid}`);
    await store.del(`${P}k:${id}`);
  };

  const seal = (code, key) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', cipherKey(code), iv);
    const ct = Buffer.concat([c.update(key, 'utf8'), c.final()]);
    return { iv: iv.toString('base64url'), ct: ct.toString('base64url'), tag: c.getAuthTag().toString('base64url') };
  };
  const open = (code, box) => {
    try {
      const d = createDecipheriv('aes-256-gcm', cipherKey(code), Buffer.from(box.iv, 'base64url'));
      d.setAuthTag(Buffer.from(box.tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(box.ct, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  };

  /** 間違いを数える。同じ接続元が 5 回で 10 分止める。全体で 10 分に 30 回なら、世代を上げて今ある番号を全部取り消す */
  const countFail = async (client) => {
    const n = await store.incr(`${P}f:${client}`, { ttlSeconds: sec(LOCK_MS) });
    if (n >= MAX_FAILS) {
      await store.set(`${P}l:${client}`, '1', { ttlSeconds: sec(LOCK_MS) });
      await store.del(`${P}f:${client}`);
    }
    const g = await store.incr(`${P}g:${Math.floor(now() / PAIR_TTL_MS)}`, { ttlSeconds: sec(PAIR_TTL_MS) * 2 });
    if (g === GLOBAL_FAIL_LIMIT) await store.incr(`${P}gen`, {});
  };

  return {
    /** 新しい合鍵と、空の記録を作る */
    async create() {
      const key = newKey();
      const t = now();
      await save(key, { v: 1, createdAt: t, lastUsedAt: t, items: [] });
      return { key, ...view({ lastUsedAt: t, items: [] }) };
    },

    /** 一覧(使うたびに、7 日の数え始めが延びる) */
    async list(key) {
      requireKey(key);
      const rec = await load(key);
      if (!rec) throw new MemoryError('この合鍵の記憶はありません(消えたか、7 日たちました)', 404, 'not_found');
      rec.lastUsedAt = now();
      await save(key, rec);
      return view(rec);
    },

    /** 頭脳に渡す「覚えていること」の文。記録が無ければ空 */
    async recall(key) {
      if (!isKey(key)) return { text: '', items: [] };
      const rec = await load(key);
      if (!rec) return { text: '', items: [] };
      return { text: rec.items.map((it) => `- ${it.text}`).join('\n'), items: rec.items };
    },

    /** 事を書き足す。名前・前の話は置き換える */
    async add(key, facts) {
      requireKey(key);
      const rec = await load(key);
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
      await save(key, rec);
      return added;
    },

    /** 1 つだけ消す */
    async forgetItem(key, itemId) {
      requireKey(key);
      const rec = await load(key);
      if (!rec) throw new MemoryError('この合鍵の記憶はありません', 404, 'not_found');
      const before = rec.items.length;
      rec.items = rec.items.filter((it) => it.id !== itemId);
      await save(key, rec);
      return before !== rec.items.length;
    },

    /** 全部消す。その合鍵の番号も取り消す */
    async forgetAll(key) {
      requireKey(key);
      const id = idOf(key);
      const existed = Boolean(await store.get(`${P}r:${id}`));
      await store.del(`${P}r:${id}`);
      await revokeCode(id);
      return existed;
    },

    /** 別の端末へ渡す 6 桁の番号を作る。前の番号は取り消す */
    async pair(key) {
      requireKey(key);
      if (!(await load(key))) throw new MemoryError('この合鍵の記憶はありません', 404, 'not_found');
      const id = idOf(key);
      await revokeCode(id);
      let code = '';
      for (let i = 0; i < 8 && !code; i++) {
        const c = String(randomInt(0, 1_000_000)).padStart(6, '0');
        if (!(await store.get(`${P}c:${codeId(c)}`))) code = c;
      }
      if (!code) throw new MemoryError('番号を作れませんでした。もう一度どうぞ', 503, 'busy');
      const expiresAt = now() + PAIR_TTL_MS;
      const cid = codeId(code);
      await store.del(`${P}u:${cid}`); // 同じ番号が前に使われていても、新しい番号は 1 回使える
      await store.set(`${P}c:${cid}`, JSON.stringify({ gen: await generation(), id, expiresAt, box: seal(code, key) }), { ttlSeconds: sec(PAIR_TTL_MS) });
      await store.set(`${P}k:${id}`, cid, { ttlSeconds: sec(PAIR_TTL_MS) });
      return { code, expiresAt: new Date(expiresAt).toISOString(), ttlSec: PAIR_TTL_MS / 1000 };
    },

    /** 番号から合鍵を受け取る。1 回しか使えない。同じ接続元が 5 回間違えたら 10 分止める */
    async claim(code, client = 'unknown') {
      if (await store.get(`${P}l:${client}`)) throw new MemoryError('間違いが続いたので、少し止めています。10 分ほどたってから試してね', 429, 'locked');
      const ok = typeof code === 'string' && CODE_RE.test(code);
      const cid = ok ? codeId(code) : '';
      const entry = ok ? await readJson(`${P}c:${cid}`) : null;
      const valid = entry && entry.expiresAt > now() && entry.gen === (await generation());
      // 1 回目だけ通す(同時に 2 か所から来ても、INCR が 1 の方だけ)
      const first = valid ? (await store.incr(`${P}u:${cid}`, { ttlSeconds: sec(PAIR_TTL_MS) })) === 1 : false;
      const key = first ? open(code, entry.box) : '';
      if (!key || !isKey(key)) {
        await countFail(client);
        throw new MemoryError('番号が違うか、切れています', 400, 'bad_code');
      }
      await store.del(`${P}c:${cid}`);
      await store.del(`${P}k:${entry.id}`);
      await store.del(`${P}f:${client}`);
      return { key };
    },
  };
}
