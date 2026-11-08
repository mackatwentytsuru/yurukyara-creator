// 使う人の声の鍵(BYOK)で、ブラウザから声のサービス(ElevenLabs)へ直接、読み上げを頼む。
// - 鍵は私たちのサーバーを通らない。送るのは「読み上げる 1 文」と、声とモデルの名前だけ(カメラ・記憶・会話の履歴は送らない)
// - 声のサービスは、ブラウザからの直接の呼び出しを受け付けている(2026-11-06 に、鍵なしの事前確認で access-control-allow-origin: * を確かめた)
// - 返るのは手元のサーバーの /api/tts と同じ PCM(16bit・24kHz・モノラル)なので、再生の道はそのまま使える
// これは画面のコードで唯一の外への通信先(privacy.test.mjs が、この 1 か所だけを許している)。
import { MODEL_DEFAULTS } from './models.js';

export const ELEVEN_TTS = 'https://api.elevenlabs.io/v1/text-to-speech/';
export const DEFAULT_VOICE_ID = 'fUjY9K2nAIwlALOwSiwc'; // 手元のサーバーの女の子の役の既定と同じ声(役ごとの声は voiceRole.js。speaker.js が voiceId で渡す)
// 声のモデルの名前は models.js の 1 か所(MODEL_DEFAULTS.voice)。ここはその値を読むだけで、名前の文字は持たない(UW3 11-08)。
// models.js は DOM も通信も使わない定数だけの部品なので、これを読み込んでも「外への通信先はこの 1 か所だけ」の確かめは変わらない
// (privacy.test.mjs は、このファイルの import が ./models.js だけなのを見る)。
export const DEFAULT_MODEL_ID = MODEL_DEFAULTS.voice;
export const SAMPLE_RATE = 24000;
const MAX_TEXT = 300;
// ML1: 声の言葉(language_code)。多言語の時だけ、画面が en・zh・ko を渡す。形の違う値・無い値は、今までと同じ 'ja'(この部品は lang.js を読まない)
const LANGUAGE_CODE = /^[a-z]{2}$/;

/** 頼む中身を作る(試験で、送る物がこれだけなのを確かめる) */
export function elevenRequest(text, { key, voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL_ID, languageCode = 'ja' }) {
  const id = /^[A-Za-z0-9]{8,40}$/.test(String(voiceId)) ? voiceId : DEFAULT_VOICE_ID;
  return {
    url: `${ELEVEN_TTS}${id}/stream?output_format=pcm_${SAMPLE_RATE}`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text ?? '').trim().slice(0, MAX_TEXT), model_id: modelId, language_code: LANGUAGE_CODE.test(String(languageCode)) ? languageCode : 'ja' }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    },
  };
}

/** 声のサービスの返事の番号を、画面の言葉にする */
export function describeElevenError(status) {
  if (status === 401) return '声の鍵が違うみたい。入れ直してね';
  if (status === 402 || status === 429) return '声の枠が足りないみたい。文字と効果音で話すね';
  if (status === 403) return 'この声の鍵では、この声を使えないみたい';
  return `声のサービスが答えません(${status})`;
}

/**
 * 1 文を読み上げてもらう。返事(Response)の本体は PCM の流れ。
 * @param {string} text
 * @param {{key:string, voiceId?:string, modelId?:string, signal?:AbortSignal}} o
 */
export function fetchElevenPcm(text, { key, voiceId, modelId, signal, languageCode }) {
  const { url, init } = elevenRequest(text, { key, voiceId, modelId, languageCode });
  return fetch(url, { ...init, signal });
}

/**
 * 鍵が使えるかを、短い 1 文(「はい。」3 字)で確かめる。使う人の鍵の枠を 3 字ぶん使う。
 * @returns {Promise<{ok:boolean, status:number, message:string}>}
 */
export async function checkVoiceKey(key, { voiceId, signal } = {}) {
  try {
    const res = await fetchElevenPcm('はい。', { key, voiceId, signal });
    if (res.ok) {
      await res.arrayBuffer().catch(() => null);
      return { ok: true, status: res.status, message: '声が出せるようになったよ、ありがとう!' };
    }
    return { ok: false, status: res.status, message: describeElevenError(res.status) };
  } catch {
    return { ok: false, status: 0, message: '声のサービスにつながりません' };
  }
}
