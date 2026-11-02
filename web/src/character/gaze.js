// 視線まわりの計算。three.js に依存しない純粋な関数とクラス(node --test で確かめる)。

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothingAlpha = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

/** 原点から見た目標の向き。+Z が正面、+X が右、+Y が上。yaw は右が正、pitch は上が正。 */
export function anglesToTarget(origin, target) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * 首と頭の追従。目より遅らせるのが目的。
 * - delay: 目標を受けてから動き出すまでの遅れ(秒)。目が先に動く時間を作る
 * - tau: そのあと、なめらかに近づく時間の目安(秒)
 * - dead: これより小さい向きの変化は、頭を少ししか動かさない(目だけで追う)
 */
export class HeadFollower {
  constructor({ delay = 0.14, tau = 0.2, dead = 0.14, maxYaw = 1.0, maxPitch = 0.5 } = {}) {
    this.delay = delay;
    this.tau = tau;
    this.dead = dead;
    this.maxYaw = maxYaw;
    this.maxPitch = maxPitch;
    this.t = 0;
    this.history = [{ t: 0, yaw: 0, pitch: 0 }];
    this.yaw = 0;
    this.pitch = 0;
  }

  _shape(v, limit) {
    const a = Math.abs(v);
    // 小さい向きは 35% だけ頭で追い、dead の 2 倍を超えたら全部追う
    const k = clamp(0.35 + (0.65 * (a - this.dead)) / this.dead, 0.35, 1);
    return clamp(v * k, -limit, limit);
  }

  step(dt, yaw, pitch) {
    this.t += dt;
    this.history.push({ t: this.t, yaw, pitch });
    const cutoff = this.t - this.delay;
    // 遅れた時刻の目標を使う。古いものは捨てる
    let delayed = this.history[0];
    while (this.history.length > 1 && this.history[1].t <= cutoff) {
      this.history.shift();
      delayed = this.history[0];
    }
    if (this.t < this.delay) delayed = this.history[0];
    const a = smoothingAlpha(dt, this.tau);
    this.yaw += (this._shape(delayed.yaw, this.maxYaw) - this.yaw) * a;
    this.pitch += (this._shape(delayed.pitch, this.maxPitch) - this.pitch) * a;
    return { yaw: this.yaw, pitch: this.pitch };
  }
}

/** 誰も見えていないときの、ゆっくりした視線のさまよい。乱数は外から渡す(試験できるように)。 */
export class IdleGaze {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.timer = 0;
    this.yaw = 0;
    this.pitch = 0;
  }

  step(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1.8 + this.rand() * 3;
      this.yaw = (this.rand() - 0.5) * 0.5;
      this.pitch = (this.rand() - 0.5) * 0.2;
    }
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
