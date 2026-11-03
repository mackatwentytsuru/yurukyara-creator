// 視線の計画の 2.4 の表を作る計算(前提は未実測の仮定。式は kiosk/docs/視線とキャリブレーションの計画.md の 2.2〜2.3)。
//   node kiosk/tools/gaze_table.mjs
// 前提(未実測): LED 下端の高さ y0=0.5 m、カメラは LED 下端の 0.1 m 下・LED の中央、等身大キャラの目の高さ = y0 + 1.5 m
const y0 = 0.5, camY = y0 - 0.1, eyeY = y0 + 1.5;
const IPD = 0.063, FW = 0.14;
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
function row(z, ey, ex = 0, hfov = 100, wpx = 1920) {
  const f = wpx / (2 * Math.tan(rad(hfov / 2)));
  const dy = ey - camY, dz = z, dx = ex;
  const elev = deg(Math.atan2(dy, Math.hypot(dx, dz)));
  const az = deg(Math.atan2(dx, dz));
  const camDist = Math.hypot(dx, dy, dz);
  const ipdPx = f * IPD / dz; // 光軸方向の奥行き(カメラを水平に向けた場合)
  // キャラの目から客の目への視線角(客の目を見る)
  const gx = deg(Math.atan2(ex, z)), gy = deg(Math.atan2(ey - eyeY, Math.hypot(ex, z)));
  // カメラの向きとキャラの視線の角度差(カメラは下から見上げる)
  const vc = [dx, dy, dz], vg = [ex, ey - eyeY, z];
  const dot = vc[0] * vg[0] + vc[1] * vg[1] + vc[2] * vg[2];
  const ang = deg(Math.acos(dot / (Math.hypot(...vc) * Math.hypot(...vg))));
  // IPD の個人差 ±5.7%(σ 3.6mm)が、客の目の位置に与える誤差(カメラから見た奥行き方向)と、キャラの目から見た視線の誤差角
  const dErr = camDist * 0.057;
  const perp = dErr * Math.sin(rad(ang));
  const gazeErr = deg(Math.atan2(perp, Math.hypot(ex, ey - eyeY, z)));
  return { 距離m: z, 目の高さm: ey, 横m: ex, カメラから見た仰角: +elev.toFixed(0), 方位: +az.toFixed(0), IPD画素_1080p: +ipdPx.toFixed(0), 顔幅画素_1080p: +(f * FW / dz).toFixed(0), キャラの視線_横: +gx.toFixed(1), キャラの視線_上下: +gy.toFixed(1), カメラとキャラ視線の角度差: +ang.toFixed(0), IPD個人差による視線誤差角: +gazeErr.toFixed(1) };
}
const rows = [];
for (const z of [1, 1.5, 2, 3]) for (const ey of [1.4, 1.6, 1.8]) rows.push(row(z, ey));
rows.push(row(2, 1.6, 1.0), row(2, 1.6, -1.0));
console.table(rows);
console.log('4K なら画素は 2 倍');
