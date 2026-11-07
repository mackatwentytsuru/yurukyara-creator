// 「VR(Quest)で開く」の決まり(本人の案 11/7)。PC やスマホの画面に、この画面の QR を出し、Quest 3 で読み取って同じキャラに入る。
// DOM も three も読まない小さな部品(node の試験で読む。画面の入口は ui/panel.js の mountQuestLink、つなぐのは main.js)。
//
// 公式で確かめた事(Meta のリリースノート、11/7 に読んだ): Meta Horizon OS v2.9(2026-10-19 の週から順に配る)で、Quest 3・3S に
// QR コードスキャナーが入った。クイック設定・カメラのアプリ・検索から開く(https://www.meta.com/help/quest/172903867975450/ )。
// 読み取った URL をどう開くかは書いていないので、実機で確かめる。
//
// 「Meta Quest に送る」(本人の答え、11/7): QR の横に、Meta 公式の「ウェブローンチ」(PC・スマホのブラウザから、
// Quest のブラウザへ https の URL を送る入口)を開くリンクを出す。公式の頁(https://developers.meta.com/horizon/documentation/web/web-launch/ 、
// 2026-07-22 更新)の決まり: 入口は WEB_LAUNCH、送る URL は url= に URL エンコードして入れる(URL と URLSearchParams で作る)・https だけ・
// 押す所に Meta Quest の名前を出す。画面のコードの外の住所は、この WEB_LAUNCH の 1 つだけ(web/test/privacy.test.mjs の例外 1 つ)。
//
// QR とウェブローンチに入れるのは、この画面の場所(origin + pathname)と、害の無い ?character=(キャラの id)と ?look=(3d・2d)だけ。
// 合言葉・記憶の番号・鍵・ほかの ? と # の中身は、URL にあっても入れない。

import { isSpecId } from '../character/urlSpec.js';
import { normalizeLook } from '../character/looks.js';

/** この PC・家の中のアドレスで開いている時の 1 行(Quest からは開けない) */
export const PRIVATE_NOTE = 'この PC・家の中のアドレスは、Quest から開けません。';

/**
 * QR の横に出す読み取り方(公式の名前で)。読み取った後に Quest のブラウザでこの画面が開くかは、公式に書いていなく、
 * 本物の Quest でもまだ確かめていないので、「開きます」とは言わない(確かめたら言ってよい。README の【確かめ待ち】と同じ所)
 */
export const SCAN_HOW = 'Quest 3・3S の QR コードスキャナー(クイック設定かカメラ)で、この画面の URL を読み取れます。';

/** QR を出せない時(URL が長い・部品を読めない) */
export const NO_QR_NOTE = 'QR を出せません。下の URL を Quest のブラウザに入れてください。';

/** Meta 公式のウェブローンチの入口(公式の頁の例と同じ形。送る URL は url= に入れる)。画面のコードで、外の住所はこれ 1 つだけ */
export const WEB_LAUNCH = 'https://www.oculus.com/open_url/';

/** 「Meta Quest に送る」の押す所の言葉(公式の決まり: Meta Quest の名前を出す)と、読み上げの名前(新しいタブで Meta の頁が開く) */
export const SEND_LABEL = 'Meta Quest に送る';
export const SEND_NAME = 'Meta Quest に送る(Meta の頁が新しいタブで開きます)';

const ipv4 = (h) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
};

/** 家の中・この PC・会社の中・携帯の会社の中の番号(Quest がふつうは届かない所) */
const privateV4 = ([a, b]) =>
  a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);

function privateV6(h) {
  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true; // fc00::/7 と fe80::/10
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (!mapped) return false;
  const dotted = ipv4(mapped[1]);
  if (dotted) return privateV4(dotted);
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1]);
  if (!hex) return false;
  const hi = parseInt(hex[1], 16);
  return privateV4([hi >> 8, hi & 0xff]);
}

/**
 * Quest から開けない場所か(この PC・家の中の番号・家の中だけの名前)。名前の付いた公開の場所は false。*.ts.net(Tailscale の中だけの名前。機械と tailnet の名前が入る・Quest は tailnet に無い)は、QR にも Meta の頁にも出さない(CRITsec3 L3)。
 * @param {string} hostname location.hostname
 */
export function isPrivateHost(hostname) {
  let h = String(hostname ?? '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/(^|\.)(local|internal|lan|home\.arpa|ts\.net)$/.test(h)) return true;
  const v4 = ipv4(h);
  if (v4) return privateV4(v4);
  if (h.includes(':')) return privateV6(h);
  return !h.includes('.'); // 点の無い 1 語の名前は、家や会社の中だけの名前
}

/**
 * QR に入れる URL。この画面の origin + pathname に、id の形の character と 3d・2d の look だけを付ける。作れない時は null。
 * @param {{origin?: string, pathname?: string}} loc
 * @param {{character?: string, look?: string}} [o]
 */
export function questTarget(loc, { character = '', look = '' } = {}) {
  const origin = String(loc?.origin ?? '');
  if (!/^https?:\/\/[^/?#@\s]+$/i.test(origin)) return null;
  let path = String(loc?.pathname ?? '/');
  if (!path.startsWith('/') || /[?#\s]/.test(path)) path = '/';
  const q = new URLSearchParams();
  if (isSpecId(character)) q.set('character', character);
  const l = normalizeLook(look);
  if (l) q.set('look', l);
  const s = q.toString();
  return `${origin}${path}${s ? `?${s}` : ''}`;
}

/**
 * ウェブローンチの URL(押すと Meta の頁が開き、Quest のブラウザへ target を送る)。https でない・名前と合言葉・# の付いた URL は作らない(null)。
 * 公式の頁の例と同じく、URL と URLSearchParams で url= に入れる(エンコードは URLSearchParams に任せる)。
 * @param {string} target questTarget の返した URL(この画面の場所と id・見た目だけ)
 */
export function webLaunchUrl(target) {
  let u;
  try {
    u = new URL(String(target ?? ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null;
  const launch = new URL(WEB_LAUNCH);
  launch.searchParams.set('url', u.href);
  return launch.href;
}

/**
 * 入口を出すか・何を出すか。
 *   show=false … Quest の中(immersive-vr が使える・ヘッドセットのブラウザ)。入口を出さない
 *   kind='private' … この PC・家の中のアドレス。QR の代わりに 1 行(note)。ウェブローンチも出さない
 *   kind='qr' … target(QR に入れる文。画面にも同じ URL を出す)。https の時だけ launch(「Meta Quest に送る」の行き先)
 * @param {{loc: {origin?: string, pathname?: string, hostname?: string}, character?: string, look?: string, immersiveVr?: boolean, headset?: boolean}} o
 */
export function questLinkPlan({ loc, character = '', look = '', immersiveVr = false, headset = false }) {
  if (immersiveVr || headset) return { show: false, kind: 'none' };
  if (isPrivateHost(loc?.hostname)) return { show: true, kind: 'private', note: PRIVATE_NOTE };
  const target = questTarget(loc, { character, look });
  if (!target) return { show: false, kind: 'none' };
  const launch = webLaunchUrl(target);
  return launch ? { show: true, kind: 'qr', target, launch } : { show: true, kind: 'qr', target };
}
