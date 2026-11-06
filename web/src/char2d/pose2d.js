// 3D の骨の回転(gestures.js が Pose に足す値)を、正面から見た 2D の板の動きに直す。three を使わない。
// 3D と同じ動きの名前(nod・wave・bow・think・tilt・shake・shrug・point)が、2D でもそのまま動く。
//   x 回り(うなずく・おじぎ)→ 下へずらして縦に少しつぶす
//   y 回り(首を振る・横を見る)→ 横へずらす(顔の部品は多めにずらして奥行きに見せる)
//   z 回り(首をかしげる・腕を上げる)→ 板をそのまま回す

const get = (pose, bone) => pose?.map?.get(bone) ?? [0, 0, 0];

export const DEFAULT_GAINS = {
  headShiftX: 0.18, // 頭の横ずれ(頭の幅に対する割合 / ラジアン)
  headShiftY: 0.22, // 頭の縦ずれ(同じ)
  faceParallax: 0.6, // 顔の部品は頭よりこれだけ多めにずらす
  arm: 0.8, // 腕の回転の効き
  bowSquash: 0.2, // おじぎで体を縦につぶす量(頭はつぶさない。つぶすと平たい顔に見える)
  bounce: 0.012, // 待つ間の弾み(背の高さに対する割合)
};

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
  const t = s.time ?? 0;
  const bounce = g.bounce * Math.max(0, Math.sin(t * Math.PI * 2 * 0.55)) * (1 - Math.min(1, bow * 3));
  const armR = get(pose, 'rightUpperArm')[2] + 0.4 * get(pose, 'rightLowerArm')[2];
  const armL = get(pose, 'leftUpperArm')[2] + 0.4 * get(pose, 'leftLowerArm')[2];
  return {
    rootY: bounce,
    upperSquash: 1 - g.bowSquash * Math.min(1, bow) + 0.01 * Math.sin((t / 4.2) * Math.PI * 2),
    headX: Math.sin(clamp(yaw, -1.2, 1.2)) * g.headShiftX,
    headY: -Math.sin(clamp(pitch, -1, 1)) * g.headShiftY - bow * 0.25,
    headRot: -roll,
    headSquash: 1 - 0.12 * Math.abs(Math.sin(clamp(pitch, -1, 1))),
    faceX: Math.sin(clamp(yaw, -1.2, 1.2)) * g.headShiftX * g.faceParallax,
    faceY: -Math.sin(clamp(pitch + bow, -1, 1)) * g.headShiftY * g.faceParallax, // おじぎでは顔が下を向く
    headGrow: 1 + 0.06 * Math.min(1, bow), // おじぎで頭が手前へ出る
    armR: armR * g.arm,
    armL: armL * g.arm,
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
