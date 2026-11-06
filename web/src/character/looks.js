// 見た目の方式(契約 K1 の looks: 3D と 2D)を選ぶ決まりと、このタブで選んだ見た目の覚え方。
// three を読まない小さな部品にして、node の試験でも読めるようにしてある(通信もしない。2D の有無の確かめは index.js)。

/** 見た目の方式の並び(切り替えのボタンもこの順) */
export const LOOKS = Object.freeze(['3d', '2d']);

/** ?look= などの値を、決まった言葉('3d' | '2d')にする。それ以外は '' */
export function normalizeLook(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '2d' || s === '3d' ? s : '';
}

/**
 * どちらの見た目で出すか。先に URL の ?look=、次にこのタブで選んだ物、次に character.json の looks.default、無ければ 3d。
 * 3D の形(model)が無く 2D がある時は 2D、その逆は 3D にする(出せる方を出す)。
 * @param {object} json character.json
 * @param {string} [asked] URL の ?look=
 * @param {string} [remembered] このタブで選んだ見た目
 */
export function pickLook(json, asked = '', remembered = '') {
  const has2d = Boolean(json?.looks?.['2d']);
  const has3d = Boolean(json?.model);
  let look = normalizeLook(asked) || normalizeLook(remembered) || (normalizeLook(json?.looks?.default) === '2d' ? '2d' : '3d');
  if (look === '3d' && !has3d && has2d) look = '2d';
  return look;
}

/** 2D の部品の表(parts.json)の場所(character.json からの相対)。looks.2d.parts が文字ならそれ、無ければ決まりの場所 */
export function partsPath(json) {
  const parts = json?.looks?.['2d']?.parts;
  return typeof parts === 'string' ? parts : '2d/parts.json';
}

/**
 * 画面で 2D の板を出せそうか。
 *   'yes'   … looks.2d.parts に部品の表(parts.json)の場所が書いてある(S2 の形)
 *   'probe' … looks はあるが 2d が書いていない。決まりの場所(2d/parts.json)にあるかを見て決める
 *   'no'    … looks が無い(前の形)か、2d が部品の名前の並びだけ(板の部品の表が無いので、画面では出せない)
 */
export function twoDHint(json) {
  const two = json?.looks?.['2d'];
  if (typeof two?.parts === 'string') return 'yes';
  if (two) return 'no';
  return json?.looks ? 'probe' : 'no';
}

/** このタブで選んだ見た目を覚える鍵(キャラごと) */
export function rememberKey(id) {
  return `yc.look.${id ?? ''}`;
}

/** このタブで選んだ見た目を読む。読めない(使えない・中身が違う)時は '' */
export function readRemembered(storage, id) {
  try {
    return normalizeLook(storage?.getItem(rememberKey(id)));
  } catch {
    return '';
  }
}

/** このタブで選んだ見た目を覚える。覚えられない時(使えない・いっぱい)は false(切り替えはそのまま効く) */
export function writeRemembered(storage, id, look) {
  const value = normalizeLook(look);
  if (!value || !storage) return false;
  try {
    storage.setItem(rememberKey(id), value);
    return true;
  } catch {
    return false;
  }
}
