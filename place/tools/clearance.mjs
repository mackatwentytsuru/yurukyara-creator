// 通れるかの検査: 立つ位置と、ドアまで、人(身長 1.8 m・半径 0.35 m)が歩けるかを room.json の箱から調べる。
//   node place/tools/clearance.mjs <places の id>      → 通れないなら終了コード 1
// 床を 5 cm の升目にして、家具と壁ぎわから半径ぶんを塞ぎ、spawn から塗りつぶす(外の調査メモの「通路・到達性」の考え方を小さく写した物)。
// 座標は place.json の部屋の座標と同じ向き(水平の x・z は撮った座標のまま)。room.json の形は本物が届くまで仮定(glbBoxes.mjs と同じ)。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flatten16 } from './glbBoxes.mjs';

export const PERSON = { radius: 0.35, height: 1.8, minDoorWidth: 0.72 };
const CELL = 0.05;

/** 列優先の 4x4 から、水平面の中の軸(x, z)と中心を取る。 */
function frame(matrix) {
  const m = flatten16(matrix);
  if (!m) return null;
  const xz = (a, b) => [m[a], m[b]];
  return { center: [m[12], m[14]], cols: [xz(0, 2), xz(4, 6), xz(8, 10)], y: m[13] };
}
const len = (v) => Math.hypot(v[0], v[1]);

/** 水平の箱(中心・軸 a・軸 b・半分の長さ)への、点の距離。中なら 0。 */
function distToBox(p, box) {
  let dx = p[0] - box.center[0], dz = p[1] - box.center[1];
  let inside = true, d2 = 0;
  for (const [axis, half] of [[box.a, box.ha], [box.b, box.hb]]) {
    const l = len(axis) || 1;
    const t = (dx * axis[0] + dz * axis[1]) / l;
    const over = Math.abs(t) - half;
    if (over > 0) { inside = false; d2 += over * over; }
  }
  return inside ? 0 : Math.sqrt(d2);
}

function floorBox(room) {
  const f = (room.floors ?? [])[0];
  const fr = f && frame(f.transform);
  if (!fr || !Array.isArray(f.dimensions)) return null;
  // 床は局所 y(または z)が水平の奥行き。水平で長いほうを選ぶ
  const depthAxis = len(fr.cols[1]) >= len(fr.cols[2]) ? fr.cols[1] : fr.cols[2];
  return { center: fr.center, a: fr.cols[0], ha: f.dimensions[0] / 2, b: depthAxis, hb: f.dimensions[1] / 2 };
}

function objectBoxes(room) {
  const out = [];
  for (const o of room.objects ?? []) {
    const fr = frame(o.transform);
    if (!fr || !Array.isArray(o.dimensions) || o.dimensions[1] < 0.1) continue; // 敷物のように低い物は塞がない
    out.push({ center: fr.center, a: fr.cols[0], ha: o.dimensions[0] / 2, b: fr.cols[2], hb: o.dimensions[2] / 2 });
  }
  return out;
}

/**
 * @param {{spawn:number[], room:object, person?:object}} args spawn は [x, z](水平)
 * @returns {{ok:boolean, spawnClearance:number|null, reachablePercent:number, doors:object[], problems:string[]}}
 */
export function checkClearance({ spawn, room, person = PERSON }) {
  const problems = [];
  const floor = floorBox(room);
  if (!floor) return { ok: false, spawnClearance: null, reachablePercent: 0, doors: [], problems: ['room.json の床が読めない'] };
  const objects = objectBoxes(room);
  const r = person.radius;

  const walkable = (p) => {
    if (distToBox(p, { ...floor, ha: floor.ha - r, hb: floor.hb - r }) > 0) return false; // 壁ぎわ
    return objects.every((b) => distToBox(p, b) >= r);
  };
  const clearance = (p) => Math.min(floor.ha, floor.hb, ...objects.map((b) => distToBox(p, b)));

  // 床の外接する四角から升目を作る
  const reach = Math.hypot(floor.ha, floor.hb);
  const cells = Math.ceil((reach * 2) / CELL) + 1;
  const toPoint = (i, j) => [floor.center[0] - reach + i * CELL, floor.center[1] - reach + j * CELL];
  const toCell = (p) => [Math.round((p[0] - floor.center[0] + reach) / CELL), Math.round((p[1] - floor.center[1] + reach) / CELL)];
  const grid = new Uint8Array(cells * cells); // 1: 歩ける
  let walkableCount = 0;
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      if (walkable(toPoint(i, j))) { grid[i * cells + j] = 1; walkableCount += 1; }
    }
  }

  const seen = new Uint8Array(cells * cells);
  const [si, sj] = toCell(spawn);
  const spawnOk = si >= 0 && sj >= 0 && si < cells && sj < cells && grid[si * cells + sj] === 1;
  const spawnClearance = Number(clearance(spawn).toFixed(2));
  let reached = 0;
  if (!spawnOk) {
    problems.push(`立つ位置が家具や壁に近すぎる(最も近い物まで ${spawnClearance} m、必要 ${r} m)`);
  } else {
    const stack = [[si, sj]];
    seen[si * cells + sj] = 1;
    while (stack.length > 0) {
      const [i, j] = stack.pop();
      reached += 1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cells || nj >= cells) continue;
        const k = ni * cells + nj;
        if (grid[k] === 1 && seen[k] === 0) { seen[k] = 1; stack.push([ni, nj]); }
      }
    }
  }
  const reachablePercent = walkableCount === 0 ? 0 : Math.round((reached / walkableCount) * 100);
  if (spawnOk && reachablePercent < 90) problems.push(`歩ける床のうち立つ位置から行けるのは ${reachablePercent}%(家具で床が分かれている)`);

  const doors = (room.doors ?? []).map((d, idx) => {
    const fr = frame(d.transform);
    const width = Array.isArray(d.dimensions) ? d.dimensions[0] : 0;
    // ドアは壁の中なので、壁ぎわの塞ぎより内側 0.8 m 以内に、行ける升目があるか
    let reachable = false;
    if (fr && spawnOk) {
      const [ci, cj] = toCell(fr.center);
      const span = Math.ceil(0.8 / CELL);
      for (let i = Math.max(0, ci - span); i <= Math.min(cells - 1, ci + span) && !reachable; i += 1) {
        for (let j = Math.max(0, cj - span); j <= Math.min(cells - 1, cj + span); j += 1) {
          if (seen[i * cells + j] === 1) { reachable = true; break; }
        }
      }
    }
    if (width < person.minDoorWidth) problems.push(`ドア ${idx} の幅 ${width} m が通れる幅 ${person.minDoorWidth} m に足りない`);
    if (!reachable) problems.push(`ドア ${idx} まで立つ位置から歩いて行けない`);
    return { index: idx, width, reachable };
  });

  return { ok: problems.length === 0, spawnClearance, reachablePercent, doors, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const id = process.argv[2];
  if (!id) { console.error('使い方: node place/tools/clearance.mjs <places の id>'); process.exit(2); }
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'places', id);
  const roomPath = join(dir, 'scan', 'room.json');
  if (!existsSync(roomPath)) { console.log(`${id}: scan/room.json が無いので、通れるかは調べない`); process.exit(0); }
  const place = JSON.parse(readFileSync(join(dir, 'place.json'), 'utf8'));
  const res = checkClearance({ spawn: [place.spawn.position[0], place.spawn.position[2]], room: JSON.parse(readFileSync(roomPath, 'utf8')) });
  console.log(`${res.ok ? '通れる' : '通れない'}: 立つ位置の余裕 ${res.spawnClearance} m、行ける床 ${res.reachablePercent}%、ドア ${res.doors.length} 枚${res.problems.length ? '\n  - ' + res.problems.join('\n  - ') : ''}`);
  process.exit(res.ok ? 0 : 1);
}
