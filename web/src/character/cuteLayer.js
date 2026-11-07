// かわいい仕草の層(契約 K2 の動きの言葉に足した名前。持ち主 S5。B5G 2026-11-08)。
// どのキャラにも同じ名前で効く「仕草」を、決まった名前の部位(頭・体・根元・腕・耳・しっぽ・目線・笑顔)の数字にする。
// キャラごとの手付けはしない: 3D の rig・VRM・2D の板は、この数字をそれぞれの骨や板に書く(cuteRig.js・characterBase.js・pose2d.js)。
// three も DOM も読まない(node --test でそのまま試せる)。乱数は外から渡せる(試験で同じ動きを出すため)。
//
// 動きの決まり(本人「モデリングで可愛さを出すのは限界がある。仕草で、どんなキャラクターでも徹底的に可愛く」):
// - 止まらない: 待つ間も、小さな息と体のゆれ。周期はそろえない(息 4.5 秒・ゆれ 7.3 秒・首 9.1 秒)
// - やわらかい: 目標へは、ばね(行き過ぎて少し戻る)で近づく。頭は体より遅れて、しっぽは体より遅れて揺れる
// - 同じ仕草を続けて同じ形で出さない(左右・回数・深さを替える)。待つ間の小さな仕草も、前と同じ物は選ばない
// - 話している間は小さく(0.55 倍)、弾みはもっと小さく(0.4 倍)
// - 重くしない: 1 コマの計算は数字 24 本のばねと、いくつかの sin だけ(物を作らない)

export const CUTE_STATES = Object.freeze(['idle', 'listening', 'thinking', 'talking']);

/** 返事で頼める仕草(K2 の動きの言葉に足した名前を含む)。説明は INTENT.md と board の K2_gesture_names.md */
export const CUTE_GESTURES = Object.freeze(['greet', 'happy', 'cheer', 'shy', 'surprised', 'think', 'nod', 'tilt', 'droop', 'bow', 'wave', 'shake', 'shrug', 'point', 'jump']);

/** 腕を使う仕草(腕の骨が無いキャラでは近い物へ) */
export const ARM_GESTURES = Object.freeze(['greet', 'cheer', 'wave', 'point', 'shrug']);

/** 表情が変わった時に、自動で付ける小さな仕草(返事の motion が none の時) */
export const EMOTION_GESTURE = Object.freeze({ happy: 'happy', surprised: 'surprised', think: 'think', sad: 'droop', angry: 'shake' });

/** 数字の名前。head*・spine* は回転(ラジアン。X = 下を向く、Y = +x の向きへ回る、Z = 見ている人から見て左回り)。
 *  root* は根元の動き(背の高さに対する割合。Y = 上)。armRaise* は「上げた形」の割合 0〜1。armSwing* は手をふる角度。
 *  armOut* は下ろした腕を外へ開く角度。armFwd* は腕を前へ寄せる角度(もじもじ・あごに手)。shoulder* は肩を上げる量(背の高さに対する割合)。tail*・ear* は角度。
 *  smile は笑顔の目の強さ 0〜1。blush は頬の赤み 0〜1(頬の部品がある子だけ)。gazeX・gazeY は目線の向きの足し分(ラジアン。Y = 上)。 */
export const CHANNELS = Object.freeze([
  'headX', 'headY', 'headZ', 'spineX', 'spineY', 'spineZ', 'rootX', 'rootY', 'rootZ',
  'armRaiseL', 'armRaiseR', 'armSwingL', 'armSwingR', 'armOutL', 'armOutR', 'armFwdL', 'armFwdR', 'shoulderL', 'shoulderR',
  'tailX', 'tailY', 'earL', 'earR', 'smile', 'blush', 'gazeX', 'gazeY',
]);

// ばね(1 秒あたりの揺れの数 f と、減り方 z)。頭は体より遅く、しっぽと耳はよく揺れる
const SPRING = {
  head: [2.4, 0.74], spine: [1.7, 0.8], root: [5.5, 0.62], arm: [3.2, 0.72], shoulder: [3.5, 0.8],
  tail: [1.6, 0.32], ear: [4.5, 0.38], smile: [3.5, 1], gaze: [5, 0.9],
};
const GROUP = (ch) => (ch.startsWith('head') ? 'head' : ch.startsWith('spine') ? 'spine' : ch.startsWith('root') ? 'root' : ch.startsWith('arm') ? 'arm'
  : ch.startsWith('shoulder') ? 'shoulder' : ch.startsWith('tail') ? 'tail' : ch.startsWith('ear') ? 'ear' : ch === 'smile' || ch === 'blush' ? 'smile' : 'gaze');

/** 話している間の仕草の大きさ / 弾みの大きさ */
export const TALK_SCALE = 0.55;
export const TALK_HOP_SCALE = 0.4;
/** 根元が上へ出るいちばん大きな量(背の高さに対する割合)。画面の頭の上の余白に足す(scene.js の motionRise) */
export const CUTE_RISE = 0.035;
/** 表情からの自動の仕草は、この秒数に 1 回まで */
export const AUTO_GAP_S = 6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** 0→1→0 の山。立ち上がり a・戻り r(全体に対する割合) */
export function bump(u, a = 0.2, r = 0.35) {
  if (u <= 0 || u >= 1) return 0;
  if (u < a) return smooth(u / a);
  if (u > 1 - r) return smooth((1 - u) / r);
  return 1;
}
/** 小さく跳ねる(放り上げた形)。t0 から len 秒。高さ h */
const hop = (t, t0, len, h) => (t > t0 && t < t0 + len ? h * Math.sin((Math.PI * (t - t0)) / len) : 0);
/** 跳ぶ前の小さなしゃがみ */
const dip = (t, t0, len, h) => (t > t0 && t < t0 + len ? -h * Math.sin((Math.PI * (t - t0)) / len) : 0);

// 仕草ごとの形。f(t, d, side, k, cap) が目標の足し分を d に書く。t は始めからの秒。side は ±1(左右の替え)、k は変形の番号、cap はキャラにある物
const G = {
  happy: {
    dur: 1.6,
    variants: 4,
    f(t, d, side, k) {
      const e = bump(t / 1.6, 0.12, 0.4);
      const hops = k % 2 === 0 ? 2 : 3;
      const gap = hops === 2 ? 0.42 : 0.33;
      d.rootY += dip(t, 0, 0.12, 0.01);
      for (let i = 0; i < hops; i++) d.rootY += hop(t, 0.12 + i * gap, gap * 0.8, i === 0 ? 0.033 : 0.026);
      // 腕: 変形の偶数は弾みに合わせてぱたぱた(上げた形の 3〜5 割)、奇数は小さなばんざい(6 割)
      const flap = Math.max(0, Math.sin((2 * Math.PI * (t - 0.08)) / (gap * 1.0)));
      const up = k % 2 ? 0.72 : 0.32 + 0.3 * flap;
      d.armRaiseL += up * e;
      d.armRaiseR += up * e;
      d.blush += 0.35 * e;
      const sw = Math.sin((2 * Math.PI * t) / 0.8);
      d.spineZ += 0.12 * side * sw * e;
      d.rootX += 0.012 * side * sw * e;
      d.headZ += 0.14 * side * Math.sin((2 * Math.PI * (t - 0.09)) / 0.8) * e;
      d.headX -= 0.04 * e;
      d.armOutL += 0.26 * e + 0.08 * Math.sin(t * 2 * Math.PI * 2.6) * e;
      d.armOutR += 0.26 * e - 0.08 * Math.sin(t * 2 * Math.PI * 2.6) * e;
      d.smile += 0.6 * e;
      d.tailX += 0.25 * e;
      d.earL += 0.18 * e;
      d.earR += 0.18 * e;
    },
  },
  greet: {
    dur: 2.3,
    variants: 4,
    f(t, d, side, k, cap) {
      const e = bump(t / 2.3, 0.16, 0.3);
      // 腕: キャラの動き(wave の clip)があれば、それが腕を動かす(cap.armByClip)。無ければ右手を上げてふる
      if (!cap.armByClip) {
        d.armRaiseR += e;
        d.armSwingR += 0.38 * Math.sin(2 * Math.PI * (k % 2 ? 2.2 : 1.9) * Math.max(0, t - 0.3)) * smooth((t - 0.25) / 0.3) * e;
      }
      d.rootY += dip(t, 0, 0.12, 0.009) + hop(t, 0.12, 0.3, 0.026) + hop(t, 0.5, 0.26, k % 2 ? 0.02 : 0.015);
      if (cap.armByClip) d.armSwingR += 0.22 * Math.sin(2 * Math.PI * 1.9 * Math.max(0, t - 0.35)) * smooth((t - 0.3) / 0.3) * e; // 小さい腕の子でも、ふる手が見えるように少し足す
      // 上げた腕と反対へ頭をかしげる(頭でっかちでも、ほおに腕が当たらない)。体は上げた腕の方へ少し寄る
      d.headZ += -0.14 * e - 0.04 * Math.sin(2 * Math.PI * 1.9 * t) * e;
      d.spineZ += 0.07 * e + 0.02 * Math.sin(2 * Math.PI * 0.95 * t) * e;
      d.rootX -= 0.004 * e;
      d.headX -= 0.03 * e;
      d.smile += 0.65 * e;
      d.earL += 0.15 * e;
      d.earR += 0.15 * e;
      d.tailX += 0.2 * e;
    },
  },
  cheer: {
    dur: 1.9,
    variants: 2,
    f(t, d, side, k) {
      const e = bump(t / 1.9, 0.14, 0.34);
      d.armRaiseL += e;
      d.armRaiseR += e;
      d.armSwingL += 0.12 * Math.sin(2 * Math.PI * 2.4 * t) * e;
      d.armSwingR -= 0.12 * Math.sin(2 * Math.PI * 2.4 * t) * e;
      d.rootY += dip(t, 0, 0.14, 0.011) + hop(t, 0.14, 0.34, 0.034) + hop(t, 0.56, 0.3, 0.027);
      d.blush += 0.3 * e;
      d.headX -= 0.08 * e;
      d.headZ += 0.03 * side * Math.sin(2 * Math.PI * 1.2 * t) * e;
      d.smile += 0.75 * e;
      d.earL += 0.25 * e;
      d.earR += 0.25 * e;
      d.tailX += 0.35 * e;
    },
  },
  shy: {
    dur: 2.8,
    variants: 4,
    f(t, d, side) {
      const e = bump(t / 2.8, 0.18, 0.34);
      const peek = bump(t / 2.8, 0.18, 0.5); // 目線は少し早く戻して、ちらっと見る
      const look = t > 1.1 && t < 1.7 ? Math.sin((Math.PI * (t - 1.1)) / 0.6) : 0; // ちらっと見る
      d.headX += (0.25 - 0.14 * look) * e;
      d.headY += (0.16 - 0.1 * look) * side * e;
      d.headZ += 0.15 * side * e;
      d.blush += 0.9 * e;
      d.gazeY -= 0.16 * e;
      d.gazeX += 0.16 * side * peek;
      d.spineY += 0.08 * side * e;
      d.spineZ += 0.09 * Math.sin((2 * Math.PI * t) / 1.35) * e;
      d.rootX += 0.006 * Math.sin((2 * Math.PI * t) / 1.35) * e;
      d.rootY -= 0.004 * e;
      const fid = Math.sin((2 * Math.PI * t) / 0.55);
      d.armOutL -= 0.18 * e;
      d.armOutR -= 0.18 * e;
      d.armFwdL += (0.5 + 0.14 * fid) * e;
      d.armFwdR += (0.5 - 0.14 * fid) * e;
      d.spineY += 0.1 * Math.sin((2 * Math.PI * t) / 1.35 + 0.8) * e;
      d.smile += 0.35 * e;
      d.earL -= 0.12 * e;
      d.earR -= 0.12 * e;
      d.tailY += 0.15 * side * e;
    },
  },
  surprised: {
    dur: 1.5,
    variants: 2,
    f(t, d, side) {
      const up = t < 0.09 ? smooth(t / 0.09) : Math.exp(-(t - 0.09) / 0.45);
      d.rootY += hop(t, 0.02, 0.26, 0.02);
      d.spineX -= 0.12 * up;
      d.headX -= 0.08 * up;
      d.headZ += 0.04 * side * up;
      d.armOutL += 0.45 * up;
      d.armOutR += 0.45 * up;
      d.earL += 0.35 * up;
      d.earR += 0.35 * up;
      d.tailX += 0.4 * up;
    },
  },
  think: {
    dur: 2.6,
    variants: 2,
    f(t, d, side) {
      const e = bump(t / 2.6, 0.22, 0.3);
      const pre = t < 0.18 ? Math.sin((Math.PI * t) / 0.18) : 0; // 反対へ少しためる
      d.headZ += side * (0.25 * e - 0.04 * pre) + 0.012 * side * Math.sin((2 * Math.PI * t) / 0.42) * e;
      d.headX -= 0.11 * e;
      d.gazeY += 0.16 * e;
      d.gazeX += 0.1 * side * e;
      d.spineZ += 0.035 * side * e;
      d.rootX -= 0.004 * side * e;
      d.tailY += 0.1 * side * e;
      if (side > 0) d.armFwdR += 0.55 * e;
      else d.armFwdL += 0.55 * e;
    },
  },
  nod: {
    dur: 0.9,
    variants: 3,
    f(t, d, side, k) {
      // あごが先に動くうなずき: 深い 2 回(2 回目は浅く)。変形で深さと回数を替える
      const depth = [0.2, 0.16, 0.24][k % 3];
      const n = k % 3 === 1 ? 3 : 2;
      const per = 0.9 / (n + 0.4);
      let v = 0;
      for (let i = 0; i < n; i++) {
        const u = (t - i * per) / per;
        if (u > 0 && u < 1) v += Math.sin(Math.PI * u) * (i === 0 ? 1 : i === 1 ? 0.55 : 0.35);
      }
      d.headX += depth * v;
      d.spineX += 0.02 * v;
      d.headZ += 0.03 * side * v;
    },
  },
  tilt: {
    dur: 1.5,
    variants: 2,
    f(t, d, side) {
      const e = bump(t / 1.5, 0.25, 0.35);
      const pre = t < 0.14 ? Math.sin((Math.PI * t) / 0.14) : 0;
      d.headZ += side * (0.2 * e - 0.03 * pre);
      d.spineZ += 0.025 * side * e;
      d.gazeX += 0.06 * side * e;
    },
  },
  droop: {
    dur: 2.4,
    variants: 2,
    f(t, d, side) {
      const e = bump(t / 2.4, 0.3, 0.4);
      d.headX += 0.2 * e;
      d.headZ += 0.04 * side * e;
      d.spineX += 0.06 * e;
      d.rootY -= 0.006 * e;
      d.armOutL -= 0.06 * e;
      d.armOutR -= 0.06 * e;
      d.gazeY -= 0.15 * e;
      d.earL -= 0.3 * e;
      d.earR -= 0.3 * e;
      d.tailX -= 0.25 * e;
    },
  },
  shake: {
    dur: 1.1,
    variants: 2,
    f(t, d, side) {
      const e = bump(t / 1.1, 0.12, 0.3);
      d.headY += 0.28 * side * Math.sin((t / 1.1) * Math.PI * 5) * e;
      d.spineY += 0.03 * side * Math.sin((t / 1.1) * Math.PI * 5 - 0.6) * e;
    },
  },
  shrug: {
    dur: 1.5,
    variants: 2,
    f(t, d, side) {
      const e = bump(t / 1.5, 0.25, 0.35);
      d.shoulderL += 0.012 * e;
      d.shoulderR += 0.012 * e;
      d.armOutL += 0.28 * e;
      d.armOutR += 0.28 * e;
      d.headZ += 0.1 * side * e;
      d.headX -= 0.03 * e;
    },
  },
  // 体だけの添え物(腕と体はキャラの動き clip か gestures.js が動かす)
  bow: { dur: 2.0, variants: 1, f(t, d) { d.smile += 0.3 * bump(t / 2, 0.3, 0.3); } },
  wave: {
    dur: 2.2,
    variants: 2,
    f(t, d, side, k, cap) {
      const e = bump(t / 2.2, 0.18, 0.3);
      if (!cap.armByClip) {
        d.armRaiseR += e;
        d.armSwingR += 0.3 * Math.sin(2 * Math.PI * 2 * Math.max(0, t - 0.3)) * smooth((t - 0.25) / 0.3) * e;
      }
      d.headZ -= 0.07 * e;
      d.smile += 0.4 * e;
    },
  },
  point: {
    dur: 2.0,
    variants: 1,
    f(t, d, side, k, cap) {
      const e = bump(t / 2, 0.25, 0.3);
      if (!cap.armByClip) {
        if (cap.pointSide > 0) d.armRaiseL += 0.55 * e;
        else d.armRaiseR += 0.55 * e;
      }
      d.spineY += 0.12 * (cap.pointSide || -1) * e;
    },
  },
};
G.jump = G.cheer;

// 待つ間の小さな仕草(4〜9 秒に 1 回。前と同じ物は選ばない)
const ACCENTS = {
  tiltL: { dur: 2.2, need: null, f(t, d) { const e = bump(t / 2.2, 0.3, 0.4); d.headZ += 0.2 * e; d.spineZ += 0.03 * e; } },
  tiltR: { dur: 2.2, need: null, f(t, d) { const e = bump(t / 2.2, 0.3, 0.4); d.headZ -= 0.2 * e; d.spineZ -= 0.03 * e; } },
  lookAside: { dur: 2.0, need: null, f(t, d, side) { const e = bump(t / 2, 0.18, 0.3); d.gazeX += 0.35 * side * e; d.headY += 0.06 * side * e; } },
  weightShift: { dur: 2.8, need: null, f(t, d, side) { const e = bump(t / 2.8, 0.35, 0.4); d.rootX += 0.007 * side * e; d.spineZ -= 0.03 * side * e; d.headZ += 0.025 * side * e; } },
  bounce: { dur: 0.7, need: null, f(t, d) { d.rootY += dip(t, 0, 0.1, 0.003) + hop(t, 0.1, 0.26, 0.012); d.smile += 0.2 * bump(t / 0.7, 0.2, 0.4); } },
  earFlick: { dur: 0.6, need: 'ears', f(t, d, side) { const e = bump(t / 0.6, 0.15, 0.5); d.earL += (side > 0 ? 0.45 : 0.1) * e; d.earR += (side > 0 ? 0.1 : 0.45) * e; } },
  armSwing: { dur: 1.8, need: 'arms', f(t, d, side) { const e = bump(t / 1.8, 0.2, 0.4); const w = Math.sin((2 * Math.PI * t) / 0.9); d.armOutL += (0.1 + 0.07 * w * side) * e; d.armOutR += (0.1 - 0.07 * w * side) * e; } },
  tailFlick: { dur: 1.4, need: 'tail', f(t, d, side) { const e = bump(t / 1.4, 0.15, 0.45); d.tailY += 0.35 * side * Math.sin((2 * Math.PI * t) / 0.7) * e; d.tailX += 0.12 * e; } },
};

/** 決まった乱数(試験用)。seed から同じ並びを出す */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * かわいい仕草の層。
 *   const cute = new CuteLayer({ caps: { arms: true, head: true, ears: false, tail: false } });
 *   毎コマ: cute.setActivity('listening'); const out = cute.step(dt, { mouth, gazeYaw }); → out の数字を骨や板に書く
 *   返事:   cute.trigger('happy', { intensity: 0.9 }) / 表情: cute.onEmotion('happy', 0.9)
 */
export class CuteLayer {
  /**
   * @param {object} [o]
   * @param {() => number} [o.rng] 乱数(試験では seededRandom)
   * @param {{arms?:boolean, head?:boolean, ears?:boolean, tail?:boolean, clipArm?:string[]}} [o.caps]
   *   arms: 腕を動かせる / head: 首(頭の骨)がある / ears・tail: 耳・しっぽを動かせる / clipArm: 腕をキャラの動き(clip)で動かす仕草の名前
   */
  constructor({ rng = Math.random, caps = {} } = {}) {
    this.rng = rng;
    this.caps = { arms: true, head: true, ears: false, tail: false, clipArm: [], ...caps };
    this.time = 0;
    this.activity = 'idle';
    this.activityT = 0; // 今の状態になってからの秒
    this.w = { listening: 0, thinking: 0, talking: 0 }; // 状態の重み(なめらかに入れ替える)
    this.target = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
    this.out = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
    this.vel = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
    this.out.blink = 0;
    this.gestures = []; // 動いている仕草 { name, def, t, amp, side, k, cap }
    this.last = { name: null, k: {} }; // 前の仕草の名前と、名前ごとの前の変形
    this.lastAccent = null;
    this.nextAccent = 3 + this.rng() * 4;
    this.accent = null; // 動いている待つ間の仕草
    this.nextNod = 1.2 + this.rng() * 1.4; // 聞いている間のうなずき
    this.nodK = 0;
    this.thinkSide = 1;
    this.nextTalkBob = 0.4;
    this.talkBob = null;
    this.pendingAuto = null;
    this.lastAutoAt = -1e9;
    this.lastEmotion = 'neutral';
    // まばたき: 閉じ → 閉じたまま → 開き。間は毎回変える。1 割は二度まばたき
    this.blinkWait = 1.5 + this.rng() * 2;
    this.blinkPhase = null;
    this.lastTriggerAt = -1e9;
    this.playing = null;
  }

  /** 休みの形へ(数字・速さ・動いている仕草を全部 0 に)。試験が「同じ形」で比べる時などに使う */
  rest() {
    for (const c of CHANNELS) {
      this.out[c] = 0;
      this.vel[c] = 0;
      this.target[c] = 0;
    }
    this.out.blink = 0;
    this.blinkPhase = null;
    this.gestures.length = 0;
    this.accent = null;
    this.talkBob = null;
    this.pendingAuto = null;
    return this.out;
  }

  /** 状態(idle・listening・thinking・talking)。知らない名前は idle */
  setActivity(name) {
    const next = CUTE_STATES.includes(name) ? name : 'idle';
    if (next === this.activity) return;
    if (next === 'thinking') this.thinkSide = -this.thinkSide; // 考える向きを毎回替える
    if (next === 'listening') this.nextNod = 0.9 + this.rng() * 0.8;
    this.activity = next;
    this.activityT = 0;
  }

  /** このキャラが出せる仕草か(腕の無いキャラは、腕の仕草を近い物へ) */
  resolve(name) {
    const n = String(name ?? '').trim().toLowerCase();
    if (!G[n]) return null;
    if (ARM_GESTURES.includes(n) && !this.caps.arms && !(this.caps.clipArm ?? []).includes(n)) return n === 'shrug' ? 'tilt' : 'happy';
    return n;
  }

  /**
   * 仕草を 1 つ始める。同じ名前が続いても、左右・回数・深さを替える。知らない名前は false。
   * @param {string} name
   * @param {{intensity?:number, clipArm?:boolean, pointSide?:number}} [opts] clipArm: 腕はキャラの動き(clip)が動かす
   */
  trigger(name, opts = {}) {
    const n = this.resolve(name);
    if (!n) return false;
    const def = G[n];
    const prevK = this.last.k[n] ?? -1;
    const k = (prevK + 1) % Math.max(1, def.variants);
    this.last.k[n] = k;
    // 同じ名前が続いた時は左右を替える。違う名前の時も、前の仕草と同じ向きにならないよう替える
    const side = k % 2 === 0 ? 1 : -1;
    this.last.name = n;
    const amp = clamp(Number.isFinite(opts.intensity) ? opts.intensity : 1, 0.2, 1);
    const cap = { ...this.caps, armByClip: Boolean(opts.clipArm), pointSide: Math.sign(opts.pointSide ?? 0) };
    // 同じ部位を取り合う前の仕草は、すばやく弱める(重ねすぎない)
    for (const g of this.gestures) g.fade = Math.min(g.fade ?? 1, 0.999);
    this.gestures.push({ name: n, def, t: 0, amp, side, k, cap, fade: 1 });
    if (this.gestures.length > 3) this.gestures.shift();
    this.pendingAuto = null; // 返事が仕草を頼んだので、表情からの自動の仕草はしない
    this.lastTriggerAt = this.time;
    this.accent = null;
    this.nextAccent = Math.max(this.nextAccent, 4 + this.rng() * 3);
    return true;
  }

  /** 表情が変わった(返事の文が始まった)。仕草が頼まれなければ、次のコマで表情に合う小さな仕草を付ける */
  onEmotion(name, weight = 1) {
    const n = String(name ?? '');
    const changed = n !== this.lastEmotion;
    this.lastEmotion = n;
    const g = EMOTION_GESTURE[n];
    if (!changed || !g || weight < 0.3) return;
    if (this.time - this.lastAutoAt < AUTO_GAP_S) return;
    this.pendingAuto = { name: g, at: this.time, intensity: 0.7 * clamp(weight, 0, 1) };
  }

  /** いま強く動いている仕草の名前(無ければ null) */
  get busy() {
    return this.gestures.length ? this.gestures[this.gestures.length - 1].name : null;
  }

  /**
   * 1 コマ進める。返すのは数字の入った out(同じ物を使い回す。書きかえない)。
   * @param {number} dt
   * @param {{mouth?:number, gazeYaw?:number, clipBusy?:boolean}} [ctx] gazeYaw: 見ている人の向き(聞く時に体を少し向ける)。clipBusy: キャラの動き(clip)が動いている
   */
  step(dt, ctx = {}) {
    const h = clamp(Number(dt) || 0, 0, 1 / 15);
    this.time += h;
    this.activityT += h;
    const t = this.time;
    // 状態の重み(0.35 秒くらいで入れ替わる)
    for (const k of Object.keys(this.w)) {
      const goal = this.activity === k ? 1 : 0;
      this.w[k] += (goal - this.w[k]) * (1 - Math.exp(-h / 0.18));
    }
    const talk = this.w.talking;
    const scale = 1 - (1 - TALK_SCALE) * talk;
    const hopScale = 1 - (1 - TALK_HOP_SCALE) * talk;
    const d = this.target;
    for (const c of CHANNELS) d[c] = 0;

    // 1. 待つ間(いつも): 息・体のゆれ・首のゆらぎ。止めない
    const breath = Math.sin((2 * Math.PI * t) / 4.5);
    d.spineX += 0.024 * breath;
    d.rootY += 0.0025 * Math.sin((2 * Math.PI * t) / 4.5 + 0.7);
    d.shoulderL += 0.0012 * breath;
    d.shoulderR += 0.0012 * breath;
    const sway = Math.sin((2 * Math.PI * t) / 7.3 + 1.1);
    d.spineZ += 0.03 * sway;
    d.rootX += 0.008 * sway;
    d.headZ += 0.02 * Math.sin((2 * Math.PI * t) / 9.1 + 0.4) - 0.006 * sway;
    d.headY += 0.02 * Math.sin((2 * Math.PI * t) / 11.7 + 2.1);
    d.headX += 0.008 * Math.sin((2 * Math.PI * t) / 5.3 + 1.7);
    d.tailY += 0.06 * Math.sin((2 * Math.PI * t) / 3.1);
    d.tailX += 0.03 * Math.sin((2 * Math.PI * t) / 4.9 + 0.3);

    // 2. 状態ごとの形
    const wl = this.w.listening;
    if (wl > 0.001) {
      // 聞く: 少し前へ寄り、話す人の方へ少し向く。耳を立てる
      const toward = clamp((Number(ctx.gazeYaw) || 0) * 0.35, -0.2, 0.2);
      d.spineX += 0.06 * wl;
      d.spineY += toward * wl;
      d.headZ += 0.04 * wl * Math.sin((2 * Math.PI * t) / 6.1);
      d.earL += 0.1 * wl;
      d.earR += 0.1 * wl;
    }
    const wt = this.w.thinking;
    if (wt > 0.001) {
      // 考える: 首をかしげて上を見る(毎回、左右を替える)。ときどき小さくかしげ直す
      const s = this.thinkSide;
      const re = Math.sin((2 * Math.PI * Math.max(0, this.activityT - 1.6)) / 3.4);
      d.headZ += s * (0.2 + 0.03 * re) * wt;
      d.headX -= 0.1 * wt;
      d.gazeY += 0.16 * wt;
      d.gazeX += 0.1 * s * wt;
      d.spineZ += 0.028 * s * wt;
      d.rootX -= 0.003 * s * wt;
      if (s > 0) d.armFwdR += 0.5 * wt;
      else d.armFwdL += 0.5 * wt;
    }
    if (talk > 0.001) {
      d.spineX += 0.008 * talk * Math.sin((2 * Math.PI * t) / 2.3);
    }

    // 3. 聞いている間の相づちのうなずき(毎回、深さと回数を替える)
    if (this.activity === 'listening') {
      this.nextNod -= h;
      if (this.nextNod <= 0 && !this.busy) {
        this.nodK += 1;
        this.gestures.push({ name: 'nod', def: G.nod, t: 0, amp: [0.75, 0.95, 0.65][this.nodK % 3], side: this.nodK % 2 ? 1 : -1, k: this.nodK, cap: {}, fade: 1, soft: true });
        this.nextNod = 1.5 + this.rng() * 1.4;
      }
    }
    // 4. 話している間の小さな頭の動き(文の調子)
    if (this.activity === 'talking') {
      this.nextTalkBob -= h;
      if (this.nextTalkBob <= 0) {
        this.talkBob = { t: 0, dur: 0.5 + this.rng() * 0.3, x: 0.03 + this.rng() * 0.025, y: (this.rng() - 0.5) * 0.06 };
        this.nextTalkBob = 0.8 + this.rng() * 0.9;
      }
    }
    if (this.talkBob) {
      this.talkBob.t += h;
      const e = bump(this.talkBob.t / this.talkBob.dur, 0.3, 0.6);
      d.headX += this.talkBob.x * e * talk;
      d.headY += this.talkBob.y * e * talk;
      if (this.talkBob.t >= this.talkBob.dur) this.talkBob = null;
    }

    // 5. 表情からの自動の仕草(頼まれた仕草が無い時だけ)
    if (this.pendingAuto && t - this.pendingAuto.at >= 0) {
      const p = this.pendingAuto;
      this.pendingAuto = null;
      if (!this.busy && t - this.lastTriggerAt > 0.3) {
        this.trigger(p.name, { intensity: p.intensity });
        this.lastAutoAt = t;
      }
    }

    // 6. 待つ間の小さな仕草(何もしていない時だけ)
    if (this.activity === 'idle' && !this.busy && !ctx.clipBusy) {
      this.nextAccent -= h;
      if (this.nextAccent <= 0 && !this.accent) {
        const names = Object.keys(ACCENTS).filter((n) => n !== this.lastAccent && (!ACCENTS[n].need || this.caps[ACCENTS[n].need]));
        const name = names[Math.floor(this.rng() * names.length) % names.length];
        this.accent = { name, def: ACCENTS[name], t: 0, side: this.rng() < 0.5 ? -1 : 1 };
        this.lastAccent = name;
        this.nextAccent = 3 + this.rng() * 4;
      }
    }
    if (this.accent) {
      this.accent.t += h;
      const tmp = this.accent;
      if (tmp.t >= tmp.def.dur) this.accent = null;
      else tmp.def.f(tmp.t, d, tmp.side);
    }

    // 7. 頼まれた仕草(重ねて足す。話している間は小さく)
    let playing = null;
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i];
      g.t += h;
      if (g.fade < 1) g.fade = Math.max(0, g.fade - h / 0.25);
      if (g.t >= g.def.dur || g.fade <= 0) {
        this.gestures.splice(i, 1);
        continue;
      }
      if (!playing && !g.soft) playing = g.name;
      const k = g.amp * g.fade * (g.soft ? 1 : scale);
      // 部位ごとに足す前の値を覚えるのは重いので、仕草の分を一度 0 の箱に書いてから倍率を掛けて足す
      const part = this._part ?? (this._part = Object.fromEntries(CHANNELS.map((c) => [c, 0])));
      for (const c of CHANNELS) part[c] = 0;
      g.def.f(g.t, part, g.side, g.k, g.cap);
      for (const c of CHANNELS) d[c] += part[c] * k * (c === 'rootY' && part.rootY > 0 ? hopScale : 1);
    }
    this.playing = playing;

    // 8. 使えない部位は 0 に(首の無いキャラは、頭の分を体に寄せる)
    if (!this.caps.head) {
      // 体が頭を兼ねる子(みかんの子など)は、頭の動きの 8 割を体で出す
      d.spineX += d.headX * 0.8;
      d.spineZ += d.headZ * 0.8;
      d.spineY += d.headY * 0.8;
      d.headX = d.headY = d.headZ = 0;
    }
    if (!this.caps.arms) d.armRaiseL = d.armRaiseR = d.armSwingL = d.armSwingR = d.armOutL = d.armOutR = 0;
    if (!this.caps.ears) d.earL = d.earR = 0;
    if (!this.caps.tail) d.tailX = d.tailY = 0;
    d.rootY = Math.min(d.rootY, CUTE_RISE);
    d.armRaiseL = clamp(d.armRaiseL, 0, 1);
    d.armRaiseR = clamp(d.armRaiseR, 0, 1);
    d.smile = clamp(d.smile, 0, 1);
    d.blush = clamp(d.blush, 0, 1);

    // 9. ばねで近づける(行き過ぎて少し戻る)。しっぽは根元の弾みに遅れて揺れる
    d.tailX += -this.vel.rootY * 1.2;
    d.tailY += -this.vel.rootX * 2.5;
    const n = h > 1 / 60 ? 2 : 1;
    const sh = h / n;
    for (let s = 0; s < n; s++) {
      for (const c of CHANNELS) {
        const [f, z] = SPRING[GROUP(c)];
        const w = 2 * Math.PI * f;
        const a = w * w * (d[c] - this.out[c]) - 2 * z * w * this.vel[c];
        this.vel[c] += a * sh;
        this.out[c] += this.vel[c] * sh;
      }
    }
    this.out.armRaiseL = clamp(this.out.armRaiseL, 0, 1);
    this.out.armRaiseR = clamp(this.out.armRaiseR, 0, 1);
    this.out.smile = clamp(this.out.smile, 0, 1);
    this.out.blush = clamp(this.out.blush, 0, 1);
    this.out.rootY = Math.min(this.out.rootY, CUTE_RISE);
    this.out.blink = this._blink(h);
    return this.out;
  }

  /** まばたき(0〜1)。閉じ 70ms → 閉じたまま 30ms → 開き 120〜220ms。間は 1.2〜5 秒で、話す・聞く間は多め */
  _blink(h) {
    if (this.blinkPhase) {
      const p = this.blinkPhase;
      p.t += h;
      let v;
      if (p.t < p.close) v = p.t / p.close;
      else if (p.t < p.close + p.hold) v = 1;
      else if (p.t < p.close + p.hold + p.open) v = 1 - smooth((p.t - p.close - p.hold) / p.open);
      else {
        this.blinkPhase = null;
        v = 0;
        if (p.again) this.blinkWait = 0.12 + this.rng() * 0.1;
      }
      return v;
    }
    const busy = this.activity === 'talking' || this.activity === 'listening';
    this.blinkWait -= h * (busy ? 1.35 : 1);
    if (this.blinkWait <= 0) {
      const again = !this._lastDouble && this.rng() < 0.12;
      this._lastDouble = again;
      this.blinkPhase = { t: 0, close: 0.06 + this.rng() * 0.025, hold: 0.02 + this.rng() * 0.03, open: 0.12 + this.rng() * 0.1, again };
      this.blinkWait = 1.4 + this.rng() * 3.4;
    }
    return 0;
  }
}

/** 仕草の名前を、そのキャラが使える物だけにする(会話のサーバーへ渡す motions の一覧の元) */
export function cuteChoices(caps = {}) {
  const c = { arms: true, head: true, clipArm: [], ...caps };
  return CUTE_GESTURES.filter((n) => n !== 'jump' && (!ARM_GESTURES.includes(n) || c.arms || (c.clipArm ?? []).includes(n)));
}
