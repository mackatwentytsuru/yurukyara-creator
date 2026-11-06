// URL の ?character= と ?place= に書ける物の決まり(点検 CRITsec F5)。three も DOM も読まない小さな部品(node の試験で読む)。
// 公開の URL では id だけを読む。外の URL やパスを書いたリンクを配られても、公式の画面に外のキャラ・人格・場所の文を出さない。
// パスや URL は、このページをこの PC の中(localhost・127.0.0.1・[::1])で開いた時だけ読む(開発の確かめ。前と同じ)。

/** キャラと場所の id の形(英小文字・数字・_ の 32 字まで) */
export const SPEC_ID_RE = /^[a-z0-9_]{1,32}$/;

/** @param {unknown} v */
export const isSpecId = (v) => typeof v === 'string' && SPEC_ID_RE.test(v);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * このページを、この PC の中で開いているか(localhost・127.0.0.1・[::1]・*.localhost)。
 * それ以外(公開の URL・家の中の番号・tailnet の名前)は、全部「公開の URL」と同じに扱う(名前は誰でも持てるので信じない)。
 * @param {{hostname?: string}} [loc]
 */
export function isLoopbackPage(loc = globalThis.location) {
  const host = String(loc?.hostname ?? '').toLowerCase();
  return LOOPBACK.has(host) || host.endsWith('.localhost');
}

/**
 * URL の値を、読んでよい指定にする。id はいつでも読む。パスや URL(id の形でない物)は allowPath の時だけ読む。
 * @param {string|null|undefined} raw URL の値
 * @param {{allowPath?: boolean}} [o]
 * @returns {{spec: string|null, rejected: boolean}} spec は読む指定(無ければ null)。rejected は、書いてあったのに読まなかった時 true
 */
export function pickSpec(raw, { allowPath = false } = {}) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return { spec: null, rejected: false };
  if (isSpecId(v) || allowPath) return { spec: v, rejected: false };
  return { spec: null, rejected: true };
}

/** 読まなかった時の知らせ(書かれた値は画面に写さない) */
export const SPEC_NOTICE = Object.freeze({
  character: '?character= に書けるのは、キャラの id(英小文字・数字・_ の 32 字まで)だけです。書かれた場所は読まずに、いつものキャラを出しました。',
  place: '?place= に書けるのは、場所の id(英小文字・数字・_ の 32 字まで)だけです。書かれた場所は読まずに、試しの場所にしました。',
});
