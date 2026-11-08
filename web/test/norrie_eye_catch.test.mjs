// ノリーの目の「光」(白い丸 2 つ)が、目を閉じた時・笑う目の時に、顔の面の上へ出ないことの試験(NE1)。
// 本人の指摘(11-08): 目をつぶった時・笑顔の目元に、白い点々が出る。
// 原因: 光はシェイプキー eye_smile で「中心へ縮めて 8 mm 奥」へ隠していた。光は目の上 7 mm にあるので、happy(eye_smile 0.9)では
//   面の下 0.4 mm にしか届かず、面のでこぼこから白い点が出た。さらに、まばたき(縮めて 1 点)と笑顔(縮める動き)はシェイプキーの足し算で
//   重なるので、笑顔のまま目を閉じると 1 点が「裏返った小さな円板」に戻り、面の上 1.9 mm へ出た。
// 直し: 光は形を変えずに平行に 30 mm 奥へ隠す(creator/builders/norrie_d.py の CATCH_HIDE)。
// この試験は model.glb の中の点を読み、画面と同じ足し算(rigRuntime.js: 表情の重みの最大・まばたき)で、光の点が頭の面の上へ出ないかを数える。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../characters/norrie/', import.meta.url);
const SKIN_MARGIN = 0.003; // 笑顔・目を閉じた時、光は面より 3 mm 以上奥
const SHOWN_MIN = 0.003; // ふだん(目を開けた時)、光は面より 3 mm 以上上(この試験が空振りでない印)
const CATCH_VERTS = 55; // 光 1 つの頂点の数(3 輪 × 18 + 中心)

function readGlb(url) {
  const b = readFileSync(url);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart);
  const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const reader = (i) => {
    const a = json.accessors[i];
    const n = COMP[a.type];
    const out = a.componentType === 5126 ? new Float32Array(a.count * n) : a.componentType === 5125 ? new Uint32Array(a.count * n) : new Uint16Array(a.count * n);
    const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    const size = Ctor.BYTES_PER_ELEMENT;
    if (a.bufferView !== undefined) {
      const bv = json.bufferViews[a.bufferView];
      const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const stride = bv.byteStride ?? n * size;
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE ? readElem(bin, off + k * stride + c * size, a.componentType) : 0;
    }
    if (a.sparse) {
      const si = json.bufferViews[a.sparse.indices.bufferView];
      const sv = json.bufferViews[a.sparse.values.bufferView];
      for (let s = 0; s < a.sparse.count; s++) {
        const idx = readElem(bin, (si.byteOffset ?? 0) + (a.sparse.indices.byteOffset ?? 0) + s * ({ 5121: 1, 5123: 2, 5125: 4 }[a.sparse.indices.componentType]), a.sparse.indices.componentType);
        for (let c = 0; c < n; c++) out[idx * n + c] = readElem(bin, (sv.byteOffset ?? 0) + (a.sparse.values.byteOffset ?? 0) + (s * n + c) * size, a.componentType);
      }
    }
    return out;
  };
  return { json, reader };
}

function readElem(bin, off, type) {
  if (type === 5126) return bin.readFloatLE(off);
  if (type === 5125) return bin.readUInt32LE(off);
  if (type === 5123) return bin.readUInt16LE(off);
  return bin.readUInt8(off);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** 点 p から軸 a の逆向きに光線を撃ち、頭の面にいちばん先に当たる所までで、面より上(外)に何 m あるか。当たらなければ +Infinity(面の外) */
function aboveSkin(p, a, tris) {
  const o = [p[0] + a[0] * 0.1, p[1] + a[1] * 0.1, p[2] + a[2] * 0.1];
  const d = [-a[0], -a[1], -a[2]];
  let tMin = Infinity;
  for (const [v0, e1, e2] of tris) {
    const pv = cross(d, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) continue;
    const tv = sub(o, v0);
    const u = dot(tv, pv) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(tv, e1);
    const v = dot(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t > 0 && t < tMin) tMin = t;
  }
  return tMin === Infinity ? Infinity : tMin - 0.1;
}

function load() {
  const { json, reader } = readGlb(new URL('model.glb', ROOT));
  const meshes = json.meshes;
  const eyes = meshes.find((m) => m.name === 'Eyes');
  const headMesh = meshes.find((m) => m.name === 'head_core');
  const matName = (p) => json.materials[p.material].name;
  const inkPrim = eyes.primitives.find((p) => matName(p) === 'Ink');
  const catchPrim = eyes.primitives.find((p) => matName(p) === 'CatchWhite');
  const targetNames = eyes.extras.targetNames;
  const tb = targetNames.indexOf('eye_blink');
  const ts = targetNames.indexOf('eye_smile');
  const hp = headMesh.primitives[0];
  const HV = reader(hp.attributes.POSITION);
  const HI = reader(hp.indices);
  const tris = [];
  for (let i = 0; i < HI.length; i += 3) {
    const v0 = [HV[HI[i] * 3], HV[HI[i] * 3 + 1], HV[HI[i] * 3 + 2]];
    const v1 = [HV[HI[i + 1] * 3], HV[HI[i + 1] * 3 + 1], HV[HI[i + 1] * 3 + 2]];
    const v2 = [HV[HI[i + 2] * 3], HV[HI[i + 2] * 3 + 1], HV[HI[i + 2] * 3 + 2]];
    tris.push([v0, sub(v1, v0), sub(v2, v0)]);
  }
  const lensSmile = reader(inkPrim.targets[ts].POSITION);
  const lensRest = reader(inkPrim.attributes.POSITION);
  const catchRest = reader(catchPrim.attributes.POSITION);
  const catchBlink = reader(catchPrim.targets[tb].POSITION);
  const catchSmile = reader(catchPrim.targets[ts].POSITION);
  return { tris, lensSmile, lensRest, catchRest, catchBlink, catchSmile };
}

const character = JSON.parse(readFileSync(new URL('character.json', ROOT), 'utf8'));
const G = load();

/** 目ごとの軸(頭の面の外向き): 黒いレンズを 25 mm 奥へ動かす向きの逆 */
function eyeAxis(sign) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < G.lensRest.length / 3; i++) {
    const d = [G.lensSmile[i * 3], G.lensSmile[i * 3 + 1], G.lensSmile[i * 3 + 2]];
    const len = Math.hypot(...d);
    if (Math.abs(len - 0.025) > 5e-4 || Math.sign(G.lensRest[i * 3]) !== sign) continue;
    sum[0] -= d[0];
    sum[1] -= d[1];
    sum[2] -= d[2];
    n++;
  }
  assert.ok(n > 100, `レンズの点が見つからない(${n})`);
  return unit(sum);
}

const chunks = () => {
  const n = G.catchRest.length / 3;
  assert.equal(n % CATCH_VERTS, 0, `光の頂点の数が 55 の倍数でない: ${n}`);
  const out = [];
  for (let c = 0; c < n / CATCH_VERTS; c++) {
    const ids = Array.from({ length: CATCH_VERTS }, (_, k) => c * CATCH_VERTS + k);
    const cx = ids.reduce((s, i) => s + G.catchRest[i * 3], 0) / CATCH_VERTS;
    out.push({ ids, sign: Math.sign(cx) });
  }
  return out;
};

const at = (i, wb, ws) => [0, 1, 2].map((k) => G.catchRest[i * 3 + k] + G.catchBlink[i * 3 + k] * wb + G.catchSmile[i * 3 + k] * ws);

/** 画面と同じ重みの足し算(rigRuntime.js): まばたきの値と、表情ごとの eye_blink の大きい方 / eye_smile は表情の重みの最大 */
function weightsOf(expr, blink) {
  const m = character.morphs?.[expr] ?? {};
  return { wb: Math.max(blink, m.eye_blink ?? 0), ws: m.eye_smile ?? 0 };
}

test('ふだん(目を開けた時)は、光が面の上に出ている(この試験が空振りでない印)', () => {
  for (const ch of chunks()) {
    const a = eyeAxis(ch.sign);
    const h = ch.ids.map((i) => aboveSkin(at(i, 0, 0), a, G.tris));
    assert.ok(Math.min(...h) >= SHOWN_MIN, `ふだんの光が面の近すぎ: 最小 ${(Math.min(...h) * 1000).toFixed(2)} mm`);
  }
});

test('笑う目(happy)の光は、目を開けていても、まばたきの途中でも閉じていても、面より 3 mm 以上奥にある', () => {
  const expressions = Object.keys(character.morphs ?? {}).filter((e) => (character.morphs[e].eye_smile ?? 0) > 0);
  assert.ok(expressions.length >= 1, '笑う目の表情が character.json に無い');
  for (const expr of expressions) {
    for (const blink of [0, 0.3, 0.5, 0.8, 1]) {
      const { wb, ws } = weightsOf(expr, blink);
      for (const ch of chunks()) {
        const a = eyeAxis(ch.sign);
        const worst = Math.max(...ch.ids.map((i) => aboveSkin(at(i, wb, ws), a, G.tris)));
        assert.ok(worst <= -SKIN_MARGIN, `${expr} まばたき ${blink}(目 ${ch.sign > 0 ? '左' : '右'}): 光が面の下 ${(-worst * 1000).toFixed(2)} mm しか届かない(3 mm 以上いる)`);
      }
    }
  }
});

test('目を完全に閉じた時(まばたき 1)は、光は 1 点に縮んで、面積が 0 になる', () => {
  for (const expr of ['neutral', ...Object.keys(character.morphs ?? {})]) {
    const { wb, ws } = weightsOf(expr, 1);
    if (ws > 0) continue; // 笑う目は、上の試験で面の奥へ隠れることを確かめる
    assert.equal(wb, 1, `${expr}: まばたき 1`);
    for (const ch of chunks()) {
      const pts = ch.ids.map((i) => at(i, wb, ws));
      const ext = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])));
      assert.ok(Math.max(...ext) < 1e-5, `${expr}: 閉じた目に光の面積が残る(${(Math.max(...ext) * 1000).toFixed(3)} mm)`);
    }
  }
});

test('光が笑顔で動く向きは、形を変えない平行移動(まばたきと足しても、縮めた 1 点が円板に戻らない)', () => {
  for (const ch of chunks()) {
    const d0 = [0, 1, 2].map((k) => G.catchSmile[ch.ids[0] * 3 + k]);
    for (const i of ch.ids) {
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(G.catchSmile[i * 3 + k] - d0[k]) < 1e-6, `光の笑顔の動きが点ごとに違う(点 ${i})`);
    }
  }
});
