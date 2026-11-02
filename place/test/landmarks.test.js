import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorHeight, buildLandmarks, buildSpawn, buildPlaceJson } from '../tools/landmarks.mjs';
import { parsePlaceJson } from '../web/placeSchema.js';

// 撮った座標は、原点も向きも撮りはじめた場所しだい。床が y=-1.3 にある例。
const hints = [
  { kind: 'floor', name: 'floor', position: [1, -1.3, 2], dimensions: [4, 5, 0], confidence: 'high' },
  { kind: 'wall', name: 'wall', position: [1, -0.1, 4.5], dimensions: [4, 2.6, 0.1], confidence: 'high' },
  { kind: 'door', name: 'door', position: [2.5, -0.3, 4.5], dimensions: [0.9, 2, 0.1], confidence: 'high' },
  { kind: 'window', name: 'window', position: [-0.5, 0, -0.5], dimensions: [1.2, 1.1, 0.1], confidence: 'medium' },
  { kind: 'window', name: 'window', position: [3, 0, -0.5], dimensions: [1.2, 1.1, 0.1], confidence: 'medium' },
  { kind: 'object', name: 'table', position: [0.5, -0.9, 1], dimensions: [1.2, 0.75, 0.7], confidence: 'high' },
  { kind: 'object', name: 'unknownThing', position: [0, -1, 0], dimensions: [1, 1, 1], confidence: 'low' },
];

test('床の高さ: floor の面の y。無ければ壁の下端', () => {
  assert.equal(floorHeight(hints), -1.3);
  assert.equal(floorHeight(hints.filter((h) => h.kind !== 'floor')), -0.1 - 2.6 / 2);
  assert.equal(floorHeight([]), 0);
});

test('landmarks: y は床を 0 にそろえ、名前は日本語、同じ名前は x の小さい順に番号', () => {
  const { landmarks, floor_y } = buildLandmarks(hints);
  assert.equal(floor_y, -1.3);
  const by = Object.fromEntries(landmarks.map((l) => [l.name, l]));
  assert.deepEqual(by['ドア'].position, [2.5, 1.0, 4.5]);
  assert.deepEqual(by['窓1'].position, [-0.5, 1.3, -0.5]);
  assert.deepEqual(by['窓2'].position, [3, 1.3, -0.5]);
  assert.deepEqual(by['テーブル'].position, [0.5, 0.4, 1]);
  assert.ok(by['unknownThing'], '知らない種類は元の名前のまま残す');
  assert.ok(!landmarks.some((l) => l.name.includes('壁')), '壁は landmark にしない');
  assert.match(by['ドア'].note, /幅 0.9 m、高さ 2 m/);
});

test('spawn: 床の中心に立ち、最初のドアのほうを向く', () => {
  const s = buildSpawn(hints, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  assert.deepEqual(s.position, [1, 0, 2]);
  // ドアは (+1.5, +2.5) 先。+z から +x 側へ atan2(1.5, 2.5) = 30.96 度
  assert.ok(Math.abs(s.yaw_deg - 31) < 0.1, String(s.yaw_deg));
});

test('spawn: ドアも床も無ければ範囲の中心で 0 度', () => {
  const s = buildSpawn([], { minX: 0, maxX: 4, minZ: -2, maxZ: 2 });
  assert.deepEqual(s, { position: [2, 0, 0], yaw_deg: 0 });
});

test('buildPlaceJson の出力は place.json の検査を通る', () => {
  const j = buildPlaceJson({ id: 'shot', name: '撮った部屋', hints, boundsXZ: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } });
  const p = parsePlaceJson(j);
  assert.equal(p.id, 'shot');
  assert.equal(p.landmarks.length, 5);
});
