// 「いま はたらいているよ」の決まり(本人 11/8 14:2x「描いてる最中とか作業中に、何かくるくる回るとか、そういうアクションがないと、固まってるように思われちゃう」)。
// 描く(1 分ほど)・子を舞台に出す・3D を待つ・1.5 秒より長い待ち、の間だけ、やさしい動き(きらきらの粒・小さな印・いまの歩みの文)を出す。
// この部品は DOM を使わない(出し入れの決まりと文だけ)。画面の側は、舞台(ui/workFx.js)と作る札(onboarding/view.js)が、知らせを受けて描く。
// 動かす印と、いま見えているかの知らせ:
//   const end = work.begin('draw');   // 待ち始め。draw・build はすぐ、ほかは 1.5 秒を過ぎても終わらなければ出す
//   end.update('いま: 形を つくっているよ'); // 歩みの文を差し替える(省けば、種類ごとの文)
//   end();                            // 終わり(何度呼んでもよい)
// 失敗や取り消しで終わりの知らせが来なくても、種類ごとの上限(maxMs)で消える。

import { clipName } from './aiNotice.js';

/** 待ち始めてから、この長さを過ぎても終わらなければ出す(すぐ終わる待ちに、ちらつかせない) */
export const WORK_DELAY_MS = 1500;

/**
 * 待ちの種類。immediate = 長いと分かっているのですぐ出す。maxMs = 出したままにする上限
 * draw = 絵を描く(1 分ほど)・build = 3D を待つ・stage = 子を舞台に出す・check = 絵を見る・think = 返事を待つ・wait = ほか
 */
export const WORK_KINDS = Object.freeze({
  draw: { immediate: true, maxMs: 4 * 60_000 },
  build: { immediate: true, maxMs: 30 * 60_000 },
  stage: { immediate: false, maxMs: 90_000 },
  check: { immediate: false, maxMs: 120_000 },
  think: { immediate: false, maxMs: 60_000 },
  wait: { immediate: false, maxMs: 60_000 },
});

/** 画面の文(ことば別。子どもにも読める短い 1 文)。think だけ、名前が入る */
export const WORK_TEXT = Object.freeze({
  ja: { draw: 'えを かいているよ', build: '3D を つくっているよ', stage: 'ぶたいに よんでいるよ', check: 'えを みているよ', think: 'かんがえているよ', wait: 'ちょっと まってね' },
  en: { draw: 'Drawing a picture', build: 'Building the 3D model', stage: 'Bringing them on stage', check: 'Looking at the picture', think: 'Thinking', wait: 'Just a moment' },
  zh: { draw: '正在画画', build: '正在做 3D', stage: '正在请它上台', check: '正在看图', think: '正在想', wait: '请稍等' },
  ko: { draw: '그림을 그리고 있어요', build: '3D를 만들고 있어요', stage: '무대로 부르고 있어요', check: '그림을 보고 있어요', think: '생각하고 있어요', wait: '잠깐만요' },
});

/** 名前つきの think(ことば別) */
const THINK_NAMED = Object.freeze({
  ja: (n) => `${n}が かんがえているよ`,
  en: (n) => `${n} is thinking`,
  zh: (n) => `${n}正在想`,
  ko: (n) => `${n} 생각 중이에요`,
});

/** 動きの下に、すぐ付ける一言(長くかかる物だけ。ことば別) */
export const WORK_NOTE = Object.freeze({
  // 描く待ちの目安は、11-08 の試しの実測(6〜14 秒。2D にする機械が遅いと、もっと)に合わせて 10〜30 秒。前の「1 分くらい」は実際より長く、止まったように見えた
  ja: { draw: '10〜30 秒くらい かかるよ', build: 'すこし かかるよ' },
  en: { draw: 'This takes about 10 to 30 seconds', build: 'This takes a little while' },
  zh: { draw: '大约要 10 到 30 秒', build: '需要一点时间' },
  ko: { draw: '10~30초쯤 걸려요', build: '조금 걸려요' },
});

const pick = (table, lang) => table[Object.hasOwn(table, lang) ? lang : 'ja'];

/** 種類ごとの文。lang は 'ja' | 'en' | 'zh' | 'ko'(それ以外・無しは 'ja')。名前は think の時だけ入れる */
export function workText(kind, { lang = 'ja', name = '' } = {}) {
  const k = Object.hasOwn(WORK_KINDS, kind) ? kind : 'wait';
  if (k === 'think') {
    const n = clipName(name);
    if (n) return pick(THINK_NAMED, lang)(n);
  }
  return pick(WORK_TEXT, lang)[k];
}

/** 動きの下に付ける一言(無ければ '') */
export function workNote(kind, lang = 'ja') {
  return pick(WORK_NOTE, lang)[kind] ?? '';
}

const realTimers = {
  set: (f, ms) => {
    const t = setTimeout(f, ms);
    t?.unref?.(); // 試験の node が、待ちの時計だけで終わらないことがないように
    return t;
  },
  clear: (t) => clearTimeout(t),
};

const EMPTY = Object.freeze({ visible: false, kind: null, text: null, pill: false, count: 0 });

/**
 * 待ちの数え役。いま見せる物があるかを、見ている所(舞台・作る札)へ知らせる。
 * @param {object} [o]
 * @param {number} [o.delayMs]
 * @param {{set:Function, clear:Function}} [o.timers] 試験で差し替える
 */
export function createWorkTracker({ delayMs = WORK_DELAY_MS, timers = realTimers } = {}) {
  /** @type {Map<number, {kind:string, text:string|null, pill:boolean, visible:boolean, showTimer:any, maxTimer:any}>} */
  const tasks = new Map();
  const subs = new Set();
  let seq = 0;
  let last = EMPTY;

  const snapshot = () => {
    const visible = [...tasks.values()].filter((t) => t.visible);
    if (!visible.length) return EMPTY;
    // 文を出す物(pill)のうち、いちばん新しい物の文。無ければ、いちばん新しい物(きらきらだけ)
    const top = visible.filter((t) => t.pill).at(-1) ?? visible.at(-1);
    return { visible: true, kind: top.kind, text: top.text, pill: top.pill, count: visible.length };
  };
  const emit = () => {
    const next = snapshot();
    if (next.visible === last.visible && next.kind === last.kind && next.text === last.text && next.pill === last.pill && next.count === last.count) return;
    last = next;
    for (const fn of [...subs]) fn(next);
  };

  return {
    /**
     * 待ち始め。返り値は「終わり」の関数(何度呼んでもよい)。end.update(文) で歩みの文を替えられる
     * @param {string} kind WORK_KINDS の名前(知らない名前は wait)
     * @param {{immediate?:boolean, pill?:boolean, text?:string, delayMs?:number}} [opt] pill: false = 文は別の所が出しているので、きらきらだけ
     */
    begin(kind, opt = {}) {
      const k = Object.hasOwn(WORK_KINDS, kind) ? kind : 'wait';
      const spec = WORK_KINDS[k];
      const id = ++seq;
      const task = { kind: k, text: typeof opt.text === 'string' ? opt.text : null, pill: opt.pill !== false, visible: false, showTimer: null, maxTimer: null };
      tasks.set(id, task);
      const end = () => {
        if (!tasks.has(id)) return;
        if (task.showTimer !== null) timers.clear(task.showTimer);
        if (task.maxTimer !== null) timers.clear(task.maxTimer);
        tasks.delete(id);
        emit();
      };
      end.update = (text) => {
        if (!tasks.has(id)) return;
        task.text = typeof text === 'string' && text ? text : null;
        emit();
      };
      const show = () => {
        task.showTimer = null;
        if (!tasks.has(id)) return;
        task.visible = true;
        emit();
      };
      task.maxTimer = timers.set(end, spec.maxMs);
      if (opt.immediate ?? spec.immediate) show();
      else task.showTimer = timers.set(show, opt.delayMs ?? delayMs);
      return end;
    },
    /** いま見せる物の知らせ(いま見えているか・種類・文・文を出すか・見えている数) */
    get state() {
      return last;
    },
    /** 変わった時に呼ぶ関数を足す(足した時に、いまの様子も 1 回渡す)。返り値は外す関数 */
    subscribe(fn) {
      subs.add(fn);
      fn(last);
      return () => subs.delete(fn);
    },
    /** 全部止める(試験・作る札を閉じた時) */
    clear() {
      for (const t of tasks.values()) {
        if (t.showTimer !== null) timers.clear(t.showTimer);
        if (t.maxTimer !== null) timers.clear(t.maxTimer);
      }
      tasks.clear();
      emit();
    },
  };
}

/** 画面ぜんたいで 1 つの数え役(舞台と作る札が同じ物を見る) */
export const work = createWorkTracker();

/** 画面の側が、いまの「ことば」と舞台の子の名前を教える(日本語だけの時は、どちらも既定のまま) */
const ctx = { lang: () => 'ja', name: () => '' };
export function configureWork({ lang, name } = {}) {
  if (typeof lang === 'function') ctx.lang = lang;
  if (typeof name === 'function') ctx.name = name;
}

/** いま見せる知らせの文(歩みの文があればそれ。無ければ種類ごとの文。ことばは画面の設定に合わせる) */
export function currentWorkText(state = work.state, lang = ctx.lang()) {
  if (!state?.visible) return '';
  return state.text ?? workText(state.kind, { lang, name: ctx.name() });
}
export const currentWorkNote = (state = work.state, lang = ctx.lang()) => (state?.visible ? workNote(state.kind, lang) : '');

/** 待ち始め(画面ぜんたいの数え役へ) */
export const beginWork = (kind, opt) => work.begin(kind, opt);
