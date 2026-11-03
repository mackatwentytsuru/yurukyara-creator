// 聞き取り。マイクの声の有無(VAD)を自前で見て、文字にする部分は「聞き取りの提供元」に任せる。
// 提供元は 2 つ:
//   web    … ブラウザ内蔵の聞き取り(Web Speech API。Chrome は Google、Safari は Apple のサービスに音を送る)
//   server … このページを配っているサーバーへ声の区間を送る(/api/stt)。Quest のブラウザには Web Speech API が無い報告があるので、こちらを使う
import { encodeWav, resample, SegmentCollector, STT_RATE } from './wav.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MIN_SEGMENT_S = 0.3; // これより短い音は、声でないとみなして送らない
const BUSY_TAIL_MS = 300; // キャラが話し終えた直後の響きを、声と間違えない
// マイクの音を集める係。描画と同じ流れ(ScriptProcessor)だと、VR の描画が重いときに音が欠けて、字が崩れた(実測)。音の専用の流れで動かす
const CAPTURE_WORKLET = `registerProcessor('stt-capture', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
});`;

export function webSpeechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export class Listener {
  /**
   * @param {object} cb
   * @param {(text:string)=>void} cb.onInterim 途中の文字(server では、声が出たときの「…」)
   * @param {(text:string, info:{lastVoicedAt:number})=>void} cb.onFinal 話し終えて確定した文字
   * @param {(active:boolean)=>void} cb.onVoice 声が出た/止まった(割り込みの判定に使う)
   * @param {(msg:string)=>void} cb.onError
   * @param {()=>void} [cb.onEmpty] server で、声を送ったのに文字にならなかった
   * @param {object} [opts]
   * @param {'web'|'server'} [opts.provider]
   * @param {()=>boolean} [opts.isBusy] server で、キャラが話している(このあいだの音は聞かない。スピーカーが近いヘッドセットでの自分の声の拾い込みを防ぐ)
   */
  constructor(cb, { provider = 'web', isBusy = () => false } = {}) {
    this.cb = cb;
    this.provider = provider;
    this.isBusy = isBusy;
    this.listening = false;
    this.voiceActive = false;
    this.lastVoicedAt = 0;
    this.level = 0;
    this.floor = 0.01;
    this.transcribing = 0; // サーバーで文字にしている最中の区間の数
    this._voiceSince = 0;
    this._silentSince = 0;
    this._busyUntil = 0;
  }

  async start() {
    if (this.listening) return;
    if (this.provider === 'web' && !webSpeechSupported()) throw new Error('このブラウザは声の聞き取りに対応していません');
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
    if (this.provider === 'server') {
      await this._startCapture(src);
      fetch('/api/stt/warm', { method: 'POST' }).catch(() => {}); // 最初の 1 回が遅くならないよう、先に用意してもらう
    } else {
      this._startRecognition();
    }
  }

  stop() {
    this.listening = false;
    clearInterval(this.vadTimer);
    try {
      this.recognition?.stop();
    } catch {
      // すでに止まっている
    }
    this.capture?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.voiceActive = false;
  }

  _vad() {
    if (this.provider === 'server' && this._ignoreWhileBusy()) return;
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
        if (this.collector) {
          this.collector.begin();
          this.cb.onInterim('…');
        }
        this.cb.onVoice(true);
      }
      if (this.collector?.full) {
        this._sendSegment();
        this.collector.begin();
      }
    } else {
      // 静かなときだけ、雑音の大きさを覚える
      this.floor += (clamp(rms, 0.002, 0.05) - this.floor) * 0.02;
      this._voiceSince = 0;
      if (!this._silentSince) this._silentSince = now;
      if (this.voiceActive && now - this._silentSince > 450) {
        this.voiceActive = false;
        this._sendSegment();
        this.cb.onVoice(false);
      }
    }
  }

  /** キャラが話している間と、その直後は、聞かない(途中の区間も捨てる) */
  _ignoreWhileBusy() {
    const now = performance.now();
    if (this.isBusy()) this._busyUntil = now + BUSY_TAIL_MS;
    if (now >= this._busyUntil) return false;
    this.collector?.cancel();
    this.voiceActive = false;
    this._voiceSince = 0;
    this._silentSince = 0;
    return true;
  }

  /** マイクの音を集める(声の区間だけを、あとでサーバーへ送る) */
  async _startCapture(src) {
    this.collector = new SegmentCollector({ rate: this.ctx.sampleRate });
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' })));
    this.capture = new AudioWorkletNode(this.ctx, 'stt-capture', { numberOfOutputs: 0 });
    this.capture.port.onmessage = (e) => this.collector.push(e.data);
    src.connect(this.capture);
  }

  async _sendSegment() {
    const pcm = this.collector?.end();
    if (!pcm || pcm.length < this.ctx.sampleRate * MIN_SEGMENT_S) return;
    const lastVoicedAt = this.lastVoicedAt;
    this.transcribing += 1;
    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: encodeWav(resample(pcm, this.ctx.sampleRate, STT_RATE)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `聞き取りのサーバー (${res.status})`);
      if (!this.listening) return;
      if (data.text) this.cb.onFinal(data.text, { lastVoicedAt });
      else this.cb.onEmpty?.();
    } catch (err) {
      this.cb.onError(`聞き取りでエラー: ${err.message}`);
    } finally {
      this.transcribing -= 1;
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
