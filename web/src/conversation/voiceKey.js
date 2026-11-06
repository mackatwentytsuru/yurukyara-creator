// 使う人が自分で入れる「声の鍵」(BYOK)を、この端末のブラウザの中だけに持つ。
// - 私たちのサーバーには送らない。読み上げのときに、声のサービスへ直接送る(elevenDirect.js)
// - 既定は「覚えない」(この画面を閉じると消える)。「この端末に覚えておく」を選んだときだけ、ブラウザの保存(localStorage)に置く
// - 画面に出すときは、頭と最後の 4 字だけ(maskVoiceKey)

const STORAGE = 'yc.voiceKey';
const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
let memo = '';
const listeners = new Set();

const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 保存が使えない(private の窓など)
  }
};

/** 鍵として受け付ける形か(空白・記号・短すぎる物を断る。本物かどうかは、声のサービスに聞くまで分からない) */
export function isPlausibleVoiceKey(key) {
  return typeof key === 'string' && KEY_RE.test(key.trim());
}

export function getVoiceKey() {
  if (memo) return memo;
  try {
    const k = storage()?.getItem(STORAGE) ?? '';
    if (isPlausibleVoiceKey(k)) {
      memo = k;
      return k;
    }
  } catch {
    // 読めない時は、覚えていない扱い
  }
  return '';
}

/** この端末のブラウザの保存に置いてあるか */
export function isVoiceKeyRemembered() {
  try {
    return Boolean(storage()?.getItem(STORAGE));
  } catch {
    return false;
  }
}

/**
 * 鍵を入れる。remember が false(既定)なら、ブラウザの保存から消し、この画面の間だけ覚える。
 * @param {string} key
 * @param {{remember?: boolean}} [o]
 */
export function setVoiceKey(key, { remember = false } = {}) {
  const k = String(key ?? '').trim();
  if (!isPlausibleVoiceKey(k)) throw new Error('声の鍵の形が違うみたい(英数字だけで、20 字以上)');
  memo = k;
  try {
    if (remember) storage()?.setItem(STORAGE, k);
    else storage()?.removeItem(STORAGE);
  } catch {
    // 保存が使えなくても、この画面の間は使える
  }
  for (const fn of listeners) fn(true);
}

/** 鍵を消す(ブラウザの保存からも) */
export function clearVoiceKey() {
  memo = '';
  try {
    storage()?.removeItem(STORAGE);
  } catch {
    // 何もしない
  }
  for (const fn of listeners) fn(false);
}

/** 画面に出すための形(頭と最後の 4 字だけ) */
export function maskVoiceKey(key = getVoiceKey()) {
  if (!key) return '';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** 鍵が入った・消えたを知らせる。戻り値を呼ぶと止める */
export function onVoiceKeyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
