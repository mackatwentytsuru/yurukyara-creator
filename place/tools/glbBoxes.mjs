// RoomPlan の room.json(壁・床・ドア・窓・家具それぞれの transform と寸法)だけから、箱でできた部屋の GLB を組み立てる。
// 本物の USDZ が Blender で読めなかったときの救済(ingest_roomscan.mjs が自動で使う)。形は箱のままで、色は種類ごとの単色。
// 座標は RoomPlan と同じ(m、y が上、右手系)なので、そのまま使える。
//
// room.json の形の前提(本物は未確認): CapturedRoom の Codable をそのまま JSON にした物。
//   floors / walls / doors / windows / openings / objects の配列、各要素に transform(列優先の 4x4。入れ子でも平らでもよい)と
//   dimensions([幅, 高さ, 奥行き])。面(床・壁・ドア・窓)は奥行きが 0 で、局所の x が幅、y が高さ、z が法線。
import { Document, NodeIO } from '@gltf-transform/core';

const COLORS = {
  floor: [0.62, 0.45, 0.3],
  wall: [0.9, 0.88, 0.84],
  door: [0.45, 0.3, 0.2],
  window: [0.72, 0.84, 0.92],
  object: [0.5, 0.36, 0.24],
};
// 面に与える厚み(m)。ドアと窓は壁より少し厚くして、両側から見えるようにする。
const THICKNESS = { floor: 0.05, wall: 0.1, door: 0.14, window: 0.14 };
const KEYS = { floors: 'floor', walls: 'wall', doors: 'door', windows: 'window', objects: 'object' };

/** 入れ子でも平らでも、数を順に集めて 16 個なら返す。 */
export function flatten16(t) {
  const out = [];
  const walk = (v) => (Array.isArray(v) ? v.forEach(walk) : out.push(Number(v)));
  walk(t);
  return out.length === 16 && out.every(Number.isFinite) ? out : null;
}

export function elementsFromRoomJson(room) {
  const els = [];
  for (const [key, kind] of Object.entries(KEYS)) {
    (room[key] ?? []).forEach((it, i) => {
      const matrix = flatten16(it.transform);
      const d = it.dimensions;
      if (!matrix || !Array.isArray(d) || d.length !== 3) return;
      const size = kind === 'object' ? [d[0], d[1], d[2]] : [d[0], d[1], THICKNESS[kind]];
      els.push({ name: `${kind}_${i}`, kind, matrix, size, rgb: COLORS[kind] });
    });
  }
  return els;
}

function boxPrimitive(doc, buffer, [sx, sy, sz], material) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach((f, i) => {
    f.v.forEach((p) => { pos.push(...p); nor.push(...f.n); });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nor)))
    .setIndices(acc('SCALAR', new Uint16Array(idx)))
    .setMaterial(material);
}

/** @returns {Promise<Uint8Array>} GLB のバイト列 */
export async function buildBoxGlb(elements) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('room');
  const mats = {};
  for (const el of elements) {
    mats[el.kind] ??= doc.createMaterial(el.kind).setBaseColorFactor([...el.rgb, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
    const mesh = doc.createMesh(el.name).addPrimitive(boxPrimitive(doc, buffer, el.size, mats[el.kind]));
    scene.addChild(doc.createNode(el.name).setMesh(mesh).setMatrix(el.matrix));
  }
  return new NodeIO().writeBinary(doc);
}
