// あいづちの声。話し終わりの直後に、うなずきと一緒に出す短い声を、前もって作っておく。
// 声は役(男の子・女の子)ごとに 1 組(11-07 第 11 波。男の子の役のノリーが、女の子の声で「はい。」と言わないように)。
// 役の声(tts.mjs の roleVoiceId)とモデル(ELEVEN_MODEL_ID)で作り、同じ言葉が続かないよう数種類を用意する。
// 作る文字数は、今日の読み上げの上限の中から引く(tts.mjs の reserveChars)。作った声は cache/fillers/ に残し、
// 声やモデルを替えたときだけ作り直す。リポジトリには入れない。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './env.mjs';
import { SAMPLE_RATE, roleVoiceId, synthesizePcm } from './tts.mjs';

export const FILLER_PHRASES = ['はい。', 'ええ。', 'なるほど。', 'そうですね。', 'はい、はい。'];
export const FILLER_ROLES = ['male', 'female'];
const dir = () => config.fillerDir;

const fileFor = (text, voiceId) => {
  const hash = createHash('sha1').update(`${voiceId}|${config.ttsModel}|${text}`).digest('hex').slice(0, 10);
  return `${hash}.pcm`;
};

/**
 * いま使える声の一覧(画面が読み込む)。voiceId を省くと女の子の役の声
 * @param {string} [voiceId]
 */
export function listFillers(voiceId = roleVoiceId('female')) {
  if (!existsSync(dir())) return [];
  const have = new Set(readdirSync(dir()));
  return FILLER_PHRASES.filter((t) => have.has(fileFor(t, voiceId))).map((text) => {
    const file = fileFor(text, voiceId);
    const bytes = readFileSync(join(dir(), file)).length;
    return { text, url: `/api/fillers/${file}`, ms: Math.round(((bytes / 2) / SAMPLE_RATE) * 1000) };
  });
}

/** 役ごとの一覧 { male: [...], female: [...] }(/api/fillers の roles) */
export function listFillerSets() {
  return Object.fromEntries(FILLER_ROLES.map((role) => [role, listFillers(roleVoiceId(role))]));
}

export function fillerPath(file) {
  return /^[0-9a-f]{10}\.pcm$/.test(file) ? join(dir(), file) : null;
}

/** 足りない声を、役ごとに作る。作った数と、使った文字数を返す。鍵が無い・上限なら、作れた分まで */
export async function ensureFillers() {
  if (!config.elevenKey) return { made: 0, chars: 0, have: 0 };
  mkdirSync(dir(), { recursive: true });
  let made = 0;
  let chars = 0;
  const voices = [...new Set(FILLER_ROLES.map((role) => roleVoiceId(role)))];
  outer: for (const voiceId of voices) {
    for (const text of FILLER_PHRASES) {
      const path = join(dir(), fileFor(text, voiceId));
      if (existsSync(path)) continue;
      try {
        writeFileSync(path, await synthesizePcm(text, undefined, { voiceId }));
        made += 1;
        chars += text.length;
      } catch (err) {
        console.warn(`あいづちの声を作れませんでした(${text}): ${err.message}`);
        break outer;
      }
    }
  }
  const sets = listFillerSets();
  return { made, chars, have: Math.min(...FILLER_ROLES.map((r) => sets[r].length)) };
}
