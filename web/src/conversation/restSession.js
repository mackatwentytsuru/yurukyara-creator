// 1 回の会話の長さを数える(BSF 11-08)。長く話した時・夜おそい時に、サーバーの安全の層が 1 回だけ「休もうか」とすすめるため。
// - 数えるだけ。すすめるかどうかはサーバー(web/server/safety.mjs の restNeed)が、restRule.js の数で決める
// - このタブの中だけ(sessionStorage)。読み込み直しても続きから数える。ほかの端末・ほかのタブには出さない。サーバーにも残さない
// - 話さない間が restRule.js の idleResetMinutes を超えたら、新しい 1 回の会話として数え直す
// - 送る物は、往復の数・話し始めてからの分・この端末の時(0〜23)・もうすすめたか、の 4 つだけ(言葉や名前は入れない)
import { REST_RULE } from './restRule.js';

export const TALK_SESSION_KEY = 'yc-talk-session-v1';

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // 保存を止めている端末(読めなくても、この画面の間は数える)
  }
}

/**
 * @param {{now?: () => number, hourOf?: (ms:number) => number, storage?: Storage|null, rule?: typeof REST_RULE}} [o]
 */
export function createTalkSession({ now = () => Date.now(), hourOf = (ms) => new Date(ms).getHours(), storage = defaultStorage(), rule = REST_RULE } = {}) {
  let state = null;
  const fresh = (at) => ({ startedAt: at, lastAt: at, turns: 0, rested: false });
  const save = () => {
    try {
      storage?.setItem(TALK_SESSION_KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても、この画面の間は数える
    }
  };
  const load = () => {
    try {
      const v = JSON.parse(storage?.getItem(TALK_SESSION_KEY) ?? 'null');
      if (v && Number.isFinite(v.startedAt) && Number.isFinite(v.lastAt) && Number.isInteger(v.turns) && v.turns >= 0) return { startedAt: v.startedAt, lastAt: v.lastAt, turns: v.turns, rested: v.rested === true };
    } catch {
      // 壊れた控えは捨てる
    }
    return null;
  };
  /** 話さない間が長ければ、新しい 1 回の会話にする */
  const current = () => {
    const t = now();
    if (!state) state = load() ?? fresh(t);
    if (t - state.lastAt > rule.idleResetMinutes * 60_000 || t < state.startedAt) state = fresh(t);
    return { state, t };
  };
  return {
    /** サーバーへ送る形(往復の数は、この回より前に話した数) */
    snapshot() {
      const { state: s, t } = current();
      return { turns: s.turns, minutes: Math.floor((t - s.startedAt) / 60_000), hour: hourOf(t), rested: s.rested };
    },
    /** 1 往復が終わった(返事が届いた)。近づいた時の声かけは数えない */
    countTurn() {
      const { state: s, t } = current();
      s.turns += 1;
      s.lastAt = t;
      save();
    },
    /** サーバーが休むことをすすめた(この 1 回の会話では、もうすすめない) */
    markRested() {
      const { state: s } = current();
      s.rested = true;
      save();
    },
  };
}
