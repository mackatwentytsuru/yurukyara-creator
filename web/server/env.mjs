// 環境変数を読む。web/.env があれば足りない分だけ補う(鍵はここに書かない)。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(WEB_ROOT, '..');

const envFile = join(WEB_ROOT, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.warn('.env を読めませんでした:', err.message);
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  // 待ち受ける先。既定は自分の端末だけ。同じネットワークの別の端末(iPhone など)から開くときだけ、HOST=0.0.0.0 にする
  host: process.env.HOST ?? '127.0.0.1',
  // Claude の呼び出しの上限(1 日の回数・1 接続元あたり 1 分の回数)
  claudeDailyCallCap: Number(process.env.CLAUDE_DAILY_CALL_CAP ?? 300),
  // 最初の文字がこの ms 来なければ、2 本目を送って早い方を使う。既定は 0(無効)。2026-11-02 の測定(n=35 組)で、効果を確認できなかったため
  // 使うなら、2 本目が勝てる 1800〜2000 くらい(2 本目の最初の文字まで約 0.9 秒を足しても、遅い 1 本目より早い所)にする
  hedgeMs: Number(process.env.CLAUDE_HEDGE_MS ?? 0),
  // 測定のときだけ、リクエストごとに hedgeMs を替えられる(公開するときは付けない)
  hedgeExperiment: process.env.HEDGE_EXPERIMENT === '1',
  claudePerMinute: Number(process.env.CLAUDE_PER_MINUTE ?? 12),
  // 試験では偽のサーバーに向ける(呼ぶたびに読む)
  get anthropicUrl() {
    return process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com/v1/messages';
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY ?? '';
  },
  elevenKey: process.env.ELEVENLABS_API_KEY ?? '',
  model: process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5',
  voiceId: process.env.ELEVEN_VOICE_ID ?? 'fUjY9K2nAIwlALOwSiwc',
  ttsModel: process.env.ELEVEN_MODEL_ID ?? 'eleven_flash_v2_5',
  dailyCharCap: Number(process.env.ELEVEN_DAILY_CHAR_CAP ?? 3000),
  tlsCert: process.env.TLS_CERT ?? '', // 証明書があれば HTTPS で配る(iPhone のカメラとマイクに必要)
  tlsKey: process.env.TLS_KEY ?? '',
  devVrmPath: process.env.DEV_VRM_PATH ?? '',
  // 記録(回数・測った時間・読み上げの文字数)の置き場所(既定は web/logs。git に入らない)。試験は別の場所にする
  logDir: process.env.LOG_DIR ?? join(WEB_ROOT, 'logs'),
  // 端末をまたぐ記憶の置き場所(既定は web/logs/memory。git に入らない)。公開のときは KV に替える
  memoryDir: process.env.MEMORY_DIR ?? join(WEB_ROOT, 'logs', 'memory'),
  // 記憶の名前(合鍵のハッシュ)に混ぜる秘密。無くても動く。値はどこにも書かない
  get memoryPepper() {
    return process.env.MEMORY_PEPPER ?? '';
  },
  // 合言葉。あれば番号づくりに要る。無いときは、この端末だけで待ち受けている時だけ番号を作る
  get appPass() {
    return process.env.APP_PASSPHRASE ?? '';
  },
};
