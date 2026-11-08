// 聞く言葉(多言語。ML1): マイクの横の選び「聞く言葉: 日本語 ▾」の値を、この端末に覚える。
// 多言語の時だけ使う値(日本語だけの時は、画面に選びも出さず、聞き取りもいつも日本語)。DOM は使わない。
// 保存が使えない端末(内緒のウインドウなど)でも止まらない。
import { DEFAULT_HEAR_LANG, normalizeHearLang } from './lang.js';

export const HEAR_LANG_STORE = 'yc.hearLang.v1';

let current = null; // 読み込む前は null(初めて読む時に、保存した値か既定を入れる)
const subs = new Set();

function load(storage) {
  try {
    return normalizeHearLang(storage?.getItem(HEAR_LANG_STORE)) ?? DEFAULT_HEAR_LANG;
  } catch {
    return DEFAULT_HEAR_LANG;
  }
}

/** いまの聞く言葉(ja・en・zh・ko) */
export function getHearLang(storage = globalThis.localStorage) {
  if (current === null) current = load(storage);
  return current;
}

/** 聞く言葉を替える。知らない値は替えない。替えたら、見ている所へ知らせて、この端末に覚える。返り値は、いまの値 */
export function setHearLang(lang, storage = globalThis.localStorage) {
  const next = normalizeHearLang(lang);
  if (!next) return getHearLang(storage);
  const changed = next !== getHearLang(storage);
  current = next;
  try {
    storage?.setItem(HEAR_LANG_STORE, next);
  } catch {
    // 覚えられなくても、この画面の間は使える
  }
  if (changed) for (const fn of [...subs]) fn(next);
  return next;
}

/** 替わった時に呼ぶ関数を足す。返り値は外す関数 */
export function onHearLang(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 試験用: 覚えた値を読み直させる */
export function resetHearLang() {
  current = null;
  subs.clear();
}

/**
 * いま実際に聞く言葉。日本語だけの時は、いつも ja(選びの値は使わない)。多言語の時だけ、選んだ値
 * @param {'ja'|'multi'} mode
 */
export const effectiveHearLang = (mode, storage) => (mode === 'multi' ? getHearLang(storage) : DEFAULT_HEAR_LANG);

/** /api/stt に付ける見出し(日本語の時は何も付けない = 今までと同じ) */
export function sttLangHeaders(lang) {
  const v = normalizeHearLang(lang);
  return v && v !== DEFAULT_HEAR_LANG ? { 'x-stt-lang': v } : {};
}
