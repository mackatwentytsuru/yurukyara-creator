// 画面が途中で切った通信(声を止めた・次の言葉で割り込んだ)の AbortError か。失敗ではないので、記録(console)には書かない。
export function isAbortError(err) {
  for (let e = err, i = 0; e && i < 3; e = e.cause, i += 1) {
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
  }
  return false;
}

/**
 * 通信の途中で起きた失敗を、記録(console)に 1 回だけ書く。
 * 画面が切った(AbortError)だけは、スタックを出さず、短い 1 行を標準出力へ(失敗ではないので、エラー用の記録を汚さない。数は見えるように残す)。
 */
export function logRequestError(err, { info = console.log, error = console.error } = {}) {
  if (isAbortError(err)) info('[中断] 画面が通信を切りました(声を止めた・次の言葉で割り込んだ)');
  else error(err);
}
