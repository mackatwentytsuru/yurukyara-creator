// あいづちの声。話し終わりの直後に、うなずきと一緒に出す短い声を、前もって作っておく。
// 同じ声(ELEVEN_VOICE_ID・ELEVEN_MODEL_ID)で作り、同じ言葉が続かないよう数種類を用意する。
// 作る文字数は、今日の読み上げの上限の中から引く(tts.mjs の reserveChars)。作った声は cache/fillers/ に残し、
// 声やモデルを替えたときだけ作り直す。リポジトリには入れない。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, WEB_ROOT } from './env.mjs';
import { SAMPLE_RATE, synthesizePcm } from './tts.mjs';

export const FILLER_PHRASES = ['はい。', 'ええ。', 'なるほど。', 'そうですね。', 'はい、はい。'];
const DIR = join(WEB_ROOT, 'cache', 'fillers');

const fileFor = (text) => {
  const hash = createHash('sha1').update(`${config.voiceId}|${config.ttsModel}|${text}`).digest('hex').slice(0, 10);
  return `${hash}.pcm`;
};

/** いま使える声の一覧(画面が読み込む) */
export function listFillers() {
  if (!existsSync(DIR)) return [];
  const have = new Set(readdirSync(DIR));
  return FILLER_PHRASES.filter((t) => have.has(fileFor(t))).map((text) => {
    const file = fileFor(text);
    const bytes = readFileSync(join(DIR, file)).length;
    return { text, url: `/api/fillers/${file}`, ms: Math.round(((bytes / 2) / SAMPLE_RATE) * 1000) };
  });
}

export function fillerPath(file) {
  return /^[0-9a-f]{10}\.pcm$/.test(file) ? join(DIR, file) : null;
}

/** 足りない声を作る。作った数と、使った文字数を返す。鍵が無い・上限なら、作れた分まで */
export async function ensureFillers() {
  if (!config.elevenKey) return { made: 0, chars: 0, have: 0 };
  mkdirSync(DIR, { recursive: true });
  let made = 0;
  let chars = 0;
  for (const text of FILLER_PHRASES) {
    const path = join(DIR, fileFor(text));
    if (existsSync(path)) continue;
    try {
      writeFileSync(path, await synthesizePcm(text));
      made += 1;
      chars += text.length;
    } catch (err) {
      console.warn(`あいづちの声を作れませんでした(${text}): ${err.message}`);
      break;
    }
  }
  return { made, chars, have: listFillers().length };
}
