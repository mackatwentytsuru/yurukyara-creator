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
  // UW5(UIR 17): 短く(長い文が 3 行になり、キャラの足にかかっていた)
  if (kind === 'NotAllowedError' || kind === 'SecurityError') return `マイクが ブラウザで許可されませんでした。${TEXT_OK}`;
  if (kind === 'NotFoundError' || kind === 'OverconstrainedError') return `マイクが見つかりません。つないでから、もう一度押してね。${TEXT_OK}`;
  if (kind === 'NotReadableError' || kind === 'AbortError') return `マイクを使えませんでした(ほかのアプリが使っているかも)。${TEXT_OK}`;
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
  if (message && HAS_JAPANESE.test(message)) return `${message.replace(/[。.]+$/, '')}。${TEXT_OK}`;
  // どれにも当たらない時は、原因が画面の写真から分かるように、名前を括弧で添える(英数字だけ・24 字まで。11-08 本人の iPhone の確かめ)
  return `声で話せませんでした${nameTag(kind)}。${TEXT_OK}`;
}

/** 括弧つきの名前(「[InvalidStateError]」)。使える文字だけを残し、空なら何も添えない */
function nameTag(name) {
  const tag = String(name ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 24);
  return tag ? `[${tag}]` : '';
}

/**
 * ブラウザの聞き取り(Web Speech)が出したエラーの名前(e.error)の、やさしい日本語。何も言わなくてよい物(no-speech・aborted)は null。
 * 当たらない名前は、括弧で添える。
 * @param {unknown} code
 */
export function recognitionErrorText(code) {
  const name = String(code ?? '');
  if (name === 'no-speech' || name === 'aborted') return null;
  if (name === 'not-allowed' || name === 'service-not-allowed') return `ブラウザの聞き取りが許可されていません${nameTag(name)}。${TEXT_OK}`;
  if (name === 'audio-capture') return `マイクの音を取れませんでした${nameTag(name)}。${TEXT_OK}`;
  if (name === 'network') return `ブラウザの聞き取りが、ネットワークにつながりませんでした${nameTag(name)}。${TEXT_OK}`;
  return `声が聞き取れなくなりました${nameTag(name)}。${TEXT_OK}`;
}
