// 画面が途中で切った通信(声を止めた・次の言葉で割り込んだ)の AbortError か。失敗ではないので、記録(console)には書かない。
export function isAbortError(err) {
  for (let e = err, i = 0; e && i < 3; e = e.cause, i += 1) {
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
  }
  return false;
}
