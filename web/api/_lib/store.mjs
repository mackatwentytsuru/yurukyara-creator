// 数と記憶の置き場。Upstash の Redis(REST)があればそこ、無ければ関数の中のメモリ(1 台の中だけ。消えてもよい物だけ)。
// どちらも同じ 4 つの呼び方: get / set(期限つき)/ del / incr(期限つき)。

/** 関数の中のメモリ。Vercel では呼び出しの間に消えることがある(試験と、置き場が無いときの代わり) */
export function createMemoryStore({ now = Date.now } = {}) {
  const items = new Map();
  const alive = (key) => {
    const it = items.get(key);
    if (!it) return null;
    if (it.until && it.until <= now()) {
      items.delete(key);
      return null;
    }
    return it;
  };
  return {
    kind: 'memory',
    async get(key) {
      return alive(key)?.value ?? null;
    },
    async set(key, value, { ttlSeconds } = {}) {
      items.set(key, { value, until: ttlSeconds ? now() + ttlSeconds * 1000 : 0 });
    },
    async del(key) {
      items.delete(key);
    },
    async incr(key, { ttlSeconds } = {}) {
      const it = alive(key);
      const value = (Number(it?.value) || 0) + 1;
      items.set(key, { value, until: it?.until || (ttlSeconds ? now() + ttlSeconds * 1000 : 0) });
      return value;
    },
  };
}

/** Upstash の REST(1 回 1 命令)。鍵は Authorization の見出しだけに入れ、記録に出さない */
export function createRedisStore({ url, token, fetchImpl = fetch }) {
  const call = async (...command) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`置き場の呼び出しに失敗しました(${res.status})`);
    const data = await res.json();
    if (data.error) throw new Error('置き場がエラーを返しました');
    return data.result;
  };
  return {
    kind: 'redis',
    async get(key) {
      const v = await call('GET', key);
      return v ?? null;
    },
    async set(key, value, { ttlSeconds } = {}) {
      await (ttlSeconds ? call('SET', key, String(value), 'EX', String(ttlSeconds)) : call('SET', key, String(value)));
    },
    async del(key) {
      await call('DEL', key);
    },
    async incr(key, { ttlSeconds } = {}) {
      const v = Number(await call('INCR', key));
      if (v === 1 && ttlSeconds) await call('EXPIRE', key, String(ttlSeconds));
      return v;
    },
  };
}

let shared = null;
/** 設定から置き場を選ぶ。同じ関数の中では 1 つを使い回す */
export function storeFor(cfg, { fetchImpl } = {}) {
  if (cfg.redisUrl && cfg.redisToken) return createRedisStore({ url: cfg.redisUrl, token: cfg.redisToken, fetchImpl });
  shared ??= createMemoryStore();
  return shared;
}
