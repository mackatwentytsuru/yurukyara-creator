// 体の動き。手続きで作る(動きのファイルが無いキャラでも動かせる)。
// 骨の名前は VRM の人型の名前。p.add(骨, x, y, z) で回転(ラジアン)を足す。

const ease = (u) => u * u * (3 - 2 * u);

/** 立ち上がり a、戻り r(どちらも全体に対する割合)。0〜1 */
export function envelope(t, duration, a = 0.25, r = 0.25) {
  const u = t / duration;
  if (u <= 0 || u >= 1) return 0;
  if (u < a) return ease(u / a);
  if (u > 1 - r) return ease((1 - u) / r);
  return 1;
}

export const GESTURES = {
  nod: {
    duration: 0.9,
    apply(t, p) {
      const e = envelope(t, 0.9, 0.1, 0.3);
      const dip = Math.max(0, Math.sin((t / 0.9) * Math.PI * 4));
      p.add('head', 0.24 * dip * e, 0, 0);
      p.add('neck', 0.1 * dip * e, 0, 0);
    },
  },
  bow: {
    duration: 2.0,
    apply(t, p) {
      const e = envelope(t, 2.0, 0.35, 0.35);
      p.add('spine', 0.3 * e, 0, 0);
      p.add('chest', 0.2 * e, 0, 0);
      p.add('neck', 0.12 * e, 0, 0);
      p.add('head', 0.1 * e, 0, 0);
    },
  },
  wave: {
    duration: 2.2,
    apply(t, p) {
      const e = envelope(t, 2.2, 0.2, 0.25);
      const swing = Math.sin(t * Math.PI * 2 * 2.2);
      p.add('rightUpperArm', 0, 0, -2.25 * e);
      p.add('rightLowerArm', 0, 0, 0.5 * swing * e);
      p.add('rightLowerArm', 0, -0.3 * e, 0);
      p.add('head', 0, 0, -0.05 * e);
    },
  },
  think: {
    duration: 2.2,
    apply(t, p) {
      const e = envelope(t, 2.2, 0.3, 0.3);
      p.add('head', -0.06 * e, 0.14 * e, 0.14 * e);
      p.add('neck', 0, 0.05 * e, 0.05 * e);
    },
  },
  tilt: {
    duration: 1.4,
    apply(t, p) {
      const e = envelope(t, 1.4, 0.3, 0.3);
      p.add('head', 0, 0, 0.2 * e);
      p.add('neck', 0, 0, 0.06 * e);
    },
  },
  shake: {
    duration: 1.0,
    apply(t, p) {
      const e = envelope(t, 1.0, 0.1, 0.25);
      p.add('head', 0, 0.28 * Math.sin((t / 1.0) * Math.PI * 6) * e, 0);
    },
  },
  shrug: {
    duration: 1.4,
    apply(t, p) {
      const e = envelope(t, 1.4, 0.3, 0.3);
      p.add('leftShoulder', 0, 0, 0.16 * e);
      p.add('rightShoulder', 0, 0, -0.16 * e);
      p.add('leftUpperArm', 0, 0, 0.18 * e);
      p.add('rightUpperArm', 0, 0, -0.18 * e);
      p.add('head', 0, 0, 0.08 * e);
    },
  },
  point: {
    duration: 2.0,
    // opts.dx, opts.dz: キャラから見た目印の位置(ワールド座標の差。+x がお客さんから見て右、+z が手前)
    apply(t, p, opts = {}) {
      const e = envelope(t, 2.0, 0.25, 0.3);
      const dx = opts.dx ?? -1;
      const dz = opts.dz ?? 0.5;
      const useLeft = dx > 0; // お客さんから見て右(+x)はキャラの左手
      // 腕は T ポーズで横を向く。前後への振りは、目印の方向の角度(水平)で決める
      const swing = Math.max(-1.3, Math.min(1.3, useLeft ? -Math.atan2(dz, Math.abs(dx)) : Math.atan2(dz, Math.abs(dx))));
      const side = useLeft ? 'left' : 'right';
      const sign = useLeft ? -1 : 1;
      p.add(`${side}UpperArm`, 0, swing * e, -sign * 1.2 * e); // 下ろした腕(±1.2)を水平まで上げる
      p.add(`${side}LowerArm`, 0, 0, sign * -0.15 * e);
    },
  },
};

/** 動きの語彙(Claude に見せる) */
export const GESTURE_NAMES = ['none', ...Object.keys(GESTURES)];

/** 立っているときの基本の姿勢。T ポーズの腕を下ろす。 */
export const REST_POSE = {
  leftUpperArm: [0, 0, -1.2],
  rightUpperArm: [0, 0, 1.2],
  leftLowerArm: [0, 0, -0.08],
  rightLowerArm: [0, 0, 0.08],
};

/** 骨ごとの回転の足し込み先 */
export class Pose {
  constructor() {
    this.map = new Map();
  }
  reset() {
    this.map.clear();
  }
  add(bone, x, y, z) {
    const cur = this.map.get(bone);
    if (cur) {
      cur[0] += x;
      cur[1] += y;
      cur[2] += z;
    } else {
      this.map.set(bone, [x, y, z]);
    }
  }
}
