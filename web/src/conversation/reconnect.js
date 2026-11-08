// サーバーが短く止まった(再起動・通信の切れ)あと、画面がリロードなしで自分でつながり直し、止まった回の言葉を 1 回だけ送り直す部品(11-08 LF3)。
// 本人の iPhone で、サーバーの再起動のあと「いま つながらないよ」が出たまま残った。
// この部品は画面も通信も知らない: 「つながったか」を調べる関数(probe)と、時計・タイマーは外から渡す(試験で時間を進めるため)。

export const RETRY_FRESH_MS = 90_000; // 止まった言葉を、この間なら自動で送り直す(それより古い言葉は、いま言ったことではないので送らない)
export const GIVE_UP_MS = 30 * 60_000; // つながり直しを待つのは、この長さまで
export const PROBE_DELAYS_MS = Object.freeze([1500, 3000, 5000, 8000, 10_000]); // 調べる間隔(最後の長さを繰り返す)

export class Reconnector {
  /**
   * @param {object} o
   * @param {() => Promise<boolean>} o.probe サーバーに届くか(届けば true)。投げた時は届かないとみなす
   * @param {(info:{pending:object|null, fresh:boolean}) => void} o.onBack つながり直した。pending は止まった回の言葉(無ければ null)。fresh は送り直してよい新しさか
   * @param {() => Promise<void>} [o.prepare] つながったと分かってから、onBack の前に待つ仕事(声・聞き取りの有無の読み直し)。投げても進む
   * @param {() => number} [o.now]
   */
  constructor({ probe, onBack, prepare = null, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h), delays = PROBE_DELAYS_MS, freshMs = RETRY_FRESH_MS, giveUpMs = GIVE_UP_MS }) {
    Object.assign(this, { probe, onBack, prepare, now, setTimer, clearTimer, delays, freshMs, giveUpMs });
    this.pending = null;
    this.waiting = false;
    this.startedAt = 0;
    this.tries = 0;
    this.timer = null;
    this.probing = false;
    this.count = 0; // つながり直した回数(試験・記録用)
  }

  /** 通信が切れた。止まった回の言葉(無くてもよい)を覚えて、つながるまで調べ続ける。続けて切れたら、いちばん新しい言葉だけを覚える */
  begin(pending = null) {
    this.pending = pending;
    if (this.waiting) return;
    this.waiting = true;
    this.startedAt = this.now();
    this.tries = 0;
    this._schedule();
  }

  /** 新しい言葉を送る時(それが先になる)。止まった言葉は送り直さない。調べるのは続ける(つながったら知らせだけ出すため) */
  supersede() {
    this.pending = null;
  }

  /** やめる(待つのも、覚えた言葉も捨てる) */
  cancel() {
    this._clear();
    this.waiting = false;
    this.pending = null;
  }

  /** 画面が「オンラインに戻った」「また見える」と言った時など、待たずに今すぐ調べる */
  nudge() {
    if (!this.waiting || this.probing) return;
    this._clear();
    void this._tick();
  }

  _schedule() {
    this._clear();
    const d = this.delays[Math.min(this.tries, this.delays.length - 1)];
    this.timer = this.setTimer(() => void this._tick(), d);
  }

  async _tick() {
    this.timer = null;
    if (!this.waiting || this.probing) return;
    if (this.now() - this.startedAt > this.giveUpMs) {
      this.cancel();
      return;
    }
    this.probing = true;
    let ok = false;
    try {
      ok = (await this.probe()) === true;
    } catch {
      ok = false;
    }
    this.probing = false;
    if (!this.waiting) return; // 調べている間に、やめられた
    if (!ok) {
      this.tries += 1;
      this._schedule();
      return;
    }
    if (this.prepare) {
      // 読み直しが終わるまで、送り直さない(終わる前に送ると、声のサーバーが「無い」のままで字幕だけになりうる)。待つ間も、新しい言葉(supersede)・やめる(cancel)は効く
      this.probing = true;
      try {
        await this.prepare();
      } catch {
        // 読み直しの失敗は、送り直しを止めない
      }
      this.probing = false;
      if (!this.waiting) return;
    }
    const pending = this.pending;
    const fresh = Boolean(pending) && this.now() - pending.at <= this.freshMs;
    this.waiting = false;
    this.pending = null;
    this.count += 1;
    this.onBack({ pending, fresh });
  }

  _clear() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

/**
 * サーバーに届くかを調べる。何か返事が来れば(404 でも)届いている。5xx(ゲートの 502 など)と、投げた時は届いていない。
 * @param {typeof fetch} fetchImpl
 * @param {number} [timeoutMs]
 */
export async function probeServer(fetchImpl = fetch, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/status', { cache: 'no-store', signal: ac.signal });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
