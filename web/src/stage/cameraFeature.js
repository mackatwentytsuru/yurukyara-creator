// カメラの機能を、次のアップデートまで外しておく 1 か所のスイッチ(11-08 本人「カメラ機能だけどうまく機能していないから VR 以外はカメラ機能を…機能から一回外してほしい。次のアップデートでそれは出そう」)。
// - 元に戻す時は、ここを true にするだけ(カメラのコードは消していない)
// - 外している間: 入力の列のカメラのボタン・入口の「カメラを使って始める」・カメラの許可の窓・会話に付ける絵・端末のカメラでの顔の追従が、どれも動かない
// - VR(ヘッドセットのブラウザ)の道は今のまま。URL の新しい口と、見える設定は作らない。試験だけ、ページを読む前に window.__YC_CAMERA_FEATURE = true と決めて入れられる

/** カメラを入れている時の、入口の下の注意書き(外している間は出さない) */
export const GATE_FINE_WITH_CAMERA = 'カメラの えは、こたえを つくるために Claude に おくられます(ほぞんしません)。つかうかは あなたが きめてね。カメラは あとから いつでも きりかえられます。マイクは「声で話す」を押した時だけ使います。';

/**
 * カメラの機能が使える画面か。VR の道か、試験が入れた時だけ true。
 * @param {object} [win] 窓(試験で偽物を渡す)
 * @returns {boolean}
 */
export function cameraFeatureOn(win = globalThis.window) {
  if (win?.__YC_CAMERA_FEATURE === true) return true;
  const headsetParam = new URLSearchParams(win?.location?.search ?? '').get('headset') === '1'; // main.js の IS_HEADSET と同じ見分け(新しい口ではない)
  return headsetParam || /OculusBrowser|Quest/i.test(globalThis.navigator?.userAgent ?? '');
}
