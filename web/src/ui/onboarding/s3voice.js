// 会話の流れ(S3)の声の部品を、初めての会話の「声の鍵」の受け口(byok)の形にする。
// S3 の部品(conversation/voiceKey.js・elevenDirect.js・voiceKeyForm.js)が入った線でだけ読める。
// index.js は、これを import() で読み、読めなければ(S3 の部品がまだ無い線)使わずに進む。
// - 鍵はこの端末のブラウザの中だけ(S3 の voiceKey.js)。私たちのサーバーには送らない
// - 入れた鍵は、短い 1 文(3 字)で使えるかを確かめてから覚える(S3 の checkVoiceKey)
// - 話すのは、舞台の読み上げ(S3 の speaker.js)。鍵があれば声のサービスへ直接、無ければレトロ音と文字送り
import { getVoiceKey, isPlausibleVoiceKey, setVoiceKey } from '../../conversation/voiceKey.js';
import { checkVoiceKey } from '../../conversation/elevenDirect.js';
import { VOICE_KEY_HELP } from '../../conversation/voiceKeyForm.js';

export const VOICE_KEY_SHAPE = '声の鍵の形が違うみたい(英数字だけで、20 字以上)';

/**
 * @param {{app:object, check?:typeof checkVoiceKey}} o check は試験で差しかえる
 */
export function createByok({ app, check = checkVoiceKey }) {
  return {
    available: () => Boolean(getVoiceKey()),
    canRemember: () => true,
    notice: () => VOICE_KEY_HELP,
    async useKey(key, { remember = false } = {}) {
      const k = String(key ?? '').trim();
      if (!isPlausibleVoiceKey(k)) return { ok: false, message: VOICE_KEY_SHAPE }; // 形が違えば、声のサービスに聞かない
      const r = await check(k, { voiceId: app?.speaker?.voiceId });
      if (!r?.ok) return { ok: false, message: r?.message ?? '声の鍵を確かめられませんでした' };
      setVoiceKey(k, { remember });
      return { ok: true };
    },
    speak: (text) => app.speaker.enqueue(text),
  };
}
