import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveAlignment, pickAlignmentPair } from '../web/align.js';

// 正解の変換を three.js で作り、その結果の点から解いて、元に戻るかを見る
function truth(yawDeg, tx, tz) {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(tx, 0, tz);
  return { yaw, m, world: ([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(m); return [v.x, v.z]; } };
}

test('solveAlignment: 2 点から向きと位置が戻る(three.js の rotation.y と同じ向き)', () => {
  for (const [deg, tx, tz] of [[0, 1, 2], [30, -1, 0.5], [-120, 3, -2], [179, 0, 0]]) {
    const t = truth(deg, tx, tz);
    const room = [[1.5, 2.5], [-2, -1]];
    const r = solveAlignment(room, room.map(t.world));
    assert.ok(Math.abs(Math.atan2(Math.sin(r.yaw - t.yaw), Math.cos(r.yaw - t.yaw))) < 1e-9, `yaw ${deg}`);
    assert.ok(Math.abs(r.tx - tx) < 1e-9 && Math.abs(r.tz - tz) < 1e-9);
    assert.ok(r.rms < 1e-9);
  }
});

test('solveAlignment: タップが 3 cm ずれていても、向きは数度以内。rms がずれの大きさを返す', () => {
  const t = truth(40, 2, -1);
  const room = [[0, 0], [3, 0], [3, 4]];
  const noise = [[0.03, 0], [-0.02, 0.02], [0, -0.03]];
  const world = room.map(t.world).map(([x, z], i) => [x + noise[i][0], z + noise[i][1]]);
  const r = solveAlignment(room, world);
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(r.yaw) - 40) < 2);
  assert.ok(r.rms > 0.005 && r.rms < 0.05);
});

test('solveAlignment: 同じ場所の 2 点や、点が足りないと日本語で失敗', () => {
  assert.throws(() => solveAlignment([[1, 1], [1, 1]], [[0, 0], [5, 5]]), /近すぎる/);
  assert.throws(() => solveAlignment([[1, 1]], [[0, 0]]), /2 個以上/);
  assert.throws(() => solveAlignment([[1, 1], [2, 2]], [[0, 0]]), /同じ数/);
});

test('pickAlignmentPair: 水平にいちばん離れた 2 つ。近すぎると失敗', () => {
  const lms = [
    { name: 'a', position: [0, 1, 0] }, { name: 'b', position: [0.4, 1, 0] },
    { name: 'c', position: [3, 0.8, 4] }, { name: 'd', position: [3.1, 0, 4.1] },
  ];
  const [p, q] = pickAlignmentPair(lms);
  assert.deepEqual([p.name, q.name].sort(), ['a', 'd']);
  assert.throws(() => pickAlignmentPair([lms[0], lms[1]]), /0.5 m/);
  assert.throws(() => pickAlignmentPair([lms[0]]), /2 つ以上/);
});
