// いま舞台にいる子を、この端末が覚える(読み込み直しても、同じ子で始めるため)。three も DOM も読まない小さな部品。
// - 覚えるのは子の id だけ(?character= と同じ形)。主役(いつもの子)の時は、覚えない(消す)
// - ?character= がアドレスにある時は、そちらが先(覚えた子は使わない)。読めなかった時は、覚えを消していつもの子から始める
// - 保存が使えない(内緒のウインドウなど)時は、覚えないだけで、画面は動く
import { isSpecId } from './urlSpec.js';
import { MAIN_CHARACTER } from './defaults.js';

export const STAGE_KEY = 'yc.stage.v1';

/** 覚えている子の id(無い・形の違う値は ''。主役は覚えない物なので ''  扱い) */
export function readStageId(store) {
  try {
    const v = JSON.parse(store?.getItem(STAGE_KEY) ?? 'null');
    return v && isSpecId(v.id) && v.id !== MAIN_CHARACTER.id ? v.id : '';
  } catch {
    return '';
  }
}

/** 舞台の子を覚える。主役・形の違う id は、覚えを消す */
export function writeStageId(store, id) {
  try {
    if (!isSpecId(id) || id === MAIN_CHARACTER.id) return store?.removeItem(STAGE_KEY);
    store?.setItem(STAGE_KEY, JSON.stringify({ id, t: Date.now() }));
  } catch {
    // 覚えられなくても、会話は続ける
  }
  return undefined;
}

/** 覚えを消す(その子が読めなかった時・消された時) */
export function forgetStageId(store) {
  try {
    store?.removeItem(STAGE_KEY);
  } catch {
    // 消せなくても続ける
  }
}

/**
 * 覚えた子から始めてよい画面か。入口の LED・自動で始める画面・ヘッドセット・重さを測る時は、決まった子で出すので、覚えを使わない
 * @param {URLSearchParams} params
 * @param {{headset?: boolean}} [o]
 */
export function stageMemoryWanted(params, { headset = false } = {}) {
  if (headset) return false;
  return !['led', 'autostart', 'headset'].some((k) => params.get(k) === '1') && params.get('perf') !== '1';
}
