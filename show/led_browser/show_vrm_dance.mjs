// ショーの踊り。VRM の正規化の骨に、場面と拍に合わせた姿勢を毎コマ書く。状態を持たず、t だけで姿勢が決まる(乱数なし)。
// 使い方(5 行):
//   import { createDance, danceInput } from './show_vrm_dance.mjs';
//   const dance = createDance(character.vrm, timeline);  // 手足の骨を含む全身と腰の位置を上書きする。目(lookAt)と顔は触らない
//   const vrmUpdate = character.vrm.update.bind(character.vrm);
//   character.vrm.update = (dt) => { dance.apply(danceInput(timeline, frame)); vrmUpdate(dt); };  // 揺れ物より先に骨を決める
//   show_motion.json の bounce・turn_deg・play は踊りと二重になるので使わない(向き・弾みは踊りが持つ。目線の look_at はそのまま使える)。
// 向きの約束(実機で確認): 前屈 +X、キャラの右へ傾く +Z、キャラの左を向く +Y、左腕を下げる −Z、肘は左 −Y・右 +Y、膝は +X。
import * as THREE from 'three';
import { chorusBars, lastIndexBefore } from './show_timing.mjs';

const DEG = Math.PI / 180;
const REF_ARM = 0.443; // 下の寸法を測ったキャラの、肩から手首の長さ。ほかのキャラはこの比で手の位置を伸ばす
const REF_AXIS_Z = 0.12; // 同じキャラの体の軸の z
const REF_CHEST_Y = 1.11;
const REF_CHEST_Z = 0.1257;

// 腕の下限(スカートと腕の実測 + 揺れの余裕 5°)。肘を伸ばして横に下ろすなら真下から 35°、肘を 45° 曲げて前に出すなら 15° まで。
const ARM_MIN_DOWN_STRAIGHT = 35 * DEG;
const ARM_MIN_DOWN_BENT = 15 * DEG;
const ELBOW_BENT = 45 * DEG;
const REACH = 0.985; // 腕・脚を伸ばしきらない割合

// 手首が入らない範囲。高さごとの楕円の半径(体の実測 + 手の太さと揺れの余裕)
const KEEP_Y = [0.8, 1.0, 1.1, 1.25, 1.4];
const KEEP_RX = [0.42, 0.33, 0.23, 0.2, 0.14];
const KEEP_RZ = [0.24, 0.22, 0.19, 0.2, 0.15];

// 全身の値の並び。腰の位置(m)と、骨の回転(ラジアン、X Y Z)と、両腕
const HX = 0, HY = 1, HZ = 2, TURN = 3;
const HIPS = 4, SPINE = 7, CHEST = 10, NECK = 13, HEAD = 16;
const ARMS = [19, 32]; // 左・右の腕の先頭
// 腕の値: 手首の位置 x(外が +)・y(立ったときの高さ)・z(前が +)、肘の向き x y z、ねじり、手首の曲げ・かしげ、指の曲げ、人差し指の曲げ、肩の上げ、肩の前
const AX = 0, AY = 1, AZ = 2, TW = 6, WP = 7, WR = 8, CURL = 9, IDX = 10, SHRUG = 11, FWD = 12;
const CHANNELS = 45;

const arm = (x, y, z, px, py, pz, tw = 0, wp = 0.1, wr = 0, curl = 0.3, idx = 0.25, shrug = 0, fwd = 0) => [x, y, z, px, py, pz, tw, wp, wr, curl, idx, shrug, fwd];
const POSE = {
  rest: arm(0.305, 1.05, 0.2, 1, -0.2, -0.8, 0, 0.2, 0, 0.35, 0.28),
  ready: arm(0.33, 1.15, 0.24, 1, -0.4, -0.7, 0, 0.1, 0, 0.3, 0.25),
  frontLow: arm(0.085, 1.1, 0.3, 1, -0.1, -0.5, 0.1, 0.25, 0, 0.3, 0.25),
  chest: arm(0.125, 1.23, 0.25, 1, -0.6, -0.2, 0, -0.1, 0, 0.5, 0.45),
  heart: arm(0.078, 1.295, 0.34, 1, -0.6, -0.3, 0, -0.65, 0, 0.6, 0.4, 0.08),
  wave: arm(0.37, 1.46, 0.1, 1, -1, -0.3, 0, -0.05, 0, 0.1, 0.05, 0.1),
  up: arm(0.33, 1.68, 0.14, 1, -0.8, -0.4, 0, -0.1, 0, 0.05, 0.02, 0.22),
  point: arm(0.43, 1.42, 0.3, 1, -1, -0.3, 0.6, 0, 0, 1, 0.02),
  vee: arm(0.41, 1.59, 0.1, 1, -0.6, -0.5, 0, -0.1, 0, 0.1, 0.05, 0.16),
  onChest: arm(0.05, 1.25, 0.23, 1, -0.7, -0.1, 0, -0.1, 0, 0.3, 0.25),
};

// 2 小節ごとの決めの形。左・右の腕と、体の足し込み(腰の左右 m、胸の傾き、頭の傾き、胸の前後)
const KIME = [
  { l: POSE.ready, r: POSE.up, hipX: 0.03, lean: 4 * DEG, tilt: -7 * DEG, bend: -2 * DEG },
  { l: POSE.chest, r: POSE.chest, hipX: 0, lean: 0, tilt: 6 * DEG, bend: 4 * DEG },
  { l: POSE.point, r: POSE.ready, hipX: -0.03, lean: -4 * DEG, tilt: 5 * DEG, bend: 3 * DEG },
  { l: POSE.heart, r: POSE.heart, hipX: 0.02, lean: 3 * DEG, tilt: -9 * DEG, bend: 2 * DEG },
];

const KIME_ATTACK_FROM = 6.4; // 8 拍のうち、次の決めへ動き出す拍

// 前の場面から移る秒
const XFADE = { preroll: 0.01, dark: 0.2, enter: 0.2, line: 0.7, song: 0.8, bow: 0.9, listen: 1.0, answer: 0.8, outro: 1.0, tail: 0.2 };
const LISTEN_TURN = -32 * DEG; // 画面の左の手前へ
const ANSWER_TURN = -26 * DEG;

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const smooth = (u) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
const span = (t, a, b) => smooth((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
/** ゆっくり入って、少し行き過ぎて戻る(5%) */
const hit = (u) => {
  const v = clamp01(u);
  return smooth(v / 0.8) + 0.05 * Math.sin(Math.PI * clamp01((v - 0.62) / 0.38));
};
/** 重心の左右。4 拍で 1 往復。端で少し留まる */
const weightShift = (beat) => {
  const x = (Math.PI * beat) / 2;
  return (Math.sin(x) + 0.16 * Math.sin(3 * x)) / 0.84;
};
/** 拍の頭で 1、裏で 0 */
const onBeat = (beat) => {
  const c = 0.5 + 0.5 * Math.cos(2 * Math.PI * beat);
  return c * c;
};
const noise = (t, a, b, c) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 4.1) * 0.1;

function setArm(p, side, pose, amount = 1) {
  const o = ARMS[side];
  for (let i = 0; i < pose.length; i++) p[o + i] += (pose[i] - p[o + i]) * amount;
}

function addAngles(p, at, x, y, z) {
  p[at] += x;
  p[at + 1] += y;
  p[at + 2] += z;
}

/** 立っているだけの形と、止めても止まらない微動 */
function stand(p, t) {
  p.fill(0);
  setArm(p, 0, POSE.rest);
  setArm(p, 1, POSE.rest);
  p[HY] = -0.012;
  const breath = Math.sin((t * 2 * Math.PI) / 3.9);
  addAngles(p, CHEST, -0.018 * breath, 0.006 * noise(t, 0.53, 0.97, 1.9), 0);
  addAngles(p, SPINE, -0.006 * breath, 0, 0.005 * noise(t, 0.41, 0.83, 1.7));
  addAngles(p, NECK, 0.012 * noise(t, 0.71, 1.13, 2.3), 0.012 * noise(t, 0.37, 0.79, 1.61), 0);
  addAngles(p, HEAD, 0.035 + 0.008 * breath, 0.02 * noise(t, 0.29, 0.86, 1.47), 0.012 * noise(t, 0.47, 1.03, 1.91));
  for (const side of [0, 1]) {
    p[ARMS[side] + SHRUG] += 0.02 * (0.5 + 0.5 * breath);
    p[ARMS[side] + AX] += 0.006 * noise(t + side * 2.1, 0.61, 1.27, 2.1);
    p[ARMS[side] + AZ] += 0.008 * noise(t + side * 3.7, 0.47, 1.09, 1.83);
  }
}

/** 重心の移動と拍の沈み。腰 → 胸 → 首の順に遅らせる。size は動きの大きさ、drop は腰の沈み(m) */
function groove(p, beat, size, drop) {
  const w = (lag) => weightShift(beat - lag);
  p[HX] += 0.055 * size * w(0);
  p[HY] -= drop * onBeat(beat);
  addAngles(p, HIPS, 0, 5 * DEG * size * w(0.5), 8 * DEG * size * w(0));
  addAngles(p, SPINE, 0, -1.5 * DEG * size * w(0.6), -7 * DEG * size * w(0.12));
  addAngles(p, CHEST, 1.5 * DEG * size * onBeat(beat - 0.12), -3 * DEG * size * w(0.7), -6 * DEG * size * w(0.25));
  addAngles(p, NECK, 0, 0, 2 * DEG * size * w(0.35));
  addAngles(p, HEAD, 3 * DEG * size * onBeat(beat - 0.22), 0, 2 * DEG * size * w(0.45));
  for (const side of [0, 1]) {
    const sign = side === 0 ? 1 : -1;
    const o = ARMS[side];
    p[o + AZ] -= 0.05 * size * sign * w(0.35);
    p[o + AY] += 0.02 * size * (onBeat(beat - 0.3) - 0.5);
    p[o + SHRUG] += 0.03 * size * Math.max(0, sign * w(0.3));
  }
}

function waveArm(p, side, t, amount) {
  setArm(p, side, POSE.wave, amount);
  const swing = Math.sin(t * 2 * Math.PI * 1.45);
  const o = ARMS[side];
  p[o + AX] += 0.06 * swing * amount;
  p[o + AY] -= 0.012 * swing * swing * amount;
  p[o + WR] += 0.16 * Math.sin(t * 2 * Math.PI * 1.45 - 0.7) * amount;
}

/** t の前後で小さくうなずく。start からの n 回、周期 period */
function nods(p, t, start, n, period, size) {
  const u = (t - start) / period;
  if (u <= 0 || u >= n) return;
  const s = Math.sin(Math.PI * (u % 1));
  const k = s * s * size;
  addAngles(p, HEAD, k, 0, 0);
  addAngles(p, NECK, k * 0.45, 0, 0);
  addAngles(p, CHEST, k * 0.12, 0, 0);
}

function poseDark(p, c) {
  stand(p, c.t);
  addAngles(p, HEAD, 9 * DEG, 0, 0);
}

function poseEnter(p, c) {
  stand(p, c.t);
  addAngles(p, HEAD, 9 * DEG * (1 - span(c.t, c.start + 1.5, c.end)), 0, 0);
}

function poseLine(p, c) {
  stand(p, c.t);
  groove(p, c.beat, 0.2, 0.004);
  const dur = c.end - c.start;
  const u = (c.t - c.start) / dur;
  const raise = span(c.t, c.start + 0.1, c.start + 0.7) * (1 - span(c.t, c.end - 0.8, c.end - 0.2));
  waveArm(p, 1, c.t, raise);
  // 客席を左から右へ見渡す
  const scan = Math.sin(u * Math.PI * 2 - 0.5);
  addAngles(p, HEAD, 0, 11 * DEG * scan, -3 * DEG * scan);
  addAngles(p, NECK, 0, 5 * DEG * scan, 0);
  addAngles(p, CHEST, 0, 5 * DEG * scan, 2 * DEG * raise);
  p[HX] += 0.018 * raise;
}

function poseSong(p, c) {
  stand(p, c.t);
  const sung = span(c.t, c.dance.sungStart - 0.8, c.dance.sungStart);
  const chorus = c.dance.chorusStart === null ? 0 : span(c.t, c.dance.chorusStart - 0.4, c.dance.chorusStart + 0.1);
  const size = lerp(0.45, lerp(0.8, 1, chorus), sung) * c.gain;
  groove(p, c.beat, size, lerp(0.012, lerp(0.02, 0.03 + 0.02 * c.energyNorm, chorus), sung));
  p[HY] -= 0.008 * sung + 0.006 * chorus; // 脚が伸びきる近くは、腰の小さな動きで膝が速く動く
  addAngles(p, HEAD, c.mouth * 0.02, 0, 0);

  // 歌の腕: ふだんは手を上げて拍に乗る。サビは左右へ大きく
  if (sung > 0) {
    const w = weightShift(c.beat - 0.3);
    setArm(p, 0, POSE.ready, sung);
    setArm(p, 1, POSE.ready, sung);
    setArm(p, 0, POSE.vee, chorus * smooth(0.5 + 0.5 * w));
    setArm(p, 1, POSE.vee, chorus * smooth(0.5 - 0.5 * w));
    applyKime(p, c, sung);
  }
}

/** 偶数の小節の頭で決めの形に入る。その手前で少しためる */
function applyKime(p, c, sung) {
  const pair = Math.floor(c.beat / 8);
  const u = c.beat - pair * 8; // 0〜8 拍
  const attack = hit((u - KIME_ATTACK_FROM) / (8 - KIME_ATTACK_FROM)); // 次の形へ入る途中の量
  const hold = 1 - span(u, 3.4, 5);
  const order = pair - c.dance.firstKimePair;
  const kimeNow = KIME[((order % 4) + 4) % 4];
  const kimeNext = KIME[(((order + 1) % 4) + 4) % 4];
  const useNext = u >= KIME_ATTACK_FROM;
  const kime = useNext ? kimeNext : kimeNow;
  const amount = sung * (useNext ? attack : u < 3.4 ? 1 : hold);
  if (amount <= 0) return;
  setArm(p, 0, kime.l, amount);
  setArm(p, 1, kime.r, amount);
  p[HX] += kime.hipX * amount;
  addAngles(p, CHEST, kime.bend * amount, 0, kime.lean * amount);
  addAngles(p, HEAD, 0, 0, kime.tilt * amount);
  const dip = u >= 6.1 && u < 7.2 ? Math.sin(((u - 6.1) / 1.1) * Math.PI) : 0;
  p[HY] -= 0.012 * dip * sung;
}

function poseBow(p, c) {
  stand(p, c.t);
  const t0 = c.t - c.start;
  const a = (lag) => {
    const down = span(t0 - lag, 0.8, 2.1);
    const up = span(t0 - lag, 2.85, 4.2);
    const settle = 1.5 * DEG * Math.sin(clamp01((t0 - lag - 4.2) / 0.5) * Math.PI);
    return { v: down * (1 - up), settle };
  };
  const hands = span(t0, 0.15, 0.85) * (1 - span(t0, 4.0, 4.8));
  setArm(p, 0, POSE.frontLow, hands);
  setArm(p, 1, POSE.frontLow, hands);
  const hip = a(0);
  const spine = a(0.05);
  const chest = a(0.1);
  const neck = a(0.16);
  const head = a(0.22);
  addAngles(p, HIPS, 19 * DEG * hip.v - hip.settle, 0, 0);
  addAngles(p, SPINE, 13 * DEG * spine.v, 0, 0);
  addAngles(p, CHEST, 11 * DEG * chest.v, 0, 0); // 腰から合わせて 43 度
  addAngles(p, NECK, 4 * DEG * neck.v, 0, 0);
  addAngles(p, HEAD, 3 * DEG * head.v, 0, 0);
  p[HZ] -= 0.065 * hip.v;
  p[HY] -= 0.022 * hip.v; // 膝を少し曲げて受ける
}

function poseListen(p, c) {
  stand(p, c.t);
  const t0 = c.t - c.start;
  p[TURN] = LISTEN_TURN;
  addAngles(p, CHEST, 3 * DEG, -3 * DEG, 0);
  // 耳を傾ける: 頭を少し手前へ下げ、首をかしげる
  const lean = span(t0, 0.9, 1.9);
  addAngles(p, NECK, 2 * DEG * lean, -5 * DEG, 3 * DEG * lean);
  addAngles(p, HEAD, 3 * DEG * lean, -6 * DEG, 8 * DEG * lean);
  setArm(p, 0, POSE.ready, 0.25);
  setArm(p, 1, POSE.ready, 0.25);
  // 聞いている間も止まらない。ゆっくり体重を移す
  const sway = Math.sin((t0 * 2 * Math.PI) / 4.3);
  p[HX] += 0.018 * sway;
  addAngles(p, HIPS, 0, 0, 2.2 * DEG * sway);
  addAngles(p, CHEST, 0, 0, -2.2 * DEG * sway);
  nods(p, c.t, c.end - 1.2, 1, 0.9, 7 * DEG);
}

function poseAnswer(p, c) {
  stand(p, c.t);
  p[TURN] = ANSWER_TURN;
  const says = c.dance.says;
  const first = says[0] ?? c.start + 0.3;
  const second = says[1] ?? lerp(c.start, c.end, 0.45);
  addAngles(p, NECK, 0, -4 * DEG, 0);
  addAngles(p, HEAD, c.mouth * 0.025, -5 * DEG, 0);
  // 1 文目: 驚いて少し引き、肩が上がって手が浮く。そのあと小さくうなずく
  const surprise = span(c.t, first - 0.1, first + 0.15) * (1 - span(c.t, first + 0.7, first + 1.6));
  addAngles(p, CHEST, -8 * DEG * surprise, 0, 0);
  p[HZ] -= 0.025 * surprise;
  addAngles(p, HEAD, -6 * DEG * surprise, 0, 0);
  setArm(p, 0, POSE.ready, 0.6 * surprise);
  setArm(p, 1, POSE.ready, 0.6 * surprise);
  p[ARMS[0] + SHRUG] += 0.1 * surprise;
  p[ARMS[1] + SHRUG] += 0.1 * surprise;
  nods(p, c.t, first + 1.4, 2, 0.85, 6 * DEG);
  // 2 文目: うれしい。首をかしげて小さく揺れ、最後に手を胸へ
  const happy = span(c.t, second - 0.3, second + 0.4);
  const sway = Math.sin((c.t - second) * 2 * Math.PI * 0.55);
  p[HX] += 0.02 * happy * sway;
  addAngles(p, HIPS, 0, 0, 2.5 * DEG * happy * sway);
  addAngles(p, CHEST, 0, 0, -3 * DEG * happy * sway);
  addAngles(p, HEAD, 0, 0, happy * (6 * DEG - 2 * DEG * sway));
  nods(p, c.t, second + 0.5, 2, 1.0, 5 * DEG);
  setArm(p, 1, POSE.onChest, span(c.t, c.end - 2.9, c.end - 2.1));
  nods(p, c.t, c.end - 1.5, 1, 1.1, 5 * DEG);
}

function poseOutro(p, c) {
  stand(p, c.t);
  const raise = span(c.t, c.start + 0.3, c.start + 1.0) * (1 - span(c.t, c.end - 0.7, c.end));
  waveArm(p, 1, c.t, raise);
  p[HX] += 0.015 * raise;
  addAngles(p, HEAD, 0, 0, -3 * DEG * raise);
}

const POSERS = { preroll: poseDark, dark: poseDark, enter: poseEnter, line: poseLine, song: poseSong, bow: poseBow, listen: poseListen, answer: poseAnswer, outro: poseOutro, tail: poseDark };

/** 重なる section を、重ならない並びにする。せりふは曲のイントロより前に出す */
function flatten(sections) {
  const line = sections.find((s) => s.id === 'line');
  const out = [];
  for (const s of [...sections].sort((a, b) => a.start - b.start)) {
    if (s.id === 'line') continue;
    if (s.id === 'song' && line && line.start >= s.start && line.end <= s.end) {
      out.push({ id: 'song', start: s.start, end: line.start }, line, { id: 'song', start: line.end, end: s.end });
    } else out.push(s);
  }
  if (line && !out.includes(line)) out.push(line);
  return out.sort((a, b) => a.start - b.start);
}

/** 曲の中の、歌い出しとサビの頭(秒)を timeline から探す */
function analyzeSong(timeline, fps) {
  const song = timeline.sections.find((s) => s.id === 'song');
  if (!song) return { sungStart: 0, chorusStart: null, firstKimePair: 0 };
  const line = timeline.sections.find((s) => s.id === 'line');
  const from = Math.max(song.start, line && line.start < song.end ? line.end : song.start);
  let sungStart = song.start;
  for (let f = Math.round(from * fps); f < Math.round(song.end * fps); f++) {
    if ((timeline.mouth[f] ?? 0) > 0.3) {
      sungStart = f / fps;
      break;
    }
  }
  const downbeats = timeline.downbeats ?? [];
  const bars = downbeats.filter((d) => d >= song.start - 1e-6 && d < song.end);
  const heads = chorusBars(song, downbeats, timeline.energy, fps).map((n) => bars[n]).filter((d) => d >= sungStart);
  // 歌い出しのあとの最初の偶数の小節で、決めの 1 番目に入る
  const firstBar = lastIndexBefore(downbeats, sungStart) + 1;
  const firstKimePair = Math.ceil(firstBar / 2);
  return { sungStart, chorusStart: heads.length ? heads[0] : null, firstKimePair };
}

/** 前後の平均でなめらかにした列。声の強さのばらつきで動きが震えないように */
function averaged(values, radius) {
  const out = new Float32Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i > 2 * radius) sum -= values[i - 2 * radius - 1] ?? 0;
    const at = i - radius;
    if (at >= 0) out[at] = sum / (2 * radius + 1);
  }
  return out;
}

/** timeline のコマから、dance.apply に渡す値を作る */
export function danceInput(timeline, frame) {
  const fps = timeline.fps;
  const t = frame / fps;
  const beats = timeline.beats ?? [];
  const downbeats = timeline.downbeats ?? [];
  const beatSec = 60 / (timeline.bpm || 120);
  const phaseOf = (a, i, len) => {
    if (a.length === 0) return (t / len) % 1;
    if (i < 0) return 1 + (t - a[0]) / len; // 最初の手前は、同じ間隔で前へのばす
    const next = a[i + 1] ?? a[i] + len;
    return (t - a[i]) / (next - a[i]);
  };
  const b = lastIndexBefore(beats, t);
  const d = lastIndexBefore(downbeats, t);
  const line = timeline.sections.find((s) => s.id === 'line' && s.start <= t && t < s.end);
  const section = line ?? timeline.sections.find((s) => s.start <= t && t < s.end) ?? timeline.sections[timeline.sections.length - 1];
  return {
    t,
    dt: 1 / fps,
    section: section.id,
    beatPhase: phaseOf(beats, b, beatSec),
    downbeatPhase: phaseOf(downbeats, d, beatSec * 4),
    barIndex: d,
    energy: timeline.energy[frame] ?? 0,
    mouth: timeline.mouth[frame] ?? 0,
  };
}

/** 手首を体の外へ押し出す。pos は手首の位置(立ったときの体の軸からの m) */
function keepOutOfBody(pos) {
  const y = pos.y;
  if (y < KEEP_Y[0] || y > KEEP_Y[KEEP_Y.length - 1]) return;
  let i = 0;
  while (i < KEEP_Y.length - 2 && y > KEEP_Y[i + 1]) i++;
  const u = (y - KEEP_Y[i]) / (KEEP_Y[i + 1] - KEEP_Y[i]);
  const rx = lerp(KEEP_RX[i], KEEP_RX[i + 1], u);
  const rz = lerp(KEEP_RZ[i], KEEP_RZ[i + 1], u);
  const k = Math.hypot(pos.x / rx, pos.z / rz);
  if (k >= 1 || k < 1e-5) return;
  // 体の前の手は前へ、横の手は横へ出す
  if (pos.z > 0) pos.z = rz * Math.sqrt(Math.max(0, 1 - (pos.x / rx) ** 2));
  else {
    pos.x *= 1 / k;
    pos.z *= 1 / k;
  }
}

export function createDance(vrm, timeline = null) {
  const h = vrm.humanoid;
  if (vrm.meta?.metaVersion === '0') throw new Error('VRM 1.0 だけに対応しています(0.x は骨の向きの約束が違います)');
  const node = (name) => h.getNormalizedBoneNode(name);
  const need = (name) => {
    const n = node(name);
    if (!n) throw new Error(`骨がありません: ${name}`);
    return n;
  };
  const bones = {};
  for (const name of ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) {
    bones[name] = need(name);
  }
  const worldOf = (n) => n.getWorldPosition(new THREE.Vector3());
  // 正規化の骨は休みの向きがそろっているので、T の姿勢で位置だけ覚える
  const initial = new Map();
  for (const name of Object.keys(h.humanBones)) {
    const n = node(name);
    if (n) initial.set(n, { q: n.quaternion.clone(), p: n.position.clone() });
  }
  for (const n of initial.keys()) n.quaternion.identity();
  bones.hips.parent.updateWorldMatrix(true, true);
  const root = bones.hips.parent;
  const toRig = (n) => root.worldToLocal(worldOf(n));
  const hipsRest = bones.hips.position.clone();
  const chestRest = toRig(bones.chest);
  const axisZ = chestRest.z + (REF_AXIS_Z - REF_CHEST_Z);

  const armScale = (bones.leftLowerArm.position.length() + bones.leftHand.position.length()) / REF_ARM;
  const armSetup = ['left', 'right'].map((side, i) => {
    const shoulder = bones[`${side}Shoulder`];
    const upper = bones[`${side}UpperArm`];
    const lower = bones[`${side}LowerArm`];
    const hand = bones[`${side}Hand`];
    const fingers = [];
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
      const parts = ['Proximal', 'Intermediate', 'Distal'].map((s) => node(`${side}${f}${s}`)).filter(Boolean);
      fingers.push({ isIndex: f === 'Index', parts });
    }
    return {
      sign: i === 0 ? 1 : -1, shoulder, upper, lower, hand, fingers,
      shoulderPos: toRig(shoulder).sub(chestRest),
      upperOffset: upper.position.clone(),
      l1: lower.position.length(),
      l2: hand.position.length(),
    };
  });
  const legSetup = ['left', 'right'].map((side) => {
    const upper = bones[`${side}UpperLeg`];
    const lower = bones[`${side}LowerLeg`];
    const foot = bones[`${side}Foot`];
    return { upper, lower, foot, hip: upper.position.clone(), l1: lower.position.length(), l2: foot.position.length(), footRest: toRig(foot) };
  });

  const say = timeline?.answer_says?.map((s) => s.start) ?? [];
  const fps = timeline?.fps ?? 60;
  const dance = { says: say, ...(timeline ? analyzeSong(timeline, fps) : { sungStart: 0, chorusStart: null, firstKimePair: 0 }) };
  const segments = timeline ? flatten(timeline.sections) : null;
  const energySm = timeline ? averaged(timeline.energy, Math.round(fps * 0.5)) : null;
  const mouthSm = timeline ? averaged(timeline.mouth, Math.round(fps * 0.08)) : null;

  const now = new Float64Array(CHANNELS);
  const before = new Float64Array(CHANNELS);
  const ctx = { t: 0, beat: 0, start: 0, end: 0, gain: 1, energyNorm: 0, mouth: 0, dance };

  // 使い回しの入れ物(毎コマ物を作らない)
  const qHips = new THREE.Quaternion();
  const qTurn = new THREE.Quaternion();
  const qSpine = new THREE.Quaternion();
  const qChest = new THREE.Quaternion();
  const qShoulder = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const yUp = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const matrix = new THREE.Matrix4();
  const vTarget = new THREE.Vector3();
  const vS = new THREE.Vector3();
  const vD = new THREE.Vector3();
  const vP = new THREE.Vector3();
  const vK = new THREE.Vector3();
  const vU = new THREE.Vector3();
  const vF = new THREE.Vector3();
  const vN = new THREE.Vector3();
  const vX = new THREE.Vector3();
  const vY = new THREE.Vector3();
  const vZ = new THREE.Vector3();

  const quatOf = (q, p, at) => q.setFromEuler(euler.set(p[at], p[at + 1], p[at + 2]));
  const basisQuat = (q, x, y) => {
    vZ.crossVectors(x, y);
    matrix.makeBasis(x, y, vZ);
    return q.setFromRotationMatrix(matrix);
  };

  /** 腕を 1 本解く。手首の位置を胸の座標で決め、肘は決めた向きへだけ曲がる */
  function solveArm(p, setup) {
    const o = ARMS[setup.sign > 0 ? 0 : 1];
    const sign = setup.sign;
    euler.set(0, -sign * p[o + FWD], sign * p[o + SHRUG]);
    qShoulder.setFromEuler(euler);
    setup.shoulder.quaternion.copy(qShoulder);
    vS.copy(setup.upperOffset).applyQuaternion(qShoulder).add(setup.shoulderPos);

    // 手首の目標(立ったときの体の寸法で書いた値を、胸の座標へ)
    vTarget.set(p[o + AX], p[o + AY], p[o + AZ]);
    keepOutOfBody(vTarget);
    vTarget.set(sign * vTarget.x * armScale, (vTarget.y - REF_CHEST_Y) * armScale, vTarget.z * armScale + axisZ - chestRest.z);

    const { l1, l2 } = setup;
    vD.subVectors(vTarget, vS);
    let d = vD.length();
    const maxD = (l1 + l2) * REACH;
    if (d > maxD) d = maxD;
    vD.normalize();
    vP.set(sign * p[o + 3], p[o + 4], p[o + 5]);
    vP.addScaledVector(vD, -vP.dot(vD)).normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const b = Math.sqrt(Math.max(1e-6, l1 * l1 - a * a));
    vU.copy(vD).multiplyScalar(a).addScaledVector(vP, b).normalize();
    vK.copy(vU).multiplyScalar(l1).add(vS);
    vF.copy(vD).multiplyScalar(d).add(vS).sub(vK).normalize();

    // 腕の下げ角の下限。肘の曲げが小さいほど、真下から離す
    const flex = Math.acos(THREE.MathUtils.clamp(vU.dot(vF), -1, 1));
    const minDown = lerp(ARM_MIN_DOWN_STRAIGHT, ARM_MIN_DOWN_BENT, smooth(flex / ELBOW_BENT));
    const down = Math.acos(THREE.MathUtils.clamp(-vU.y, -1, 1));
    if (down < minDown) {
      const len = Math.hypot(vU.x, vU.z);
      const hx = len > 1e-3 ? vU.x / len : sign;
      const hz = len > 1e-3 ? vU.z / len : 0;
      // 水平の向きは、外へ寄せてから下げ角を保つ
      const sx = sign * Math.max(sign * hx, 0.5);
      const norm = Math.hypot(sx, hz);
      vU.set((Math.sin(minDown) * sx) / norm, -Math.cos(minDown), (Math.sin(minDown) * hz) / norm);
      vK.copy(vU).multiplyScalar(l1).add(vS);
      vF.subVectors(vTarget, vK).normalize();
    }

    vN.crossVectors(vU, vF).normalize();
    vX.copy(vU).multiplyScalar(sign);
    vY.copy(vN).multiplyScalar(-sign);
    basisQuat(qA, vX, vY); // 上腕(胸の座標)
    setup.upper.quaternion.copy(qShoulder).invert().multiply(qA);
    vX.copy(vF).multiplyScalar(sign);
    vZ.crossVectors(vX, vY).normalize();
    vY.crossVectors(vZ, vX);
    basisQuat(qB, vX, vY); // 前腕(胸の座標)
    qC.setFromAxisAngle(xAxis, -p[o + TW]);
    qB.multiply(qC);
    setup.lower.quaternion.copy(qA).invert().multiply(qB);

    // 手首と指。手のひらの側へ曲げる向きが +
    euler.set(0, sign * p[o + WR], -sign * p[o + WP]);
    setup.hand.quaternion.setFromEuler(euler);
    for (const finger of setup.fingers) {
      const curl = finger.isIndex ? p[o + IDX] : p[o + CURL];
      finger.parts.forEach((part, i) => {
        euler.set(0, 0, -sign * curl * (i === 0 ? 1.15 : i === 1 ? 1.45 : 0.9));
        part.quaternion.setFromEuler(euler);
      });
    }
  }

  /** 脚を 1 本解く。足は床に置いたまま、腰の動きを膝で受ける */
  function solveLeg(setup, hipsPos) {
    const { l1, l2 } = setup;
    vTarget.copy(setup.footRest).sub(hipsRest);
    vTarget.applyQuaternion(qTurn).add(hipsRest).sub(hipsPos); // 足の場所(回った体の向きに合わせる)
    qA.copy(qHips).invert();
    vTarget.applyQuaternion(qA).sub(setup.hip); // 腰の座標で、股関節から足首へ
    let d = vTarget.length();
    const maxD = (l1 + l2) * 0.9995;
    if (d > maxD) d = maxD;
    vD.copy(vTarget).normalize();
    vP.set(0, 0, 1).applyQuaternion(qTurn).applyQuaternion(qA);
    vP.addScaledVector(vD, -vP.dot(vD)).normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const b = Math.sqrt(Math.max(1e-7, l1 * l1 - a * a));
    vU.copy(vD).multiplyScalar(a).addScaledVector(vP, b).normalize();
    vK.copy(vU).multiplyScalar(l1);
    vF.copy(vD).multiplyScalar(d).sub(vK).normalize();
    vX.crossVectors(vU, vF).normalize();
    vY.copy(vU).negate();
    basisQuat(qB, vX, vY);
    setup.upper.quaternion.copy(qB);
    vY.copy(vF).negate();
    vZ.crossVectors(vX, vY).normalize();
    vY.crossVectors(vZ, vX);
    basisQuat(qC, vX, vY);
    setup.lower.quaternion.copy(qB).invert().multiply(qC);
    // 足は床に平ら。向きだけ体に合わせる
    setup.foot.quaternion.copy(qHips).multiply(qC).invert().multiply(qTurn);
  }

  function evaluate(id, out) {
    (POSERS[id] ?? poseDark)(out, ctx);
  }

  function segmentAt(input) {
    if (segments) {
      let i = 0;
      for (let k = 0; k < segments.length; k++) {
        if (segments[k].start <= input.t) i = k;
      }
      return { seg: segments[i], prev: i > 0 ? segments[i - 1] : null };
    }
    const s = input.section;
    if (typeof s !== 'object' || s === null) throw new Error('timeline なしのときは、section を {id, start, end} で渡してください');
    return { seg: s, prev: null };
  }

  function writePose(p) {
    qTurn.setFromAxisAngle(yUp, p[TURN]);
    quatOf(qHips, p, HIPS).premultiply(qTurn);
    vS.set(p[HX], p[HY], p[HZ]).applyQuaternion(qTurn);
    bones.hips.position.copy(hipsRest).add(vS);
    bones.hips.quaternion.copy(qHips);
    quatOf(qSpine, p, SPINE);
    quatOf(qChest, p, CHEST);
    bones.spine.quaternion.copy(qSpine);
    bones.chest.quaternion.copy(qChest);
    quatOf(bones.neck.quaternion, p, NECK);
    quatOf(bones.head.quaternion, p, HEAD);
    const hipsPos = bones.hips.position;
    for (const leg of legSetup) solveLeg(leg, hipsPos);
    for (const a of armSetup) solveArm(p, a);
  }

  return {
    /** 1 コマ分の姿勢を書く。同じ入力なら同じ姿勢 */
    apply(input) {
      const { seg, prev } = segmentAt(input);
      const frame = Math.round(input.t * fps);
      const energy = energySm ? energySm[Math.min(frame, energySm.length - 1)] : input.energy ?? 0;
      ctx.t = input.t;
      ctx.beat = ((input.barIndex ?? 0) + (input.downbeatPhase ?? 0)) * 4;
      ctx.energyNorm = clamp01((energy - 0.55) / 0.4);
      ctx.gain = 0.88 + 0.24 * ctx.energyNorm;
      ctx.mouth = mouthSm ? mouthSm[Math.min(frame, mouthSm.length - 1)] : input.mouth ?? 0;

      ctx.start = seg.start;
      ctx.end = seg.end;
      evaluate(seg.id, now);
      const xfade = XFADE[seg.id] ?? 0.5;
      if (prev && input.t - seg.start < xfade) {
        ctx.start = prev.start;
        ctx.end = prev.end;
        evaluate(prev.id, before);
        const k = smooth((input.t - seg.start) / xfade);
        for (let i = 0; i < CHANNELS; i++) now[i] = before[i] + (now[i] - before[i]) * k;
      }
      writePose(now);
    },
    /** 骨を読み込んだときの姿勢へ戻す */
    reset() {
      for (const [n, v] of initial) {
        n.quaternion.copy(v.q);
        n.position.copy(v.p);
      }
    },
  };
}
