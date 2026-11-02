import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadFollower, anglesToTarget, smoothingAlpha } from '../src/character/gaze.js';

test('正面なら角度は 0、右にずれると yaw が正', () => {
  const o = { x: 0, y: 1.4, z: 0 };
  assert.deepEqual(anglesToTarget(o, { x: 0, y: 1.4, z: 2 }), { yaw: 0, pitch: 0 });
  assert.ok(anglesToTarget(o, { x: 1, y: 1.4, z: 2 }).yaw > 0);
  assert.ok(anglesToTarget(o, { x: 0, y: 2.4, z: 2 }).pitch > 0);
});

test('頭は、目標を受けてから 0.14 秒は動き出さない(目が先)', () => {
  const h = new HeadFollower();
  let last;
  for (let i = 0; i < 4; i++) last = h.step(1 / 30, 0.8, 0); // 0.13 秒ぶん
  assert.ok(Math.abs(last.yaw) < 0.02, `yaw=${last.yaw}`);
});

test('頭は、そのあと目標に近づく(首が後から追う)', () => {
  const h = new HeadFollower();
  let last;
  for (let i = 0; i < 90; i++) last = h.step(1 / 30, 0.8, 0);
  assert.ok(last.yaw > 0.6, `yaw=${last.yaw}`);
});

test('小さな向きの変化は、頭を少ししか動かさない(目だけで追う)', () => {
  const h = new HeadFollower();
  let last;
  for (let i = 0; i < 90; i++) last = h.step(1 / 30, 0.1, 0);
  assert.ok(last.yaw < 0.05, `yaw=${last.yaw}`);
});

test('平滑化の係数は 0〜1', () => {
  const a = smoothingAlpha(1 / 60, 0.1);
  assert.ok(a > 0 && a < 1);
  assert.equal(smoothingAlpha(0.1, 0), 1);
});

import { GESTURES, Pose } from '../src/character/gestures.js';

test('指さし: 目印が右(+x)なら左手、左(-x)なら右手を上げる', () => {
  const right = new Pose();
  GESTURES.point.apply(1.0, right, { dx: 3, dz: 0 });
  assert.ok(right.map.has('leftUpperArm') && !right.map.has('rightUpperArm'));
  const left = new Pose();
  GESTURES.point.apply(1.0, left, { dx: -3, dz: 0 });
  assert.ok(left.map.has('rightUpperArm') && !left.map.has('leftUpperArm'));
});

test('指さし: 手前(+z)の目印では、腕が前へ振れる向きに回る', () => {
  const p = new Pose();
  GESTURES.point.apply(1.0, p, { dx: -2, dz: 2 });
  const [, y] = p.map.get('rightUpperArm');
  assert.ok(y > 0);
});
