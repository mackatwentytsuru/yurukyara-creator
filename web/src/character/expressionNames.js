// 表情の名前の扱い。画面(three-vrm)でも、サーバー(頭脳の返事の検証)でも使う、three を使わない部品。
// キャラは標準の表情(neutral happy surprised sad angry relaxed think)のほかに、カスタムの表情を持てる。
// そのキャラに無い表情は、近い物に落とす(ウインク → happy など)。

export const STANDARD_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad', 'angry', 'relaxed', 'think'];

// 名前をそろえる(大文字小文字・_ - の違いは同じ物として扱う)
const norm = (s) => String(s).toLowerCase().replace(/[_\-\s]/g, '');

// 近い標準の表情。キャラの character.json の expression_fallback で上書きできる
const DEFAULT_FALLBACK = {
  think: 'relaxed', thinking: 'neutral',
  wink: 'happy', winkright: 'happy', smug: 'happy', sparkle: 'happy', tongue: 'happy', singbig: 'aa', moutho: 'surprised', shy: 'happy', blush: 'happy', embarrassed: 'happy', bigsmile: 'happy', grin: 'happy', smile: 'happy', laugh: 'happy', joy: 'happy', fun: 'happy', proud: 'happy',
  pout: 'angry', sulk: 'angry', annoyed: 'angry', mad: 'angry',
  troubled: 'sad', worried: 'sad', cry: 'sad', crying: 'sad', tears: 'sad', sob: 'sad', sorrow: 'sad',
  confused: 'surprised', shock: 'surprised', amazed: 'surprised',
  ウインク: 'happy', 照れ: 'happy', 満面の笑み: 'happy', ふくれっ面: 'angry', 困り顔: 'sad', 泣き顔: 'sad',
};
const DEFAULT_BY_NORM = Object.fromEntries(Object.entries(DEFAULT_FALLBACK).map(([k, v]) => [norm(k), v]));

/**
 * name を、canShow(そのキャラが出せる)な表情に直す。出せなければ、近い物をたどる(最大 4 つ)。見つからなければ null。
 * @param {string} name
 * @param {(n:string)=>boolean} canShow
 * @param {Record<string,string>} explicit キャラが決めた落とし先
 */
export function nearestExpression(name, canShow, explicit = {}) {
  const byNorm = Object.fromEntries(Object.entries(explicit ?? {}).map(([k, v]) => [norm(k), v]));
  let cur = name;
  for (let i = 0; i < 5 && cur; i++) {
    if (canShow(cur)) return cur;
    cur = byNorm[norm(cur)] ?? DEFAULT_BY_NORM[norm(cur)] ?? (cur === 'neutral' ? null : 'neutral');
  }
  return canShow('neutral') ? 'neutral' : null;
}

/**
 * 1 回の返事のあいだ、特別な表情(標準でない物)は 1 つまで。2 つ目以降は、近い標準の表情に落とす。
 * 漫符(頬の赤み・涙・汗など)を持つ表情が続けて切り替わると、板が重なって飛び出すため。同じ表情の続きはそのまま。
 * @param {string[]} expressions そのキャラの表情の一覧
 * @returns {(name:string)=>string} 文ごとに通す関数(返事ごとに作り直す)
 */
export function oneCustomPerReply(expressions) {
  const std = new Set(STANDARD_EXPRESSIONS);
  let used = null;
  return (name) => {
    if (std.has(name) || !expressions.includes(name)) return name;
    if (used === null || used === name) {
      used = name;
      return name;
    }
    return nearestExpression(name, (n) => std.has(n) && expressions.includes(n)) ?? 'neutral';
  };
}
