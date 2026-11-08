// 聞き取り。マイクの声の有無(VAD)を自前で見て、文字にする部分は「聞き取りの提供元」に任せる。
// 提供元は 2 つ:
//   web    … ブラウザ内蔵の聞き取り(Web Speech API。Chrome は Google、Safari は Apple のサービスに音を送る)
//   server … このページを配っているサーバーへ声の区間を送る(/api/stt)。Quest のブラウザには Web Speech API が無い報告があるので、こちらを使う
import { encodeWav, resample, SegmentCollector, STT_RATE } from './wav.js';
import { getSttHint, sttHintHeaders } from './sttHint.js';
// BUX: 「マイクとスピーカー」の窓で選んだマイク。既定でないマイクは PC の聞き取りへ。音が来ない時は画面へ知らせる
import { AUDIO_WORDS, NOTE_EVENT, SILENT_EVENT, createSilenceWatch, decideListening, isDefaultMic, loadChoice, micConstraints, resolveDevice, serverSttAvailable, splitDevices, tell } from './audioDevices.js';
// 11-08 本人の iPhone: カメラを入れたまま取り直す・ブラウザの聞き取りが使えない時は PC の聞き取りへ自動で替える・止まった原因の報告
import { openMicStream } from './micStream.js';
import { beginRecording, endRecording, ensureRecordType } from './audioSession.js'; // iPhone: マイクを開く前に音の使い方を「録音も再生も」へ。閉じたら再生用へ戻す
import { FALLBACK_WORDS, isFallbackError, shouldFallToServer } from './sttFallback.js';
import { recognitionErrorText } from '../stage/micNotice.js';

const MIC_BASE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** 覚えている選びと今の一覧から、この回の聞き取りの道とマイクを決める */
export async function micPlan(baseProvider, { choice = loadChoice(), enumerate = () => navigator.mediaDevices.enumerateDevices(), serverOk = serverSttAvailable() } = {}) {
  const chosen0 = choice?.mic ?? null;
  if (!chosen0) return { provider: baseProvider, useChosen: false, chosen: null, note: '' };
  let mics = [];
  try {
    mics = splitDevices(await enumerate()).mics;
  } catch {
    // 一覧が取れない時は、選んだ時の印で決める
  }
  const chosen = resolveDevice(mics, chosen0) ?? chosen0;
  const plan = decideListening(baseProvider, { chosen, isDefault: isDefaultMic(mics, { ...chosen, def: chosen0.def }), serverOk });
  return { ...plan, chosen };
}

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
   * @param {(msg:string)=>void} [cb.onNotice] 聞き取りの道を自動で替えた時の、やさしい一言
   * @param {(provider:'web'|'server')=>void} [cb.onProvider] 聞き取りの道が替わった(注意書きを直す)
   * @param {()=>void} [cb.onStopped] 聞き取りが自分で止まった(ボタンの見た目を戻す)
   * @param {()=>boolean} [cb.cameraOn] カメラが入っているか(マイクの取り直しに使う)
   * @param {()=>(()=>void)} [cb.holdCamera] カメラの映像を一瞬止める。戻す関数を返す
   * @param {(event:object)=>void} [cb.report] 失敗の報告(名前・提供元・段だけ。音も文字も入れない)
   * @param {object} [opts]
   * @param {'web'|'server'} [opts.provider]
   * @param {()=>boolean} [opts.isBusy] server で、キャラが話している(このあいだの音は聞かない。スピーカーが近いヘッドセットでの自分の声の拾い込みを防ぐ)
   * @param {()=>string} [opts.hint] server で、聞き取りの手がかりにする言葉(話しかけているキャラの名前)。無ければ会話が入れた名前(sttHint.js)
   */
  constructor(cb, { provider = 'web', isBusy = () => false, hint = getSttHint } = {}) {
    this.cb = cb;
    this.hint = hint;
    this.provider = provider;
    this.baseProvider = provider; // 頼まれた道(選んだマイクで server に替えても、ここは変えない)
    this.micLabel = ''; // 使っているマイクの名前(選んだ時だけ)
    this.isBusy = isBusy;
    this.listening = false;
    this.voiceActive = false;
    this.lastVoicedAt = 0;
    this.level = 0;
    this.floor = 0.01;
    this.transcribing = 0; // サーバーで文字にしている最中の区間の数
    // 区間ごとの時刻(performance.now())。声の区間が閉じた → 送った → 字が返った、を残す(遅延の測定用。音も字も入れない)
    this.timings = [];
    this._closedAt = 0;
    this._voiceSince = 0;
    this._silentSince = 0;
    this._busyUntil = 0;
  }

  async start() {
    if (this.listening) return;
    // BUX: 選んだマイク。既定でないマイクは、その音を PC の聞き取りへ(ブラウザの聞き取りは既定のマイクしか使えない)
    const plan = await micPlan(this.baseProvider);
    this.provider = plan.provider;
    if (plan.note) tell(NOTE_EVENT, { text: plan.note });
    this._checkWebSupport();
    // 失敗した時に、どの段で止まったかを名前に添える(画面の写真と報告で原因を探すため。音も文字も入れない)
    let stage = 'mic-open';
    // iPhone: 再生用のままだと getUserMedia が InvalidStateError で断られる。開く前に「録音も再生も」へ(閉じる時に stop() が戻す)
    beginRecording();
    this._recSession = true;
    try {
      // 声の有無を見るためのマイク(エコーは打ち消す)。カメラが入っていて失敗したら、1 回だけ取り直す(micStream.js)
      const open = (audio) => openMicStream((c) => { ensureRecordType(); return navigator.mediaDevices.getUserMedia(c); }, { audio }, { cameraOn: this.cb.cameraOn?.() === true, holdCamera: this.cb.holdCamera });
      try {
        this.stream = await open(micConstraints(MIC_BASE, plan.chosen, !plan.useChosen));
        this.micLabel = plan.useChosen ? plan.chosen.label : '';
      } catch (err) {
        if (!plan.useChosen || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) throw err;
        // 選んだマイクが抜かれた: 頼まれた道と既定のマイクに戻す
        tell(NOTE_EVENT, { text: AUDIO_WORDS.gone });
        this.provider = this.baseProvider;
        this._checkWebSupport();
        this.stream = await open({ ...MIC_BASE });
        this.micLabel = '';
      }
      stage = 'audio-setup';
      this._silence = createSilenceWatch({ startedAt: performance.now() });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // iPhone では、押した後に作った AudioContext が止まったまま(suspended)で、音が 0 のままになることがある
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch(() => {});
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.src = src;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
      this.listening = true;
      this.vadTimer = setInterval(() => this._vad(), 40);
      if (this.provider === 'server') {
        stage = 'capture';
        await this._startCapture(src);
        fetch('/api/stt/warm', { method: 'POST' }).catch(() => {}); // 最初の 1 回が遅くならないよう、先に用意してもらう
      } else {
        stage = 'recognition';
        this._startRecognition();
      }
    } catch (err) {
      // 途中まで開いた物(マイク・音の場)を残さない(マイクの印が付いたままにならない)
      this.stop();
      try {
        if (err && typeof err === 'object' && !err.stage) err.stage = stage;
      } catch {
        // 書き込めない失敗でも、そのまま投げる
      }
      throw err;
    }
  }

  /** ブラウザの聞き取りが無い時は、PC の聞き取りがあればそちらで聞く。どちらも無ければ投げる */
  _checkWebSupport() {
    if (this.provider !== 'web' || webSpeechSupported()) return;
    if (!serverSttAvailable()) throw new Error('このブラウザは声の聞き取りに対応していません');
    this.provider = 'server';
    this.cb.onNotice?.(FALLBACK_WORDS.missing);
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
    if (this._recSession) {
      this._recSession = false;
      endRecording(); // マイクを閉じた: 声を出す側の「再生用」へ戻す
    }
  }

  _vad() {
    if (this.provider === 'server' && this._ignoreWhileBusy()) {
      this._silence?.feed(0, performance.now(), true); // キャラが話している間は、音が来ない時間に数えない
      return;
    }
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    const rms = Math.sqrt(sum / this.samples.length);
    this.level = rms;
    const now = performance.now();
    // BUX: 押してから何秒か音がまったく来ない(消音・違うマイク)なら、画面へ 1 回だけ知らせる
    if (this._silence?.feed(rms, now, this.isBusy()) === 'silent') tell(SILENT_EVENT, { provider: this.provider, mic: this.micLabel });
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
        this._closedAt = now;
        // 話し終わりの合図(onVoice(false))で、あいづちを先に出す条件は「直近に途中の字が届いた」こと。server では声の出始めの「…」しか無く、
        // 2.5 秒を超える発話ではあいづちが字より後になった(実測)。閉じるときにも「…」を出して、条件を満たす
        if (this.collector) this.cb.onInterim('…');
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
    try {
      if (!this.ctx.audioWorklet) throw new Error('audioWorklet なし');
      await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' })));
      this.capture = new AudioWorkletNode(this.ctx, 'stt-capture', { numberOfOutputs: 0 });
      this.capture.port.onmessage = (e) => this.collector.push(e.data);
      src.connect(this.capture);
    } catch (err) {
      // 音の専用の流れを使えない(古い iPhone のブラウザなど): 同じ音を、古い道(ScriptProcessor)で集める。出力は無音
      if (typeof this.ctx.createScriptProcessor !== 'function') throw err;
      const node = this.ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => this.collector.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(node);
      node.connect(this.ctx.destination);
      this.capture = node;
    }
  }

  _hintNow() {
    try {
      return String(this.hint() ?? '');
    } catch {
      return ''; // 手がかりが取れなくても、聞き取りは止めない
    }
  }

  async _sendSegment() {
    const pcm = this.collector?.end();
    if (!pcm || pcm.length < this.ctx.sampleRate * MIN_SEGMENT_S) return;
    const lastVoicedAt = this.lastVoicedAt;
    this.transcribing += 1;
    const tm = { lastVoicedAt, closedAt: this._closedAt || null, sendAt: performance.now(), doneAt: null, serverMs: null, audioS: +(pcm.length / this.ctx.sampleRate).toFixed(2) };
    this.timings.push(tm);
    if (this.timings.length > 50) this.timings.shift();
    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav', ...sttHintHeaders(this._hintNow()) },
        body: encodeWav(resample(pcm, this.ctx.sampleRate, STT_RATE)),
      });
      const data = await res.json();
      tm.doneAt = performance.now();
      tm.serverMs = data.ms ?? null;
      if (!res.ok) throw new Error(data.error ?? `聞き取りのサーバー (${res.status})`);
      if (!this.listening) return;
      if (data.silent) tell(SILENT_EVENT, { provider: this.provider, mic: this.micLabel }); // BUX: サーバーが「音がほぼ 0」と答えた
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
      // 許可されない・音を取れない・つながらない: 作り直しても同じなので、PC の聞き取りへ替える(無ければ、止めて知らせる)
      if (isFallbackError(e.error)) {
        void this._recognitionFailed(e.error, e);
        return;
      }
      this.cb.onError(`聞き取りでエラー: ${e.error}`);
    };
    rec.onend = () => {
      if (this.listening && !this._recognitionDead) setTimeout(() => this._startRecognition(), 200);
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      void this._recognitionFailed('start-failed', err);
    }
  }

  /**
   * ブラウザの聞き取りが始められない・止まった時。PC の聞き取りがあれば、自動でそちらへ替えて一言そえる。
   * 無ければ、やさしい一言を出して聞くのをやめる(同じ失敗を 0.2 秒ごとに繰り返さない)。どちらも報告に残す(名前・提供元だけ)
   */
  async _recognitionFailed(code, err) {
    if (this._recognitionDead || !this.listening) return;
    this._recognitionDead = true;
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.abort?.();
      } catch {
        // すでに止まっている
      }
    }
    const fell = shouldFallToServer({ provider: this.provider, errorCode: code, serverOk: serverSttAvailable() });
    this.cb.report?.({ kind: fell ? 'voice-fallback' : 'voice-start-failed', error: { name: code, message: err?.message ?? '' }, provider: 'web', stage: 'recognition', fellBack: fell });
    if (fell) {
      try {
        this.provider = 'server';
        await this._startCapture(this.src);
        fetch('/api/stt/warm', { method: 'POST' }).catch(() => {});
        this.cb.onProvider?.('server');
        this.cb.onNotice?.(FALLBACK_WORDS.toServer);
        return;
      } catch {
        this.provider = 'web'; // 替えられなかった: 下で止めて知らせる
      }
    }
    this.cb.onError(recognitionErrorText(code) ?? recognitionErrorText('start-failed'));
    this.stop();
    this.cb.onStopped?.();
  }
}
