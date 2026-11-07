// しつかん(3D の材質)の決まりの試験(B5M)。three を読まない部品だけ(stage/shitsukan.js)。画面の中の確かめは shitsukan_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHITSUKAN, SHITSUKAN_IDS, DEFAULT_SHITSUKAN, STORE_KEY, LOOKS, LIGHT, FUR_LOOK, TILE_M,
  normalizeShitsukan, pickShitsukan, readStored, writeStored, characterDefault, labelOf, subOf, heavyNoteWanted,
  isFlatPaint, classifyMaterial, cylinderUv, smoothNormals, fleeceHeight, normalFromHeight, ormFromHeight,
} from '../src/stage/shitsukan.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};

test('4 つの しつかん は いつもの・ぬの・け・つるつる の順で、既定は ぬの', () => {
  assert.deepEqual(SHITSUKAN.map((s) => s.label), ['いつもの', 'ぬの', 'け', 'つるつる']);
  assert.deepEqual(SHITSUKAN.map((s) => s.id), SHITSUKAN_IDS);
  assert.equal(DEFAULT_SHITSUKAN, 'fabric');
  assert.equal(labelOf('fabric'), 'ぬの');
});

test('書かれ方のゆれを読む(作る道が日本語で書いても): 布・ぬの・毛・け・つるつる・いつもの', () => {
  for (const [v, id] of [['ぬの', 'fabric'], ['布', 'fabric'], ['fabric', 'fabric'], [' Fabric ', 'fabric'], ['け', 'fur'], ['毛', 'fur'], ['もこもこ', 'fur'], ['つるつる', 'vinyl'], ['vinyl', 'vinyl'], ['いつもの', 'drawn'], ['drawn', 'drawn']]) {
    assert.equal(normalizeShitsukan(v), id, v);
  }
  for (const v of ['', 'metal', null, undefined, 3, {}]) assert.equal(normalizeShitsukan(v), null);
});

test('決める順: URL → このブラウザで覚えた物 → character.json の looks.3d.material → ぬの', () => {
  const json = { id: 'norrie', looks: { '3d': { at: 'top', material: 'vinyl' } } };
  assert.deepEqual(pickShitsukan({}), { id: 'fabric', from: 'default' });
  assert.deepEqual(pickShitsukan({ json }), { id: 'vinyl', from: 'character' });
  assert.deepEqual(pickShitsukan({ json, stored: 'fur' }), { id: 'fur', from: 'stored' });
  assert.deepEqual(pickShitsukan({ json, stored: 'fur', url: 'いつもの' }), { id: 'drawn', from: 'url' });
  assert.deepEqual(pickShitsukan({ json: { looks: { '3d': { material: '???' } } } }), { id: 'fabric', from: 'default' }); // 知らない値は既定
  assert.equal(characterDefault({ looks: { '3d': { material: '毛' } } }), 'fur');
  assert.equal(characterDefault({}), null);
});

test('端末の段では変えない: 決める関数は段を受け取らない(どの端末でも同じ見た目)', () => {
  // pickShitsukan の引数に段は無い。毛の「おもいよ」だけが段で変わる(見た目ではなく知らせ)
  assert.equal(pickShitsukan.length, 0);
  assert.equal(heavyNoteWanted('high'), false);
  for (const t of ['mid', 'low', 'xr', undefined]) assert.equal(heavyNoteWanted(t), true);
  assert.equal(subOf('fur', { heavyNote: true }), 'おもいよ');
  assert.equal(subOf('fur', { heavyNote: false }), 'もこもこ');
  assert.equal(subOf('fabric', { heavyNote: true }), 'ふわふわ'); // 重くない物は変えない
  assert.ok(FUR_LOOK.layers > 0 && Number.isInteger(FUR_LOOK.layers)); // 毛の層の数は 1 つ(段の furLayers を使わない)
});

test('このブラウザで、キャラごとに覚える(壊れた値・使えない保存先でも止まらない)', () => {
  const s = memory();
  assert.equal(readStored(s, 'norrie'), null);
  assert.equal(writeStored(s, 'norrie', 'fur'), true);
  assert.equal(writeStored(s, 'mikan', 'vinyl'), true);
  assert.equal(readStored(s, 'norrie'), 'fur');
  assert.equal(readStored(s, 'mikan'), 'vinyl');
  assert.deepEqual(JSON.parse(s.raw.get(STORE_KEY)), { norrie: 'fur', mikan: 'vinyl' });
  assert.equal(writeStored(s, 'norrie', 'metal'), false); // 知らない id は書かない
  assert.equal(writeStored(s, '', 'fur'), false);
  s.raw.set(STORE_KEY, '{壊れた');
  assert.equal(readStored(s, 'norrie'), null);
  assert.equal(writeStored(s, 'norrie', 'drawn'), true); // 壊れた値は上書きして直す
  assert.equal(readStored(s, 'norrie'), 'drawn');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStored(broken, 'norrie'), null);
  assert.equal(writeStored(broken, 'norrie', 'fur'), false);
  assert.equal(readStored(null, 'norrie'), null);
});

test('平らな塗り(発光 = 絵の色 × 0.92・地の色 = × 0.22)を見分け、絵の色を発光から戻す', () => {
  // ノリーの茶色(GLB の数字そのまま)
  const brown = { name: 'Brown', meshName: 'Head', color: [0.018, 0.011, 0.01], emissive: [0.074, 0.047, 0.042], emissiveIntensity: 1 };
  assert.equal(isFlatPaint(brown.color, brown.emissive), true);
  const r = classifyMaterial(brown);
  assert.equal(r.kind, 'body');
  assert.ok(Math.abs(r.drawing[0] - 0.074 / 0.92) < 1e-6);
  assert.equal(r.glow, null); // 平らな塗りの発光は、差しかえた後に残さない(光で色を出す)
  // ロボの光る所(地の色より発光が弱い)は平らな塗りではない → 光ったまま残す
  const glow = classifyMaterial({ name: 'Glow', color: [1, 0.855, 0.552], emissive: [0.8, 0.684, 0.442] });
  assert.equal(glow.kind, 'body');
  assert.deepEqual(glow.drawing, [1, 0.855, 0.552]);
  assert.deepEqual(glow.glow, [0.8, 0.684, 0.442]);
  // 明るさの持ち上げだけの材質(元の発光が無い)は、地の色が絵の色
  const orange = classifyMaterial({ name: 'Orange', color: [1, 0.254, 0.012], emissive: [0, 0, 0] });
  assert.deepEqual([orange.kind, orange.drawing, orange.glow], ['body', [1, 0.254, 0.012], null]);
  assert.equal(isFlatPaint([0.5, 0.5, 0.5], [0, 0, 0]), false);
  assert.equal(isFlatPaint([0, 0, 0], [0.97, 0.97, 0.97]), false); // 地の色が黒で発光だけ(目の光)は平らな塗りの形ではない
});

test('部品の分け方: 輪郭の殻は隠す・顔の部品と線は残す・体と小物は差しかえる', () => {
  const kinds = (list) => list.map((m) => classifyMaterial(m).kind);
  assert.deepEqual(
    kinds([
      { name: 'Outline', color: [0, 0, 0] },
      { name: 'Brown', meshName: 'ol_Head', color: [0.018, 0.011, 0.01], emissive: [0.074, 0.047, 0.042] },
      { name: 'Ink', color: [0.001, 0.001, 0.001], emissive: [0.002, 0.002, 0.002] },
      { name: 'CatchWhite', color: [0, 0, 0], emissive: [0.973, 0.973, 0.973] },
      { name: 'ToothWhite', color: [0, 0, 0], emissive: [0.973, 0.973, 0.973] },
      { name: 'MouthIn', color: [0.001, 0.001, 0.001] },
      { name: 'Pink', color: [0.171, 0.098, 0.111], emissive: [0.714, 0.41, 0.463] },
      { name: 'Blush', color: [0.199, 0.116, 0.124], emissive: [0.832, 0.485, 0.52] },
      { name: 'cheek1', color: [1, 1, 1], hasMap: true, transparent: true },
      { name: 'FaceMat', color: [1, 1, 1], hasMap: true, faceAtlas: true },
      { name: 'Screen', color: [0.005, 0.01, 0.019] }, // 暗い画面(ロボの顔)は線と同じく残す
      { name: 'Glove', color: [0.214, 0.214, 0.214], emissive: [0.896, 0.896, 0.896] },
      { name: 'Cream', color: [0.192, 0.179, 0.161], emissive: [0.802, 0.75, 0.672] },
      { name: 'Green', color: [1, 1, 1], hasMap: true }, // 色の絵のある体(ようこそくん)
      { name: 'Paper', color: [1, 1, 1], emissive: [1, 0.62, 0.28], emissiveIntensity: 0.5 }, // 提灯の紙(光る)
    ]),
    ['outline', 'outline', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'body', 'body', 'body', 'body'],
  );
  // 光る紙は、差しかえても光ったまま(発光 × 強さ)
  assert.deepEqual(classifyMaterial({ name: 'Paper', color: [1, 1, 1], emissive: [1, 0.62, 0.28], emissiveIntensity: 0.5 }).glow, [0.5, 0.31, 0.14]);
});

test('材質の数字: 布 = 粗さ 0.86 と布のつや・つるつる = 上塗りのつや。光は重い影とすき間の陰を使わない', () => {
  assert.equal(LOOKS.fabric.roughness, 0.86);
  assert.ok(LOOKS.fabric.sheenTint > 1); // つやの色は地の色を明るく(白へ寄せない)
  assert.equal(LOOKS.vinyl.clearcoat, 1);
  assert.ok(LOOKS.vinyl.roughness < LOOKS.fabric.roughness);
  assert.ok(LIGHT.exposure > 0 && LIGHT.exposure < 1);
  assert.equal('shadowMapSize' in LIGHT || 'ssao' in LIGHT, false);
});

test('円柱の UV: 世界の長さでそろい、継ぎ目は真後ろの 1 本だけ', () => {
  // 半径 0.1 の円柱(高さ 0.24)。正面(+z)は u = 0、高さ 0.12 で v = 1
  const pos = [];
  for (const y of [0, 0.12, 0.24]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    pos.push(Math.sin(a) * 0.1, y, Math.cos(a) * 0.1);
  }
  const uv = cylinderUv(Float32Array.from(pos), TILE_M);
  assert.equal(uv.length, (pos.length / 3) * 2);
  assert.ok(Math.abs(uv[0]) < 1e-6); // 正面
  assert.ok(Math.abs(uv[16 * 2 + 1] - 1) < 1e-5); // 高さ 0.12 で 1
  // 横へ 1/4 周(弧の長さ 0.157)= 0.157 / 0.12 ≈ 1.31
  assert.ok(Math.abs(uv[4 * 2] - (Math.PI / 2) * 0.1 / TILE_M) < 1e-4);
  // u の飛び(継ぎ目)は真後ろの 1 か所だけ
  let jumps = 0;
  for (let k = 0; k < 16; k++) if (Math.abs(uv[((k + 1) % 16) * 2] - uv[k * 2]) > 1.5) jumps++;
  assert.equal(jumps, 1);
  assert.equal(cylinderUv(new Float32Array(0)).length, 0);
});

test('円柱の UV: キャラの真ん中の軸(center)で投げると、板の真ん中の近くでも角度が急に変わらない', () => {
  // キャラの前にある、横に曲がった板(顔のお面の形)。板の真ん中のまわりで投げると u が大きく飛ぶが、キャラの軸のまわりなら弧の長さどおり
  const pos = [];
  for (let k = -4; k <= 4; k++) {
    const a = (k / 4) * 0.6; // ±34°
    pos.push(Math.sin(a) * 0.15, 0.5, Math.cos(a) * 0.15);
  }
  const uv = cylinderUv(Float32Array.from(pos), TILE_M, [0, 0]);
  const steps = [];
  for (let k = 0; k < 8; k++) steps.push(uv[(k + 1) * 2] - uv[k * 2]);
  const want = (0.6 / 4) * 0.15 / TILE_M; // 1 歩の弧の長さ ÷ 12 cm
  for (const s of steps) assert.ok(Math.abs(s - want) < 1e-4, `u の歩みがそろわない: ${steps}`);
});

test('法線をならす: 丸い所はならし、向きが 40° より違う角(箱の角)は残す', () => {
  // 箱の 1 つの角: 3 つの面の頂点が同じ位置で、向きが 90° ずつ違う → まとめない・混ぜない
  const pos = Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const nrm = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const idx = [0, 3, 5, 1, 4, 3, 2, 5, 4];
  const out = smoothNormals(pos, nrm, idx);
  for (let i = 0; i < 3; i++) {
    const dot = out[i * 3] * nrm[i * 3] + out[i * 3 + 1] * nrm[i * 3 + 1] + out[i * 3 + 2] * nrm[i * 3 + 2];
    assert.ok(dot > 0.999, `角の向きが混ざった(${i}: ${dot})`);
  }
  // ゆるく曲がった帯(となりどうし 10° ずつ)は、ならすと段差が小さくなる
  const p2 = [];
  const n2 = [];
  for (let k = 0; k < 6; k++) {
    const a = ((k * 10) * Math.PI) / 180;
    p2.push(k, 0, 0, k, 1, 0);
    const n = [0, Math.sin(a), Math.cos(a)];
    n2.push(...n, ...n);
  }
  const i2 = [];
  for (let k = 0; k < 5; k++) i2.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
  const o2 = smoothNormals(Float32Array.from(p2), Float32Array.from(n2), i2, { iterations: 8 });
  const angle = (o, k) => Math.atan2(o[k * 6 + 1], o[k * 6 + 2]);
  // 真ん中の 2 つの間の角の差は、元の 10° より小さくなる(ならした)。長さは 1
  assert.ok(Math.abs(angle(o2, 3) - angle(o2, 2)) < (10 * Math.PI) / 180);
  for (let i = 0; i < o2.length; i += 3) assert.ok(Math.abs(Math.hypot(o2[i], o2[i + 1], o2[i + 2]) - 1) < 1e-5);
});

test('毛羽の絵: 同じ種なら同じ・端どうしがつながる・法線と粗さの絵は 0..255 の RGBA', () => {
  const size = 64;
  const h = fleeceHeight(size, 7);
  const h2 = fleeceHeight(size, 7);
  assert.deepEqual(Array.from(h.slice(0, 50)), Array.from(h2.slice(0, 50)));
  assert.ok(h.every((v) => v >= -1 && v <= 1));
  // 右の端の列と左の端の列の差は、となりの列どうしの差と同じくらい(継ぎ目が出ない)
  let edge = 0;
  let inner = 0;
  for (let y = 0; y < size; y++) {
    edge += Math.abs(h[y * size + size - 1] - h[y * size]);
    inner += Math.abs(h[y * size + 1] - h[y * size]);
  }
  assert.ok(edge < inner * 2.5, `端 ${edge} 中 ${inner}`);
  const n = normalFromHeight(h, size);
  const o = ormFromHeight(h, size, LOOKS.fabric);
  assert.equal(n.length, size * size * 4);
  assert.equal(o.length, size * size * 4);
  // 法線は上(z)を向く: 青の成分が 128 より大きい
  for (let i = 0; i < n.length; i += 4) assert.ok(n[i + 2] > 128);
  // 粗さ(緑)は 0.86 ± 0.08 の中
  for (let i = 1; i < o.length; i += 4) assert.ok(o[i] >= Math.floor(0.78 * 255) && o[i] <= Math.ceil(0.94 * 255));
});
