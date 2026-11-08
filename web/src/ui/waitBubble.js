// 起動中・返事待ちの表示(CU。本人 11/8「スマホで、最初の一言が出るまで ラグがある。起動中だと分かるようにして。無視されてるように見えたくない」)。
// 3 つの場面で、同じ「…」(3 つの点が順に光る)と、子どもにも読める一言を出す:
//   1. 入口: 画面とキャラを読んでいる間(押せない間)は「ノリーが おきているよ…」。押せるようになったら「じゅんび できたよ! おしてね」
//   2. 押した後〜最初の一言(再訪)・話しかけた後〜返事の最初の文字: 字幕の場所に「ノリーが かんがえているよ」+「…」
//   3. 初めての会話の札: 吹き出しの中身が空の間は「…」(view.js)
// DOM を使わない部分(出す・消すの決まり)だけをここに置く。出し方は render で渡す(node の試験で、タイマーを差し替えて確かめる)。
// 動きを止める設定(prefers-reduced-motion)では、点は動かさず文字だけ(style.css)。

/** 入口で、読み込み中に出す一言(名前は、案内するキャラ) */
export const wakeLoading = (name = 'ノリー') => `${name}が おきているよ…`;
/** 入口で、押せるようになった時の一言 */
export const WAKE_READY = 'じゅんび できたよ! おしてね';
/** 入口で、押した後(カメラやモデルを用意している間)の一言 */
export const WAKE_BUSY = 'いま じゅんびしているよ…';
/** 入口で、読み込めなかった時の一言(動く点は止める。ずっと「起きているよ」のままにしない) */
export const WAKE_FAILED = 'うまく ひらけなかったよ。もう一度 ひらいてね';
/** 入口の読み込み中に、一言の下へ添える説明 */
export const WAKE_HINT = 'ボタンが ひかったら、おしてね';
/** 字幕の場所に出す一言(返事を待つ間・最初の一言を待つ間) */
export const thinkingText = (name = 'ノリー') => `${name}が かんがえているよ`;

/** 話しかけてから、返事の文字が無いまま、この長さを過ぎたら出す(すぐ返る時にちらつかせない) */
export const WAIT_DELAY_MS = 400;
/** 出したままにする上限。失敗や取り消しで消す知らせが来なくても、ずっと残さない */
export const WAIT_MAX_MS = 20000;

/**
 * 返事を待つ間の「…」の吹き出しを出し入れする。
 * @param {object} o
 * @param {(visible:boolean, text:string)=>void} o.render 出す(true と文)・消す(false)。画面の側で DOM を触る
 * @param {()=>string} [o.nameOf] いま話しかけているキャラの名前
 * @param {number} [o.delayMs]
 * @param {number} [o.maxMs]
 * @param {{set:Function, clear:Function}} [o.timers] 試験でタイマーを差し替える
 */
export function createWaitBubble({ render, nameOf = () => 'ノリー', delayMs = WAIT_DELAY_MS, maxMs = WAIT_MAX_MS, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } } = {}) {
  let showTimer = null;
  let maxTimer = null;
  let active = false;
  let shown = false;

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
    render(true, thinkingText(nameOf()));
  };
  const end = () => {
    clearTimers();
    active = false;
    if (!shown) return;
    shown = false;
    render(false, '');
  };

  return {
    /** 待ち始め。immediate なら、すぐ出す(押した直後の最初の一言)。そうでなければ delayMs を過ぎても文字が来なければ出す。出ている間の呼び直しは、出したまま */
    begin({ immediate = false } = {}) {
      clearTimers();
      active = true;
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
