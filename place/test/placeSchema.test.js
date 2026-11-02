import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaceJson, bearingFrom, PlaceFormatError } from '../web/placeSchema.js';

const valid = {
  id: 'example',
  name: '例',
  model: 'room.glb',
  scale_m: 1.0,
  floor_y: 0.0,
  spawn: { position: [0, 0, 0], yaw_deg: 0 },
  landmarks: [{ name: '入口', position: [0, 0, 2], note: '案内' }],
};

test('正しい place.json はそのまま通り、元の物は変わらない', () => {
  const before = JSON.stringify(valid);
  const p = parsePlaceJson(valid);
  assert.equal(p.id, 'example');
  assert.deepEqual(p.landmarks[0].position, [0, 0, 2]);
  assert.equal(JSON.stringify(valid), before);
  assert.notEqual(p.landmarks[0].position, valid.landmarks[0].position);
});

test('足りない値は既定で補う', () => {
  const p = parsePlaceJson({ id: 'a', model: 'a.glb' });
  assert.equal(p.name, 'a');
  assert.equal(p.scale_m, 1);
  assert.equal(p.floor_y, 0);
  assert.deepEqual(p.spawn, { position: [0, 0, 0], yaw_deg: 0 });
  assert.deepEqual(p.landmarks, []);
});

test('model がないと、日本語の理由つきで失敗する', () => {
  assert.throws(() => parsePlaceJson({ id: 'a' }), (e) => {
    assert.ok(e instanceof PlaceFormatError);
    assert.match(e.message, /model/);
    return true;
  });
});

test('scale_m が 0 以下や数でないと失敗する', () => {
  assert.throws(() => parsePlaceJson({ ...valid, scale_m: 0 }), PlaceFormatError);
  assert.throws(() => parsePlaceJson({ ...valid, scale_m: '1' }), PlaceFormatError);
});

test('landmarks の位置が 3 つの数でないと失敗する', () => {
  const bad = { ...valid, landmarks: [{ name: 'x', position: [0, 1] }] };
  assert.throws(() => parsePlaceJson(bad), PlaceFormatError);
});

test('landmarks の名前がかぶると失敗する', () => {
  const lm = { name: 'x', position: [0, 0, 0] };
  assert.throws(() => parsePlaceJson({ ...valid, landmarks: [lm, lm] }), PlaceFormatError);
});

test('中身がオブジェクトでないと失敗する', () => {
  assert.throws(() => parsePlaceJson(null), PlaceFormatError);
  assert.throws(() => parsePlaceJson([]), PlaceFormatError);
});

test('bearingFrom: 正面 +z の先は 0 度、+x は左 90 度', () => {
  const ahead = bearingFrom([0, 0, 0], 0, [0, 0, 2]);
  assert.ok(Math.abs(ahead.left_deg) < 1e-9);
  assert.equal(ahead.distance_m, 2);
  const left = bearingFrom([0, 0, 0], 0, [3, 0, 0]);
  assert.ok(Math.abs(left.left_deg - 90) < 1e-9);
});

test('bearingFrom: 向き(yaw)を回すと見え方も回る。-180〜180 に収まる', () => {
  const r = bearingFrom([0, 0, 0], 90, [0, 0, 2]); // +x を向いている人から見て +z は右 90 度
  assert.ok(Math.abs(r.left_deg - -90) < 1e-9);
  const back = bearingFrom([0, 0, 0], 0, [0, 0, -2]);
  assert.ok(Math.abs(Math.abs(back.left_deg) - 180) < 1e-9);
});
