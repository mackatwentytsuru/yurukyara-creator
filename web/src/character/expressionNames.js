// 表情の名前の扱い。画面(three-vrm)でも、サーバー(頭脳の返事の検証)でも使う、three を使わない部品。
// キャラは標準の表情(neutral happy surprised sad angry relaxed think)のほかに、カスタムの表情を持てる。
// そのキャラに無い表情は、近い物に落とす(ウインク → happy など)。

export const STANDARD_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad', 'angry', 'relaxed', 'think'];

// 名前をそろえる(大文字小文字・_ - の違いは同じ物として扱う)
const norm = (s) => String(s).toLowerCase().replace(/[_\-\s]/g, '');

// 近い標準の表情。キャラの character.json の expression_fallback で上書きできる
const DEFAULT_FALLBACK = {
  think: 'relaxed', thinking: 'relaxed',
  wink: 'happy', winkright: 'happy', smug: 'happy', sparkle: 'happy', tongue: 'happy', singbig: 'happy', moutho: 'surprised', shy: 'happy', blush: 'happy', embarrassed: 'happy', bigsmile: 'happy', grin: 'happy', smile: 'happy', laugh: 'happy', joy: 'happy', fun: 'happy', proud: 'happy',
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
