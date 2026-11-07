// 「声で話す」が使えなかった時の知らせ(やさしい日本語)。three も DOM も読まない小さな部品(node の試験で読む)。
// スマホの確かめ(P1 高): 失敗しても画面に何も出ない・http では英語の err.message がそのまま出る、を直す。
// 出す先は字幕の上の知らせ(#uiNotice。畳まれた「Claude の考え」の中でなく)。文字で話す道はいつも残ると、そえる。

const TEXT_OK = '文字ならこのまま話せます';
const HAS_JAPANESE = /[぀-ヿ㐀-鿿]/;

/**
 * マイクを使う前に分かる失敗(https でない・ブラウザがマイクを持たない)の知らせ。使える時は null。
 * @param {{secure?: boolean, mediaDevices?: unknown}} env window.isSecureContext と navigator.mediaDevices
 */
export function micUnavailableText({ secure = true, mediaDevices = {} } = {}) {
  if (!secure) return `声で話すには、https のページで開いてね。${TEXT_OK}`;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return `このブラウザでは、声で話せないみたい。${TEXT_OK}`;
  return null;
}

/**
 * マイクを使おうとして失敗した時の知らせ。英語の err.message は出さない(日本語の文だけ、そのまま使う)。
 * @param {unknown} err
 */
export function micFailureText(err) {
  const kind = err && typeof err === 'object' ? String(err.name ?? '') : '';
  if (kind === 'NotAllowedError' || kind === 'SecurityError') return `マイクを使えませんでした(ブラウザで許可されませんでした)。ブラウザの設定で許可すると、声で話せます。${TEXT_OK}`;
  if (kind === 'NotFoundError' || kind === 'OverconstrainedError') return `マイクが見つかりません。つないでから、もう一度押してね。${TEXT_OK}`;
  if (kind === 'NotReadableError' || kind === 'AbortError') return `マイクを使えませんでした(ほかのアプリが使っているかも)。${TEXT_OK}`;
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
  if (message && HAS_JAPANESE.test(message)) return `${message.replace(/[。.]+$/, '')}。${TEXT_OK}`;
  return `声で話せませんでした。${TEXT_OK}`;
}
