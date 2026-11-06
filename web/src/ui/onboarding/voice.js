// 声の出し方を 1 つにまとめる(初めての会話と性格の画面が使う)。
// - none       : 文字送り(1 字ずつ)+レトロ RPG 風の効果音。音は WebAudio の矩形波をその場で鳴らすだけ(録音・保存・送信なし)
// - browser    : この端末の読み上げ(speechSynthesis)。無い端末は none と同じ
// - elevenlabs : (1) 使う人の鍵(BYOK。会話の流れ S3 の部品を byok として受け取る)
//                (2) 会話サーバーに声の鍵がある(/api/status の tts.available)ときは、サーバーの読み上げ(Speaker)
//                どちらも無いときは none と同じ。鍵の受け口(byok.useKey)がある時だけ、7 歩目で鍵を入れられる
// byok の形: { useKey(key, { remember }) → { ok, message }, speak(text, { pitch, rate }) → Promise, available() → bool,
//             notice() → 何をどこへ送るかの説明, canRemember() → bool }(鍵そのものは、ここでは持たない)

const PUNCT = /[\s、。,.!?！？…「」]/u;

/** レトロな効果音。最初のタップの中で unlock() を呼ぶ(ブラウザの決まり) */
export function createBlipper() {
  let ctx = null;
  let count = 0;
  let played = 0;
  return {
    unlock() {
      try {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        ctx ??= new AC({ latencyHint: 'interactive' });
        if (ctx.state !== 'running') ctx.resume();
      } catch {
        ctx = null;
      }
    },
    /** 1 回鳴らす。音が出せない(未許可・対応なし)ときは数えるだけ */
    blip({ pitch = 1, who = 'char', volume = 0.045 } = {}) {
      count += 1;
      if (!ctx || ctx.state !== 'running') return false;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const base = who === 'guide' ? 440 : 660;
      osc.frequency.setValueAtTime(base * pitch * (0.95 + ((count * 37) % 11) / 100), t);
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
      played += 1;
      return true;
    },
    stats: () => ({ count, played, running: Boolean(ctx && ctx.state === 'running') }),
  };
}

const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * el に text を 1 字ずつ出す。signal が止まったら、残りを一度に出す(押すと飛ばせる)。
 * @returns {Promise<number>} 出すのにかかった ms
 */
export function crawl(el, text, { cps = 26, onChar, signal, instant = reducedMotion() } = {}) {
  const t0 = performance.now();
  const all = [...String(text)];
  return new Promise((resolve) => {
    if (instant || !all.length) {
      el.textContent = text;
      resolve(0);
      return;
    }
    let i = 0;
    el.textContent = '';
    const tick = () => {
      if (signal?.aborted) {
        el.textContent = text;
        resolve(performance.now() - t0);
        return;
      }
      i += 1;
      el.textContent = all.slice(0, i).join('');
      const ch = all[i - 1];
      if (onChar && !PUNCT.test(ch) && i % 2 === 1) onChar(ch);
      if (i >= all.length) {
        resolve(performance.now() - t0);
        return;
      }
      setTimeout(tick, (1000 / cps) * (/[、。!?！？…]/u.test(ch) ? 5 : 1));
    };
    tick();
  });
}

const browserVoiceOk = () => typeof globalThis.speechSynthesis?.speak === 'function' && typeof globalThis.SpeechSynthesisUtterance === 'function';

function speakBrowser(text, { pitch = 1, rate = 1 } = {}) {
  return new Promise((resolve) => {
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.pitch = pitch;
    u.rate = rate;
    const done = () => resolve();
    u.onend = done;
    u.onerror = done;
    setTimeout(done, 400 + [...text].length * 260); // 終わりの知らせが来ない端末でも止まらない
    globalThis.speechSynthesis.cancel();
    globalThis.speechSynthesis.speak(u);
  });
}

/**
 * @param {object} [o]
 * @param {object} [o.app] main.js の app(status・speaker を読む)。無くてもよい
 * @param {object} [o.byok] 使う人の鍵の部品(S3)。無ければ鍵は入れられない
 */
export function createVoice({ app = null, byok = null, blipper = createBlipper() } = {}) {
  const serverOk = () => Boolean(app?.status?.tts?.available && app?.speaker && !app.speaker.ttsError);
  const byokOk = () => Boolean(byok?.available?.());
  /** その出し方で、本物の声が出せるなら、使う道の名前(byok・server・browser)。出せなければ null */
  const realVoice = (provider) => {
    if (provider === 'elevenlabs') return byokOk() ? 'byok' : serverOk() ? 'server' : null;
    if (provider === 'browser') return browserVoiceOk() ? 'browser' : null;
    return null;
  };
  return {
    blipper,
    realVoice,
    /** 鍵の部品を後から渡す(S3 の部品は import() で読むので、少し遅れて届く) */
    setByok(next) {
      byok = next ?? null;
    },
    canTakeKey: () => typeof byok?.useKey === 'function',
    canRemember: () => Boolean(byok?.canRemember?.()),
    notice: () =>
      byok?.notice?.() ?? '鍵は読み上げにだけ使います。読み上げる文字は ElevenLabs へ送られ、使った分の料金が鍵の持ち主にかかります。',
    async useKey(key, opts) {
      if (typeof byok?.useKey !== 'function') return { ok: false, message: '鍵の受け口がありません' };
      return byok.useKey(key, opts);
    },
    unlock() {
      blipper.unlock();
      try {
        app?.speaker?.unlock?.();
      } catch {
        // 音の許可が取れなくても、文字送りは続ける
      }
    },
    /**
     * 本物の声で話す。返り値は使った道の名前。本物の声が無ければ null(呼ぶ側が文字送りにする)
     * @param {string} text
     * @param {{voice:{provider:string,pitch:number,rate:number}}} settings
     */
    async speak(text, settings) {
      const v = settings?.voice ?? {};
      const way = realVoice(v.provider);
      if (way === 'byok') await byok.speak(text, { pitch: v.pitch, rate: v.rate });
      else if (way === 'server') await app.speaker.enqueue(text);
      else if (way === 'browser') await speakBrowser(text, { pitch: v.pitch, rate: v.rate });
      return way;
    },
  };
}
