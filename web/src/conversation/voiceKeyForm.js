// 「声の鍵」の欄(画面の部品)。使う人が自分の ElevenLabs の鍵を入れると、キャラが本物の声で話す(BYOK)。
// 使い方(S4 の初めての会話・S5 の設定から 1 行で): mountVoiceKeyForm(parent, { onReady }) → { root, refresh }
// - 鍵はこの端末のブラウザの中だけ。私たちのサーバーには送らない。既定は「覚えない」(画面を閉じると消える)
// - 入れたら、短い 1 文(3 字)で使えるかを確かめる。使えたら onReady(「声が出せるようになったよ、ありがとう!」)
// 文字は textContent だけで入れる。
import { checkVoiceKey } from './elevenDirect.js';
import { clearVoiceKey, getVoiceKey, isPlausibleVoiceKey, isVoiceKeyRemembered, maskVoiceKey, setVoiceKey } from './voiceKey.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

export const VOICE_KEY_HELP = '鍵はこの端末の中だけで使い、私たちのサーバーには送りません。読み上げる文だけが声のサービス(ElevenLabs)に届き、あなたの鍵の枠を使います。';

/**
 * @param {HTMLElement} parent
 * @param {{onReady?:(message:string)=>void, onCleared?:()=>void, voiceId?:string}} [o]
 */
export function mountVoiceKeyForm(parent, { onReady, onCleared, voiceId } = {}) {
  const input = el('input', { type: 'password', placeholder: '声の鍵(ElevenLabs)', autocomplete: 'off', spellcheck: false, className: 'vk-input' });
  input.setAttribute('autocapitalize', 'off');
  const remember = el('input', { type: 'checkbox', className: 'vk-remember' });
  const rememberLabel = el('label', { className: 'vk-remember-label' }, remember, ' この端末に覚えておく(しなければ、画面を閉じると消えます)');
  const useBtn = el('button', { type: 'button', className: 'vk-use', textContent: '声を使う' });
  const clearBtn = el('button', { type: 'button', className: 'vk-clear', textContent: '鍵を消す' });
  const status = el('p', { className: 'vk-status', role: 'status' });
  const root = el(
    'section',
    { className: 'voice-key', ariaLabel: '声の鍵' },
    el('h2', { textContent: '声の鍵' }),
    el('p', { className: 'vk-help', textContent: VOICE_KEY_HELP }),
    el('div', { className: 'vk-row' }, input, useBtn),
    rememberLabel,
    clearBtn,
    status,
  );
  parent.append(root);

  const refresh = () => {
    const k = getVoiceKey();
    status.textContent = k ? `声の鍵: ${maskVoiceKey(k)}(${isVoiceKeyRemembered() ? 'この端末に覚えています' : 'この画面の間だけ'})` : '声の鍵はまだありません。無くても、文字と効果音で話せます';
    clearBtn.hidden = !k;
  };

  useBtn.addEventListener('click', async () => {
    const k = input.value.trim();
    if (!isPlausibleVoiceKey(k)) {
      status.textContent = '声の鍵の形が違うみたい(英数字だけで、20 字以上)';
      return;
    }
    useBtn.disabled = true;
    status.textContent = '確かめています…';
    const r = await checkVoiceKey(k, { voiceId });
    useBtn.disabled = false;
    input.value = ''; // 入れた鍵を欄に残さない
    if (!r.ok) {
      status.textContent = r.message;
      return;
    }
    setVoiceKey(k, { remember: remember.checked });
    refresh();
    onReady?.(r.message);
  });

  clearBtn.addEventListener('click', () => {
    clearVoiceKey();
    refresh();
    onCleared?.();
  });

  refresh();
  return { root, refresh };
}
