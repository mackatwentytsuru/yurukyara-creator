// 入口を通った直後に「はじめての会話」(7 歩)を出すかの決まり(点検 CRITux 2)。three も DOM も読まない小さな部品(node の試験で読む)。
// 初めての訪問(このブラウザに、7 歩を終えたか「あとで」を押した印が無い)なら、入口を閉じたすぐ後に出す。
// 入口より先には出さない(入口でカメラかカメラなしを選び、音を出す許可を取ってから)。

/** 7 歩を終えた・「あとで」を押した印の名前(S4 の web/src/ui/onboarding/index.js の DONE_KEY と同じ。main.js は S4 の値を渡す) */
export const FIRST_RUN_DONE_KEY = 'yc.onboarded.v1';

/** 自分からは出さない場面: 入口の LED・自動で始める・ヘッドセット・重さを測る時 */
const NO_AUTO = ['led', 'autostart', 'headset', 'perf'];

/**
 * 入口を通った直後に、初めての会話を自動で出すか。
 * 出さない: ?onboard=0(出さない)・?onboard=1(読み込んだ時にもう出ている)・?auto=0(キャラが自分から始める事をしない。確かめの道具が使う)・
 * 入口の LED・自動で始める・ヘッドセット・重さを測る時・このブラウザに印がある時。
 * 覚える所が使えないブラウザ(内緒のウインドウなど)は、何も覚えていないので、初めてとみなす。
 * @param {{params: URLSearchParams, storage?: {getItem(k: string): string|null}|null, doneKey?: string, headset?: boolean}} o
 * @returns {boolean}
 */
export function shouldOpenFirstRun({ params, storage = null, doneKey = FIRST_RUN_DONE_KEY, headset = false }) {
  const onboard = params.get('onboard');
  if (onboard === '0' || onboard === '1') return false;
  if (params.get('auto') === '0') return false;
  if (headset || NO_AUTO.some((k) => params.get(k) === '1')) return false;
  try {
    return !storage?.getItem(doneKey);
  } catch {
    return true;
  }
}
