// 読み上げ(ElevenLabs)の中継。鍵はサーバーだけが持つ。
// 月の枠を使い切らないよう、1 日あたりの文字数の上限をここで数えて守る。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, WEB_ROOT } from './env.mjs';

const LOG_DIR = join(WEB_ROOT, 'logs');
const USAGE_FILE = join(LOG_DIR, 'tts_usage.json');
export const SAMPLE_RATE = 24000; // pcm_24000

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD(ローカル日付)

function readUsage() {
  try {
    const u = JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
    if (u.date === today()) return u;
  } catch {
    // 無ければ新しく始める
  }
  return { date: today(), chars: 0 };
}

function writeUsage(u) {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(u));
}

export function ttsStatus() {
  const u = readUsage();
  return {
    available: Boolean(config.elevenKey),
    usedToday: u.chars,
    capToday: config.dailyCharCap,
    remainingToday: Math.max(0, config.dailyCharCap - u.chars),
    model: config.ttsModel,
  };
}

/** 文字数を先に引き当てる。足りなければ false(読み上げを断る) */
export function reserveChars(n) {
  const u = readUsage();
  if (u.chars + n > config.dailyCharCap) return false;
  u.chars += n;
  writeUsage(u);
  return true;
}

export function refundChars(n) {
  const u = readUsage();
  u.chars = Math.max(0, u.chars - n);
  writeUsage(u);
}

/** text を読み上げて、PCM(16bit・24kHz・モノラル)を res に流す */
export async function streamSpeech(text, res, signal) {
  const clean = String(text ?? '').trim().slice(0, 300);
  if (!clean) {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"text が空です"}');
    return;
  }
  if (!config.elevenKey) {
    res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"読み上げの鍵がありません"}');
    return;
  }
  if (!reserveChars(clean.length)) {
    res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"今日の読み上げの上限に達しました"}');
    return;
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}/stream?output_format=pcm_${SAMPLE_RATE}`;
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: clean, model_id: config.ttsModel, language_code: 'ja' }),
    });
  } catch (err) {
    refundChars(clean.length);
    throw err;
  }
  if (!upstream.ok || !upstream.body) {
    refundChars(clean.length);
    const detail = (await upstream.text()).slice(0, 200);
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `読み上げに失敗 (${upstream.status})`, detail }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'x-sample-rate': String(SAMPLE_RATE),
    'cache-control': 'no-store',
  });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

export const hasLogDir = () => existsSync(LOG_DIR);
