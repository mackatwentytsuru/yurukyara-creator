// 「AR で見る」「VR で見る」「画面に戻る」のボタンを container に出す(使えない物は出さない)。
//   mountModeButtons({ modes, container, onError, onWait })
// modes は modes.js の createPresentation の戻り値。ボタンは data-hide-in-ar 付き(AR に入ると隠れる。
// 戻る手段は、殻ではアプリを閉じる/Quest ではシステムのメニュー)。見た目は web/ 側の CSS で決める(クラス place-mode-button)。
//
// 実機の Quest(11/7): VR・AR を押すと、ブラウザの下に「…没入体験を開くことを許可しますか? [許可しない] [許可する]」の帯が出て、
// 答えるまで requestSession が返らない(画面は何も変わらず「押しても何も起きない」に見えた)。もう一度押すと InvalidStateError。
// そこで、頼んでいる間は全部のボタンを押せなくし(aria-busy)、onWait(mode) で画面の真ん中に XR_WAIT_TEXT を出してもらう。
// 入れた・断られた・失敗した時に onWait(null)。iPhone の殻の AR は、ブラウザの許可が無いので onWait を呼ばない。
const LABELS = { ar: 'AR で見る', vr: 'VR で見る', screen: '画面に戻る' };

/** VR・AR を頼んで、入るか断られるまで画面の真ん中に出す文 */
export const XR_WAIT_TEXT = 'ブラウザの下の『許可する』を押してください';

/** ブラウザに許可をたずねられる入り方か(WebXR の VR・AR。iPhone の殻の AR はたずねない) */
export const asksBrowser = (modes, mode) => mode === 'vr' || (mode === 'ar' && modes?.available?.ar_kind === 'webxr');

/**
 * 入れなかった時の知らせ(日本語)。ブラウザで「許可しない」を押した時(NotAllowedError・SecurityError)は、そう言う。
 * @param {unknown} err
 * @param {string} mode
 */
export function xrErrorText(err, mode) {
  const what = mode === 'ar' ? 'AR に入れませんでした' : mode === 'vr' ? 'VR に入れませんでした' : '画面に戻れませんでした';
  const kind = err && typeof err === 'object' ? String(err.name ?? '') : '';
  if (kind === 'NotAllowedError' || kind === 'SecurityError') return `${what}(ブラウザで許可されませんでした)`;
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err ?? '');
  return `${what}(${message || '理由は分かりません'})`;
}

export function mountModeButtons({ modes, container, onError = () => {}, onWait = () => {}, doc = container.ownerDocument }) {
  const buttons = {};
  let busy = null; // 頼んでいる見せ方(入るか断られるまで)。その間は、どのボタンも押せない(2 回目を頼まない)
  function refresh() {
    for (const [mode, btn] of Object.entries(buttons)) {
      btn.hidden = mode === 'screen' ? modes.mode === 'screen' : modes.mode === mode;
      btn.disabled = Boolean(busy);
      if (busy === mode) btn.setAttribute('aria-busy', 'true');
      else btn.removeAttribute('aria-busy');
    }
  }
  async function choose(mode) {
    if (busy || modes.pending) return; // 頼んでいる途中は、もう頼まない
    const asks = asksBrowser(modes, mode);
    busy = mode;
    refresh();
    if (asks) onWait(mode);
    try {
      await modes.enter(mode);
    } catch (e) {
      onError(new Error(xrErrorText(e, mode), { cause: e }));
    } finally {
      busy = null;
      if (asks) onWait(null);
      refresh();
    }
  }
  for (const mode of ['ar', 'vr', 'screen']) {
    if (mode !== 'screen' && !modes.available[mode]) continue;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `place-mode-button place-mode-${mode}`;
    btn.textContent = LABELS[mode];
    btn.dataset.hideInAr = '';
    btn.addEventListener('click', () => void choose(mode));
    buttons[mode] = btn;
    container.appendChild(btn);
  }
  refresh();
  // 自動で AR に入る(殻)ときや、ヘッドセット側で終わらせたときも、表示を今のモードに合わせる
  modes.subscribe?.(refresh);
  return { buttons, refresh, choose, get busy() { return busy; } };
}
