// 公開のリンクの合言葉(審査の人に渡す物)を、このタブの中だけに持つ。URL には入れず、見出し x-demo-pass で送る(契約 K5)。
// 画面の入力欄(S5)が setDemoPass を呼ぶ。タブを閉じると消える(sessionStorage。使えなければ、この画面の間だけ)。

const STORAGE = 'yc.demoPass';
let memo = '';

const storage = () => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export function getDemoPass() {
  if (memo) return memo;
  try {
    memo = storage()?.getItem(STORAGE) ?? '';
  } catch {
    memo = '';
  }
  return memo;
}

export function setDemoPass(pass) {
  memo = String(pass ?? '').trim().slice(0, 200);
  try {
    if (memo) storage()?.setItem(STORAGE, memo);
    else storage()?.removeItem(STORAGE);
  } catch {
    // この画面の間だけ覚える
  }
}

export const clearDemoPass = () => setDemoPass('');

/** 会話と記憶の API に付ける見出し(合言葉が無ければ空) */
export function demoHeaders() {
  const p = getDemoPass();
  return p ? { 'x-demo-pass': p } : {};
}
