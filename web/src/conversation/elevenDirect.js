// 使う人の声の鍵(BYOK)で、ブラウザから声のサービス(ElevenLabs)へ直接、読み上げを頼む。
// - 鍵は私たちのサーバーを通らない。送るのは「読み上げる 1 文」と、声とモデルの名前だけ(カメラ・記憶・会話の履歴は送らない)
// - 声のサービスは、ブラウザからの直接の呼び出しを受け付けている(2026-11-06 に、鍵なしの事前確認で access-control-allow-origin: * を確かめた)
// - 返るのは手元のサーバーの /api/tts と同じ PCM(16bit・24kHz・モノラル)なので、再生の道はそのまま使える
// これは画面のコードで唯一の外への通信先(privacy.test.mjs が、この 1 か所だけを許している)。

export const ELEVEN_TTS = 'https://api.elevenlabs.io/v1/text-to-speech/';
export const DEFAULT_VOICE_ID = 'fUjY9K2nAIwlALOwSiwc'; // 手元のサーバーの女の子の役の既定と同じ声(役ごとの声は voiceRole.js。speaker.js が voiceId で渡す)
// ノリーの声の候補(11-07)を作ったのと同じモデル(voiceRole.js の VOICE_MODEL_ID と同じ。この部品はほかの部品を読み込まない決まりなので、文字で持つ)。
// 前の既定 eleven_flash_v2_5 は最初の音が少し早い(2026-11-02 に測った: 約 290ms、v4 turbo は 290〜520ms)
export const DEFAULT_MODEL_ID = 'eleven_v4_turbo';
export const SAMPLE_RATE = 24000;
const MAX_TEXT = 300;

/** 頼む中身を作る(試験で、送る物がこれだけなのを確かめる) */
export function elevenRequest(text, { key, voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL_ID }) {
  const id = /^[A-Za-z0-9]{8,40}$/.test(String(voiceId)) ? voiceId : DEFAULT_VOICE_ID;
  return {
    url: `${ELEVEN_TTS}${id}/stream?output_format=pcm_${SAMPLE_RATE}`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text ?? '').trim().slice(0, MAX_TEXT), model_id: modelId, language_code: 'ja' }),
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
export function fetchElevenPcm(text, { key, voiceId, modelId, signal }) {
  const { url, init } = elevenRequest(text, { key, voiceId, modelId });
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
