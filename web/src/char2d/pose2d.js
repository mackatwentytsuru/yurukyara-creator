// 3D の骨の回転(gestures.js が Pose に足す値)を、正面から見た 2D の板の動きに直す。three を使わない。
// 3D と同じ動きの名前(nod・wave・bow・think・tilt・shake・shrug・point)が、2D でもそのまま動く。
//   x 回り(うなずく・おじぎ)→ 下へずらして縦に少しつぶす
//   y 回り(首を振る・横を見る)→ 横へずらす(顔の部品は多めにずらして奥行きに見せる)
//   z 回り(首をかしげる・腕を上げる)→ 板をそのまま回す
// 腕が 2 枚(上腕と前腕)のキャラは、上腕を肩で回し、前腕をひじで曲げる(手を振る時は前腕が上を向く)。

const get = (pose, bone) => pose?.map?.get(bone) ?? [0, 0, 0];

export const DEFAULT_GAINS = {
  headShiftX: 0.18, // 頭の横ずれ(頭の幅に対する割合 / ラジアン)
  headShiftY: 0.22, // 頭の縦ずれ(同じ)
  faceParallax: 0.6, // 顔の部品は頭よりこれだけ多めにずらす
  arm: 0.8, // 腕の回転の効き
  bowSquash: 0.2, // おじぎで体を縦につぶす量
  bounce: 0.012, // 待つ間の弾み(背の高さに対する割合)
  // おじぎの頭(既定は前と同じ: 頭を下げ、少し手前へ大きく。つぶさない)
  bowHoldHead: 0, // 1 なら、おじぎの間は首の傾きで頭を下げない(胸の蝶ネクタイなどを頭で隠さない)
  bowHeadDrop: 0.25, // おじぎで頭が下がる量(頭の高さに対する割合 / おじぎの量)
  bowHeadSquash: 0, // おじぎで頭を縦につぶす量(下を向いた見え方。頭の回る中心 = あごのあたりを残してつぶす)
  bowHeadGrow: 0.06, // おじぎで頭が手前へ大きくなる量
  bowFaceDrop: 0, // おじぎで顔の部品をさらに下げる量(頭の高さに対する割合)
  // 腕が 2 枚のキャラ(parts.json に forearm_r・forearm_l がある時)だけ使う
  elbow: 2.2, // 腕を高く上げた時に、ひじで曲げる最大の角度(ラジアン)
  elbowFrom: 0.3, // 骨の上腕の角度(の大きさ)がこれを超えたら曲げ始める
  elbowTo: 2.25, // ここで最大(手を振る動きの上腕の角度)
  swing: 0.6, // 前腕の振り(骨の前腕の z 回転の効き)
};

const ease = (u) => u * u * (3 - 2 * u);

/** 腕を上げた量(骨の上腕の角度)から、ひじで曲げる角度。上げる側へ曲げる(右腕はマイナス、左腕はプラス) */
function elbowBend(upperZ, side, g) {
  const raised = side === 'r' ? -upperZ : upperZ; // 外へ上げる向きを正に
  if (raised <= 0) return 0;
  const u = clamp((raised - g.elbowFrom) / Math.max(1e-6, g.elbowTo - g.elbowFrom), 0, 1);
  return (side === 'r' ? -1 : 1) * g.elbow * ease(u);
}

/**
 * @param {{map: Map<string, number[]>}} pose 骨ごとの回転の足し込み
 * @param {{headYaw:number, headPitch:number, time:number, mouth:number}} s
 * @returns 板ごとの動き(数は全部、元の SVG の大きさに対する割合かラジアン)
 */
export function pose2d(pose, s = {}, gains = DEFAULT_GAINS) {
  const g = { ...DEFAULT_GAINS, ...gains };
  const head = get(pose, 'head');
  const neck = get(pose, 'neck');
  const spine = get(pose, 'spine');
  const chest = get(pose, 'chest');
  const yaw = (s.headYaw ?? 0) + head[1] + neck[1];
  const pitch = head[0] + neck[0] - (s.headPitch ?? 0); // 下を向くと +
  const roll = head[2] + neck[2];
  const bow = Math.max(0, spine[0] + chest[0]);
  const bowK = Math.min(1, bow * 2); // おじぎの深さ 0〜1(おじぎの動きの山で 1)
  const dropPitch = pitch * (1 - g.bowHoldHead * bowK); // おじぎの間は、首の傾きで頭を下げない(キャラによる)
  const t = s.time ?? 0;
  const bounce = g.bounce * Math.max(0, Math.sin(t * Math.PI * 2 * 0.55)) * (1 - Math.min(1, bow * 3));
  const upR = get(pose, 'rightUpperArm')[2];
  const upL = get(pose, 'leftUpperArm')[2];
  const loR = get(pose, 'rightLowerArm')[2];
  const loL = get(pose, 'leftLowerArm')[2];
  return {
    rootY: bounce,
    upperSquash: 1 - g.bowSquash * Math.min(1, bow) + 0.01 * Math.sin((t / 4.2) * Math.PI * 2),
    headX: Math.sin(clamp(yaw, -1.2, 1.2)) * g.headShiftX,
    headY: -Math.sin(clamp(dropPitch, -1, 1)) * g.headShiftY - bow * g.bowHeadDrop,
    headRot: -roll,
    headSquash: 1 - 0.12 * Math.abs(Math.sin(clamp(pitch, -1, 1))) - g.bowHeadSquash * bowK,
    faceX: Math.sin(clamp(yaw, -1.2, 1.2)) * g.headShiftX * g.faceParallax,
    faceY: -Math.sin(clamp(pitch + bow, -1, 1)) * g.headShiftY * g.faceParallax - g.bowFaceDrop * bowK, // おじぎでは顔が下を向く
    headGrow: 1 + g.bowHeadGrow * Math.min(1, bow), // おじぎで頭が手前へ出る
    // 腕が 1 枚の時(上腕と前腕を足した回し方)
    armR: (upR + 0.4 * loR) * g.arm,
    armL: (upL + 0.4 * loL) * g.arm,
    // 腕が 2 枚の時: 上腕は肩で、前腕はひじで(上腕から見た角度)
    upperR: upR * g.arm,
    upperL: upL * g.arm,
    foreR: elbowBend(upR, 'r', g) + loR * g.swing,
    foreL: elbowBend(upL, 'l', g) + loL * g.swing,
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
