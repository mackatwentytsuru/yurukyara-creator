// 本人の撮影がまだないあいだの試し用に、手で寸法を決めた簡単な部屋を作る。
//   node tools/make_test_room.mjs   → places/test_room/room.glb と place.json
// 部屋: 5m x 4m、高さ 2.6m(天井なし)。入口は南の壁(z=+2)、x=1.0 に幅 0.9m・高さ 2.0m。
// 机: 幅 1.2m・奥行 0.7m・高さ 0.75m を (-1.4, -1.2) に。
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'places', 'test_room');
mkdirSync(outDir, { recursive: true });

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('test_room');

const materials = {};
const material = (name, rgb) => {
  materials[name] ??= doc
    .createMaterial(name)
    .setBaseColorFactor([...rgb, 1])
    .setRoughnessFactor(0.9)
    .setMetallicFactor(0);
  return materials[name];
};

// 直方体(中心 c、大きさ s)。面ごとに法線を持たせるので 24 頂点。
function boxPrimitive([cx, cy, cz], [sx, sy, sz], mat) {
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
    f.v.forEach((p) => { pos.push(p[0] + cx, p[1] + cy, p[2] + cz); nor.push(...f.n); });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(nor)))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setMaterial(mat);
}

// 名前つきの物体を 1 つ足す(landmark や後の位置合わせで名前を使えるように)
function add(name, center, size, mat) {
  const mesh = doc.createMesh(name).addPrimitive(boxPrimitive(center, size, mat));
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

const wall = material('wall', [0.86, 0.84, 0.8]);
const floor = material('floor', [0.55, 0.42, 0.3]);
const wood = material('desk', [0.4, 0.27, 0.16]);
const door = material('door_frame', [0.2, 0.45, 0.7]);

const W = 5, D = 4, H = 2.6, T = 0.1;
add('floor', [0, -0.025, 0], [W + 2 * T, 0.05, D + 2 * T], floor);
add('wall_north', [0, H / 2, -D / 2 - T / 2], [W + 2 * T, H, T], wall);
add('wall_west', [-W / 2 - T / 2, H / 2, 0], [T, H, D], wall);
add('wall_east', [W / 2 + T / 2, H / 2, 0], [T, H, D], wall);

// 南の壁は入口で割る: 入口は x = 0.55〜1.45、高さ 2.0
const doorL = 0.55, doorR = 1.45, doorH = 2.0;
const southZ = D / 2 + T / 2;
add('wall_south_left', [(-W / 2 - T + doorL) / 2, H / 2, southZ], [doorL + W / 2 + T, H, T], wall);
add('wall_south_right', [(doorR + W / 2 + T) / 2, H / 2, southZ], [W / 2 + T - doorR, H, T], wall);
add('wall_south_top', [(doorL + doorR) / 2, (doorH + H) / 2, southZ], [doorR - doorL, H - doorH, T], wall);
// 入口の枠(青い細い柱)で入口の位置が絵でも分かるように
add('door_frame_left', [doorL - 0.03, doorH / 2, southZ], [0.06, doorH, T + 0.04], door);
add('door_frame_right', [doorR + 0.03, doorH / 2, southZ], [0.06, doorH, T + 0.04], door);

// 机
const dx = -1.4, dz = -1.2, topY = 0.75, topT = 0.04;
add('desk_top', [dx, topY - topT / 2, dz], [1.2, topT, 0.7], wood);
for (const [i, [lx, lz]] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]].entries()) {
  add(`desk_leg_${i}`, [dx + lx, (topY - topT) / 2, dz + lz], [0.05, topY - topT, 0.05], wood);
}

await new NodeIO().write(join(outDir, 'room.glb'), doc);

const place = {
  id: 'test_room',
  name: '試しの部屋',
  model: 'room.glb',
  scale_m: 1.0,
  floor_y: 0.0,
  spawn: { position: [0, 0, -0.5], yaw_deg: 0 },
  landmarks: [
    { name: '入口', position: [1.0, 0, 2.0], note: '青い枠のドア。お客さんはここから入ってくる' },
    { name: '机', position: [-1.4, 0.75, -1.2], note: '部屋の奥の左にある木の机。高さ 75cm' },
    { name: '奥の壁', position: [0, 1.3, -2.0], note: '入口の正面の壁' },
  ],
};
writeFileSync(join(outDir, 'place.json'), JSON.stringify(place, null, 2) + '\n', 'utf8');
console.log('書き出した:', outDir);
