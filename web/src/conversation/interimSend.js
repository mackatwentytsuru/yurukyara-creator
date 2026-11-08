// ブラウザの聞き取りの「確定」が遅い時に、途中の文字を先に送る(11-08 LF2。本人の iPhone の実測: 話し終わりから送るまで 中央 2.9 秒)。
// 声が止まった(VAD)あと FLUSH_MS たっても確定が来ない時、いちばん新しい途中の文字を、その言葉として送る。
// あとから確定が来た時は、同じ言葉なら捨てる(2 回送らない)。違う言葉(言い足し・聞き直し)なら、送ったほうを置き換える。
// 時計と送る関数は外から渡せる(試験で時間を進めるため)。この部品は画面も通信も知らない。

export const FLUSH_MS = 700; // 声が止まってから、確定を待つ長さ
export const KEEP_MS = 10_000; // 先に送った言葉を「あとの確定と照らす」ために覚えておく長さ
const PLACEHOLDER = '…'; // サーバーの聞き取りが、声の出始めと終わりに出す印(中身の文字ではない)

/** 句読点・記号・空白を除き、全角半角をそろえた形(確定と途中の文字が「同じ言葉か」を見る時に使う) */
export function normalizeSpoken(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

export class InterimSender {
  /**
   * @param {object} o
   * @param {(text:string, info:{via:'interim'}) => void} o.send 途中の文字を、その言葉として送る
   * @param {() => number} [o.now]
   * @param {number} [o.flushMs]
   */
  constructor({ send, now = () => performance.now(), flushMs = FLUSH_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h), enabled = true }) {
    Object.assign(this, { send, now, flushMs, setTimer, clearTimer, enabled }); // enabled=false: 先送りをしない(速さの前後の比べ用)。確定はいつも「そのまま送る」
    this.interimText = '';
    this.interimAt = 0;
    this.voiceOnAt = 0;
    this.endedAt = 0;
    this.timer = null;
    this.sent = null; // 先に送った言葉 { rest(まだ確定が来ていない分の正規形), at }
    this.count = 0; // 先に送った回数(試験・記録用)
  }

  /** 途中の文字が届いた */
  interim(text) {
    const t = String(text ?? '').trim();
    if (!t || t === PLACEHOLDER) return;
    this.interimText = t;
    this.interimAt = this.now();
  }

  /** 声の出始め(true)・声が止まった(false)。lastVoicedAt は声が最後に出ていた時刻 */
  voice(active, lastVoicedAt = 0) {
    this._clear();
    if (active) {
      this.voiceOnAt = this.now();
      return;
    }
    this.endedAt = this.now();
    if (!this.enabled) return;
    // この言葉の途中の文字が、まだ届いていない(声の出始めより前の古い物しかない)なら、待たない
    if (!this.interimText || this.interimAt < this.voiceOnAt - 300) return;
    this.timer = this.setTimer(() => this._flush(lastVoicedAt), this.flushMs);
  }

  _flush(lastVoicedAt) {
    this.timer = null;
    const text = this.interimText;
    if (!text) return;
    this.interimText = '';
    const norm = normalizeSpoken(text);
    if (!norm) return;
    this.sent = { rest: norm, at: this.now() };
    this.count += 1;
    this.send(text, { via: 'interim', lastVoicedAt });
  }

  /**
   * 確定が届いた。どうするかを返す:
   *  'send'    ふつうに送る(先に送った物は無い)
   *  'drop'    先に送った言葉と同じ(か、その一部)。送らない
   *  'replace' 先に送った言葉と違う(言い足し・聞き直し)。送ったほうを止めて、これを送る
   */
  final(text) {
    this._clear();
    this.interimText = '';
    const sent = this.sent;
    if (!sent) return 'send';
    if (this.now() - sent.at > KEEP_MS) {
      this.sent = null;
      return 'send';
    }
    const n = normalizeSpoken(text);
    if (!n) return 'drop';
    // 確定が何回かに分かれて届くことがある(先に送った言葉の頭から順に)。送った言葉のうち、確定した分だけ減らす
    if (sent.rest === n) {
      this.sent = null;
      return 'drop';
    }
    if (sent.rest.startsWith(n)) {
      sent.rest = sent.rest.slice(n.length);
      return 'drop';
    }
    this.sent = null;
    return 'replace';
  }

  /** 聞くのをやめた・やり直した時 */
  reset() {
    this._clear();
    this.interimText = '';
    this.sent = null;
  }

  _clear() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
