// 撮った部屋(部屋の座標)と、AR の世界(起動した位置が原点)を重ねる計算。three.js に依存しない。
//
// AR の世界は毎回ちがう場所・向きで始まるので、部屋の 3D はそのままでは現実の部屋に重ならない。
// 現実の床の 2 か所以上(部屋の目印の真下)をタップしてもらい、「部屋の点 → 世界の点」の対応から、
// 水平面の中の回転(yaw)と平行移動を求める。床の高さは世界の床の高さ(殻が見つけた水平面)で決める。
//
// 向きの約束は three.js の rotation.y と同じ: 点 (x, z) は
//   x' = x cosθ + z sinθ,   z' = -x sinθ + z cosθ
// (+z を向く物は、θ だけ回すと +x のほうへ向く。place.json の yaw_deg と同じ向き)。

/**
 * @param {number[][]} roomXZ  部屋の座標の点 [[x, z], ...](2 個以上)
 * @param {number[][]} worldXZ AR の世界で同じ場所だった点 [[x, z], ...]
 * @returns {{yaw: number, tx: number, tz: number, rms: number}} yaw はラジアン。rms は合わせたあとの食い違い(m)
 */
export function solveAlignment(roomXZ, worldXZ) {
  const n = roomXZ.length;
  if (n < 2 || worldXZ.length !== n) throw new Error('位置合わせには、同じ数の点が 2 個以上いる');
  const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / n;
  const rc = [mean(roomXZ, 0), mean(roomXZ, 1)];
  const wc = [mean(worldXZ, 0), mean(worldXZ, 1)];
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i += 1) {
    const rx = roomXZ[i][0] - rc[0];
    const rz = roomXZ[i][1] - rc[1];
    const wx = worldXZ[i][0] - wc[0];
    const wz = worldXZ[i][1] - wc[1];
    dot += rx * wx + rz * wz;
    cross += rx * wz - rz * wx;
  }
  if (Math.hypot(dot, cross) < 1e-9) throw new Error('位置合わせの点が近すぎる(同じ場所を 2 回タップした?)');
  const yaw = -Math.atan2(cross, dot);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const apply = (x, z) => [x * c + z * s, -x * s + z * c];
  const [rx, rz] = apply(rc[0], rc[1]);
  const tx = wc[0] - rx;
  const tz = wc[1] - rz;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = apply(roomXZ[i][0], roomXZ[i][1]);
    sq += (px + tx - worldXZ[i][0]) ** 2 + (pz + tz - worldXZ[i][1]) ** 2;
  }
  return { yaw, tx, tz, rms: Math.sqrt(sq / n) };
}

/** 部屋の目印から、位置合わせに使う 2 つ(水平にいちばん離れた組)を選ぶ。landmarks は {name, position:[x,y,z]}。 */
export function pickAlignmentPair(landmarks) {
  if (landmarks.length < 2) throw new Error('位置合わせには、目印が 2 つ以上いる');
  let best = null;
  for (let i = 0; i < landmarks.length; i += 1) {
    for (let j = i + 1; j < landmarks.length; j += 1) {
      const d = Math.hypot(landmarks[i].position[0] - landmarks[j].position[0], landmarks[i].position[2] - landmarks[j].position[2]);
      if (!best || d > best.d) best = { i, j, d };
    }
  }
  if (best.d < 0.5) throw new Error('目印どうしが 0.5 m より近い。位置合わせに使えない');
  return [landmarks[best.i], landmarks[best.j]];
}
