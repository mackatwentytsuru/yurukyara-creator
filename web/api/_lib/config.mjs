// 公開の関数の設定。値は全部、Vercel の環境変数から読む(鍵・合言葉はリポジトリに書かない)。
// 呼ぶたびに読む(試験で環境変数を替えられるように)。

const num = (v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const text = (v) => String(v ?? '').trim(); // 画面に貼った時の前後の空白・改行を落とす(画面の側も trim する)

/** @param {Record<string, string|undefined>} env */
export function readConfig(env = process.env) {
  return {
    // 合言葉。空なら「合言葉なし」= だれでも仮の頭脳だけ(本物の頭脳は使わない)。短すぎる時も本物は使わない(gate.mjs)
    passphrase: text(env.DEMO_PASSPHRASE),
    // 本物の頭脳の鍵があるか(値そのものは持ち歩かない)
    hasBrainKey: Boolean(text(env.ANTHROPIC_API_KEY)),
    // 本物の頭脳を呼ぶ回数の上限(1 日・全体)と、接続元ごとの 1 分の上限。超えたら仮の頭脳に替える
    dailyCap: num(env.DEMO_DAILY_CAP, 300, { min: 0, max: 100000 }),
    perMinute: num(env.DEMO_PER_MINUTE, 10, { min: 1, max: 600 }),
    // 本文の大きさの上限(バイト)。これより大きい物は読まずに断る
    maxBodyBytes: num(env.DEMO_MAX_BODY_BYTES, 32768, { min: 1024, max: 262144 }),
    // BCV: カメラの絵 1 枚の分として、本文の上限に足してよい大きさ(バイト。絵のついた本文だけ)と、1 日に本物の頭脳へ送る絵の枚数
    maxImageBytes: num(env.DEMO_MAX_IMAGE_BYTES, 163840, { min: 0, max: 262144 }),
    dailyImageCap: num(env.DEMO_DAILY_IMAGE_CAP, 100, { min: 0, max: 100000 }),
    // 数を数える置き場(Upstash の Redis の REST)。Vercel の画面からつなぐと KV_REST_API_* の名前で入る
    redisUrl: text(env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL),
    redisToken: text(env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN),
    // Vercel の上で動いているか(Vercel が配りに入れる環境変数で見分ける)。Upstash が無い時に、関数の中のメモリへ落とさないため
    onVercel: Boolean(env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL || env.VERCEL_REGION),
  };
}
