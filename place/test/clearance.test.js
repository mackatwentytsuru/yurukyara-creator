import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkClearance } from '../tools/clearance.mjs';

const at = (x, y, z) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, y, z, 1]];
const floorAt = (x, z) => [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [x, 0, z, 1]];
const room = (objects = [], doorWidth = 0.9) => ({
  floors: [{ transform: floorAt(0, 0), dimensions: [4, 5, 0] }],
  doors: [{ transform: at(1.5, 1, 2.5), dimensions: [doorWidth, 2, 0.1] }],
  objects,
});

test('何も無い部屋: 真ん中に立てて、ドアまで行ける', () => {
  const r = checkClearance({ spawn: [0, 0], room: room() });
  assert.equal(r.ok, true, r.problems.join(','));
  assert.equal(r.doors[0].reachable, true);
  assert.ok(r.reachablePercent >= 99);
});

test('家具の中に立つ位置があると不合格', () => {
  const table = { transform: at(0, 0.4, 0), dimensions: [1.2, 0.8, 0.7] };
  const r = checkClearance({ spawn: [0, 0], room: room([table]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /近すぎる/);
});

test('ドアが人の幅より狭いと不合格(0.72 m の境目)', () => {
  assert.equal(checkClearance({ spawn: [0, 0], room: room([], 0.72) }).ok, true);
  const r = checkClearance({ spawn: [0, 0], room: room([], 0.6) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /幅/);
});

test('家具の壁で部屋が分かれて、ドアに行けないと不合格。隙間が人の幅(0.7 m)より狭い場合も同じ', () => {
  // 幅 4 m の部屋を、奥行き 1 m の低い棚(高さ 1 m)で横一列に塞ぐ。隙間は左右に 0.3 m ずつ
  const shelf = { transform: at(0, 0.5, 0.5), dimensions: [3.4, 1, 1] };
  const r = checkClearance({ spawn: [0, -1.5], room: room([shelf]) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /歩いて行けない/);
});

test('敷物のように低い物は塞がない', () => {
  const rug = { transform: at(0, 0.01, 0), dimensions: [2, 0.02, 2] };
  assert.equal(checkClearance({ spawn: [0, 0], room: room([rug]) }).ok, true);
});

test('偽の撮影(30 度回した部屋): 中心に立てて、ドアに行ける', () => {
  const fake = JSON.parse(readFileSync(new URL('../testdata/fake_scan/room.json', import.meta.url), 'utf8'));
  const r = checkClearance({ spawn: [0, 0], room: fake });
  assert.equal(r.ok, true, r.problems.join(','));
  assert.equal(r.doors.length, 1);
});

test('床が読めないときは不合格で理由を返す', () => {
  const r = checkClearance({ spawn: [0, 0], room: { objects: [] } });
  assert.equal(r.ok, false);
});
