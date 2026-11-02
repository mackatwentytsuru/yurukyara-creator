// 聞き取り。マイクの声の有無(VAD)を自前で見て、文字にする部分は「聞き取りの提供元」に任せる。
// 提供元はいま 1 つ: ブラウザ内蔵の聞き取り(Web Speech API。Chrome は Google、Safari は Apple のサービスに音を送る)。
// クラウドの聞き取り(ElevenLabs Scribe など)を足すときは、同じ形(start/stop/onInterim/onFinal)で差し替える。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function webSpeechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class Listener {
  /**
   * @param {object} cb
   * @param {(text:string)=>void} cb.onInterim 途中の文字
   * @param {(text:string, info:{lastVoicedAt:number})=>void} cb.onFinal 話し終えて確定した文字
   * @param {(active:boolean)=>void} cb.onVoice 声が出た/止まった(割り込みの判定に使う)
   * @param {(msg:string)=>void} cb.onError
   */
  constructor(cb) {
    this.cb = cb;
    this.listening = false;
    this.voiceActive = false;
    this.lastVoicedAt = 0;
    this.level = 0;
    this.floor = 0.01;
    this._voiceSince = 0;
    this._silentSince = 0;
  }

  async start() {
    if (this.listening) return;
    if (!webSpeechSupported()) throw new Error('このブラウザは声の聞き取りに対応していません');
    // 声の有無を見るためのマイク(エコーは打ち消す)
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    src.connect(this.analyser);
    this.listening = true;
    this.vadTimer = setInterval(() => this._vad(), 40);
    this._startRecognition();
  }

  stop() {
    this.listening = false;
    clearInterval(this.vadTimer);
    try {
      this.recognition?.stop();
    } catch {
      // すでに止まっている
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.voiceActive = false;
  }

  _vad() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    const rms = Math.sqrt(sum / this.samples.length);
    this.level = rms;
    const now = performance.now();
    const threshold = Math.max(0.025, this.floor * 3);
    if (rms > threshold) {
      this.lastVoicedAt = now;
      this._silentSince = 0;
      if (!this._voiceSince) this._voiceSince = now;
      if (!this.voiceActive && now - this._voiceSince > 160) {
        this.voiceActive = true;
        this.cb.onVoice(true);
      }
    } else {
      // 静かなときだけ、雑音の大きさを覚える
      this.floor += (clamp(rms, 0.002, 0.05) - this.floor) * 0.02;
      this._voiceSince = 0;
      if (!this._silentSince) this._silentSince = now;
      if (this.voiceActive && now - this._silentSince > 450) {
        this.voiceActive = false;
        this.cb.onVoice(false);
      }
    }
  }

  _startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) this.cb.onFinal(text, { lastVoicedAt: this.lastVoicedAt });
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) this.cb.onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.cb.onError(`聞き取りでエラー: ${e.error}`);
    };
    rec.onend = () => {
      if (this.listening) setTimeout(() => this._startRecognition(), 200);
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.cb.onError(err.message);
    }
  }
}
