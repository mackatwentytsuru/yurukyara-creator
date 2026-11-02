// AR で撮った部屋を現実の部屋に重ねる手順(タップ 2 回)。画面の文は prompt を出す。
//   const flow = createAlignFlow({ place });       // 水平にいちばん離れた 2 つの目印を選ぶ
//   flow.prompt                                     // 「『入口』の真下の床をタップしてください」
//   flow.submit(worldPoint)                         // 殻の onHit の点(世界の座標)を渡す。2 つそろうと place.setAlignment まで行う
//   flow.done / flow.result({yaw, tx, tz, rms})     // rms は食い違い(m)。0.15 を超えたら、やり直しを勧める
// 床の高さは、渡された floorY(殻が見つけた床)があればそれ、無ければタップした点の高さの平均。
import { pickAlignmentPair, solveAlignment } from './align.js';

export const RMS_LIMIT_M = 0.15;

export function createAlignFlow({ place, floorY = null, pair = null }) {
  const targets = pair ?? pickAlignmentPair(place.landmarks.map((l) => ({ name: l.name, position: l.position.toArray?.() ?? l.position })));
  const hits = [];
  let result = null;

  return {
    targets,
    get done() { return result !== null; },
    get result() { return result; },
    get ok() { return result !== null && result.rms <= RMS_LIMIT_M; },
    get prompt() {
      if (result) {
        return result.rms <= RMS_LIMIT_M
          ? `位置合わせができました(食い違い ${(result.rms * 100).toFixed(0)} cm)`
          : `食い違いが ${(result.rms * 100).toFixed(0)} cm あります。やり直してください`;
      }
      return `「${targets[hits.length].name}」の真下の床をタップしてください(${hits.length + 1}/${targets.length})`;
    },
    /** @param {{x:number,y:number,z:number}|number[]} worldPoint */
    submit(worldPoint) {
      if (result) return result;
      const w = Array.isArray(worldPoint) ? worldPoint : [worldPoint.x, worldPoint.y, worldPoint.z];
      hits.push(w);
      if (hits.length < targets.length) return null;
      const room = targets.map((t) => [t.position[0], t.position[2]]);
      const world = hits.map((h) => [h[0], h[2]]);
      const r = solveAlignment(room, world);
      const y = floorY ?? hits.reduce((s, h) => s + h[1], 0) / hits.length;
      place.setAlignment({ yaw: r.yaw, tx: r.tx, tz: r.tz, floorY: y });
      result = { ...r, floorY: y };
      return result;
    },
    reset() {
      hits.length = 0;
      result = null;
      place.clearAlignment();
    },
  };
}
