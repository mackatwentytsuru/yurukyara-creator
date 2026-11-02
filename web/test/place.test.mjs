import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptPlace, landmarkWorld, SAMPLE_PLACE } from '../src/place.js';

const sample = { ...SAMPLE_PLACE, loaded: null };

test('試しの場所: spawn から測った、お客さんから見た方向で目印を渡す', () => {
  const p = promptPlace(sample);
  assert.equal(p.landmarks.find((l) => l.name === 'お手洗い').where.startsWith('左奥'), true);
  assert.equal(p.landmarks.find((l) => l.name === '入口').where.startsWith('手前'), true);
});

test('AR で位置合わせの前は、部屋の目印を渡さない(現実と合わないため)', () => {
  assert.deepEqual(promptPlace(sample, { arUnaligned: true }).landmarks, []);
});

test('位置合わせをしていない場所の目印は、部屋の座標のまま(目の高さに上げる)', () => {
  const pos = landmarkWorld(sample, '入口');
  assert.deepEqual(pos, [0, 1.1, 2.5]);
  assert.equal(landmarkWorld(sample, '存在しない'), null);
});
