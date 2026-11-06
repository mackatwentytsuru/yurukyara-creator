// 何も指定が無い時に出すキャラの順と、主役。three を読まない小さな部品にして、node の試験でも読めるようにしてある。

/** 主役(協力者が手で描いた三面図から作る子)。初めての会話の案内役にもなる。表示の名前は、舞台に出ていれば character.json の name を使う */
export const MAIN_CHARACTER = Object.freeze({ id: 'norrie', name: 'ノリー' });

/** 何も指定が無い時に出すキャラ。先頭から、読めた物を使う(主役 → 作例のようこそくん。主役がまだ無い木でも画面は出る) */
export const DEFAULT_CHARACTERS = Object.freeze([MAIN_CHARACTER.id, 'yokoso']);

/**
 * ids を先頭から順に load で試し、最初に読めた物を返す。全部だめなら、最後の理由を投げる。
 * @template T
 * @param {readonly string[]} ids
 * @param {(id: string) => Promise<T>} load
 * @param {(id: string, err: Error) => void} [onSkip] 読めずに次へ進んだ時(理由を残す)
 * @returns {Promise<{ character: T, id: string }>}
 */
export async function loadFirstOf(ids, load, onSkip = () => {}) {
  let lastErr = null;
  for (const id of ids) {
    try {
      return { character: await load(id), id };
    } catch (err) {
      lastErr = err;
      onSkip(id, err);
    }
  }
  throw lastErr ?? new Error('出せるキャラがありません');
}
