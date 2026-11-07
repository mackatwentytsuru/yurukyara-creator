// 初めての訪問で話す決まった文の声を、前もって作っておく(おぼえ書きに入れる。tts.mjs の ttsCache)。
// - 対象: 主役(とその子の人格の文の「初めてのあいさつ」)の決まった文。本物の頭脳の最初の返事は、たいてい人格の文のあいさつと同じ言い回しになる。
//         それと、初めての会話(7 歩)で主役が声で言う 2 文
// - いつ: サーバーが起きた時と、画面を開かれた時(/api/status。10 分に 1 回まで、全部そろうまで)。おぼえ書きは手元のフォルダにも残るので、
//         2 回目からは声のサービスに頼まない(文字数も使わない)
// - 文字数は、今日の上限の中から引く。残りが少ない(WARM_MIN_REMAINING 字未満)時はやらない
// - 鍵・声の鍵・使う人の言葉は扱わない。文は人格の文とコードの中の決まった文だけ
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, REPO_ROOT } from './env.mjs';
import { firstGreeting } from './greeting.mjs';
import { personaVoice } from '../src/conversation/voiceRole.js';
import * as onboardingScript from '../src/ui/onboarding/script.js';
import { MAIN_CHARACTER } from '../src/character/defaults.js';
import { cacheKey } from './ttsCache.mjs';
import { ttsCache, ttsStatus, synthesizePcm, voiceForRequest } from './tts.mjs';
import { toSpeechText } from '../src/conversation/speechReading.js';

export const WARM_MIN_REMAINING = 1500;
const RETRY_MS = 10 * 60 * 1000;
// 初めての会話の 7 歩目で主役が声で言う文(script.js の _voice。文が変わったら、ここも合わせる。違っていても、温めが外れるだけ)
const CARD_VOICE_LINES = ['声でも話せるよ。よろしくね!'];
// 初めての会話の 1 歩目で、案内役(主役ノリー)が最初に言う 2 文。台本(script.js の guideFirstLines)から読む。
// 台本に guideFirstLines が無い古い版の時だけ、下の控えを使う(温めが外れるだけで、動きは止まらない)
const FALLBACK_GUIDE_FIRST_LINES = [
  'はじめまして! 執事見習いのノリーデス。きみだけのゆるキャラを生み出すお手伝い、ノリー、がんばりマス!',
  'どんな子を生み出そうか?',
];
const VOICE_THANKS_FALLBACK = '声が出せるようになったよ、ありがとう!';

/** 案内役の最初の 2 文(台本の関数から。読めない時は控え) */
export function guideFirstLines() {
  try {
    const fn = onboardingScript.guideFirstLines;
    if (typeof fn === 'function') {
      const lines = fn(MAIN_CHARACTER.name, true);
      if (Array.isArray(lines) && lines.length && lines.every((l) => typeof l === 'string')) return lines;
    }
  } catch {
    // 台本が読めない時は控えで温める
  }
  return FALLBACK_GUIDE_FIRST_LINES;
}
export const GUIDE_FIRST_LINES = guideFirstLines();

/** 温める [{ text, voiceId }] の一覧(声を作らない。試験でも使う) */
export function warmTargets({ ids = [MAIN_CHARACTER.id], dir = join(REPO_ROOT, 'characters'), cfg = config } = {}) {
  const out = [];
  for (const id of ids) {
    let persona = '';
    try {
      persona = readFileSync(join(dir, id, 'persona.md'), 'utf8');
    } catch {
      continue;
    }
    const own = personaVoice(persona);
    // 画面が送る声と同じ決め方(画面は役と、その子自身の声の id を送る。サーバーは使ってよい声の表に入っていれば使う)
    const { voiceId } = voiceForRequest({ voice: own.role, voiceId: own.voiceId });
    const lines = [...firstGreeting(persona), ...(id === MAIN_CHARACTER.id ? [...GUIDE_FIRST_LINES, ...CARD_VOICE_LINES, (onboardingScript.VOICE_THANKS ?? VOICE_THANKS_FALLBACK)] : [])];
    for (const text of lines) out.push({ text, voiceId });
  }
  return out;
}

let lastRun = 0;
let running = null;
let complete = false;

/**
 * 決まった文の声を作っておく。もうおぼえ書きにある文は飛ばす。同時に 2 回は走らない。
 * @returns {Promise<{made:number, had:number, skipped:string|null}>}
 */
export function warmFirstVisit({ now = Date.now(), force = false, targets = warmTargets(), cfg = config } = {}) {
  if (running) return running;
  if (!cfg.elevenKey) return Promise.resolve({ made: 0, had: 0, skipped: 'no-key' });
  if (process.env.TTS_WARM === '0') return Promise.resolve({ made: 0, had: 0, skipped: 'off' }); // 試験は声のサービスへの頼みを数えるので、温めを止める
  if (!force && (complete || now - lastRun < RETRY_MS)) return Promise.resolve({ made: 0, had: 0, skipped: complete ? 'done' : 'recent' });
  lastRun = now;
  running = (async () => {
    let made = 0;
    let had = 0;
    let skipped = null;
    for (const { text, voiceId } of targets) {
      const clean = toSpeechText(text).trim().slice(0, 300);
      if (ttsCache.has(cacheKey(voiceId, cfg.ttsModel, clean))) {
        had += 1;
        continue;
      }
      if (ttsStatus().remainingToday < WARM_MIN_REMAINING) {
        skipped = 'low-remaining';
        break;
      }
      try {
        await synthesizePcm(text, undefined, { voiceId });
        made += 1;
      } catch (err) {
        skipped = 'failed';
        console.warn(`[声] 温めに失敗: ${String(err?.message ?? err).slice(0, 100)}`);
        break;
      }
    }
    complete = skipped === null;
    return { made, had, skipped };
  })().finally(() => {
    running = null;
  });
  return running;
}

