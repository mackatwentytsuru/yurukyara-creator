// テレビ表示まわりの小さな文と判定(B13L・TV3 の should)。DOM も three も読まない(node の試験で読む)。
//   ① 「テレビに映す」の箱には、ホーム画面に追加して開く手順を、箱を開くたびに書く(前は全画面にした後に 1 回だけで、見のがすと二度と出なかった)
//   ② 全画面の案内の「F11」は Windows などの言葉。Mac は control + command + F なので、Mac には F11 と書かない

/**
 * Mac(iPad ではない)か。iPadOS の Safari は Mac と同じ名乗りをするので、指で触れる点が 2 つ以上ある「Mac」は iPad とみなして Mac に数えない
 * @param {{userAgent?: string, platform?: string, maxTouchPoints?: number}} nav navigator の 3 つの値
 */
export function isMacDesktop({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent ?? '');
  if (/iPhone|iPod|iPad/.test(ua)) return false;
  const mac = String(platform ?? '').startsWith('Mac') || /Macintosh|Mac OS X/.test(ua);
  return mac && !(Number(maxTouchPoints) > 1);
}

/** PC のブラウザで全画面にするキーの案内(F11 は Mac では全画面にならない) */
export function pcFullscreenKeys(mac = false) {
  return mac ? 'control + command + F キー' : 'F11 キー';
}

/**
 * 「テレビに映す」の箱に書く、ホーム画面に追加して開く手順(帯の無い全画面になる)。ホーム画面の頁として開いている時は '' (もう済んでいる)。
 * 箱を開くたびに見える(手順の下の注意の行)
 * @param {{installed?: boolean}} o
 */
export function homeScreenLine({ installed = false } = {}) {
  if (installed) return '';
  return 'ぜんがめんに したい ときは、共有ボタン →「ホーム画面に追加」→ ホーム画面の ゆるキャラの アイコンから ひらいてね(URL の おびが きえます)。';
}
