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
};
