import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AHEAD_M, computeRig, rigToOffset, rotateXZ } from '../src/vrStage.js';
import { wrapLines } from '../src/ui/vrPanel.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} と ${b}`);

/** 変換を掛けた後の、頭の位置と顔の向き */
function after(rig, head, forward) {
  const [x, z] = rotateXZ(head[0], head[2], rig.yaw);
  const [fx, fz] = rotateXZ(forward[0], forward[2], rig.yaw);
  return { head: [x + rig.x, head[1] + rig.y, z + rig.z], forward: [fx, fz] };
}

const cases = [
  ['ふつう: -z を向いて原点の近く、キャラは原点で +z 向き', [0.3, 1.6, -0.2], [0, 0, -1], [0, 0, 0], [0, 0, 1]],
  ['横を向いて始める', [1, 1.7, 2], [1, 0, 0], [0, 0, 0], [0, 0, 1]],
  ['キャラが部屋の中で別の向き', [0, 1.6, 0], [0, 0, -1], [2, 0, -3], [1, 0, 0]],
  ['斜め', [-0.5, 1.5, 0.5], [Math.SQRT1_2, 0, Math.SQRT1_2], [1, 0.4, 1], [-Math.SQRT1_2, 0, Math.SQRT1_2]],
];

for (const [name, head, forward, charPos, charForward] of cases) {
  test(`立ち位置: ${name}`, () => {
    const rig = computeRig({ head, forward, charPos, charForward, floorY: charPos[1] });
    const r = after(rig, head, forward);
    near(r.head[0], charPos[0] + charForward[0] * AHEAD_M, '頭の x');
    near(r.head[2], charPos[2] + charForward[2] * AHEAD_M, '頭の z');
    near(r.head[1], head[1] + charPos[1], '頭の高さ(床をキャラの足元にそろえる)');
    near(r.forward[0], -charForward[0], '顔の向き x');
    near(r.forward[1], -charForward[2], '顔の向き z');
  });
}

test('three の y 軸回転と、同じ向きに回っている', () => {
  const v = new THREE.Vector3(1, 0, 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  const [x, z] = rotateXZ(1, 2, 0.7);
  near(x, v.x, 'x');
  near(z, v.z, 'z');
});

test('WebXR へ渡す原点のずれは、変換の逆になっている', () => {
  const rig = { yaw: 0.8, x: 1, y: 0.2, z: -2 };
  const { position, orientation } = rigToOffset(rig);
  // 実際の点 p は、ずらした空間では 「ずれの逆行列 × p」に見える
  const inv = new THREE.Matrix4().compose(position, orientation, new THREE.Vector3(1, 1, 1)).invert();
  const p = new THREE.Vector3(0.5, 1.6, 0.3).applyMatrix4(inv);
  const [x, z] = rotateXZ(0.5, 0.3, rig.yaw);
  near(p.x, x + rig.x, 'x');
  near(p.y, 1.6 + rig.y, 'y');
  near(p.z, z + rig.z, 'z');
});

test('板の文字: 1 字ずつ折り返し、入りきらないときは新しい行を残す', () => {
  const measure = (s) => [...s].length;
  assert.deepEqual(wrapLines('あいうえおかき', measure, 3, 5), ['あいう', 'えおか', 'き']);
  assert.deepEqual(wrapLines('あいうえおかき', measure, 3, 2), ['えおか', 'き']);
  assert.deepEqual(wrapLines('', measure, 3, 2), []);
});
