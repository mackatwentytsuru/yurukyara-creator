// ブラウザの聞き取り(Web Speech)が使えない・止まった時に、PC の聞き取り(/api/stt)へ自動で替えるかの決まり。
// 11-08 本人の iPhone で「声で話せませんでした」になった(原因は画面に名前を出して確かめる)。PC に聞き取りがあるなら、人が何もしなくても声で話せるように。
// DOM も three も読まない小さな部品(node の試験で読む)。

/** この名前でブラウザの聞き取りが止まったら、PC の聞き取りへ替える(許可されない・音を取れない・つながらない。start-failed は「始められなかった」の、画面の側の印) */
export const FALLBACK_ERRORS = Object.freeze(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'start-failed']);

export const FALLBACK_WORDS = Object.freeze({
  toServer: 'ブラウザの聞き取りが使えなかったので、PC の聞き取りに切りかえたよ',
  missing: 'このブラウザには声の聞き取りが無いので、PC の聞き取りで聞くね',
});

/** 止まった理由が、PC の聞き取りへ替える名前か */
export function isFallbackError(code) {
  return FALLBACK_ERRORS.includes(String(code ?? ''));
}

/**
 * 替えるか。ブラウザの聞き取りで動いていて、PC の聞き取りがあり、名前が当たる時だけ。
 * @param {{provider?: string, errorCode?: unknown, serverOk?: boolean}} o
 */
export function shouldFallToServer({ provider = 'web', errorCode, serverOk = false } = {}) {
  return provider === 'web' && serverOk === true && isFallbackError(errorCode);
}
