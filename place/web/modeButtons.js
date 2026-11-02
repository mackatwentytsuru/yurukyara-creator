// 「AR で見る」「VR で見る」「画面に戻る」のボタンを container に出す(使えない物は出さない)。
//   mountModeButtons({ modes, container, onError })
// modes は modes.js の createPresentation の戻り値。ボタンは data-hide-in-ar 付き(AR に入ると隠れる。
// 戻る手段は、殻ではアプリを閉じる/Quest ではシステムのメニュー)。見た目は web/ 側の CSS で決める(クラス place-mode-button)。
const LABELS = { ar: 'AR で見る', vr: 'VR で見る', screen: '画面に戻る' };

export function mountModeButtons({ modes, container, onError = () => {}, doc = container.ownerDocument }) {
  const buttons = {};
  function refresh() {
    for (const [mode, btn] of Object.entries(buttons)) {
      btn.hidden = mode === 'screen' ? modes.mode === 'screen' : modes.mode === mode;
    }
  }
  for (const mode of ['ar', 'vr', 'screen']) {
    if (mode !== 'screen' && !modes.available[mode]) continue;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `place-mode-button place-mode-${mode}`;
    btn.textContent = LABELS[mode];
    btn.dataset.hideInAr = '';
    btn.addEventListener('click', async () => {
      try {
        await modes.enter(mode);
      } catch (e) {
        onError(e);
      }
      refresh();
    });
    buttons[mode] = btn;
    container.appendChild(btn);
  }
  refresh();
  return { buttons, refresh };
}
