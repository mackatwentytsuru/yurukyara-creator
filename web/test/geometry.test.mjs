import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceToWorld, describeDirection, landmarksForPrompt, describeScene } from '../src/tracking/geometry.js';

test('画像の中央にいる人は、キャラの正面(x≈0)', () => {
  const [x, , z] = faceToWorld({ x: 0.5, y: 0.5, width: 0.2 });
  assert.ok(Math.abs(x) < 1e-9);
  assert.ok(z > 0.4 && z < 1.5);
});

test('カメラの絵の左にいる人は、お客さんから見て右(+x)', () => {
  const [x] = faceToWorld({ x: 0.2, y: 0.5, width: 0.2 });
  assert.ok(x > 0);
  const [x2] = faceToWorld({ x: 0.8, y: 0.5, width: 0.2 });
  assert.ok(x2 < 0);
});

test('顔が小さいほど遠い', () => {
  const near = faceToWorld({ x: 0.5, y: 0.5, width: 0.3 })[2];
  const far = faceToWorld({ x: 0.5, y: 0.5, width: 0.06 })[2];
  assert.ok(far > near * 3);
});

test('距離は 0.4〜6m に収める', () => {
  assert.equal(faceToWorld({ x: 0.5, y: 0.5, width: 5 })[2], 0.4);
  assert.equal(faceToWorld({ x: 0.5, y: 0.5, width: 0.001 })[2], 6);
});

test('画像の上にいる人は、頭の高さより上を向く', () => {
  const [, y] = faceToWorld({ x: 0.5, y: 0.2, width: 0.2 }, { headY: 1.4 });
  assert.ok(y > 1.4);
});

test('目印の方向: 右手前・左奥・正面', () => {
  assert.equal(describeDirection(2, 2).text, '右手前');
  assert.equal(describeDirection(-2, -2).text, '左奥');
  assert.equal(describeDirection(0, 3).text, '手前');
  assert.equal(describeDirection(0.1, 0.1).text, 'すぐそば');
});

test('目印を Claude に渡す形にする', () => {
  const out = landmarksForPrompt([{ name: '入口', position: [0, 0, 2], note: '入口です' }]);
  assert.equal(out[0].name, '入口');
  assert.match(out[0].where, /手前.*2\.0m/);
});

test('見えている様子の言葉', () => {
  const world = new Map([[1, [0.5, 1.4, 1.0]], [2, [-0.4, 1.4, 2.0]]]);
  const text = describeScene(
    [{ id: 1 }, { id: 2 }],
    { primaryId: 1, speakerId: 1, world },
  );
  assert.match(text, /2 人が見えている/);
  assert.match(text, /話している/);
  assert.equal(describeScene([], { world }), '人は見えていない');
});

test('目印の方向は、キャラの向き(yaw)を考える', () => {
  // キャラが +x 向き(rotation.y=90度)。+x にある目印は、キャラの真正面(手前側)に見える
  const [a] = landmarksForPrompt([{ name: 'A', position: [5, 0, 0] }], [0, 0, 0], 90);
  assert.match(a.where, /^手前、約 5\.0m/);
  // 同じキャラの原点が (1,0,1) にずれていても、相対で決まる
  const [b] = landmarksForPrompt([{ name: 'B', position: [1, 0, 3] }], [1, 0, 1], 0);
  assert.match(b.where, /^手前、約 2\.0m/);
  // Vector3 のような { x, y, z } の位置も受け取る
  const [c] = landmarksForPrompt([{ name: 'C', position: { x: -3, y: 0, z: -3 } }]);
  assert.match(c.where, /^左奥/);
});
