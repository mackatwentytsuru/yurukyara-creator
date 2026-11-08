// 起動中・返事待ちの表示(CU。本人 11/8「スマホで、最初の一言が出るまで ラグがある。起動中だと分かるようにして。無視されてるように見えたくない」)。
// 3 つの場面で、同じ「…」(3 つの点が順に光る)と、子どもにも読める一言を出す:
//   1. 入口: 画面とキャラを読んでいる間(押せない間)は「ノリーが おきているよ…」。押せるようになったら「じゅんび できたよ! おしてね」
//   2. 押した後〜最初の一言(再訪)・話しかけた後〜返事の最初の文字: 字幕の場所に「ノリーが かんがえているよ」+「…」
//   3. 初めての会話の札: 吹き出しの中身が空の間は「…」(view.js)
// DOM を使わない部分(出す・消すの決まり)だけをここに置く。出し方は render で渡す(node の試験で、タイマーを差し替えて確かめる)。
// 動きを止める設定(prefers-reduced-motion)では、点は動かさず文字だけ(style.css)。

import { clipName } from './aiNotice.js';

// ことばは「ことば」の設定(ja・en・zh・ko。conversation/lang.js)に合わせる。日本語は今までと 1 字も変わらない。
// 名前の入る文(おきているよ・かんがえているよ)は、名前を AI の知らせと同じに切る(長い名前で 1 行からはみ出さない)。
const WAIT_TEXT = Object.freeze({
  ja: {
    loading: (n) => `${n}が おきているよ…`,
    ready: 'じゅんび できたよ! おしてね',
    busy: 'いま じゅんびしているよ…',
    failed: 'うまく ひらけなかったよ。もう一度 ひらいてね',
    hint: 'ボタンが ひかったら、おしてね',
    thinking: (n) => `${n}が かんがえているよ`,
  },
  en: {
    loading: (n) => `${n} is waking up…`,
    ready: 'Ready! Tap to start',
    busy: 'Getting ready…',
    failed: "Couldn't open it. Please open it again",
    hint: 'Tap when the button glows',
    thinking: (n) => `${n} is thinking`,
  },
  zh: {
    loading: (n) => `${n}正在醒来…`,
    ready: '准备好了!点一下吧',
    busy: '正在准备…',
    failed: '没能打开,请再打开一次',
    hint: '按钮亮起来后,点一下',
    thinking: (n) => `${n}正在想`,
  },
  ko: {
    loading: (n) => `${n} 일어나는 중이에요…`,
    ready: '준비됐어요! 눌러 주세요',
    busy: '지금 준비하고 있어요…',
    failed: '잘 열리지 않았어요. 다시 열어 주세요',
    hint: '버튼이 빛나면 눌러 주세요',
    thinking: (n) => `${n} 생각 중이에요`,
  },
});
const textsOf = (lang) => WAIT_TEXT[Object.hasOwn(WAIT_TEXT, lang) ? lang : 'ja'];
const nameOr = (name, fallback) => clipName(name) || fallback;
const DEFAULT_NAME = Object.freeze({ ja: 'ノリー', en: 'Norrie', zh: '诺里', ko: '노리' });
const defaultName = (lang) => DEFAULT_NAME[Object.hasOwn(DEFAULT_NAME, lang) ? lang : 'ja'];

/** 入口で、読み込み中に出す一言(名前は、案内するキャラ) */
export const wakeLoading = (name = 'ノリー', lang = 'ja') => textsOf(lang).loading(nameOr(name, defaultName(lang)));
/** 入口で、押せるようになった時の一言 */
export const WAKE_READY = WAIT_TEXT.ja.ready;
/** 入口で、押した後(カメラやモデルを用意している間)の一言 */
export const WAKE_BUSY = WAIT_TEXT.ja.busy;
/** 入口で、読み込めなかった時の一言(動く点は止める。ずっと「起きているよ」のままにしない) */
export const WAKE_FAILED = WAIT_TEXT.ja.failed;
/** 入口の読み込み中に、一言の下へ添える説明 */
export const WAKE_HINT = WAIT_TEXT.ja.hint;
/** 字幕の場所に出す一言(返事を待つ間・最初の一言を待つ間) */
export const thinkingText = (name = 'ノリー', lang = 'ja') => textsOf(lang).thinking(nameOr(name, defaultName(lang)));

/** 入口の一言(state は loading・ready・busy・failed)を、ことばに合わせて返す */
export function wakeLine(state, { name = '', lang = 'ja' } = {}) {
  const t = textsOf(lang);
  if (state === 'ready') return t.ready;
  if (state === 'busy') return t.busy;
  if (state === 'failed') return t.failed;
  return t.loading(nameOr(name, defaultName(lang)));
}
/** 入口の読み込み中に添える説明を、ことばに合わせて返す */
export const wakeHint = (lang = 'ja') => textsOf(lang).hint;
/** 話しかけてから、返事の文字が無いまま、この長さを過ぎたら出す(すぐ返る時にちらつかせない) */
export const WAIT_DELAY_MS = 400;
/** 出したままにする上限。失敗や取り消しで消す知らせが来なくても、ずっと残さない */
export const WAIT_MAX_MS = 20000;

/**
 * 返事を待つ間の「…」の吹き出しを出し入れする。
 * @param {object} o
 * @param {(visible:boolean, text:string)=>void} o.render 出す(true と文)・消す(false)。画面の側で DOM を触る
 * @param {()=>string} [o.nameOf] いま話しかけているキャラの名前
 * @param {()=>string} [o.langOf] いまのことば(ja・en・zh・ko。無ければ ja)
 * @param {(kind:string, opt?:object)=>(()=>void)} [o.track] はたらいている動き(ui/work.js の beginWork)。待っている間だけ、きらきらを出す(文はここの吹き出しが出すので pill: false)
 * @param {number} [o.delayMs]
 * @param {number} [o.maxMs]
 * @param {{set:Function, clear:Function}} [o.timers] 試験でタイマーを差し替える
 */
export function createWaitBubble({ render, nameOf = () => 'ノリー', langOf = () => 'ja', track = null, delayMs = WAIT_DELAY_MS, maxMs = WAIT_MAX_MS, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } } = {}) {
  let showTimer = null;
  let maxTimer = null;
  let active = false;
  let shown = false;
  let endTrack = null; // きらきらの動きの終わり(待ち始めから終わりまで。1.5 秒を過ぎれば work 側が出す)

  const clearTimers = () => {
    if (showTimer !== null) timers.clear(showTimer);
    if (maxTimer !== null) timers.clear(maxTimer);
    showTimer = null;
    maxTimer = null;
  };
  const show = () => {
    showTimer = null;
    if (!active) return;
    shown = true;
    render(true, thinkingText(nameOf(), langOf()));
  };
  const end = () => {
    clearTimers();
    active = false;
    endTrack?.();
    endTrack = null;
    if (!shown) return;
    shown = false;
    render(false, '');
  };

  return {
    /** 待ち始め。immediate なら、すぐ出す(押した直後の最初の一言)。そうでなければ delayMs を過ぎても文字が来なければ出す。出ている間の呼び直しは、出したまま */
    begin({ immediate = false } = {}) {
      clearTimers();
      active = true;
      if (!endTrack && track) endTrack = track('think', { pill: false });
      maxTimer = timers.set(end, maxMs);
      if (shown) return;
      if (immediate) show();
      else showTimer = timers.set(show, delayMs);
    },
    /** 文字が来た・失敗した・取り消した */
    end,
    get active() {
      return active;
    },
    get shown() {
      return shown;
    },
  };
}
