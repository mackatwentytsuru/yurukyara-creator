// 声の入出力(window.KioskIO)。画面(kiosk.js)より前に読まれ、既存の聞き取り(Listener)と読み上げ(Speaker)をつなぐ。
// 聞き取りの提供元: ブラウザ内蔵(Web Speech)が使えればそれ、無ければサーバーの /api/stt。?stt=server で強制できる。
// ?voice=0 で声の入出力を付けない(文字だけ)。ベンダーが決まったら、この 1 ファイルを差し替えるだけでよい。
import { Listener, webSpeechSupported } from '/kiosk/conv/listener.js';
import { Speaker } from '/kiosk/conv/speaker.js';

const params = new URLSearchParams(location.search);

/** 画面に渡す声の入出力を作る。提供元・ブラウザの差は、ここで吸収する */
export function createKioskIO({ provider } = {}) {
  const speaker = new Speaker();
  const textHandlers = new Set();
  const interimHandlers = new Set();
  let listener = null;

  // ブラウザは、人が触るまで音を出せない(iPhone は特に)。最初の 1 回の触りで音の出口を開ける
  const unlock = () => {
    try {
      speaker.unlock();
    } catch {
      // 音の出口が開けなくても、字幕と文字の入力は動かす
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true, passive: true });

  const pick = provider ?? (params.get('stt') === 'server' || !webSpeechSupported() ? 'server' : 'web');

  const stt = {
    provider: pick,
    get listening() {
      return Boolean(listener?.listening);
    },
    async start() {
      if (listener?.listening) return;
      unlock();
      listener = new Listener(
        {
          onInterim: (t) => interimHandlers.forEach((h) => h(t)),
          // 自分の読み上げを聞き返して質問にしないよう、話している間の確定は捨てる
          onFinal: (t) => {
            if (speaker.speaking) return;
            textHandlers.forEach((h) => h(t));
          },
          onVoice: () => {},
          onError: (m) => interimHandlers.forEach((h) => h(`(聞き取れません: ${m})`)),
        },
        { provider: pick, isBusy: () => speaker.speaking },
      );
      await listener.start();
    },
    stop() {
      listener?.stop();
    },
    onText(cb) {
      textHandlers.add(cb);
    },
    onInterim(cb) {
      interimHandlers.add(cb);
    },
  };

  const tts = {
    speaker,
    /** 1 文を読み上げる。割り込まれたら解決して終わる */
    speak: (text) => speaker.enqueue(text),
    stop: () => speaker.stop(),
  };

  return { stt, tts };
}

if (params.get('voice') !== '0') window.KioskIO = createKioskIO();
