// 読み上げ(ElevenLabs)の中継。鍵はサーバーだけが持つ。
// 月の枠を使い切らないよう、1 日あたりの文字数の上限をここで数えて守る。
// 声はキャラの役(男の子・女の子)ごと(11-07 第 11 波): 画面(speaker.js)が、話す役と、その子自身の声の id を本文で送る。
// 読み方の表(speechReading.js。例: 執事 → しつじ)を、声のサービスに渡す直前に当てる(画面も当ててから送る。2 回通しても同じ)。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, REPO_ROOT } from './env.mjs';
import { toSpeechText } from '../src/conversation/speechReading.js';
import { ROLE_DEFAULT_VOICES, isVoiceId, normalizeVoiceChoice, personaVoice } from '../src/conversation/voiceRole.js';

const LOG_DIR = config.logDir;
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

/**
 * 役の既定の声。環境変数(ELEVEN_VOICE_MALE・ELEVEN_VOICE_FEMALE)> voiceRole.js の既定 > ELEVEN_VOICE_ID。形の違う値は飛ばす
 * @param {'male'|'female'} role
 */
export function roleVoiceId(role, cfg = config) {
  const r = role === 'male' ? 'male' : 'female';
  return [r === 'male' ? cfg.voiceMale : cfg.voiceFemale, ROLE_DEFAULT_VOICES[r], cfg.voiceId].find(isVoiceId);
}

const KNOWN_VOICES_TTL_MS = 5000;
let knownCache = { at: 0, ids: null };

/**
 * 使ってよい声の id の表(CRITsec3 L4): 役の既定・環境変数(ELEVEN_VOICE_MALE・FEMALE・ID・IDS)・characters/<id>/persona.md の「声の id」。
 * 本文の voiceId が、形が正しいだけでは使わない(手元のサーバーに届く人が、持ち主のアカウントの別の声を言わせられないように)。
 * 画面で作った子の persona.md は、作ってすぐ表に入る(5 秒ごとに読み直す)。
 * @returns {Set<string>}
 */
export function knownVoiceIds(cfg = config, { now = Date.now(), dir = join(REPO_ROOT, 'characters') } = {}) {
  const useCache = cfg === config && dir === join(REPO_ROOT, 'characters');
  if (useCache && knownCache.ids && now - knownCache.at < KNOWN_VOICES_TTL_MS) return knownCache.ids;
  const ids = new Set([...Object.values(ROLE_DEFAULT_VOICES), cfg.voiceMale, cfg.voiceFemale, cfg.voiceId, ...(cfg.voiceIds ?? [])].filter(isVoiceId));
  try {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        const id = personaVoice(readFileSync(join(dir, d.name, 'persona.md'), 'utf8')).voiceId;
        if (id) ids.add(id);
      } catch {
        // persona.md の無い物は飛ばす
      }
    }
  } catch {
    // characters が無い(公開の関数など)
  }
  if (useCache) knownCache = { at: now, ids };
  return ids;
}

/**
 * /api/tts の本文から、話す声を決める。
 * 本文: { text, voice: 'auto'|'male'|'female'(話す役。画面は、性格の画面で選んだ役か、その子の役を送る), voiceId?: その子自身の声の id }
 * voice が 'auto'・無い・知らない値なら女の子(サーバーはキャラを知らない。11-07 までの既定の声と同じ)。
 * 声の id: その子自身の声(形が正しく、使ってよい表 knownVoiceIds に入っている時)> 役の既定 > ELEVEN_VOICE_ID
 * @returns {{role: 'male'|'female', voiceId: string}}
 */
export function voiceForRequest(body, cfg = config, known = knownVoiceIds(cfg)) {
  const b = body && typeof body === 'object' ? body : {};
  const choice = normalizeVoiceChoice(b.voice);
  const role = choice === 'male' ? 'male' : 'female';
  return { role, voiceId: isVoiceId(b.voiceId) && known.has(b.voiceId) ? b.voiceId : roleVoiceId(role, cfg) };
}

const speechUrl = (voiceId) => `${config.elevenUrl}${voiceId}/stream?output_format=pcm_${SAMPLE_RATE}`;

export function ttsStatus() {
  const u = readUsage();
  return {
    available: Boolean(config.elevenKey),
    usedToday: u.chars,
    capToday: config.dailyCharCap,
    remainingToday: Math.max(0, config.dailyCharCap - u.chars),
    model: config.ttsModel,
    // 役ごとの声がある(画面は話す役を送る)。中身の id は出さない
    roles: ['male', 'female'],
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

/**
 * text を読み上げて、PCM(16bit・24kHz・モノラル)を res に流す
 * @param {{role?: 'male'|'female', voiceId?: string}} [voice] 話す声(voiceForRequest の結果)。無ければ女の子の既定
 */
export async function streamSpeech(text, res, signal, voice = {}) {
  const { role, voiceId } = isVoiceId(voice.voiceId) ? { role: voice.role === 'male' ? 'male' : 'female', voiceId: voice.voiceId } : voiceForRequest({ voice: voice.role });
  const clean = toSpeechText(text).trim().slice(0, 300);
  if (!clean) {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"text が空です"}');
    return;
  }
  if (!config.elevenKey) {
    // 声の鍵が無いのは失敗ではない(字幕と「ピッ」で話す)。503 だとブラウザの console に毎回赤い行が出たので(CRITux 25)、
    // 204(中身なし)と理由の印で返す。画面(speaker.js)はこれを見て、この画面の間は聞きに来ない
    res.writeHead(204, { 'x-tts': 'off', 'x-tts-reason': 'no-key', 'cache-control': 'no-store' }).end();
    return;
  }
  if (!reserveChars(clean.length)) {
    res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"今日の声は使い切りました。あしたまた声で話せるよ","reason":"cap"}');
    return;
  }
  const url = speechUrl(voiceId);
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
    // 声のサービスの返事の文は、画面に返さない(手元の記録にだけ書く。CRITsec3 L4)
    console.warn(`[声] 読み上げに失敗 (${upstream.status}): ${(await upstream.text()).slice(0, 200)}`);
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `読み上げに失敗 (${upstream.status})` }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'x-sample-rate': String(SAMPLE_RATE),
    'x-voice-role': role, // 話した役(試験と確かめ用。声の id は出さない)
    'cache-control': 'no-store',
  });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

/**
 * 短い文を読み上げて、PCM(16bit・24kHz・モノラル)をまとめて返す。あいづちの声を前もって作るのに使う
 * @param {{voiceId?: string}} [o] 声(無ければ女の子の既定)
 */
export async function synthesizePcm(text, signal, { voiceId } = {}) {
  const clean = toSpeechText(text).trim().slice(0, 300);
  if (!clean || !config.elevenKey) throw new Error('読み上げの鍵か文がありません');
  if (!reserveChars(clean.length)) throw new Error('今日の読み上げの上限に達しました');
  const url = speechUrl(isVoiceId(voiceId) ? voiceId : roleVoiceId('female'));
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: clean, model_id: config.ttsModel, language_code: 'ja' }),
    });
    if (!res.ok) throw new Error(`読み上げに失敗 (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    refundChars(clean.length);
    throw err;
  }
}

export const hasLogDir = () => existsSync(LOG_DIR);
