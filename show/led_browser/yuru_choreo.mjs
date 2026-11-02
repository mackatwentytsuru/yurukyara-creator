// ゆるキャラのショーの踊り。拍の番号だけで全部が決まる(前のコマの状態を持たない)。
// 全員に同じ手続きを当て、キャラの順番の分だけ少し遅らせて、左から右へ波にする。
// 小節の役割は曲の測定に合わせる: 0 = 静かな頭、4・9 = 低音が抜ける、5 の頭 = 低音が戻る所(全員の決め)、最後の小節 = おじぎ。

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);

export const KIME_BAR = 5;
export const BEATS_PER_BAR = 4;
const KIME_BEAT = KIME_BAR * BEATS_PER_BAR;
const KIME_LEN = 2; // 決めの跳躍の拍数
const CROUCH_LEN = 1;
const WAVE_STEP = 0.2; // 隣のキャラとの遅れ(拍)
const ENTER_STEP = 0.6; // 登場の間隔(拍)
const ENTER_LEN = 0.9;
const AMP_FADE = 0.5; // 小節の変わり目で振れ幅を変える長さ(拍)
const CLIP_FADE = 0.3;
const BOW_LEN = 3;
const SPIN_BEAT = 34; // 小節 8 の終わり 2 拍で、順に 1 回転
const SPIN_LEN = 2;
const LAND_ATTACK = 0.1; // 着地のつぶれが立ち上がる長さ(拍)。0 にすると 1 コマで絵がとぶ
const ARM_FADE = 0.3; // 決めの腕の上げ下げの長さ(拍)
const KIME_ARM = 1.1;

//                 小節  0     1     2     3     4     5     6     7     8     9     10    11    12
const HOP      = [0.00, 0.06, 0.07, 0.07, 0.00, 0.08, 0.10, 0.10, 0.11, 0.09, 0.09, 0.10, 0.00]; // 体の高さに対する割合
const SWAY_DEG = [2.00, 5.00, 5.00, 6.00, 9.00, 6.00, 7.00, 7.00, 8.00, 8.00, 6.00, 7.00, 0.00];
const STEP     = [0.00, 0.02, 0.03, 0.03, 0.01, 0.03, 0.04, 0.04, 0.04, 0.02, 0.03, 0.03, 0.00]; // 左右の足運び
const YAW_DEG  = [0.00, 10.0, 12.0, 14.0, 8.00, 12.0, 16.0, 16.0, 18.0, 10.0, 14.0, 14.0, 0.00];
const ARM      = [0.10, 0.35, 0.45, 0.45, 0.00, 0.60, 0.70, 0.70, 0.75, 0.00, 0.55, 0.60, 0.00]; // 腕の上げ(ラジアン)
const CLIPS    = ['idle', 'idle', 'nod', 'idle', 'wave', 'idle', 'nod', 'idle', 'idle', 'wave', 'nod', 'idle', 'bow'];
const HALF_TIME_BARS = new Set([4, 9]); // 2 拍で 1 回だけ跳ねる小節

function barValue(table, beat) {
  const bar = Math.min(table.length - 1, Math.max(0, Math.floor(beat / BEATS_PER_BAR)));
  const next = Math.min(table.length - 1, bar + 1);
  const end = (bar + 1) * BEATS_PER_BAR;
  return table[bar] + (table[next] - table[bar]) * smooth(end - AMP_FADE, end, beat);
}

/** 全員一緒にする間は遅れを 0 にする。決めの前後と、おじぎ */
function waveGate(b, bowBeat) {
  const kime = smooth(KIME_BEAT - 1.8, KIME_BEAT - CROUCH_LEN, b) * (1 - smooth(KIME_BEAT + KIME_LEN, KIME_BEAT + KIME_LEN + 1, b));
  const bow = smooth(bowBeat - 1, bowBeat, b);
  return (1 - kime) * (1 - bow);
}

function backEase(x) {
  const c = 1.2;
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

/**
 * b: ショーの頭からの拍(小数)、index: 波の順番。
 * 返す値: visible, scale(登場), y・x(体の高さに対する割合), swayDeg, yawDeg, squash, clips, armL/armR, headYawDeg, headPitchDeg, surprise
 */
export function danceAt(b, index, bars) {
  const bowBeat = (bars - 1) * BEATS_PER_BAR;
  const db = b - index * WAVE_STEP * waveGate(b, bowBeat);
  const enter = (b - index * ENTER_STEP) / ENTER_LEN;
  const out = { visible: enter > 0, scale: enter >= 1 ? 1 : backEase(enter), x: 0, y: 0, swayDeg: 0, yawDeg: 0, squash: 0, armL: 0, armR: 0, headYawDeg: 0, headPitchDeg: 0, surprise: 0, clips: [] };
  const bar = Math.min(bars - 1, Math.max(0, Math.floor(db / BEATS_PER_BAR)));

  // 跳ねる。足が着いた瞬間につぶれて、宙で少し伸びる
  const halfTime = HALF_TIME_BARS.has(bar);
  const p = fract(db / (halfTime ? 2 : 1));
  const hop = barValue(HOP, db);
  out.y = hop * 4 * p * (1 - p);
  out.squash = hop * (1.5 * Math.exp(-p * 9) * smooth(0, LAND_ATTACK / (halfTime ? 2 : 1), p) - 0.6 * Math.sin(Math.PI * p));
  out.swayDeg = barValue(SWAY_DEG, db) * Math.sin((Math.PI * db) / (halfTime ? 2 : 1));
  out.x = barValue(STEP, db) * Math.sin((Math.PI * db) / 2);
  out.yawDeg = barValue(YAW_DEG, db) * Math.sin((Math.PI * db) / 2);
  const arm = barValue(ARM, db);
  const armWave = 0.5 + 0.5 * Math.sin(Math.PI * db);
  out.armL = arm * armWave;
  out.armR = arm * (1 - armWave);
  out.headYawDeg = 12 * Math.sin((Math.PI * db) / 2) * (arm > 0 ? 1 : 0.5);
  out.headPitchDeg = 7 * Math.abs(Math.sin(Math.PI * db));

  if (db >= SPIN_BEAT && db < SPIN_BEAT + SPIN_LEN) out.yawDeg += 360 * smooth(SPIN_BEAT, SPIN_BEAT + SPIN_LEN, db);

  // 決め: かがんで、全員で高く跳んで 1 回転、着地でつぶれる
  if (b >= KIME_BEAT - CROUCH_LEN && b < KIME_BEAT) {
    const crouch = smooth(KIME_BEAT - CROUCH_LEN, KIME_BEAT - 0.1, b);
    out.squash += 0.2 * crouch;
    out.y *= 1 - crouch;
    out.swayDeg *= 1 - crouch;
    out.x *= 1 - crouch;
    out.armL *= 1 - crouch;
    out.armR *= 1 - crouch;
  } else if (b >= KIME_BEAT && b < KIME_BEAT + KIME_LEN) {
    const u = (b - KIME_BEAT) / KIME_LEN;
    out.y = 0.42 * 4 * u * (1 - u);
    out.squash = 0.2 * (1 - smooth(0, 0.06, u)) - 0.1 * Math.sin(Math.PI * u);
    out.yawDeg = 360 * smooth(0, 1, u);
    out.swayDeg = 0;
    out.x = 0;
    const lift = smooth(0, ARM_FADE, b - KIME_BEAT);
    out.armL = KIME_ARM * lift;
    out.armR = KIME_ARM * lift;
    out.headYawDeg = 0;
    out.surprise = 1 - smooth(0.6, 1, u);
    out.jump = { phase: u, weight: smooth(0, 0.08, u) * (1 - smooth(0.92, 1, u)) };
  } else if (b >= KIME_BEAT + KIME_LEN && b < KIME_BEAT + KIME_LEN + 1) {
    const after = b - KIME_BEAT - KIME_LEN;
    out.squash += 0.2 * Math.exp(-after * 5) * smooth(0, LAND_ATTACK, after);
    const down = smooth(0, ARM_FADE, after);
    out.armL = KIME_ARM + (out.armL - KIME_ARM) * down;
    out.armR = KIME_ARM + (out.armR - KIME_ARM) * down;
  }

  // おじぎの前は揺れを収める
  const still = 1 - smooth(bowBeat - 1, bowBeat, b);
  for (const key of ['y', 'swayDeg', 'x', 'yawDeg', 'armL', 'armR', 'headYawDeg', 'headPitchDeg', 'squash']) out[key] *= still;

  // 動き。小節の頭で切りかえ、前の動きから短く混ぜる
  const beatInBar = db - bar * BEATS_PER_BAR;
  const name = CLIPS[Math.min(CLIPS.length - 1, bar)];
  const blend = bar === 0 ? 1 : smooth(0, CLIP_FADE, beatInBar);
  const previous = bar === 0 ? 'idle' : CLIPS[bar - 1];
  if (name === 'bow') out.clips.push({ name, phase: clamp01((b - bowBeat) / BOW_LEN), weight: smooth(bowBeat, bowBeat + CLIP_FADE, b) });
  else out.clips.push({ name, phase: fract(db / BEATS_PER_BAR), weight: blend });
  if (blend < 1 && previous !== name) out.clips.push({ name: previous, phase: fract(db / BEATS_PER_BAR), weight: 1 - blend });
  return out;
}

export function kimeAgeBeats(b) {
  return b >= KIME_BEAT ? b - KIME_BEAT : 1000;
}
