// 公開の関数の設定。値は全部、Vercel の環境変数から読む(鍵・合言葉はリポジトリに書かない)。
// 呼ぶたびに読む(試験で環境変数を替えられるように)。

const num = (v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** @param {Record<string, string|undefined>} env */
export function readConfig(env = process.env) {
  return {
    // 合言葉。空なら「合言葉なし」= だれでも仮の頭脳だけ(本物の頭脳は使わない)
    passphrase: env.DEMO_PASSPHRASE ?? '',
    // 本物の頭脳の鍵があるか(値そのものは持ち歩かない)
    hasBrainKey: Boolean(env.ANTHROPIC_API_KEY),
    // 本物の頭脳を呼ぶ回数の上限(1 日・全体)と、接続元ごとの 1 分の上限。超えたら仮の頭脳に替える
    dailyCap: num(env.DEMO_DAILY_CAP, 300, { min: 0, max: 100000 }),
    perMinute: num(env.DEMO_PER_MINUTE, 10, { min: 1, max: 600 }),
    // 本文の大きさの上限(バイト)。これより大きい物は読まずに断る
    maxBodyBytes: num(env.DEMO_MAX_BODY_BYTES, 32768, { min: 1024, max: 262144 }),
    // 数を数える置き場(Upstash の Redis の REST)。Vercel の画面からつなぐと KV_REST_API_* の名前で入る
    redisUrl: env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? '',
    redisToken: env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? '',
  };
}
