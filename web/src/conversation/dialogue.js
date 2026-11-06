// 会話の 1 ターンを進める。
// サーバーから thought / say が順に届く。say が届くたびに読み上げを始め、
// その文が話し始める瞬間に、表情・動き・視線・字幕を合わせる。
// 返事が来るまでの間は、うなずきでつなぐ。割り込まれたら cancel() で全部止める。
import { streamChat } from './brainClient.js';
import { redactSecrets } from './secrets.js';

export const SECRET_NOTICE = '鍵らしい文字は送らなかったよ。声の鍵は「声の鍵」の欄に入れてね';

export const NOD_AT_MS = [350, 1700]; // 返事が始まるまで、この時刻にうなずく(話し終わりから)
const FILLER_FRESH_MS = 4000; // 話し終わりの合図で先に出したあいづちは、この間なら、送るときに出し直さない

export const HISTORY_KEEP = 24; // サーバーが使うのは直近 12 件。画面側は余裕を見て 24 件だけ持つ(全部送ると、長い一日の後に本文が上限を超える)

/** 履歴を直近 keep 件にする。先頭は、いつも user から(assistant から始まる履歴は、API が受け付けない) */
export function trimHistory(history, keep = HISTORY_KEEP) {
  const tail = history.slice(-keep);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser < 0 ? [] : tail.slice(firstUser);
}

/** 返事を、モデルに指示した出力の形(1 行 1 つの JSON)に戻す */
export function assistantLines(sayEvents, thought) {
  return sayEvents
    .map((ev, i) => {
      const line = { type: 'say', text: ev.text, expression: ev.expression, motion: ev.motion, gaze: ev.gaze };
      if (i === 0 && thought) Object.assign(line, { intent: thought.intent, stage: thought.stage, handoff: thought.handoff });
      return JSON.stringify(line);
    })
    .join(String.fromCharCode(10));
}

export class Dialogue {
  /**
   * @param {object} deps
   * @param {import('../character/characterBase.js').CharacterBase} deps.character
   * @param {import('./speaker.js').Speaker} deps.speaker
   * @param {object} deps.ui thought / say / error / caption を受ける
   * @param {() => object} deps.getContext 見えている様子・キャラ・場所
   * @param {(spec:string, ms:number) => (number[]|null)} deps.setGaze 'person' | 'away' | 'landmark:名前'
   * @param {(entry:object) => void} deps.onMetric
   * @param {(ev:object) => void} [deps.onEvent] サーバーから届いたイベントを全部渡す(記憶の札の onChatEvent など)
   *   ui.notice(文) があれば、「仮の頭脳です」などの一言をそこへ出す
   */
  constructor({ character, speaker, ui, getContext, setGaze, onMetric, motionChoices, interview = false, onEvent = null }) {
    // interview: インタビューの型(返事 2 文まで・台本にしない)で答えさせる(入口の LED の ?interview=1)
    Object.assign(this, { character, speaker, ui, getContext, setGaze, onMetric, motionChoices, interview, onEvent });
    this.history = [];
    this.abort = null;
    this.timers = [];
    this.turnId = 0;
    this.busy = false;
    this.brain = 'unknown';
    this.pre = null; // 話し終わりの合図(声が止まった)で先に出した、あいづち { at, t0, fillerMs, fillerEndMs, text }
  }

  /**
   * 声が止まった(話し終わりらしい)ときに、先にあいづちの声を出す。確定した文字が来る前に、間をつなぐ。
   * 話し終わっていなかった(また話し出した)ときは、聞く側の割り込みの処理が止める。
   * @param {number} t0 声が最後に出ていた時刻
   */
  preFiller(t0) {
    if (this.busy || this.speaker.speaking) return false;
    const f = this.speaker.playFiller({
      onStart: (tNow) => {
        if (this.pre) this.pre.fillerMs = Math.round(tNow - t0);
        this.character.play('nod'); // うなずきと一緒に
      },
    });
    if (!f) return false;
    this.pre = { at: performance.now(), t0, fillerMs: null, fillerEndMs: Math.round(performance.now() - t0 + f.ms), text: f.text };
    return true;
  }

  cancel({ keepFiller = false } = {}) {
    this.turnId += 1;
    this.abort?.abort();
    this.abort = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (!keepFiller) {
      this.pre = null;
      this.speaker.stop();
    }
    this.character.setMouth(0);
    this.ui.caption(null);
    this.busy = false;
  }

  /**
   * @param {{text?:string, trigger?:string|null, t0?:number, mode?:'voice'|'text'}} turn
   *   t0: ユーザーが話し終えた時刻(performance.now())。声でないときは送信した時刻
   */
  async send({ text: raw = '', trigger = null, t0 = performance.now(), mode = 'text' } = {}) {
    // 鍵らしい文字は、画面にもサーバーにも出さない(声の鍵を会話の欄に貼ってしまったとき)
    const { text, count: secrets } = redactSecrets(raw);
    if (secrets) this.ui.notice?.(SECRET_NOTICE);
    const pre = this.pre;
    this.pre = null;
    // 先に出したあいづちは、止めずに続ける(cancel は、前の返事とタイマーだけを止める)
    this.cancel({ keepFiller: Boolean(pre) });
    const id = this.turnId;
    this.busy = true;
    const ac = new AbortController();
    this.abort = ac;
    const ctx = this.getContext();
    const m = { mode, t0, tSend: performance.now(), tFirstSay: null, tAudio: null, ttsFirstByteMs: null, brain: this.brain, tts: 'eleven', fillerMs: null, fillerEndMs: null };
    // あいづち: 先に出していればそれを、まだなら今出す(声で話しかけられた回だけ)。数字は本当の返事とは別に残す
    let fillerWanted = mode === 'voice' && trigger !== 'approach';
    if (fillerWanted && pre && performance.now() - pre.at < FILLER_FRESH_MS) {
      m.fillerMs = pre.fillerMs;
      m.fillerEndMs = pre.fillerEndMs;
      fillerWanted = false;
    }
    let fillerPlayed = Boolean(m.fillerEndMs !== null);
    if (fillerWanted) {
      const f = this.speaker.playFiller({
        onStart: (tNow) => {
          m.fillerMs = Math.round(tNow - t0);
          this.character.play('nod');
        },
      });
      if (f) {
        m.fillerEndMs = Math.round(performance.now() - t0 + f.ms);
        fillerPlayed = true;
      }
    }
    let sayCount = 0;
    const spoken = [];
    const sayEvents = []; // 履歴に、指示どおりの JSON の形で戻すため
    let thoughtEv = null;
    if (trigger !== 'approach') this.ui.userSaid(text);

    // 返事が来るまでの、うなずき
    for (const at of fillerPlayed ? NOD_AT_MS.slice(1) : NOD_AT_MS) {
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
      expressionHints: this.character.expressionHints,
      motions: this.motionChoices?.(this.character),
      ...(this.interview ? { interview: true } : {}),
    };

    try {
      await streamChat(
        body,
        (ev) => {
          if (id !== this.turnId) return;
          this.onEvent?.(ev);
          if (ev.type === 'meta') {
            // meta は何度か届く(頭脳の種類・ヘッジとキャッシュの記録)。種類が入っているものだけ使う
            if (ev.brain) {
              this.brain = ev.brain;
              m.brain = ev.brain;
            }
            if (ev.notice) this.ui.notice?.(ev.notice); // 「仮の頭脳です(…)」
          } else if (ev.type === 'thought') {
            thoughtEv = ev;
            this.ui.thought(ev);
          } else if (ev.type === 'say') {
            if (m.tFirstSay === null) m.tFirstSay = performance.now();
            sayCount += 1;
            const isFirst = sayCount === 1;
            spoken.push(ev.text);
            sayEvents.push(ev);
            this.speaker
              .enqueue(ev.text, {
                onFirstByte: (ms) => {
                  if (isFirst) m.ttsFirstByteMs = ms;
                },
                onStart: (tNow, info) => {
                  if (id !== this.turnId) return;
                  if (m.tAudio === null) m.tAudio = tNow;
                  this._performSay(ev, info);
                },
                // 声が無いときは、字幕を 1 字ずつ出す(レトロの文字送り)
                onCrawl: (shown) => {
                  if (id === this.turnId) this.ui.caption(shown);
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
    // 前の返事は、指示で決めた形(1 行 1 つの JSON。最初の行に用件と段階)のまま履歴に戻す。
    // ふつうの文で戻すと、モデルがそれをまねて、JSON でなく文章で答える回が出た(2026-11-02)
    if (sayEvents.length) this.history.push({ role: 'assistant', content: assistantLines(sayEvents, thoughtEv) });
    this.history = trimHistory(this.history);
    this.busy = false;
    // 音が出た瞬間を待って記録する
    const waitStart = () => {
      if (id !== this.turnId) return;
      if (m.tAudio !== null) this._report(m);
      else if (this.speaker.pending > 0) setTimeout(waitStart, 50);
    };
    waitStart();
  }

  _performSay(ev, info = {}) {
    // カスタムの表情は、漫符(頬の赤み・涙・汗)が値に比例して大きくなるので 1.0 で出す。標準は 0.9
    const weight = ev.expression === 'neutral' ? 0 : this.character.isCustomExpression?.(ev.expression) ? 1 : 0.9;
    this.character.setEmotion(ev.expression, weight);
    const pos = this.setGaze(ev.gaze, 2400); // 目印を見るときは、その場所(ワールド座標)が返る
    if (ev.motion && ev.motion !== 'none') this.character.play(ev.motion, pos ? { dx: pos[0], dz: pos[2] } : {});
    this.ui.say(ev);
    this.ui.caption(info.crawl ? '' : ev.text); // 文字送りのときは空から始め、onCrawl が 1 字ずつ足す
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
      // あいづちの声(話し終わりから、その声が出るまで / 終わるまで)。本当の返事の最初の音(totalMs)とは別の数字
      fillerMs: m.fillerMs,
      fillerEndMs: m.fillerEndMs,
    };
    entry.valid = entry.brain === 'haiku' && entry.tts === 'eleven';
    this.onMetric(entry);
  }
}
