// 読み上げ。サーバーの /api/tts から PCM(16bit・24kHz)を流し読みして、WebAudio で隙間なくつなぐ。
// - 文ごとに取りに行き、前の文を話している間に次の文を用意する
// - 出力の大きさ(RMS)から口の開きを作る
// - stop() で、取得も再生も止める(割り込まれたとき)
// - 読み上げが使えないとき(鍵なし・上限)は、音なしで同じ長さだけ口を動かす(字幕は出る)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Speaker {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.nextTime = 0;
    this.sources = new Set();
    this.aborts = new Set();
    this.chain = Promise.resolve();
    this.pending = 0;
    this.epoch = 0;
    this.timers = new Set();
    this.fakeUntil = 0;
    this._level = 0;
    this.ttsError = null; // 読み上げが使えない理由(使えるなら null)
    this.fetchLog = [];
    this.fillers = []; // あいづちの声 { text, samples(Float32Array), ms }
    this.lastFiller = -1;
  }

  /** あいづちの声を、サーバーから読んでおく(前もって作られた物。無ければ何もしない) */
  async loadFillers() {
    try {
      const list = (await (await fetch('/api/fillers')).json()).fillers ?? [];
      this.fillers = await Promise.all(
        list.map(async (f) => {
          const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
          const view = new DataView(bytes.buffer, 0, bytes.length - (bytes.length % 2));
          const samples = new Float32Array(view.byteLength / 2);
          for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          return { text: f.text, samples, ms: Math.round((samples.length / 24000) * 1000) };
        }),
      );
    } catch (err) {
      console.warn('あいづちの声を読めませんでした:', err.message);
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
    return this.pending > 0 || this.sources.size > 0 || performance.now() < this.fakeUntil;
  }

  /** 口の開き(0〜1)。毎フレーム呼ぶ */
  level() {
    let target = 0;
    if (this.analyser && this.sources.size) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += v * v;
      target = clamp(Math.sqrt(sum / this.buf.length) * 6, 0, 1);
    } else if (performance.now() < this.fakeUntil) {
      const t = performance.now() / 1000;
      target = 0.35 + 0.35 * Math.abs(Math.sin(t * 9)) * (0.6 + 0.4 * Math.sin(t * 2.3));
    }
    this._level += (target - this._level) * 0.5;
    return this._level;
  }

  /**
   * 1 文を追加する。すぐに音声の取得を始め、順番が来たら再生する。
   * @returns {Promise<void>} この文を話し終えたら解決する
   */
  enqueue(text, { onStart, onFirstByte } = {}) {
    const epoch = this.epoch;
    this.pending += 1;
    const abort = new AbortController();
    this.aborts.add(abort);
    const chunks = this._pump(this._fetchPcm(text, abort.signal, onFirstByte));
    const done = this.chain.then(() => (epoch === this.epoch ? this._play(text, chunks, epoch, onStart) : undefined));
    this.chain = done.catch(() => {}).finally(() => {
      this.aborts.delete(abort);
    });
    return done
      .catch((err) => {
        if (epoch === this.epoch) console.warn('読み上げでエラー:', err.message);
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
      });
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
    let res;
    try {
      res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      this.ttsError = '通信できません';
      return;
    }
    if (!res.ok) {
      let reason = `読み上げが使えません (${res.status})`;
      try {
        reason = (await res.json()).error ?? reason;
      } catch {
        // そのまま
      }
      this.ttsError = reason;
      return;
    }
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

  async _play(text, chunks, epoch, onStart) {
    let started = false;
    const begin = (startAt) => {
      started = true;
      const delay = Math.max(0, (startAt - this.ctx.currentTime) * 1000);
      this._later(() => {
        if (epoch === this.epoch) onStart?.(performance.now());
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
    if (!started) {
      // 音が取れなかった(鍵なし・上限・通信できない)。同じ長さだけ口を動かして字幕を出す
      const now = this.ctx ? this.ctx.currentTime : 0;
      const startAt = Math.max(now + 0.03, this.nextTime);
      const dur = clamp(text.length * 0.16 + 0.4, 0.8, 8);
      this.nextTime = startAt + dur;
      if (this.ctx) begin(startAt);
      else this._later(() => epoch === this.epoch && onStart?.(performance.now()), 0);
      const startMs = performance.now() + Math.max(0, (startAt - now) * 1000);
      this.fakeUntil = Math.max(this.fakeUntil, startMs + dur * 1000);
    }
    // この文が終わるまで待つ(次の文は、その間に先に用意されている)
    const wait = this.ctx ? Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) : 0;
    await new Promise((resolve) => this._later(resolve, wait));
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
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.nextTime = 0;
    this.fakeUntil = 0;
    this.pending = 0;
    this.chain = Promise.resolve();
    this._level = 0;
  }
}
