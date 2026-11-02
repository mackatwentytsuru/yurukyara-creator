import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildBoxGlb, elementsFromRoomJson, flatten16 } from '../tools/glbBoxes.mjs';

const parse = (bytes) =>
  new Promise((ok, ng) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, ng));
const translate = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

test('flatten16: 入れ子の列でも平らでも 16 個にそろえる。数が違えば null', () => {
  const m = translate(1, 2, 3);
  assert.deepEqual(flatten16(m), m);
  assert.deepEqual(flatten16([m.slice(0, 4), m.slice(4, 8), m.slice(8, 12), m.slice(12, 16)]), m);
  assert.equal(flatten16([1, 2, 3]), null);
  assert.equal(flatten16(null), null);
});

test('elementsFromRoomJson: 面は厚みをつけ、物は寸法どおり。壊れた要素は飛ばす', () => {
  const room = {
    walls: [{ transform: translate(0, 1, 0), dimensions: [4, 2, 0] }, { transform: [1, 2], dimensions: [1, 1, 0] }],
    objects: [{ transform: translate(1, 0.4, 1), dimensions: [1.2, 0.8, 0.6] }],
  };
  const els = elementsFromRoomJson(room);
  assert.equal(els.length, 2);
  assert.deepEqual(els.find((e) => e.kind === 'wall').size, [4, 2, 0.1]);
  assert.deepEqual(els.find((e) => e.kind === 'object').size, [1.2, 0.8, 0.6]);
});

test('buildBoxGlb: 位置と寸法が箱の大きさに出る(回した壁でも)', async () => {
  // 幅 4・高さ 2 の壁を、y 軸まわりに 90 度回して (3, 1, 0) に置く → 幅が z 方向に伸びる
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(3, 1, 0).toArray();
  const els = elementsFromRoomJson({ walls: [{ transform: m, dimensions: [4, 2, 0] }] });
  const gltf = await parse(await buildBoxGlb(els));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 4) < 1e-4 && Math.abs(size.y - 2) < 1e-4 && Math.abs(size.x - 0.1) < 1e-4, size.toArray().join(','));
  const c = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x - 3) < 1e-4 && Math.abs(c.y - 1) < 1e-4);
});

test('偽の撮影の room.json から、床・壁・ドア・窓・家具の箱が全部入った GLB ができる', async () => {
  const room = JSON.parse(readFileSync(new URL('../testdata/fake_scan/room.json', import.meta.url), 'utf8'));
  const els = elementsFromRoomJson(room);
  assert.deepEqual([...new Set(els.map((e) => e.kind))].sort(), ['door', 'floor', 'object', 'wall', 'window']);
  const gltf = await parse(await buildBoxGlb(els));
  let meshes = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) meshes += 1; });
  assert.equal(meshes, els.length);
});
