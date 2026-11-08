// ノリー(3D)のほっぺの試験(CB1)。本人の指摘(11-08): ほっぺの赤い丸が、ほっぺではない所(あごの角)についていて、可愛くない。
// 直し: 目の下の、ふっくらした所(中心 x ±0.092・高さ 0.712)へ、ふんわり消える桃色のぼかしをのせた(creator/builders/norrie_d.py の CHEEK_*)。
// この試験は characters/norrie/model.glb と motions/*.glb の中の点を読んで、次を数える:
//   1. ほっぺが、決めた「ほっぺの場所」の内にある(中心・大きさ・左右対称・目や口との間・桃色の材質)
//   2. ほっぺが頭の骨 100% で付き、動きのどのコマでも、顔の仮面との間が変わらない(頭と一緒に動く)
//   3. 動き 5 つ(おじぎ・うなずき・手をふる・待機・話す)のどのコマでも、ほっぺが顔・頭・腕・蝶ネクタイと交わらない
// 座標は glTF(x 横・y 上・z 前)。builder(Blender)の z は、ここでは y。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../characters/norrie/', import.meta.url);
const MOTIONS = ['bow', 'idle', 'nod', 'talk', 'wave'];
const SOFT_RATIO = 0.675; // ぼかしの外の半径に対する「濃さが半分になる線」の割合(builder の CHEEK_HARD 0.35 から)
const FACE_PARTS = ['Head', 'Eyes', 'Mouth', 'Tooth', 'nose', 'nose_line', 'mask', 'mask_line', 'BowWings', 'BowKnot', 'arm_L_part', 'arm_R_part'];

// ---------------- glb を読む ----------------
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CTYPE = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };

function readGlb(url) {
  const b = readFileSync(url);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = b.subarray(20 + jsonLen + 8);
  const elem = (off, t) => (t === 5126 ? bin.readFloatLE(off) : t === 5125 ? bin.readUInt32LE(off) : t === 5123 ? bin.readUInt16LE(off) : bin.readUInt8(off));
  const accessor = (i) => {
    const a = json.accessors[i];
    const n = COMP[a.type];
    const T = CTYPE[a.componentType];
    const out = new T(a.count * n);
    if (a.bufferView !== undefined) {
      const bv = json.bufferViews[a.bufferView];
      const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const stride = bv.byteStride ?? n * T.BYTES_PER_ELEMENT;
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = elem(off + k * stride + c * T.BYTES_PER_ELEMENT, a.componentType);
    }
    return out;
  };
  return { json, accessor };
}

// ---------------- 行列(列が先の 4x4) ----------------
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function compose(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  let k0 = 1 - t, k1 = t;
  if (d < 0.9995) {
    const th = Math.acos(d);
    k0 = Math.sin((1 - t) * th) / Math.sin(th);
    k1 = Math.sin(t * th) / Math.sin(th);
  }
  const q = a.map((v, i) => v * k0 + bb[i] * k1);
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}

// ---------------- 骨組みと動き ----------------
const MODEL = readGlb(new URL('model.glb', ROOT));
const NODES = MODEL.json.nodes;
const PARENT = new Map();
NODES.forEach((n, i) => (n.children ?? []).forEach((c) => PARENT.set(c, i)));
const SKIN = MODEL.json.skins[0];
const IBM = MODEL.accessor(SKIN.inverseBindMatrices);
const nodeIndex = (name) => NODES.findIndex((n) => n.name === name);
const jointName = (j) => NODES[SKIN.joints[j]].name;

/** 動きの GLB を読む: 節の名前 → { translation|rotation|scale: { times, values } } */
function readMotion(name) {
  const g = readGlb(new URL(`motions/${name}.glb`, ROOT));
  const anim = g.json.animations[0];
  const byName = new Map();
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const nm = g.json.nodes[ch.target.node].name;
    const rec = byName.get(nm) ?? {};
    rec[ch.target.path] = { times: g.accessor(s.input), values: g.accessor(s.output), step: s.interpolation === 'STEP' };
    byName.set(nm, rec);
  }
  const times = Array.from(Object.values(Object.fromEntries(byName)).find((r) => r.rotation).rotation.times);
  return { byName, times };
}

function sample(ch, t, n) {
  const { times, values, step } = ch;
  let i = 0;
  while (i < times.length - 2 && t >= times[i + 1]) i++;
  const t0 = times[i], t1 = times[Math.min(i + 1, times.length - 1)];
  const f = step || t1 === t0 ? 0 : Math.min(Math.max((t - t0) / (t1 - t0), 0), 1);
  const a = Array.from(values.subarray(i * n, i * n + n));
  const b = Array.from(values.subarray(Math.min(i + 1, times.length - 1) * n, Math.min(i + 1, times.length - 1) * n + n));
  return n === 4 ? slerp(a, b, f) : a.map((v, k) => v + (b[k] - v) * f);
}

/** 時刻 t の骨ごとの「皮の行列」(世界の行列 × 逆の結び目)。motion が null なら休みの形。override は { 節の名前: (局所の行列) => 局所の行列 } */
function skinMatrices(motion, t, override = {}) {
  const world = new Map();
  const localOf = (idx) => {
    const n = NODES[idx];
    const rec = motion?.byName.get(n.name) ?? {};
    const tr = rec.translation ? sample(rec.translation, t, 3) : (n.translation ?? [0, 0, 0]);
    const ro = rec.rotation ? sample(rec.rotation, t, 4) : (n.rotation ?? [0, 0, 0, 1]);
    const sc = rec.scale ? sample(rec.scale, t, 3) : (n.scale ?? [1, 1, 1]);
    const m = compose(tr, ro, sc);
    return override[n.name] ? override[n.name](m) : m;
  };
  const worldOf = (idx) => {
    if (world.has(idx)) return world.get(idx);
    const l = localOf(idx);
    const p = PARENT.get(idx);
    const w = p === undefined ? l : mul(worldOf(p), l);
    world.set(idx, w);
    return w;
  };
  return SKIN.joints.map((nodeIdx, j) => mul(worldOf(nodeIdx), Array.from(IBM.subarray(j * 16, j * 16 + 16))));
}

/** 節(名前)の板ごとの { pos(休み), joints, weights, idx(三角形), mat 名 } */
function primsOf(nodeName) {
  const idx = nodeIndex(nodeName);
  assert.ok(idx >= 0, `節 ${nodeName} が model.glb に無い`);
  const mesh = MODEL.json.meshes[NODES[idx].mesh];
  return mesh.primitives.map((p) => ({
    pos: MODEL.accessor(p.attributes.POSITION),
    joints: MODEL.accessor(p.attributes.JOINTS_0),
    weights: MODEL.accessor(p.attributes.WEIGHTS_0),
    tris: MODEL.accessor(p.indices),
    material: MODEL.json.materials[p.material]?.name,
    uv: p.attributes.TEXCOORD_0,
    prim: p,
  }));
}

function skinned(prim, mats) {
  const n = prim.pos.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = prim.pos[i * 3], y = prim.pos[i * 3 + 1], z = prim.pos[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = prim.weights[i * 4 + k];
      if (w === 0) continue;
      const [px, py, pz] = apply(mats[prim.joints[i * 4 + k]], x, y, z);
      ox += w * px; oy += w * py; oz += w * pz;
    }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
  }
  return out;
}

// ---------------- 三角形どうしの交わり(分離軸) ----------------
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const TOUCH = 1e-7; // これ以下の接し方は「交わらない」(0.1 µm)

/** 2 つの三角形が(接するだけでなく)めり込んで交わるか */
function trisIntersect(A, B) {
  const ea = [sub3(A[1], A[0]), sub3(A[2], A[1]), sub3(A[0], A[2])];
  const eb = [sub3(B[1], B[0]), sub3(B[2], B[1]), sub3(B[0], B[2])];
  const na = cross3(ea[0], ea[1]);
  const nb = cross3(eb[0], eb[1]);
  const axes = [na, nb];
  for (const x of ea) for (const y of eb) axes.push(cross3(x, y));
  for (const x of ea) axes.push(cross3(na, x));
  for (const x of eb) axes.push(cross3(nb, x));
  for (const ax of axes) {
    const l = Math.hypot(...ax);
    if (l < 1e-12) continue;
    const u = [ax[0] / l, ax[1] / l, ax[2] / l];
    const pa = A.map((p) => dot3(p, u));
    const pb = B.map((p) => dot3(p, u));
    if (Math.max(...pa) <= Math.min(...pb) + TOUCH || Math.max(...pb) <= Math.min(...pa) + TOUCH) return false;
  }
  return true;
}

function boxOf(P, tris, i) {
  const m = [1e9, 1e9, 1e9], M = [-1e9, -1e9, -1e9];
  for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
    const v = P[tris[i * 3 + k] * 3 + c];
    if (v < m[c]) m[c] = v;
    if (v > M[c]) M[c] = v;
  }
  return [m, M];
}
const boxHit = (a, b, pad) => [0, 1, 2].every((c) => a[0][c] <= b[1][c] + pad && b[0][c] <= a[1][c] + pad);
const triOf = (P, tris, i) => [0, 1, 2].map((k) => [P[tris[i * 3 + k] * 3], P[tris[i * 3 + k] * 3 + 1], P[tris[i * 3 + k] * 3 + 2]]);

/** 板 a(点 PA)と板 b(点 PB)の、交わる三角形の組の数 */
function countOverlaps(a, PA, b, PB) {
  const ba = Array.from({ length: a.tris.length / 3 }, (_, i) => boxOf(PA, a.tris, i));
  let n = 0;
  for (let j = 0; j < b.tris.length / 3; j++) {
    const bj = boxOf(PB, b.tris, j);
    let tb = null;
    for (let i = 0; i < ba.length; i++) {
      if (!boxHit(ba[i], bj, 0)) continue;
      tb ??= triOf(PB, b.tris, j);
      if (trisIntersect(triOf(PA, a.tris, i), tb)) n++;
    }
  }
  return n;
}

// ---------------- 形の数え ----------------
const bounds = (P) => {
  const m = [1e9, 1e9, 1e9], M = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length / 3; i++) for (let k = 0; k < 3; k++) {
    m[k] = Math.min(m[k], P[i * 3 + k]);
    M[k] = Math.max(M[k], P[i * 3 + k]);
  }
  return { m, M };
};
const centroid = (P) => {
  const c = [0, 0, 0];
  const n = P.length / 3;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k] / n;
  return c;
};

/** 片側(左 = +x)のほっぺの、濃さ半分の楕円(正面から見た x・y の中心と半径) */
function halfEllipse(sign) {
  const [p] = primsOf(sign > 0 ? 'cheek_L' : 'cheek_R');
  const { m, M } = bounds(p.pos);
  return { cx: (m[0] + M[0]) / 2, cy: (m[1] + M[1]) / 2, rx: ((M[0] - m[0]) / 2) * SOFT_RATIO, ry: ((M[1] - m[1]) / 2) * SOFT_RATIO, outer: { w: M[0] - m[0], h: M[1] - m[1] } };
}
const ellipseMetric = (e, x, y) => ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2; // 1 より小さければ内

// ================= 1. ほっぺの場所 =================
test('ほっぺは、目の下のふっくらした所(中心 |x| 0.085〜0.10・高さ 0.70〜0.725)に、左右対称にある', () => {
  const L = halfEllipse(1);
  const R = halfEllipse(-1);
  for (const [name, e] of [['左', L], ['右', R]]) {
    assert.ok(Math.abs(e.cx) >= 0.085 && Math.abs(e.cx) <= 0.1, `${name}のほっぺの中心 x ${e.cx.toFixed(4)}`);
    assert.ok(e.cy >= 0.7 && e.cy <= 0.725, `${name}のほっぺの中心の高さ ${e.cy.toFixed(4)}`);
  }
  assert.ok(Math.abs(L.cx + R.cx) < 1e-4, `左右の中心 x が対称でない: ${L.cx} と ${R.cx}`);
  assert.ok(Math.abs(L.cy - R.cy) < 1e-4, '左右の中心の高さが違う');
});

test('ほっぺの大きさ: 見える(濃さ半分の)楕円は、横 0.027〜0.036・縦 0.020〜0.028(前の硬い丸 0.024×0.016 の 1.5〜2 倍の幅)', () => {
  for (const s of [1, -1]) {
    const e = halfEllipse(s);
    assert.ok(e.rx >= 0.027 && e.rx <= 0.036, `横の半径 ${e.rx.toFixed(4)}`);
    assert.ok(e.ry >= 0.02 && e.ry <= 0.028, `縦の半径 ${e.ry.toFixed(4)}`);
  }
});

test('ほっぺは、やわらかい桃色の絵(Blush_soft)で、縁へ消える板(224 三角形・絵の座標つき)', () => {
  for (const nm of ['cheek_L', 'cheek_R']) {
    const [p] = primsOf(nm);
    assert.equal(p.material, 'Blush_soft', `${nm} の材質`);
    assert.ok(p.uv !== undefined, `${nm} に絵の座標が無い`);
    assert.equal(p.tris.length / 3, 224, `${nm} の三角形の数`);
  }
  assert.equal(MODEL.json.images.length >= 1, true, '桃色の絵が GLB に入っている');
  const mat = MODEL.json.materials.find((m) => m.name === 'Blush_soft');
  assert.equal(mat.alphaMode, 'BLEND', '縁が消えるように、半透明で描く');
  assert.ok(mat.pbrMetallicRoughness.baseColorTexture, '桃色は絵の色(ぼかしの濃さは絵の透明度)');
});

test('目の下端から、見えるほっぺの楕円まで 0.025 m 以上あく(目に近づきすぎない)', () => {
  const e = halfEllipse(1);
  const eyes = primsOf('Eyes')[0];
  let d = Infinity;
  for (let i = 0; i < eyes.pos.length / 3; i++) {
    if (eyes.pos[i * 3] <= 0) continue; // 左目
    for (let a = 0; a < 360; a += 2) {
      const x = e.cx + e.rx * Math.cos((a * Math.PI) / 180);
      const y = e.cy + e.ry * Math.sin((a * Math.PI) / 180);
      d = Math.min(d, Math.hypot(eyes.pos[i * 3] - x, eyes.pos[i * 3 + 1] - y));
    }
  }
  assert.ok(d >= 0.025, `目とほっぺの間 ${(d * 1000).toFixed(1)} mm(25 mm 以上いる)`);
});

test('口を、広げた(mouth_wide 1)・丸めた(mouth_o 1)・開いた(mouth_open 1)・笑った(mouth_wide 0.9)形にしても、正面では、ほっぺの楕円と重ならない', () => {
  const e = halfEllipse(1);
  const mouth = primsOf('Mouth')[0];
  const names = MODEL.json.meshes[NODES[nodeIndex('Mouth')].mesh].extras.targetNames;
  const T = names.map((_, i) => MODEL.accessor(mouth.prim.targets[i].POSITION));
  const ix = (n) => names.indexOf(n);
  const shapes = { ふだん: {}, 開く: { mouth_open: 1 }, 広げる: { mouth_wide: 1 }, 丸める: { mouth_o: 1 }, 笑う: { mouth_wide: 0.9, mouth_open: 0.7 } };
  for (const [label, w] of Object.entries(shapes)) {
    let worst = Infinity;
    for (let i = 0; i < mouth.pos.length / 3; i++) {
      let x = mouth.pos[i * 3], y = mouth.pos[i * 3 + 1];
      for (const [n, v] of Object.entries(w)) {
        x += T[ix(n)][i * 3] * v;
        y += T[ix(n)][i * 3 + 1] * v;
      }
      worst = Math.min(worst, ellipseMetric(e, Math.abs(x), y));
    }
    assert.ok(worst > 1.2, `${label}: 口がほっぺの楕円に近すぎる(楕円の内側は 1 未満、いま ${worst.toFixed(2)})`);
  }
});

// ================= 2. 頭と一緒に動く =================
test('ほっぺは頭の骨 100% で付いている', () => {
  for (const nm of ['cheek_L', 'cheek_R']) {
    const [p] = primsOf(nm);
    for (let i = 0; i < p.pos.length / 3; i++) {
      assert.equal(jointName(p.joints[i * 4]), 'head', `${nm} の点 ${i} が頭の骨でない`);
      assert.ok(p.weights[i * 4] >= 0.9999, `${nm} の点 ${i} の頭の骨の重み ${p.weights[i * 4]}`);
    }
  }
});

test('休みの形では、皮の行列は元の点を動かさない(この試験の骨の計算が合っている印)', () => {
  const mats = skinMatrices(null, 0);
  for (const nm of ['cheek_L', 'Head', 'mask']) {
    for (const p of primsOf(nm)) {
      const q = skinned(p, mats);
      for (let i = 0; i < q.length; i++) assert.ok(Math.abs(q[i] - p.pos[i]) < 1e-4, `${nm}: 休みで点が動く`);
    }
  }
});

test('頭を 30° まわすと、ほっぺは顔の仮面と一緒に動き、間の距離は変わらない', () => {
  const yaw = (m) => mul(m, compose([0, 0, 0], [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)], [1, 1, 1]));
  const rest = skinMatrices(null, 0);
  const turned = skinMatrices(null, 0, { head: yaw });
  const dist = (mats, a, b) => {
    const ca = centroid(skinned(primsOf(a)[0], mats));
    const cb = centroid(skinned(primsOf(b)[0], mats));
    return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
  };
  for (const c of ['cheek_L', 'cheek_R']) {
    const moved = Math.hypot(...centroid(skinned(primsOf(c)[0], rest)).map((v, k) => v - centroid(skinned(primsOf(c)[0], turned))[k]));
    assert.ok(moved > 0.01, `${c}: 頭をまわしても動かない(${(moved * 1000).toFixed(1)} mm)`);
    assert.ok(Math.abs(dist(rest, c, 'mask') - dist(turned, c, 'mask')) < 1e-5, `${c}: 仮面との距離が変わった`);
  }
});

// ================= 3. 動きの中でめり込まない =================
const MOTION_DATA = Object.fromEntries(MOTIONS.map((m) => [m, readMotion(m)]));

test('動き 5 つのどのコマでも、ほっぺは仮面との距離がほぼ変わらず(頭の大きさの 2% まで。おじぎは頭を少しつぶす。頭と一緒に動く)、頭を動かす動きでは実際に動く', () => {
  let movedMax = 0;
  for (const name of MOTIONS) {
    const mo = MOTION_DATA[name];
    let ref = null;
    let first = null;
    for (let i = 0; i < mo.times.length; i += 2) {
      const mats = skinMatrices(mo, mo.times[i]);
      const cc = centroid(skinned(primsOf('cheek_L')[0], mats));
      const cm = centroid(skinned(primsOf('mask')[0], mats));
      const d = Math.hypot(cc[0] - cm[0], cc[1] - cm[1], cc[2] - cm[2]);
      ref ??= d;
      first ??= cc;
      assert.ok(Math.abs(d - ref) < 2e-2 * ref, `${name} のコマ ${i}: ほっぺと仮面の距離が 2% を超えて変わった(${d} と ${ref})`);
      movedMax = Math.max(movedMax, Math.hypot(cc[0] - first[0], cc[1] - first[1], cc[2] - first[2]));
    }
  }
  assert.ok(movedMax > 0.005, `動きの中でほっぺが 5 mm も動かない(${movedMax}): この試験が空振り`);
});

/** 動き 1 つの、ほっぺ × 顔の部品の、めり込んだ三角形の組の数(2 コマおき)。shift はほっぺの点を前後にずらす負の対照 */
function overlapsIn(motionName, shift = 0) {
  const mo = MOTION_DATA[motionName];
  const cheeks = ['cheek_L', 'cheek_R'].map((n) => primsOf(n)[0]);
  const others = FACE_PARTS.flatMap((n) => primsOf(n).map((p) => ({ n, p })));
  let total = 0;
  const detail = {};
  for (let i = 0; i < mo.times.length; i += 2) {
    const mats = skinMatrices(mo, mo.times[i]);
    const cp = cheeks.map((c) => {
      const q = skinned(c, mats);
      for (let k = 2; k < q.length; k += 3) q[k] += shift;
      return q;
    });
    const op = others.map(({ p }) => skinned(p, mats));
    cheeks.forEach((c, ci) => {
      others.forEach(({ n, p }, oi) => {
        const k = countOverlaps(c, cp[ci], p, op[oi]);
        if (k) detail[`${ci ? 'cheek_R' : 'cheek_L'}|${n}@${i}`] = k;
        total += k;
      });
    });
    const k = countOverlaps(cheeks[0], cp[0], cheeks[1], cp[1]);
    if (k) detail[`cheek_L|cheek_R@${i}`] = k;
    total += k;
  }
  return { total, detail };
}

for (const name of MOTIONS) {
  test(`動き ${name}: ほっぺは、顔・頭・腕・蝶ネクタイのどの部品とも、どのコマでもめり込まない(0 組)`, () => {
    const { total, detail } = overlapsIn(name);
    assert.equal(total, 0, `めり込み ${total} 組: ${JSON.stringify(detail)}`);
  });
}

test('負の対照: ほっぺを 6 mm 奥へ沈める(持ち上げ 4.2 mm の板が面にめり込む)と、めり込みを数えられる(数え方が空振りでない印)', () => {
  const { total } = overlapsIn('idle', -0.006);
  assert.ok(total > 50, `沈めても数えられない(${total})`);
});
