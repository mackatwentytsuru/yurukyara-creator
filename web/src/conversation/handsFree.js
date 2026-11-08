// ハンズフリー(接客モード): 店の人が 1 回押したら、あとは来場者が話しかけるだけ。聞き取りの見張り。
// 聞き取りが止まった・始められなかった・マイクの線が切れた・時間切れで自分で終わった時に、1→2→4…30 秒の間をあけて自分で始め直す。
// - 画面が裏の間は始めない(待つ)。戻ったら始める(裏でマイクを取りに行って断られる・音が鳴るのを避ける)
// - キャラが話している間は、始めない(1 秒おきに見直す)
// - 抜けたら(disable)二度と始めない
// DOM も通信も持たない。聞き取りの始め方・生きているかは、渡された関数が決める(タイマーも渡せる = node の試験で読む)。

/** 始め直すまでの間(ms)。続けて失敗するたびに伸び、最後の値で止まる */
export const BACKOFF_MS = Object.freeze([1000, 2000, 4000, 8000, 16000, 30000]);
/** 生きているかの見張りの間・話している間や裏の間の見直しの間(ms) */
export const WATCH_MS = 2000;
export const WAIT_MS = 1000;

/**
 * @param {object} o
 * @param {()=>boolean} o.alive 聞き取りが生きているか(始まっていて、マイクの線が切れていない)
 * @param {()=>Promise<unknown>} o.start 聞き取りを始める(失敗したら投げるか、alive が false のまま)
 * @param {()=>boolean} [o.isBusy] キャラが話している・返事を作っている間 true(この間は始めない)
 * @param {()=>boolean} [o.isHidden] 画面が裏に回っている間 true
 * @param {(fn:()=>void, ms:number)=>any} [o.setTimer]
 * @param {(t:any)=>void} [o.clearTimer]
 */
export function createHandsFree({ alive, start, isBusy = () => false, isHidden = () => false, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let on = false;
  let failures = 0;
  let timer = null;
  let running = false;
  let starts = 0;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const later = (ms) => {
    stopTimer();
    if (!on) return;
    timer = setTimer(() => {
      timer = null;
      void check();
    }, ms);
  };

  async function check() {
    if (!on || running) return;
    if (isHidden() || isBusy()) return later(WAIT_MS); // 裏・話している間は、数えずに待つ
    if (alive()) {
      failures = 0;
      return later(WATCH_MS);
    }
    running = true;
    starts += 1;
    try {
      await start();
    } catch {
      // 失敗は、下で alive を見て数える(投げた失敗も、始まらなかった失敗も同じ扱い)
    } finally {
      running = false;
    }
    if (!on) return; // 始めている間に、抜けた
    if (alive()) {
      failures = 0;
      return later(WATCH_MS);
    }
    failures += 1;
    return later(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
  }

  return {
    /** 見張りを始める(すぐ 1 回確かめる) */
    enable() {
      if (on) return;
      on = true;
      failures = 0;
      void check();
    },
    /** やめる(接客モードを抜けた時)。二度と始めない */
    disable() {
      on = false;
      stopTimer();
    },
    /** 画面が戻った・聞き取りが止まったと分かった時に、待たずに確かめる */
    nudge() {
      if (!on) return;
      stopTimer();
      void check();
    },
    get enabled() {
      return on;
    },
    /** 続けて失敗した回数(試験用) */
    get failures() {
      return failures;
    },
    /** 始めようとした回数(試験用) */
    get starts() {
      return starts;
    },
  };
}

/** マイクの線がまだ生きているか(切れた = ended。聞き取りの stream を渡す)。stream が無い時(ブラウザの聞き取りの一部)は、止まっていないものとして true */
export function streamAlive(stream) {
  const tracks = stream?.getAudioTracks?.();
  if (!tracks) return true;
  return tracks.length > 0 && tracks.every((t) => t.readyState === 'live');
}

/**
 * 接客の見張りが「マイクは生きている」と見てよいか。聞き取りが動いている(listening)で線が生きているか、
 * 取り直しの最中(starting)なら生きている扱い(数えないと、見張りが取り直しの途中で止めて作り直し、二重の手間になる)
 */
export function listenerAlive(listener) {
  if (listener?.starting) return true;
  return Boolean(listener?.listening) && streamAlive(listener.stream);
}
