// 「パソコンの つづきを スマホで」(本人の案 11/7 18:0x): PC の札が出す 6 桁の番号を、QR でも別の端末へ渡す決まり。
// DOM も three も読まない小さな部品(node の試験で読む。画面の部品は ui/memoryPanel.js)。
//
// QR に入れる文 = この画面の origin + pathname(+ アドレスにあった害の無い ?character= と ?look= だけ。S5 の questTarget と同じ決まり)
// + '#pair=' + 番号。# の後ろはサーバーへ届かない(ブラウザは # を送らない。Referer にも入らない)。
// 合鍵・合言葉・ほかの ? と # の中身は入れない。番号の決まり(10 分・1 回だけ)はサーバーのまま(QR でも、打っても同じ)。
// QR で開いた端末は、この部品を読んだすぐ後に # を読み、アドレスの欄から消す(history.replaceState。戻るの履歴にも残さない)。

import { questTarget } from '../stage/questLink.js';
import { isLoopbackPage } from '../character/urlSpec.js';

/** アドレスの # の頭(この後ろに 6 桁の番号) */
export const PAIR_HASH = '#pair=';
const CODE_RE = /^[0-9]{6}$/;

/** 画面に出す言葉(PC の札と、QR で開いた端末の確かめ)。確かめは子どもにも読めるように、ひらがなと短い文で */
export const PAIR_TEXT = Object.freeze({
  qrHow: 'スマホのカメラで読み取ると、この続きから話せます(番号と同じく 10 分・1 回だけ)。',
  qrLoopback: 'この PC の中のアドレス(localhost など)なので、スマホでは開けません。スマホでは番号を入れてね。',
  qrLabel: '別の端末で続ける QR コード',
  ask: 'パソコンの つづきを はじめる?',
  lead: 'パソコンで おはなしした ことを おぼえたまま、ここで つづきが できるよ。',
  yes: 'はじめる',
  no: 'やめる',
  close: 'とじる',
  busy: 'つないでいるよ…',
  done: 'つながったよ! パソコンの つづきから はなしてね。',
  gone: 'この QR は もう つかえないよ(じかんぎれか、もう つかった QR)。パソコンで もう いちど QR を だしてね。',
  wait: 'まちがいが つづいたので、すこし まってから ためしてね。',
  pass: 'あいことばを いれてから「はじめる」を おしてね。',
  passLabel: 'あいことば',
  fail: 'いまは つながらないよ。すこし まってから、もう いちど「はじめる」を おしてね。',
});

/**
 * QR に入れる文。番号が 6 桁の数字で、この画面の場所が http(s) の時だけ(ほかは null)。
 * @param {{origin?: string, pathname?: string}} loc
 * @param {string} code 6 桁の番号
 * @param {{character?: string, look?: string}} [o] 入れてよいのは id の形の character と 3d・2d の look だけ(questTarget が確かめる)
 */
export function pairLinkUrl(loc, code, { character = '', look = '' } = {}) {
  const c = String(code ?? '');
  if (!CODE_RE.test(c)) return null;
  const base = questTarget(loc, { character, look });
  return base ? `${base}${PAIR_HASH}${c}` : null;
}

/**
 * アドレスにあった ?character=(か ?char=)と ?look= だけを拾う(QR で開いた端末も同じ子・同じ見た目で始める)。
 * 形の確かめは pairLinkUrl(questTarget)がする。ほかの ?(合言葉・記憶を切る指定など)は拾わない。
 * @param {{search?: string}} loc
 */
export function pageLook(loc) {
  const q = new URLSearchParams(String(loc?.search ?? ''));
  return { character: q.get('character') ?? q.get('char') ?? '', look: q.get('look') ?? '' };
}

/** この PC の中のアドレスか(QR を読んだスマホからは開けない。知らせを 1 行足す) */
export const isLoopbackLink = (loc) => isLoopbackPage(loc);

/**
 * アドレスの # を読む。#pair= で始まらなければ null。番号が 6 桁の数字なら { code }、形が違えば { code: '', bad: true }
 * @param {string} hash location.hash
 */
export function readPairHash(hash) {
  const h = String(hash ?? '');
  if (!h.startsWith(PAIR_HASH)) return null;
  const v = h.slice(PAIR_HASH.length);
  return CODE_RE.test(v) ? { code: v } : { code: '', bad: true };
}

/**
 * QR で開いた時の番号を読み、すぐにアドレスの欄から # を消す(? の中身はそのまま。戻るの履歴にも残さない)。
 * #pair= が無ければ何もしない(null)。消せなかった時も、読んだ番号は返す(画面の確かめで 1 回だけ使う)
 * @param {{location?: {hash?: string, pathname?: string, search?: string}, history?: {state?: any, replaceState?: Function}}} [win]
 */
export function takePairFromLocation(win = globalThis) {
  const loc = win?.location;
  if (!loc || typeof loc.hash !== 'string') return null;
  const got = readPairHash(loc.hash);
  if (!got) return null;
  try {
    win.history?.replaceState?.(win.history.state ?? null, '', `${loc.pathname ?? '/'}${loc.search ?? ''}`);
  } catch {
    // 消せない端末でも、番号は 10 分で切れ、1 回しか使えない
  }
  return got;
}

/**
 * 番号の受け取りが失敗した時に、確かめの窓に出す言葉と次の形。
 *   final: true … もう一度押しても同じ(番号が違う・切れた・使った、間違いが続いた)。「とじる」だけにする
 *   needPass: true … 公開の URL で合言葉が要る(合言葉の欄を出して、もう一度「はじめる」)
 * @param {{status?: number, reason?: string}} err
 */
export function pairErrorText(err) {
  const status = Number(err?.status) || 0;
  if (status === 400 || err?.reason === 'bad_code') return { text: PAIR_TEXT.gone, final: true, needPass: false };
  if (status === 429) return { text: PAIR_TEXT.wait, final: true, needPass: false };
  if (status === 403 || err?.reason === 'no_pass') return { text: PAIR_TEXT.pass, final: false, needPass: true };
  return { text: PAIR_TEXT.fail, final: false, needPass: false };
}
