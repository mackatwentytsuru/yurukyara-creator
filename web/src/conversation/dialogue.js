// 会話の 1 ターンを進める。
// サーバーから thought / say が順に届く。say が届くたびに読み上げを始め、
// その文が話し始める瞬間に、表情・動き・視線・字幕を合わせる。
// 返事が来るまでの間は、うなずきでつなぐ。割り込まれたら cancel() で全部止める。
import { roleOf } from './role.js'; // B3(第 12 波 b): 役目を会話に付けて送る
import { mlBodyFields } from './mlBody.js'; // ML1: 多言語・お店のきまり・お店の端末の欄
import { streamChat } from './brainClient.js';
import { createTalkSession } from './restSession.js'; // BSF 11-08: 長い会話・夜おそくの「休もうか」のため、1 回の会話の長さを数える
import { redactSecrets } from './secrets.js';
import { setSttHint } from './sttHint.js';
import { normalizeSpoken } from './interimSend.js'; // 言葉の同じ・違いを見る形(句読点と全角半角を除く)
import { VOICE_CAP_NOTICE } from './speaker.js';

/** 店の入口の画面(LED・テレビ表示)か。夜に動く画面なので、時間帯の休むすすめは付けない(BSFf) */
function inShopScreen() {
  const cl = globalThis.document?.documentElement?.classList;
  return Boolean(cl && (cl.contains('is-led') || cl.contains('tv-mode')));
}

export const SECRET_NOTICE = '鍵らしい文字は送らなかったよ。声の鍵は「声の鍵」の欄に入れてね';

export const TEXT_MAX_CHARS = 500; // 1 回の発言の長さの上限(サーバーの validate と同じ 500 字)
export const OFFLINE_NOTICE = 'いま つながらないよ。もう一度ためしてね';
export const TOO_LONG_NOTICE = `ながすぎるよ。${TEXT_MAX_CHARS} 字までで言ってね`;
export const BUSY_NOTICE = 'いま こみあっているよ。すこし まってね';

/**
 * 通信の失敗を、子どもに読める言葉にする(英語の Failed to fetch などは出さない)。
 * 送った言葉が長すぎた(413)時は、その言葉。混んでいる・上限(429。サーバーの文に (429) が入る時も)は「こみあっているよ」。
 */
export function friendlyChatError(err) {
  if (Number(err?.status) === 413) return TOO_LONG_NOTICE;
  if (Number(err?.status) === 429 || /\(429\)/.test(String(err?.message ?? ''))) return BUSY_NOTICE;
  return OFFLINE_NOTICE;
}

/** 送り直せば通る失敗か: 返事が無い(status なし = 通信の切れ・時間切れ)か、門が「いま届かない」と答えた 502・503・504 だけ。
 *  500 はサーバーの中の失敗で、送り直しても同じ(送り続けてしまう)ので除く。413・429 などの 4xx も除く */
const OUTAGE_STATUSES = new Set([502, 503, 504]);
export function isOutage(err) {
  const s = Number(err?.status);
  return !Number.isFinite(s) || OUTAGE_STATUSES.has(s);
}

export const NOD_AT_MS = [350, 1700]; // 返事が始まるまで、この時刻にうなずく(話し終わりから)
const FILLER_FRESH_MS = 4000; // 話し終わりの合図で先に出したあいづちは、この間なら、送るときに出し直さない

export const HISTORY_KEEP = 24; // サーバーが使うのは直近 12 件。画面側は余裕を見て 24 件だけ持つ(全部送ると、長い一日の後に本文が上限を超える)

/** 履歴を直近 keep 件にする。先頭は、いつも user から(assistant から始まる履歴は、API が受け付けない) */
export function trimHistory(history, keep = HISTORY_KEEP) {
  const tail = history.slice(-keep);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser < 0 ? [] : tail.slice(firstUser);
}

export const CARRY_MAX_CHARS = 400; // つなげた言葉の長さの上限(サーバーの 1 回の発言は 500 字まで)
export const CARRY_FRESH_MS = 30000; // 返事が 1 文も来ないまま止めた言葉を、次の言葉につなげておく時間

/** 前の言葉と今の言葉をつなぐ(前が句読点で終わっていなければ「、」を入れる)。長すぎれば古い方を切る */
export function joinWords(before, now) {
  const a = String(before ?? '').trim();
  const b = String(now ?? '').trim();
  if (!a) return b;
  if (!b) return a;
  // 今の言葉が、前の言葉を頭に含んでいる(途中の文字を先に送ったあと、確定が全部の言葉で届いた時など)なら、重ねずに今の言葉だけ
  if (normalizeSpoken(b).startsWith(normalizeSpoken(a))) return b;
  const joined = /[。.!！?？、,]$/u.test(a) ? a + b : `${a}、${b}`;
  return Array.from(joined).slice(-CARRY_MAX_CHARS).join('');
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
   *   ui.notice(文) があれば、「おためしモードです」などの一言をそこへ出す
   */
  constructor({ character, speaker, ui, getContext, setGaze, onMetric, motionChoices, interview = false, onEvent = null, onOffline = null, onInterrupted = null }) {
    // interview: インタビューの型(返事 2 文まで・台本にしない)で答えさせる(入口の LED の ?interview=1)
    // onOffline: 通信が切れて返事が 1 つも来なかった回の言葉を渡す(main.js が、つながり直したら送り直す)
    // onInterrupted: 返事の最初の音の前に、言い直し・割り込みで止められた回の記録を渡す(いちばん待たせた回が、数字から消えないように。11-08 LF4)
    Object.assign(this, { character, speaker, ui, getContext, setGaze, onMetric, motionChoices, interview, onEvent, onOffline, onInterrupted });
    this.history = [];
    this.abort = null;
    this.timers = [];
    this.turnId = 0;
    this.busy = false;
    this.brain = 'unknown';
    this.cur = null; // 返事を待っている最中の回 { text, trigger, said }
    this.open = null; // 送ったが、まだ記録を出していない回の数字 m(止められたら onInterrupted に出す)
    this.carry = null; // 返事が 1 文も来ないまま止められた回の言葉 { text, at }。次の言葉の頭につなげる(取りこぼさない)
    try {
      setSttHint(getContext?.()?.character?.name); // 聞き取りの手がかり(キャラの名前)。最初の声から効くように
    } catch {
      // キャラがまだ決まっていない
    }
    this.pre = null; // 話し終わりの合図(声が止まった)で先に出した、あいづち { at, t0, fillerMs, fillerEndMs, text }
    this.talk = createTalkSession({ hourOf: (ms) => (inShopScreen() ? null : new Date(ms).getHours()) }); // 店の入口の画面(LED・テレビ表示)は夜に動くので、時間帯のすすめは使わない(BSFf) // BSF: 往復の数・分・端末の時・すすめた後か(このタブの中だけ)
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
    // 返事が 1 文も来ないまま止める回の言葉は、捨てずに、次の言葉の頭につなげる(言い直しや割り込みで、前の言葉を取りこぼさない)
    const cur = this.cur;
    if (this.busy && cur && cur.said === 0 && cur.trigger !== 'approach' && cur.text) this.carry = { text: cur.text, at: Date.now() };
    // B3(第 12 波 b): 返事が途中まで届いた回を止める時は、その言葉と届いた返事を履歴に残す(続けて送っても、前の話を落とさない)
    if (this.busy && cur && cur.said > 0 && cur.sayEvents?.length) {
      this.history.push({ role: 'user', content: cur.trigger === 'approach' ? '(使う人が近づいてきた)' : cur.text });
      this.history.push({ role: 'assistant', content: assistantLines(cur.sayEvents, cur.thought) });
      this.history = trimHistory(this.history);
    }
    this._reportInterrupted();
    this.cur = null;
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
   *   retry: つながり直して送り直した回(true)。この回がまた通信の切れで失敗しても、もう送り直さない(onOffline の info.retry で伝える)
   via: 'interim'(確定を待たずに途中の文字を先に送った回)・'replace'(先に送ったあと、違う字の確定で送り直した回)。記録の 1 項目になる(11-08 LF3)
   */
  async send({ text: raw = '', trigger = null, t0 = performance.now(), mode = 'text', via = null, retry = false } = {}) {
    // 鍵らしい文字は、画面にもサーバーにも出さない(声の鍵を会話の欄に貼ってしまったとき)
    let { text, count: secrets } = redactSecrets(raw);
    if (secrets) this.ui.notice?.(SECRET_NOTICE);
    // 長すぎる言葉: 文字では断る(送らない・履歴にも残さない)。声は聞き取った最後の 500 字にする
    if (Array.from(text).length > TEXT_MAX_CHARS) {
      if (mode === 'text') {
        this.ui.caption(TOO_LONG_NOTICE, 6000);
        return;
      }
      text = Array.from(text).slice(-TEXT_MAX_CHARS).join('');
    }
    const pre = this.pre;
    this.pre = null;
    // 先に出したあいづちは、止めずに続ける(cancel は、前の返事とタイマーだけを止める)
    this.cancel({ keepFiller: Boolean(pre) });
    // 前の回が、返事が 1 文も来ないまま止められていたら、その言葉を今の言葉の頭につなげて送る(近づいた合図の回はつなげない)
    let askText = text;
    if (trigger !== 'approach' && this.carry) {
      if (Date.now() - this.carry.at <= CARRY_FRESH_MS) askText = joinWords(this.carry.text, text);
      this.carry = null;
    }
    const id = this.turnId;
    const sayEvents = []; // 履歴に、指示どおりの JSON の形で戻すため(止めた回も、届いた分を履歴に残す)
    const cur = { text: askText, trigger, said: 0, sayEvents, thought: null };
    this.cur = cur;
    this.busy = true;
    const ac = new AbortController();
    this.abort = ac;
    const ctx = this.getContext();
    setSttHint(ctx.character?.name); // 聞き取りの手がかり(今のキャラの名前)
    // 声の役(男の子・女の子)は、今の子の人格の文から決まる(おまかせの時)。返事の声もあいづちも、その役で話す(11-07 第 11 波)
    this.speaker.setVoicePersona?.(ctx.character?.persona);
    // ML1: ことば(声は文ごとの言葉で話す)と、聞く言葉(日本語以外の時は、日本語のあいづちを出さない)。日本語だけの時は、どちらも ja
    this.speaker.setLangMode?.(ctx.lang);
    this.speaker.setHearLang?.(ctx.hearLang);
    const m = { mode, t0, tSend: performance.now(), tFirstSay: null, tAudio: null, ttsFirstByteMs: null, brain: this.brain, tts: 'eleven', fillerMs: null, fillerEndMs: null, via, done: false };
    this.open = trigger === 'approach' ? null : m; // 近づいた合図の声かけは、待たせた回ではないので数えない
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
    let thoughtEv = null;
    // 前の言葉をつないで送る時は、つないだ言葉を見せる(2 回目の言葉だけが出て、前の言葉が消えたように見えないように。第 12 波 b)
    if (trigger !== 'approach') this.ui.userSaid(askText);

    // 返事が来るまでの、うなずき
    for (const at of fillerPlayed ? NOD_AT_MS.slice(1) : NOD_AT_MS) {
      const wait = Math.max(0, t0 + at - performance.now());
      this.timers.push(
        setTimeout(() => {
          if (id === this.turnId && m.tAudio === null) this.character.play('nod');
        }, wait),
      );
    }

    // BCV: 使う人がカメラを入れて話しかけた回だけ、その時の絵を 1 枚(決めるのは main.js の getImage。cameraFrame.js が作る)。
    // 近づいた合図の回は送らない。履歴には入れない(次の回に前の絵を送り直さない)
    const cameraImage = trigger === 'approach' ? null : (this.getImage?.({ mode, trigger }) ?? null);
    const role = roleOf({ settings: ctx.character?.role ? { role: ctx.character.role } : null, character: this.character, persona: ctx.character?.persona });
    const body = {
      session: this.talk.snapshot(), // BSF: 1 回の会話の長さ(休むすすめ。すすめるかはサーバーが決める)
      history: this.history,
      text: askText,
      trigger,
      scene: ctx.scene,
      // 役目(第 12 波 b): 使う人が選んだ値 > character.json の role > 人格の文の行 > おうち(src/conversation/role.js)
      character: { ...ctx.character, role },
      // ML1: 多言語・お店のきまり・お店の端末(日本語だけ・ふつうの端末・欄が空の時は何も足さない = 本文は今日と同じ)
      ...mlBodyFields({ lang: ctx.lang, hearLang: ctx.hearLang, facts: ctx.facts, shopDevice: ctx.shopDevice, role, persona: ctx.character?.persona }),
      place: ctx.place,
      expressions: this.character.expressions,
      expressionHints: this.character.expressionHints,
      motions: this.motionChoices?.(this.character),
      ...(this.interview ? { interview: true } : {}),
      ...(cameraImage ? { image: cameraImage } : {}),
    };

    let offline = null; // 通信が切れて、返事が 1 つも無かった回の言葉(送り直しの元)
    let failed = false; // つながらない・断られた回(返事が 1 つも無い)は、履歴に残さない(長すぎる言葉の 413 が、以後ずっと続かないように)
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
            if (ev.notice) this.ui.notice?.(ev.notice); // 「おためしモードです(…)」
            if (ev.rest) this.talk.markRested(); // BSF: 休むことをすすめた(この 1 回の会話では、もうすすめない)
          } else if (ev.type === 'thought') {
            thoughtEv = ev;
            cur.thought = ev;
            this.ui.thought(ev);
          } else if (ev.type === 'say') {
            if (m.tFirstSay === null) m.tFirstSay = performance.now();
            sayCount += 1;
            cur.said = sayCount;
            const isFirst = sayCount === 1;
            spoken.push(ev.text);
            sayEvents.push(ev);
            // B3(第 12 波 b): 届いた文は、話し始める前から字幕に薄く出す(返事の全部が早く読める。声は今までどおり 1 文ずつ)
            this.ui.sayAhead?.(ev);
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
                // 今日の声の上限に当たった: 字幕だけで話している理由を、1 回だけ言う
                if (this.speaker.capReached && !this.capNoticed) {
                  this.capNoticed = true;
                  this.ui.notice?.(VOICE_CAP_NOTICE);
                }
              });
          } else if (ev.type === 'error') {
            failed = true;
            // B13S(QA8 #1): 英語と JSON の文を「あたまの なか」にだけ出して無言にしない。字幕の所に、やさしい日本語で
            const msg = friendlyChatError({ status: ev.status, message: ev.message });
            this.ui.error(msg);
            this.ui.caption(msg, 6000);
          }
        },
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) {
        failed = true;
        // 字幕の所に、やさしい日本語で(英語の文が、隠れた考えの箱にだけ出ていた。QA6)
        const msg = friendlyChatError(err);
        this.ui.error(msg);
        this.ui.caption(msg, 6000);
        // 通信が切れていた(サーバーが短く止まった等)なら、画面が自分でつながり直して送り直す(reconnect.js)。言葉が長すぎた(413)などは送り直さない
        if (isOutage(err) && trigger !== 'approach') offline = { text: askText, mode, turnId: id, at: Date.now(), retry };
      }
    }
    if (id !== this.turnId) return;
    this.cur = null;
    if (failed && !sayEvents.length) {
      this.busy = false;
      this.open = null; // つながらなかった回は、止められた回ではない
      if (offline) this.onOffline?.(offline);
      return;
    }
    this.history.push({ role: 'user', content: trigger === 'approach' ? '(使う人が近づいてきた)' : askText });
    // 前の返事は、指示で決めた形(1 行 1 つの JSON。最初の行に用件と段階)のまま履歴に戻す。
    // ふつうの文で戻すと、モデルがそれをまねて、JSON でなく文章で答える回が出た(2026-11-02)
    if (sayEvents.length) this.history.push({ role: 'assistant', content: assistantLines(sayEvents, thoughtEv) });
    this.history = trimHistory(this.history);
    if (trigger !== 'approach' && sayEvents.length) this.talk.countTurn(); // BSF: 1 往復(近づいた時の声かけは数えない)
    this.busy = false;
    // 音が出た瞬間を待って記録する
    const waitStart = () => {
      if (id !== this.turnId) return;
      if (m.tAudio !== null) this._report(m);
      else if (this.speaker.pending > 0) setTimeout(waitStart, 50);
      else if (this.open === m) this.open = null; // 声の無い返事(字幕だけ・声の上限・声の失敗)は、止められた回ではない。残すと次の言葉が「止められた」の嘘の 1 行を出す
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

  /** 返事の最初の音の前に止められた回(言い直し・割り込み・ボタン)を 1 行残す。止められた回が、いちばん遅かった回のことがある。valid にはしない(中央値に混ぜない) */
  _reportInterrupted() {
    const m = this.open;
    this.open = null;
    if (!m || m.done || !this.onInterrupted) return;
    m.done = true;
    this.onInterrupted({
      mode: m.mode,
      brain: m.brain,
      tts: this.speaker.ttsError ? 'silent' : 'eleven',
      interrupted: true,
      valid: false,
      waitedMs: Math.round(performance.now() - m.t0),
      t0ToSendMs: Math.round(m.tSend - m.t0),
      sendToFirstSayMs: m.tFirstSay ? Math.round(m.tFirstSay - m.tSend) : null,
      totalMs: m.tAudio !== null ? Math.round(m.tAudio - m.t0) : null,
      ...(m.via ? { via: m.via } : {}),
    });
  }

  _report(m) {
    m.done = true;
    if (this.open === m) this.open = null;
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
      ...(m.via ? { via: m.via } : {}),
    };
    entry.valid = entry.brain === 'haiku' && entry.tts === 'eleven';
    this.onMetric(entry);
  }
}
