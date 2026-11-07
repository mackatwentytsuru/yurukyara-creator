// かわいい仕草の層(B5G)の耳。作例の 4 体には耳の骨が無いので、決まった名前(ear_L・ear_R)の骨だけの小さな rig を作って確かめる。
// 2D の板(pose2d.js の earRotL・earRotR)も同じ数字から動くことを見る。画面・WebGL は使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CuteRig } from '../src/character/cuteRig.js';
import { CuteLayer, seededRandom } from '../src/character/cuteLayer.js';
import { pose2d } from '../src/char2d/pose2d.js';

const DT = 1 / 30;

/** root → body → head → ear_L・ear_R、body → arm_L・arm_R。皮は体の骨 1 本だけに付けた箱 */
function earRig() {
  const bone = (name, x, y, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, 0);
    if (parent) parent.add(b);
    return b;
  };
  const root = bone('root', 0, 0);
  const body = bone('body', 0, 0.3, root);
  const head = bone('head', 0, 0.4, body);
  const earL = bone('ear_L', 0.12, 0.2, head);
  const earR = bone('ear_R', -0.12, 0.2, head);
  const armL = bone('arm_L', 0.2, 0.15, body);
  const armR = bone('arm_R', -0.2, 0.15, body);
  const geo = new THREE.BoxGeometry(0.4, 1, 0.3).translate(0, 0.5, 0);
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = 1; // 体の骨
    w[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  const scene = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = 'body_mesh';
  scene.add(root, mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([root, body, head, earL, earR, armL, armR]));
  return { scene, earL, earR };
}

/** 20 秒(待つ → うれしい → びっくり → 聞く)。毎コマ、足す前の向きからの耳の角度の山を数える */
function runEars(seed) {
  const { scene, earL, earR } = earRig();
  const rig = new CuteRig(scene, new Map(), {}, null);
  const layer = new CuteLayer({ rng: seededRandom(seed), caps: rig.caps });
  let maxL = 0;
  let maxR = 0;
  let movedFrames = 0;
  const frames = 30 * 20;
  for (let i = 0; i < frames; i++) {
    if (i === 180) layer.trigger('happy');
    if (i === 330) layer.trigger('surprised');
    if (i === 450) layer.setActivity('listening');
    rig.beforeMixer();
    rig.captureBase();
    const qL = earL.quaternion.clone();
    const qR = earR.quaternion.clone();
    rig.apply(layer.step(DT));
    const aL = earL.quaternion.angleTo(qL);
    const aR = earR.quaternion.angleTo(qR);
    maxL = Math.max(maxL, aL);
    maxR = Math.max(maxR, aR);
    if (aL > 0.03 || aR > 0.03) movedFrames += 1;
  }
  return { rig, layer, earL, earR, maxL, maxR, movedShare: movedFrames / frames };
}

test('耳の骨(ear_L・ear_R)のある子は、耳がときどき動き(待つ間も)、動きは小さく、足した分は次のコマで外れる', (t) => {
  for (const seed of [1, 7, 23]) {
    const { rig, layer, earL, earR, maxL, maxR, movedShare } = runEars(seed);
    t.diagnostic(`seed ${seed}: 左 ${maxL.toFixed(3)} 右 ${maxR.toFixed(3)} ラジアン・動いたコマ ${(movedShare * 100).toFixed(0)}%`);
    assert.equal(rig.caps.ears, true, '耳を動かせる');
    assert.ok(rig.earL === earL && rig.earR === earR, '決まった名前で見つかる');
    assert.ok(maxL > 0.05 && maxR > 0.05, `耳が動く ${maxL} ${maxR}`);
    assert.ok(maxL < 0.8 && maxR < 0.8, `耳の動きは小さい ${maxL} ${maxR}`);
    assert.ok(movedShare > 0.05 && movedShare < 0.95, `いつも動き続けない・止まりきらない ${movedShare}`);
    // 足す分を 0 にした 1 コマで、耳は休みの向きにもどる(毎コマ積み上がらない)
    const zero = Object.fromEntries(Object.keys(layer.out).map((k) => [k, 0]));
    rig.beforeMixer();
    rig.captureBase();
    rig.apply(zero);
    for (const b of [earL, earR]) assert.ok(b.quaternion.angleTo(rig.base.get(b).q) < 1e-6, `${b.name} がもどる`);
  }
});

test('耳の無い子(作例の 4 体など)は、耳の数字が 0 のまま', () => {
  const layer = new CuteLayer({ rng: seededRandom(4), caps: { ears: false, tail: true } });
  layer.trigger('happy');
  for (let i = 0; i < 30 * 8; i++) {
    const o = layer.step(DT);
    assert.equal(o.earL, 0);
    assert.equal(o.earR, 0);
  }
});

test('2D の板の耳(ear_l・ear_r)も同じ数字で動き、±0.4 ラジアンまで。仕草の層が無い時は動かさない', () => {
  const layer = new CuteLayer({ rng: seededRandom(9), caps: { ears: true, tail: true } });
  let peak = 0;
  for (let i = 0; i < 30 * 12; i++) {
    if (i === 120) layer.trigger('surprised');
    const cute = layer.step(DT);
    const m = pose2d({ map: new Map() }, { time: i * DT, cute });
    assert.ok(Math.abs(m.earRotL) <= 0.4 + 1e-9 && Math.abs(m.earRotR) <= 0.4 + 1e-9, `${m.earRotL} ${m.earRotR}`);
    peak = Math.max(peak, Math.abs(m.earRotL), Math.abs(m.earRotR));
  }
  assert.ok(peak > 0.03, `2D の耳が動く ${peak}`);
  const still = pose2d({ map: new Map() }, { time: 1 });
  assert.equal(still.earRotL, 0);
  assert.equal(still.earRotR, 0);
});
