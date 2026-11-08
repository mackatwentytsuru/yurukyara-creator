// 聞き取り。マイクの声の有無(VAD)を自前で見て、文字にする部分は「聞き取りの提供元」に任せる。
// 提供元は 2 つ:
//   web    … ブラウザ内蔵の聞き取り(Web Speech API。Chrome は Google、Safari は Apple のサービスに音を送る)
//   server … このページを配っているサーバーへ声の区間を送る(/api/stt)。Quest のブラウザには Web Speech API が無い報告があるので、こちらを使う
import { encodeWav, resample, SegmentCollector, STT_RATE } from './wav.js';
import { getSttHint, sttHintHeaders } from './sttHint.js';
import { SR_LANG, normalizeHearLang } from './lang.js'; // ML1: 多言語の聞き取り
import { sttLangHeaders } from './hearLang.js';
// BUX: 「マイクとスピーカー」の窓で選んだマイク。既定でないマイクは PC の聞き取りへ。音が来ない時は画面へ知らせる
import { AUDIO_WORDS, NOTE_EVENT, SILENT_EVENT, createSilenceWatch, decideListening, isDefaultMic, loadChoice, micConstraints, resolveDevice, serverSttAvailable, splitDevices, tell } from './audioDevices.js';
// 11-08 本人の iPhone: カメラを入れたまま取り直す・ブラウザの聞き取りが使えない時は PC の聞き取りへ自動で替える・止まった原因の報告
import { openMicStream } from './micStream.js';
import { beginRecording, endRecording, getMicWithSession, reassertRecording } from './audioSession.js'; // iPhone: マイクを開く前に音の使い方を「録音も再生も」へ。閉じたら再生用へ戻す
import { FALLBACK_WORDS, isFallbackError, shouldFallToServer } from './sttFallback.js';
import { micFailureText, recognitionErrorText } from '../stage/micNotice.js';

const MIC_BASE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// B13V: ずっと聞き続ける(ハンズフリー)ための決まり
const RESTART_MS = 200; // ブラウザの聞き取りが終わってから、始め直すまで
const RESTART_MAX_MS = 3000; // 始めてすぐ終わる(1 秒未満)のが続く時の、待ちの上限(同じ失敗を 0.2 秒ごとに繰り返さない)
const QUICK_END_MS = 1000;
const NET_RETRY_MAX = 3; // PC の聞き取りが無い時の、ネットワークの失敗の連続の許し(超えたら止めて知らせる)
const NET_RETRY_STEP_MS = 800;
const REOPEN_MAX = 3; // マイクの取り直しを、30 秒に何回まで許すか(超えたら止めて知らせる。無限に繰り返さない)
const REOPEN_WINDOW_MS = 30000;
const RESUME_WAIT_MS = 1500; // 戻った時の AudioContext.resume を待つ上限(iPhone では返事が来ないことがある)
export const LISTEN_WORDS = Object.freeze({
  netRetry: 'つながりにくいので、聞き取りをつなぎ直しているよ',
  reopened: 'マイクを取り直したよ。そのまま話してね',
});

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
  constructor(cb, { provider = 'web', isBusy = () => false, hint = getSttHint, lang = () => 'ja' } = {}) {
    this.cb = cb;
    this.hint = hint;
    this.lang = lang; // ML1: 聞く言葉(ja・en・zh・ko)を返す関数。日本語だけの時は、いつも 'ja'(今までと同じ)
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
    // B13V: ハンズフリーの見張り
    this._startPromise = null; // 聞き始めている最中の約束(許可の窓が開いている間も)
    this._startAborted = false; // 始めている最中に stop() された(答えが来たらすぐ閉じる)
    this._recTimer = null; // ブラウザの聞き取りの始め直しの予約(1 つだけ)
    this._recQuick = 0; // 始めてすぐ終わった回数の連続
    this._nextDelay = 0;
    this._netFails = 0;
    this._pageHook = null;
    this._returning = false;
    this._reopenLog = [];
  }

  /** 聞き始めている最中か(許可の窓が開いている間など)。2 回目のタップで取り消すために、画面側が見る */
  get starting() {
    return this._startPromise !== null;
  }

  /**
   * 聞き始める。聞いている最中・始めている最中に呼んでも、2 本目は作らず、同じ約束を返す。
   * 始めている最中に stop() されたら、マイクの答えが来た時にすぐ閉じる(エラーにはしない)。
   */
  start() {
    if (this.listening) return Promise.resolve();
    if (this._startPromise) return this._startPromise;
    this._startAborted = false;
    const p = this._doStart().finally(() => {
      if (this._startPromise === p) this._startPromise = null;
    });
    this._startPromise = p;
    return p;
  }

  async _doStart() {
    this._recognitionDead = false;
    this._netFails = 0;
    this._recQuick = 0;
    // BUX: 選んだマイク。既定でないマイクは、その音を PC の聞き取りへ(ブラウザの聞き取りは既定のマイクしか使えない)
    const plan = await micPlan(this.baseProvider);
    if (this._startAborted) return;
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
      const open = (audio) => openMicStream((c) => getMicWithSession((x) => navigator.mediaDevices.getUserMedia(x), c),{ audio }, { cameraOn: this.cb.cameraOn?.() === true, holdCamera: this.cb.holdCamera });
      let stream;
      try {
        stream = await open(micConstraints(MIC_BASE, plan.chosen, !plan.useChosen));
        this.micLabel = plan.useChosen ? plan.chosen.label : '';
      } catch (err) {
        if (this._startAborted || !plan.useChosen || !['OverconstrainedError', 'NotFoundError'].includes(err?.name)) throw err;
        // 選んだマイクが抜かれた: 頼まれた道と既定のマイクに戻す
        tell(NOTE_EVENT, { text: AUDIO_WORDS.gone });
        this.provider = this.baseProvider;
        this._checkWebSupport();
        stream = await open({ ...MIC_BASE });
        this.micLabel = '';
      }
      // QA8 ③: 許可の窓が開いている間に「はなす」をもう 1 回押された(= stop())。答えが来ても、マイクを開けたままにしない
      if (this._startAborted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this._watchStream(stream);
      stage = 'audio-setup';
      this._silence = createSilenceWatch({ startedAt: performance.now() });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // iPhone では、押した後に作った AudioContext が止まったまま(suspended)で、音が 0 のままになることがある
      if (this.ctx.state === 'suspended') this.ctx.resume?.().catch(() => {});
      // 電話・Siri などで止められた時は、前に戻っていれば自分で動かし直す
      this.ctx.onstatechange = () => {
        const st = this.ctx?.state;
        if (this.listening && !this._isHidden() && (st === 'suspended' || st === 'interrupted')) this.ctx.resume?.().catch(() => {});
      };
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.src = src;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
      this.listening = true;
      this.vadTimer = setInterval(() => this._vad(), 40);
      this._hookPage();
      if (this.provider === 'server') {
        stage = 'capture';
        await this._startCapture(src);
        if (this._startAborted) {
          this.stop();
          return;
        }
        fetch('/api/stt/warm', { method: 'POST' }).catch(() => {}); // 最初の 1 回が遅くならないよう、先に用意してもらう
      } else {
        stage = 'recognition';
        this._startRecognition();
      }
    } catch (err) {
      // 始めている最中に止められた後の失敗(断った・取れなかった)は、もう誰も待っていない。静かに終える
      if (this._startAborted) {
        this.stop();
        return;
      }
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

  /** 聞くのをやめる。何度呼んでも安全(閉じた物は閉じ直さない)。始めている最中に呼ぶと、マイクの答えが来た時に閉じる */
  stop() {
    if (this._startPromise) this._startAborted = true;
    this.listening = false;
    clearInterval(this.vadTimer);
    clearTimeout(this._recTimer);
    this._recTimer = null;
    this._unhookPage();
    const rec = this.recognition;
    this.recognition = null; // 古い物の知らせ(onend など)は、もう受けない
    if (rec) {
      try {
        rec.stop();
      } catch {
        // すでに止まっている
      }
    }
    this.capture?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close()?.catch?.(() => {});
    this.voiceActive = false;
    if (this._recSession) {
      this._recSession = false;
      endRecording(); // マイクを閉じた: 声を出す側の「再生用」へ戻す
    }
  }

  /* ---------- B13V: ハンズフリー(ずっと聞き続ける)の見張り ---------- */

  _isHidden() {
    return globalThis.document?.visibilityState === 'hidden';
  }

  /** ページが前に戻った・タブが戻った時に、聞き取りを生き返らせる(止まっていたら動かし直す) */
  _hookPage() {
    if (this._pageHook) return;
    const doc = globalThis.document;
    const win = globalThis.window;
    const onVis = () => void this._onReturn();
    doc?.addEventListener?.('visibilitychange', onVis);
    win?.addEventListener?.('pageshow', onVis);
    this._pageHook = () => {
      doc?.removeEventListener?.('visibilitychange', onVis);
      win?.removeEventListener?.('pageshow', onVis);
    };
  }

  _unhookPage() {
    const off = this._pageHook;
    this._pageHook = null;
    off?.();
  }

  /** マイクの流れが外から閉じられた(別の物がマイクを取った・iPhone が閉じた)時の見張り */
  _watchStream(stream) {
    for (const t of stream.getTracks()) {
      t.addEventListener?.('ended', () => {
        if (this.stream !== stream || !this.listening || this._isHidden()) return; // 隠れている間は、戻った時(_onReturn)にまとめて見る
        void this._reopen();
      });
    }
  }

  /**
   * 前に戻った時: ①音の使い方をそろえ直す ②止まった AudioContext を動かす ③マイクの流れが閉じていたら取り直す
   * ④ブラウザの聞き取りが止まっていたら始め直す。何も起きていなければ、何もしない
   */
  async _onReturn() {
    if (!this.listening || this._returning || this._isHidden()) return;
    this._returning = true;
    try {
      reassertRecording();
      const ctx = this.ctx;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        // iPhone では resume の返事が来ないことがあるので、待つのは少しだけ
        await Promise.race([Promise.resolve(ctx.resume?.()).catch(() => {}), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
      }
      if (!this.listening) return;
      const tracks = this.stream?.getTracks?.() ?? [];
      if (tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')) {
        await this._reopen();
        return;
      }
      if (this.provider === 'web' && !this.recognition && !this._recTimer && !this._recognitionDead) this._startRecognition();
      this.cb.onRevived?.();
    } finally {
      this._returning = false;
    }
  }

  /** マイクを一度閉じて取り直す。30 秒に REOPEN_MAX 回を超えたら、繰り返さず止めて知らせる。取れなければ止めて知らせる */
  async _reopen() {
    const now = performance.now();
    this._reopenLog = this._reopenLog.filter((t) => now - t < REOPEN_WINDOW_MS);
    const tooMany = this._reopenLog.length >= REOPEN_MAX;
    this._reopenLog.push(now);
    this.stop();
    try {
      if (tooMany) throw Object.assign(new Error('reopen-loop'), { name: 'ReopenLoop', stage: 'reopen' });
      await this.start();
      this.cb.onNotice?.(LISTEN_WORDS.reopened);
      this.cb.onRevived?.();
    } catch (err) {
      const text = micFailureText(err);
      this.cb.onError(text);
      this.cb.onNotice?.(text);
      this.cb.onStopped?.();
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

  /** いま聞く言葉(ja・en・zh・ko)。取れない・知らない値は 'ja' */
  _langNow() {
    try {
      return normalizeHearLang(this.lang()) ?? 'ja';
    } catch {
      return 'ja';
    }
  }

  /**
   * 聞く言葉を替えた時に呼ぶ(多言語の時のマイクの選び)。ブラウザの聞き取りは、いまの聞き取りを止めて、新しい言葉で始め直す
   * (止まると rec.onend が、新しい言葉で 200ms 後に始め直す)。PC の聞き取りは、次の区間から新しい言葉で送る
   */
  setLang() {
    if (!this.listening || this.provider !== 'web') return;
    try {
      this.recognition?.stop();
    } catch {
      // すでに止まっている
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
        headers: { 'content-type': 'audio/wav', ...sttHintHeaders(this._hintNow()), ...sttLangHeaders(this._langNow()) },
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

  /**
   * ブラウザの聞き取りの始め直しを予約する(予約は 1 つだけ。2 回呼んでも 2 本にならない)。
   * 隠れているタブでは始めない(始めても許されない)。前に戻った時(_onReturn)に始める
   */
  _scheduleRecognition(delay = RESTART_MS) {
    if (!this.listening || this._recognitionDead || this.provider !== 'web' || this._recTimer) return;
    this._recTimer = setTimeout(() => {
      this._recTimer = null;
      if (this.listening && !this._recognitionDead && this.provider === 'web') this._startRecognition();
    }, delay);
  }

  /** いまのブラウザの聞き取りを、知らせを受けないようにして閉じる(作り直す前に必ず。2 本が同時に動かないように) */
  _dropRecognition() {
    const old = this.recognition;
    this.recognition = null;
    if (!old) return;
    old.onresult = old.onerror = old.onend = null;
    try {
      old.abort?.();
    } catch {
      // すでに止まっている
    }
  }

  _startRecognition() {
    // 呼ぶ側(予約・戻った時・聞き始め)が聞いているかを見てから呼ぶ。ここでは、道が違う・もう使えない時だけ止める
    if (this._recognitionDead || this.provider !== 'web') return;
    clearTimeout(this._recTimer);
    this._recTimer = null;
    if (this._isHidden()) return; // 隠れている間は始めない。前に戻った時に _onReturn が始める
    this._dropRecognition();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    const startedAt = performance.now();
    const mine = () => this.recognition === rec; // 古い物(作り直し前・止めた後)の知らせは捨てる
    rec.lang = SR_LANG[this._langNow()] ?? 'ja-JP'; // ML1: 日本語は今までの 'ja-JP' のまま
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (!mine()) return;
      this._netFails = 0; // 何か届いた = つながっている
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
      if (!mine()) return;
      // 話さなかった・こちらで止めた: 何もしない(このあと onend が来て、自分で始め直す)
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      // つながらない(network)で PC の聞き取りが無い時は、少し待ってつなぎ直す(ハンズフリーを一時の通信の乱れで止めない)。続いたら止めて知らせる
      if (e.error === 'network' && !serverSttAvailable()) {
        this._netFails += 1;
        if (this._netFails <= NET_RETRY_MAX) {
          this._nextDelay = NET_RETRY_STEP_MS * this._netFails;
          if (this._netFails === 1) this.cb.onNotice?.(LISTEN_WORDS.netRetry);
          return;
        }
      }
      // 許可されない・音を取れない・つながらない: 作り直しても同じなので、PC の聞き取りへ替える(無ければ、止めて知らせる)
      if (isFallbackError(e.error)) {
        void this._recognitionFailed(e.error, e);
        return;
      }
      this.cb.onError(`聞き取りでエラー: ${e.error}`);
    };
    rec.onend = () => {
      if (!mine()) return;
      this.recognition = null;
      // 始めてすぐ終わるのが続く時は、待ちを倍にしていく(0.2 → 0.4 → 0.8 … 上限 3 秒)。ふつうに続いたあとの終わりは 0.2 秒で始め直す
      this._recQuick = performance.now() - startedAt < QUICK_END_MS ? this._recQuick + 1 : 0;
      const wait = Math.min(RESTART_MS * 2 ** Math.min(this._recQuick, 5), RESTART_MAX_MS);
      const delay = Math.max(this._recQuick > 1 ? wait : RESTART_MS, this._nextDelay);
      this._nextDelay = 0;
      this._scheduleRecognition(delay);
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
    clearTimeout(this._recTimer);
    this._recTimer = null;
    this._dropRecognition();
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
    const text = recognitionErrorText(code) ?? recognitionErrorText('start-failed');
    this.cb.onError(text);
    this.cb.onNotice?.(text); // スマホでも見える所へ(onError だけだと、畳まれた欄の中にしか出ない)
    this.stop();
    this.cb.onStopped?.();
  }
}
