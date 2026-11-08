// 「AI キャラクターの〈名前〉と話しています」の知らせ(使う人と話すチャットは、AI だと知らせる決まり。いつも見せる)。
// 舞台の子が読み込まれた時・替わった時・ことばが替わった時に、画面の 2 か所(#aiNotice と #aiNoticeTop)の文字を替える。
// 名前が分からない間は、名前なしの文。文字は textContent だけで入れる(名前は使う人が作った物なので、HTML として扱わない)。

/** 名前の長さの上限(長い名前で、1 行の知らせが画面からはみ出さないように) */
export const AI_NOTICE_NAME_MAX = 16;

/** 名前が無い間の文(ことば別)。index.html の最初の文字と同じ(日本語) */
export const AI_NOTICE_NO_NAME = Object.freeze({
  ja: 'AI キャラクターと話しています',
  en: "You're talking with an AI character",
  zh: '你正在和 AI 角色交谈',
  ko: 'AI 캐릭터와 대화하고 있어요',
});

/** 画面の lang 属性(文字の形を、その言葉に合わせる) */
const HTML_LANG = Object.freeze({ ja: 'ja', en: 'en', zh: 'zh-Hans', ko: 'ko' });

/** 韓国語の「와/과」: 名前の最後がハングルで、終わりの子音(받침)があれば 과、無ければ 와。ハングルでなければ 와(과) */
function koWith(name) {
  const code = name.charCodeAt(name.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '와(과)';
  return (code - 0xac00) % 28 === 0 ? '와' : '과';
}

/** 長すぎる名前は切る(「…」を付ける)。空白だけ・空は ''。 */
export function clipName(name, max = AI_NOTICE_NAME_MAX) {
  const chars = [...String(name ?? '').replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/**
 * 知らせの文。lang は 'ja' | 'en' | 'zh' | 'ko'(それ以外・無しは 'ja')。
 *  ja: AI キャラクターの〈名前〉と話しています
 *  en: You're talking with 〈名前〉, an AI character
 */
export function aiNoticeText(name, lang = 'ja') {
  const l = Object.hasOwn(AI_NOTICE_NO_NAME, lang) ? lang : 'ja';
  const n = clipName(name);
  if (!n) return AI_NOTICE_NO_NAME[l];
  if (l === 'en') return `You're talking with ${n}, an AI character`;
  if (l === 'zh') return `你正在和 AI 角色${n}交谈`;
  if (l === 'ko') return `AI 캐릭터 ${n}${koWith(n)} 대화하고 있어요`;
  return `AI キャラクターの${n}と話しています`;
}

/** 画面の 2 か所の知らせを、名前とことばに合わせて書き替える。書いた文を返す(2 か所とも無ければ文だけ返す) */
export function setAiNotice({ name, lang = 'ja', doc = globalThis.document } = {}) {
  const text = aiNoticeText(name, lang);
  const htmlLang = HTML_LANG[Object.hasOwn(HTML_LANG, lang) ? lang : 'ja'];
  for (const id of ['aiNotice', 'aiNoticeTop']) {
    const el = doc?.getElementById?.(id);
    if (!el) continue;
    if (el.textContent !== text) el.textContent = text;
    el.setAttribute('lang', htmlLang);
  }
  return text;
}
