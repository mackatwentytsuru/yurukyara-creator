import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAlignFlow, RMS_LIMIT_M } from '../web/alignFlow.js';

function fakePlace() {
  return {
    landmarks: [
      { name: '入口', position: new THREE.Vector3(1, 0, 2) },
      { name: '机', position: new THREE.Vector3(-1.4, 0.75, -1.2) },
      { name: '奥の壁', position: new THREE.Vector3(0, 1.3, -2) },
    ],
    calls: [],
    setAlignment(a) { this.calls.push(['set', a]); },
    clearAlignment() { this.calls.push(['clear']); },
  };
}
const yawM = (deg, tx, tz) => new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(deg)).setPosition(tx, 0, tz);

test('2 つタップすると place.setAlignment が呼ばれ、向き・位置・床の高さが入る', () => {
  const place = fakePlace();
  const flow = createAlignFlow({ place });
  assert.deepEqual(flow.targets.map((t) => t.name).sort(), ['入口', '奥の壁']);
  assert.match(flow.prompt, new RegExp(`「${flow.targets[0].name}」の真下の床`));
  const m = yawM(25, 1, -3);
  const pts = flow.targets.map((t) => new THREE.Vector3(t.position[0], 0, t.position[2]).applyMatrix4(m));
  assert.equal(flow.submit({ x: pts[0].x, y: -1.2, z: pts[0].z }), null);
  assert.match(flow.prompt, new RegExp(`「${flow.targets[1].name}」`));
  const r = flow.submit([pts[1].x, -1.2, pts[1].z]);
  assert.ok(flow.done && flow.ok);
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(r.yaw) - 25) < 1e-6);
  assert.deepEqual(place.calls.length, 1);
  assert.equal(place.calls[0][1].floorY, -1.2);
  assert.match(flow.prompt, /位置合わせができました/);
});

test('食い違いが大きいと、やり直しを勧める。reset で元に戻る', () => {
  const place = fakePlace();
  const flow = createAlignFlow({ place, floorY: 0 });
  // 部屋では 4 m 離れた 2 点を、世界では 5 m 離れた所でタップした(縮尺が合わない)
  flow.submit([0, 0, 0]);
  const r = flow.submit([5, 0, 0.5]);
  assert.ok(r.rms > RMS_LIMIT_M);
  assert.equal(flow.ok, false);
  assert.match(flow.prompt, /やり直して/);
  flow.reset();
  assert.equal(flow.done, false);
  assert.deepEqual(place.calls.at(-1), ['clear']);
});
