// 鍵らしい文字を消す(画面とサーバーの両方で使う。部品なし)。
// 声の鍵を、うっかり会話の欄に貼っても、サーバー・頭脳・記憶・記録へ送らないため。
// 日本語の会話に、英数字だけの長い続きはまず出ないので、長い英数字の続きは鍵とみなして消す。
export const REDACTED = '[鍵らしい文字は消しました]';

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Claude の鍵の形
  /sk_[A-Za-z0-9]{20,}/g, // 声の鍵の形(sk_ で始まる)
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /\b[a-f0-9]{32,}\b/gi, // 古い形の声の鍵(16 進 32 字)
  /[A-Za-z0-9_-]{40,}/g, // 記憶の合鍵(43 字)など、長い英数字の続き
];

/**
 * @param {string} text
 * @returns {{text:string, count:number}} 消した後の文と、消した数
 */
export function redactSecrets(text) {
  let s = String(text ?? '');
  let count = 0;
  for (const re of PATTERNS) {
    s = s.replace(re, () => {
      count += 1;
      return REDACTED;
    });
  }
  return { text: s, count };
}

/** 鍵らしい文字を含むか */
export const looksLikeSecret = (text) => redactSecrets(text).count > 0;
