// 会話の頭脳と声のモデルの名前を 1 か所に置く(第 12 波 b・B3)。
// 新しいモデルが出たら、ここの既定の 1 行を替えるか、環境変数 1 つ(CLAUDE_MODEL・ELEVEN_MODEL_ID)で替わる。
// 読む所: サーバー(env.mjs → 頭脳 brain.mjs・声 tts.mjs・あいづち fillers.mjs・公開の関数)、
//         画面(声の鍵の道 elevenDirect.js・speaker.js は voiceRole.js の VOICE_MODEL_ID 経由)、台本(web/scripts の測りと試し)。
// DOM も通信も使わない(画面・サーバー・node --test のどれでも読める)。

/** 既定のモデル。頭脳 = Claude の会話のモデル、声 = ElevenLabs の読み上げのモデル */
export const MODEL_DEFAULTS = Object.freeze({
  brain: 'claude-haiku-5-5',
  voice: 'eleven_v4_turbo', // ノリーの声の候補(11-07)を作ったのと同じモデル
});

/** ブラウザから描く道(B4。切ってある)が絵を頼むモデルの既定。環境変数 YC_DRAW_MODEL で替わる */
export const DRAW_MODEL_DEFAULT = 'claude-sonnet-5-5';

/** 既定を替える環境変数の名前(サーバーと台本だけが読む) */
export const MODEL_ENV = Object.freeze({ brain: 'CLAUDE_MODEL', voice: 'ELEVEN_MODEL_ID' });

// モデルの名前の形(英数字で始まり、英数字と . _ : - だけ、80 字まで)。URL や本文に入るので、ほかの文字は通さない
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/** モデルの名前の形か */
export const isModelName = (v) => typeof v === 'string' && MODEL_NAME.test(v);

/**
 * 環境変数から、使うモデルを決める。空・形の違う値は既定(空の値を「無い」と同じにする。.env の例を写した時の空欄)。
 * @param {Record<string, string|undefined>} [env] process.env など
 * @returns {{brain: string, voice: string}}
 */
export function modelsFrom(env = {}) {
  const pick = (kind) => {
    const v = String(env?.[MODEL_ENV[kind]] ?? '').trim();
    return isModelName(v) ? v : MODEL_DEFAULTS[kind];
  };
  return { brain: pick('brain'), voice: pick('voice') };
}
