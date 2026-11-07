// 読み上げ。PCM(16bit・24kHz)を流し読みして、WebAudio で隙間なくつなぐ。
// - 声の取り先: 使う人の声の鍵(BYOK)があれば、ブラウザから声のサービスへ直接(鍵はサーバーへ送らない)。無ければ手元のサーバーの /api/tts
// - 文ごとに取りに行き、前の文を話している間に次の文を用意する
// - 出力の大きさ(RMS)から口の開きを作る
// - stop() で、取得も再生も止める(割り込まれたとき)
// - 声が使えないとき(鍵なし・上限・公開のリンク)は、レトロ RPG 風の「ピッ」と文字送りで話す(retroVoice.js)。音を切っていれば文字送りだけ
//   このときの口は、文字送りの予定で動かす(文字が出ている間は開け閉めし、句読点の間と話し終わりで閉じる)。
//   「ピッ」の音の大きさからは作らない: 小さい音なので、口が半分しか開かなかった(11-06 合わせ②の話す試験で 0.69 → 0.33)。
// - 声の役(男の子・女の子): 性格の画面で選んだ値(setVoiceChoice)か、その子の人格の文から決まる役で話す(voiceRole.js)。
//   声の鍵の道は役の声で直接、サーバーの道は話す役(voice)と、その子自身の声の id(あれば)を送る。あいづちの声も役の組を使う
// - 読み方の表(speechReading.js。例: 執事 → しつじ)は、声に渡す文だけに当てる。字幕と文字送りは、もとの文のまま(11-07 第 11b 波)
import { recordedNod } from './nods.js'; // B3(第 12 波 b): 相づちは録ってある声で
import { ROLE_DEFAULT_VOICES } from './voiceRole.js';
import { getVoiceKey } from './voiceKey.js';
import { describeElevenError, fetchElevenPcm } from './elevenDirect.js';
import { RETRO, crawlSchedule, isPause, scheduleRetro, voiceFor } from './retroVoice.js';
import { toSpeechText } from './speechReading.js';
import { VOICE_MODEL_ID, isVoiceId, normalizeVoiceChoice, resolveVoice } from './voiceRole.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SERVER_TTS_OFF = new Set([404, 405, 429, 501, 503]); // サーバーに声が無い・上限: この画面の間は聞きに行かない
// サーバーが 204 と印(x-tts-reason)で「声なし」と返した時の理由(11-07 CRITux 25: 鍵が無い時の 503 を 204 にした)
const SERVER_TTS_REASON = { 'no-key': '読み上げの鍵がありません' };
export const NO_SERVER_VOICE = '声のサーバーがありません';

export class Speaker {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.nextTime = 0;
    this.wallNext = 0; // 音が使えないときの、画面の時計での次の文の始まり(ms)
    this.sources = new Set(); // 声(読み上げ・あいづち)の音。口の開きはこの音の大きさから作る
    this.retroNodes = new Set(); // 「ピッ」の発振器。鳴っている間は話している扱い。口の開きには使わない
    this.quiet = []; // 文字送りの中で口を閉じる時間 [始め, 終わり](this.clock の ms)。句読点の間など
    this.clock = () => performance.now(); // 画面の時計(試験で差し替える)
    this.aborts = new Set();
    this.chain = Promise.resolve();
    this.pending = 0;
    this.epoch = 0;
    this.timers = new Set();
    this.fakeUntil = 0;
    this._level = 0;
    this.ttsError = null; // 読み上げが使えない理由(使えるなら null)
    this.fetchLog = [];
    this.fillers = []; // あいづちの声 { text, samples(Float32Array), ms }(今の役の組)
    this.fillerSets = null; // 役ごとの組 { male, female }(サーバーが役ごとに返した時)
    this.lastFiller = -1;
    this.voiceChoice = 'auto'; // 性格の画面で選んだ声('auto' | 'male' | 'female'。setVoiceChoice)
    this.voicePersona = ''; // 役を決める人格の文(setVoiceChoice・会話の 1 回ごとに Dialogue が渡す)
    this.ownVoiceId = null; // その子の声の id(setVoice で決め打ちした時。人格の文の「声の id」が先)
    this.retro = true; // 声が無いとき「ピッ」を鳴らすか(false なら文字送りだけ)
    this.retroVoice = voiceFor('');
    this.serverTtsOff = null; // サーバーに声が無いと分かった理由(分かったら、この画面の間は聞きに行かない)
    this.voiceKeyStatus = null; // 声の鍵で頼んだときの、最後の失敗の番号
  }

  /**
   * キャラごとの声。voiceId はその子自身の声(形の正しい id だけ。人格の文の「声の id」が先)、seed はレトロの「ピッ」の高さと音色を決める名前。
   * @param {{voiceId?:string, seed?:string}} o
   */
  setVoice({ voiceId, seed } = {}) {
    if (voiceId !== undefined) this.ownVoiceId = isVoiceId(voiceId) ? voiceId : null;
    if (seed !== undefined) this.retroVoice = voiceFor(seed);
  }

  /**
   * 声の役を選ぶ(性格の画面の「おまかせ / 男の子 / 女の子」。S4 は voiceRole.js の applyVoiceChoice から呼ぶ)。
   * 選んだ値は、次に呼ぶまで残る(舞台の子を替えた時は、その子の値で呼び直す)。
   * @param {string} choice 'auto' | 'male' | 'female'(ほかの値は 'auto')
   * @param {{persona?: string}} [o] その子の人格の文(省くと前の文のまま。空の文も受ける)
   * @returns {{choice: string, role: 'male'|'female', voiceId: string}}
   */
  setVoiceChoice(choice, { persona } = {}) {
    this.voiceChoice = normalizeVoiceChoice(choice);
    if (typeof persona === 'string') this.voicePersona = persona;
    return this._afterVoiceChange();
  }

  /**
   * 会話の 1 回ごとに、今の子の人格の文を受け取る(Dialogue が渡す。おまかせの役は、いつも今の子の文から決まる)。
   * 空の文は受けない(人格の文を読む前の回で、性格の画面が渡した文を消さないため)。
   */
  setVoicePersona(persona) {
    if (typeof persona !== 'string' || !persona.trim() || persona === this.voicePersona) return;
    this.voicePersona = persona;
    this._afterVoiceChange();
  }

  /** 今の声 { choice, role, voiceId(声の鍵の道で使う id), ownVoiceId(その子自身の声を使う時の id。無ければ null) } */
  currentVoice() {
    return resolveVoice({ choice: this.voiceChoice, persona: this.voicePersona, ownVoiceId: this.ownVoiceId });
  }

  /** 声の鍵(BYOK)の道で使う声の id(初めての会話の 7 歩目が、鍵を確かめる時に読む) */
  get voiceId() {
    return this.currentVoice().voiceId;
  }

  /** 役が替わったら、あいづちの声もその役の組にする */
  _afterVoiceChange() {
    const v = this.currentVoice();
    if (this.fillerSets) this.fillers = this.fillerSets[v.role] ?? [];
    return { choice: v.choice, role: v.role, voiceId: v.voiceId };
  }

  /**
   * 画面を配るサーバーに声があるか(main.js が /api/status を読んだ後に渡す。公開の URL には /api/status も /api/tts も無い)。
   * false なら、この画面の間は /api/tts を聞きに行かない(無い道を聞くと、console に 404 の赤い行が出る)。
   * true に戻すと、また聞きに行く(この知らせで止めていた時だけ)。声の鍵(BYOK)の道は、どちらでも使える。
   * @param {boolean} available
   */
  setServerVoice(available) {
    if (available) {
      if (this.serverTtsOff === NO_SERVER_VOICE) this.serverTtsOff = null;
    } else if (!this.serverTtsOff) {
      this.serverTtsOff = NO_SERVER_VOICE;
    }
  }

  /**
   * あいづちの声を、サーバーから読んでおく(前もって作られた物。無ければ何もしない)。
   * サーバーが役ごとの組(roles)を返せば両方を読み、今の役の組を使う(役が替わると組も替わる)。
   */
  async loadFillers() {
    const decode = (list) =>
      Promise.all(
        (Array.isArray(list) ? list : []).map(async (f) => {
          const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
          const view = new DataView(bytes.buffer, 0, bytes.length - (bytes.length % 2));
          const samples = new Float32Array(view.byteLength / 2);
          for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          return { text: f.text, samples, ms: Math.round((samples.length / 24000) * 1000) };
        }),
      );
    try {
      const data = await (await fetch('/api/fillers')).json();
      if (data?.roles && typeof data.roles === 'object') {
        const [male, female] = await Promise.all([decode(data.roles.male), decode(data.roles.female)]);
        this.fillerSets = { male, female };
        this.fillers = this.fillerSets[this.currentVoice().role] ?? [];
      } else {
        this.fillerSets = null;
        this.fillers = await decode(data?.fillers);
      }
    } catch (err) {
      console.warn('あいづちの声を読めませんでした:', err.message);
      this.fillerSets = null;
      this.fillers = [];
    }
    return this.fillers.length;
  }

  /**
   * あいづちの声を 1 つ出す。同じ言葉が続かないよう、前に出した物は避ける。
   * 本当の返事の声は、あとに続けて(これが終わってから)再生される。
   * @returns {{text:string, ms:number}|null} 出せなければ null
   */
  playFiller({ onStart } = {}) {
    if (!this.ctx || !this.fillers.length) return null;
    let i;
    do i = Math.floor(Math.random() * this.fillers.length);
    while (this.fillers.length > 1 && i === this.lastFiller);
    this.lastFiller = i;
    const f = this.fillers[i];
    const buffer = this.ctx.createBuffer(1, f.samples.length, 24000);
    buffer.copyToChannel(f.samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    const startAt = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    const delay = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
    this._later(() => onStart?.(performance.now()), delay);
    return { text: f.text, ms: f.ms };
  }

  /** ユーザーのタップの中で呼ぶ。iPhone の Safari は、これが無いと音が出ない */
  unlock() {
    // iPhone の消音スイッチ(サイレントモード)が入っていても、音を出す(iOS 17 から。Web Audio だけの音は、消音スイッチで消えるため)
    try {
      if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = 'playback';
    } catch {
      // 対応していない・許されない端末は、そのまま
    }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, 24000);
    s.connect(this.ctx.destination);
    s.start(0);
  }

  get speaking() {
    return this.pending > 0 || this.sources.size > 0 || this.retroNodes.size > 0 || this.clock() < this.fakeUntil;
  }

  /** 口の開き(0〜1)。毎フレーム呼ぶ。声があれば音の大きさから、声が無ければ文字送りの予定から作る */
  level() {
    let target = 0;
    const now = this.clock();
    if (this.analyser && this.sources.size) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += v * v;
      target = clamp(Math.sqrt(sum / this.buf.length) * 6, 0, 1);
    } else if (now < this.fakeUntil && !this._isQuiet(now)) {
      const t = now / 1000;
      target = 0.35 + 0.35 * Math.abs(Math.sin(t * 9)) * (0.6 + 0.4 * Math.sin(t * 2.3));
    }
    this._level += (target - this._level) * 0.5;
    return this._level;
  }

  /** 文字送りの中で、口を閉じている時間か(過ぎた分は捨てる) */
  _isQuiet(now) {
    if (this.quiet.length && this.quiet[0][1] <= now) this.quiet = this.quiet.filter(([, to]) => to > now);
    return this.quiet.some(([from, to]) => from <= now && now < to);
  }

  /**
   * 声が無い文の口の予定: 文字が出始めてから出終わるまで動かし、句読点で止まる間と、出始めるまでは閉じる。
   * @param {number} startMs 文字が出始める時刻(this.clock の ms)
   */
  _mouthForCrawl(startMs, steps, totalMs) {
    const now = this.clock();
    if (startMs > now) this.quiet.push([now, startMs]);
    for (const [k, s] of steps.entries()) {
      if (!isPause(s.ch)) continue;
      const next = k + 1 < steps.length ? steps[k + 1].atMs : totalMs;
      this.quiet.push([startMs + s.atMs, startMs + next]);
    }
    this.fakeUntil = Math.max(this.fakeUntil, startMs + totalMs);
  }

  /**
   * 1 文を追加する。すぐに音声の取得を始め、順番が来たら再生する。
   * onStart(時刻, {crawl}) は話し始め。crawl が true なら、字幕は onCrawl(見えている文字) で 1 字ずつ届く(声が無いとき)
   * @returns {Promise<void>} この文を話し終えたら解決する
   */
  enqueue(text, { onStart, onFirstByte, onCrawl } = {}) {
    const epoch = this.epoch;
    this.pending += 1;
    const abort = new AbortController();
    this.aborts.add(abort);
    // B3(第 12 波 b): 相づちだけの文(「はい。」など)は、録ってある声で話す(声のサービスに頼まない = 声の文字数を使わない・すぐ出る)
    const clip = this._recordedNod(text);
    const chunks = this._pump(clip ? recordedPcm(clip, onFirstByte) : this._fetchPcm(text, abort.signal, onFirstByte));
    const done = this.chain.then(() => (epoch === this.epoch ? this._play(text, chunks, epoch, onStart, onCrawl) : undefined));
    this.chain = done.catch(() => {}).finally(() => {
      this.aborts.delete(abort);
    });
    return done
      .catch((err) => {
        if (epoch === this.epoch && err?.name !== 'AbortError') console.warn('読み上げでエラー:', err.message);
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
      });
  }

  /**
   * B3(第 12 波 b): この文が、録ってある相づちの声(今の役の組)と同じなら、その声 { text, samples }。違えば null。
   * 端末の声で読む時・その子自身の声が役の既定と違う時は使わない(声がちがって聞こえるため)
   */
  _recordedNod(text) {
    if (!this.fillers.length || this.deviceVoice === true || this._deviceVoiceOn?.()) return null;
    const v = this.currentVoice();
    if (v.ownVoiceId && v.ownVoiceId !== ROLE_DEFAULT_VOICES[v.role]) return null;
    const said = recordedNod(text, this.fillers.map((f) => f.text));
    return said ? (this.fillers.find((f) => f.text === said) ?? null) : null;
  }

  /** 取得をすぐ始めて、取れた分をためておく(順番が来る前に次の文を用意するため) */
  _pump(gen) {
    const queue = [];
    let finished = false;
    let wake = null;
    (async () => {
      try {
        for await (const c of gen) {
          queue.push(c);
          wake?.();
        }
      } catch {
        // 止められた・通信できなかった。取れた分だけを使う
      }
      finished = true;
      wake?.();
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length) {
            yield queue.shift();
            continue;
          }
          if (finished) return;
          await new Promise((r) => (wake = r));
        }
      },
    };
  }

  async *_fetchPcm(text, signal, onFirstByte) {
    const t0 = performance.now();
    // 声の鍵(BYOK)があれば、声のサービスへ直接頼む(鍵は手元のサーバーに送らない)
    const key = getVoiceKey();
    if (!key && this.serverTtsOff) {
      this.ttsError = this.serverTtsOff;
      return;
    }
    // 話す役と声(性格の画面の値 → その子の人格の文 → 女の子)。サーバーへは役と、その子自身の声の id だけを送る
    const voice = this.currentVoice();
    // 声に渡す文だけ、読み方の表を当てる(字幕・文字送りは _play が、もとの text で出す)
    const spoken = toSpeechText(text);
    let res;
    try {
      res = key
        ? await fetchElevenPcm(spoken, { key, voiceId: voice.voiceId, modelId: VOICE_MODEL_ID, signal })
        : await fetch('/api/tts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: spoken, voice: voice.role, ...(voice.ownVoiceId ? { voiceId: voice.ownVoiceId } : {}) }),
            signal,
          });
    } catch (err) {
      if (signal.aborted) return;
      this.ttsError = '通信できません';
      return;
    }
    if (!res.ok) {
      if (key) {
        this.voiceKeyStatus = res.status;
        this.ttsError = describeElevenError(res.status);
        return;
      }
      let reason = `読み上げが使えません (${res.status})`;
      try {
        reason = (await res.json()).error ?? reason;
      } catch {
        // そのまま
      }
      this.ttsError = reason;
      if (SERVER_TTS_OFF.has(res.status)) this.serverTtsOff = reason;
      return;
    }
    if (!key && (res.status === 204 || res.headers?.get?.('x-tts') === 'off' || !res.body)) {
      // サーバーに声の鍵が無い(失敗ではない。字幕と「ピッ」で話す)。この画面の間は聞きに行かない
      const reason = SERVER_TTS_REASON[res.headers?.get?.('x-tts-reason') ?? ''] ?? '読み上げが使えません';
      this.ttsError = reason;
      this.serverTtsOff = reason;
      return;
    }
    if (key) this.voiceKeyStatus = null;
    this.ttsError = null;
    const reader = res.body.getReader();
    let first = true;
    let rest = null;
    while (true) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      if (first) {
        first = false;
        const ms = performance.now() - t0;
        this.fetchLog.push(ms);
        onFirstByte?.(ms);
      }
      let bytes = value;
      if (rest) {
        const merged = new Uint8Array(rest.length + value.length);
        merged.set(rest);
        merged.set(value, rest.length);
        bytes = merged;
        rest = null;
      }
      const usable = bytes.length - (bytes.length % 2);
      if (usable < bytes.length) rest = bytes.slice(usable);
      if (usable === 0) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
      const out = new Float32Array(usable / 2);
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
      yield out;
    }
  }

  async _play(text, chunks, epoch, onStart, onCrawl) {
    let started = false;
    const begin = (startAt, info = { crawl: false }) => {
      started = true;
      const delay = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
      this._later(() => {
        if (epoch === this.epoch) onStart?.(performance.now(), info);
      }, delay);
    };
    for await (const samples of chunks) {
      if (epoch !== this.epoch) return;
      if (!this.ctx) continue;
      const buffer = this.ctx.createBuffer(1, samples.length, 24000);
      buffer.copyToChannel(samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      const startAt = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
      src.start(startAt);
      this.nextTime = startAt + buffer.duration;
      this.sources.add(src);
      src.onended = () => this.sources.delete(src);
      if (!started) begin(startAt);
    }
    // この文が終わるまで待つ(次の文は、その間に先に用意されている)
    const wait = !started ? this._retro(text, epoch, onStart, onCrawl) : this.ctx ? Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) : 0;
    await new Promise((resolve) => this._later(resolve, wait));
  }

  /**
   * 声が取れなかった(鍵なし・上限・通信できない)文を、文字送りと「ピッ」で話す。
   * 音が使えない(まだタップされていない・音を切っている)ときは、文字送りと口の動きだけ。
   */
  _retro(text, epoch, onStart, onCrawl) {
    const info = { crawl: true };
    const { steps, totalMs } = crawlSchedule(text);
    const durMs = Math.max(totalMs, 400) + RETRO.tailMs;
    let baseMs;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const startAt = Math.max(now + 0.03, this.nextTime);
      this.nextTime = startAt + durMs / 1000;
      baseMs = Math.max(0, (startAt - now) * 1000);
      if (this.retro && this.analyser) {
        for (const osc of scheduleRetro(this.ctx, this.analyser, steps, this.retroVoice, startAt)) {
          this.retroNodes.add(osc);
          osc.onended = () => this.retroNodes.delete(osc);
        }
      }
    } else {
      // 音がまだ使えない(タップの前): 画面の時計で順番に並べる
      const nowMs = this.clock();
      const startMs = Math.max(nowMs + 30, this.wallNext);
      this.wallNext = startMs + durMs;
      baseMs = startMs - nowMs;
    }
    // 口は、音を鳴らしても切っていても同じ予定で動かす(文字が出ている間だけ)
    this._mouthForCrawl(this.clock() + baseMs, steps, totalMs);
    this._later(() => epoch === this.epoch && onStart?.(performance.now(), info), baseMs);
    for (const s of steps) this._later(() => epoch === this.epoch && onCrawl?.(s.shown), baseMs + s.atMs);
    return baseMs + durMs;
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  /** 取得も再生も止める(割り込まれたとき・次の返事の前) */
  stop() {
    this.epoch += 1;
    for (const a of this.aborts) a.abort();
    this.aborts.clear();
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // もう止まっている
      }
    }
    this.sources.clear();
    for (const osc of this.retroNodes) {
      try {
        osc.stop();
      } catch {
        // もう止まっている
      }
    }
    this.retroNodes.clear();
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.nextTime = 0;
    this.wallNext = 0;
    this.fakeUntil = 0;
    this.quiet = [];
    this.pending = 0;
    this.chain = Promise.resolve();
    this._level = 0;
  }
}

/** B3(第 12 波 b): 録ってある声を、取ってきた声と同じ流れ(1 かたまり)で渡す。最初のバイトは 0 ms */
async function* recordedPcm(clip, onFirstByte) {
  onFirstByte?.(0);
  yield clip.samples;
}
