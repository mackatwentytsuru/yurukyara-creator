// 会話の 1 ターンを進める。
// サーバーから thought / say が順に届く。say が届くたびに読み上げを始め、
// その文が話し始める瞬間に、表情・動き・視線・字幕を合わせる。
// 返事が来るまでの間は、うなずきでつなぐ。割り込まれたら cancel() で全部止める。
import { streamChat } from './brainClient.js';

export const NOD_AT_MS = [350, 1700]; // 返事が始まるまで、この時刻にうなずく(話し終わりから)

export class Dialogue {
  /**
   * @param {object} deps
   * @param {import('../character/characterBase.js').CharacterBase} deps.character
   * @param {import('./speaker.js').Speaker} deps.speaker
   * @param {object} deps.ui thought / say / error / caption を受ける
   * @param {() => object} deps.getContext 見えている様子・キャラ・場所
   * @param {(spec:string, ms:number) => (number[]|null)} deps.setGaze 'person' | 'away' | 'landmark:名前'
   * @param {(entry:object) => void} deps.onMetric
   */
  constructor({ character, speaker, ui, getContext, setGaze, onMetric }) {
    Object.assign(this, { character, speaker, ui, getContext, setGaze, onMetric });
    this.history = [];
    this.abort = null;
    this.timers = [];
    this.turnId = 0;
    this.busy = false;
    this.brain = 'unknown';
  }

  cancel() {
    this.turnId += 1;
    this.abort?.abort();
    this.abort = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.speaker.stop();
    this.character.setMouth(0);
    this.ui.caption(null);
    this.busy = false;
  }

  /**
   * @param {{text?:string, trigger?:string|null, t0?:number, mode?:'voice'|'text'}} turn
   *   t0: ユーザーが話し終えた時刻(performance.now())。声でないときは送信した時刻
   */
  async send({ text = '', trigger = null, t0 = performance.now(), mode = 'text' } = {}) {
    this.cancel();
    const id = this.turnId;
    this.busy = true;
    const ac = new AbortController();
    this.abort = ac;
    const ctx = this.getContext();
    const m = { mode, t0, tSend: performance.now(), tFirstSay: null, tAudio: null, ttsFirstByteMs: null, brain: this.brain, tts: 'eleven' };
    let sayCount = 0;
    const spoken = [];
    if (trigger !== 'approach') this.ui.userSaid(text);

    // 返事が来るまでの、うなずき
    for (const at of NOD_AT_MS) {
      const wait = Math.max(0, t0 + at - performance.now());
      this.timers.push(
        setTimeout(() => {
          if (id === this.turnId && m.tAudio === null) this.character.play('nod');
        }, wait),
      );
    }

    const body = {
      history: this.history,
      text,
      trigger,
      scene: ctx.scene,
      character: ctx.character,
      place: ctx.place,
      expressions: this.character.expressions,
    };

    try {
      await streamChat(
        body,
        (ev) => {
          if (id !== this.turnId) return;
          if (ev.type === 'meta') {
            this.brain = ev.brain;
            m.brain = ev.brain;
          } else if (ev.type === 'thought') {
            this.ui.thought(ev);
          } else if (ev.type === 'say') {
            if (m.tFirstSay === null) m.tFirstSay = performance.now();
            sayCount += 1;
            const isFirst = sayCount === 1;
            spoken.push(ev.text);
            this.speaker
              .enqueue(ev.text, {
                onFirstByte: (ms) => {
                  if (isFirst) m.ttsFirstByteMs = ms;
                },
                onStart: (tNow) => {
                  if (id !== this.turnId) return;
                  if (m.tAudio === null) m.tAudio = tNow;
                  this._performSay(ev);
                },
              })
              .then(() => {
                if (id === this.turnId && spoken.length === sayCount && this.speaker.pending === 0) this.ui.caption(null, 1200);
              });
          } else if (ev.type === 'error') {
            this.ui.error(ev.message);
          }
        },
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) this.ui.error(err.message);
    }
    if (id !== this.turnId) return;
    this.history.push({ role: 'user', content: trigger === 'approach' ? '(お客さんが近づいてきた)' : text });
    if (spoken.length) this.history.push({ role: 'assistant', content: spoken.join('') });
    this.busy = false;
    // 音が出た瞬間を待って記録する
    const waitStart = () => {
      if (id !== this.turnId) return;
      if (m.tAudio !== null) this._report(m);
      else if (this.speaker.pending > 0) setTimeout(waitStart, 50);
    };
    waitStart();
  }

  _performSay(ev) {
    this.character.setEmotion(ev.expression, ev.expression === 'neutral' ? 0 : 0.9);
    const pos = this.setGaze(ev.gaze, 2400); // 目印を見るときは、その場所(ワールド座標)が返る
    if (ev.motion && ev.motion !== 'none') this.character.play(ev.motion, pos ? { dx: pos[0], dz: pos[2] } : {});
    this.ui.say(ev);
    this.ui.caption(ev.text);
  }

  _report(m) {
    const entry = {
      mode: m.mode,
      brain: m.brain,
      tts: this.speaker.ttsError ? 'silent' : 'eleven',
      totalMs: Math.round(m.tAudio - m.t0),
      sendToFirstSayMs: m.tFirstSay ? Math.round(m.tFirstSay - m.tSend) : null,
      ttsFirstByteMs: m.ttsFirstByteMs ? Math.round(m.ttsFirstByteMs) : null,
      t0ToSendMs: Math.round(m.tSend - m.t0),
    };
    entry.valid = entry.brain === 'haiku' && entry.tts === 'eleven';
    this.onMetric(entry);
  }
}
