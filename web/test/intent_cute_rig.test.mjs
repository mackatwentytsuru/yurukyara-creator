// かわいい仕草の層を rig の骨に書く所(web/src/character/cuteRig.js。B5G)の試験。作例の GLB を node で読む(画面・WebGL は使わない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CuteRig, RAISE_MAX, autoTail } from '../src/character/cuteRig.js';
import { CuteLayer, CUTE_GESTURES, seededRandom } from '../src/character/cuteLayer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'characters');
globalThis.self ??= globalThis; // GLTFLoader が読む
const loader = new GLTFLoader();
loader.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const parse = (file) =>
  new Promise((ok, ng) => {
    const b = fs.readFileSync(file);
    loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), path.dirname(file) + '/', ok, ng);
  });

async function load(id) {
  const dir = path.join(ROOT, id);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
  const g = await parse(path.join(dir, json.model));
  const clips = new Map();
  for (const [name, rel] of Object.entries(json.motions ?? {})) {
    const m = await parse(path.join(dir, rel));
    if (m.animations[0]) clips.set(name, m.animations[0]);
  }
  const lookBone = json.look?.bone ? g.scene.getObjectByName(json.look.bone) : null;
  return { json, scene: g.scene, clips, lookBone };
}

const RIGS = ['norrie', 'mikan', 'yokoso', 'robo'].filter((id) => fs.existsSync(path.join(ROOT, id, 'character.json')));
const angle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

test('作例の rig で、決まった名前の骨が見つかり、仕草で上げる腕は 120° まで', async () => {
  assert.ok(RIGS.length >= 4, `作例 ${RIGS}`);
  for (const id of RIGS) {
    const { json, scene, clips, lookBone } = await load(id);
    const r = new CuteRig(scene, clips, json, lookBone);
    assert.equal(r.caps.arms, true, `${id} 腕`);
    assert.equal(r.caps.head, Boolean(scene.getObjectByName('head')), `${id} 首`);
    assert.ok(r.root && r.body, `${id} 根元と体`);
    for (const side of ['L', 'R']) assert.ok(angle(r.raise[side].q) <= RAISE_MAX + 1e-6, `${id} ${side} ${angle(r.raise[side].q)}`);
    assert.ok(r.unit > 0.5 && r.unit < 2, `${id} 背の高さ ${r.unit}`);
  }
});

test('動き(clip)の上に足した分は、次のコマで外れる(毎コマ積み上がらない)', async () => {
  for (const id of RIGS) {
    const { json, scene, clips, lookBone } = await load(id);
    const r = new CuteRig(scene, clips, json, lookBone);
    const mixer = new THREE.AnimationMixer(scene);
    const idle = mixer.clipAction(clips.get('idle'));
    idle.play();
    const layer = new CuteLayer({ rng: seededRandom(3), caps: r.caps });
    const dt = 1 / 30;
    for (let i = 0; i < 150; i++) {
      if (i % 40 === 0) layer.trigger(CUTE_GESTURES[(i / 40) % CUTE_GESTURES.length]);
      r.beforeMixer();
      mixer.update(dt);
      r.captureBase();
      r.apply(layer.step(dt));
    }
    // 足す分を 0 にした 1 コマで、骨は動きだけの値にもどる
    const zero = Object.fromEntries(Object.keys(layer.out).map((k) => [k, 0]));
    r.beforeMixer();
    mixer.update(dt);
    r.captureBase();
    r.apply(zero);
    for (const b of r.bones) {
      const s = r.base.get(b);
      if (b === lookBone) continue;
      assert.ok(b.quaternion.angleTo(s.q) < 1e-6, `${id} ${b.name} の向き`);
      assert.ok(b.position.distanceTo(s.p) < 1e-9, `${id} ${b.name} の位置`);
    }
    for (const b of r.bones) for (const v of [...b.quaternion.toArray(), ...b.position.toArray()]) assert.ok(Number.isFinite(v));
  }
});

test('しっぽの部品があってしっぽの骨が無い子は、骨を 1 本足し、重みの和は 1・根元は体のまま・先はしっぽの骨', async () => {
  const id = RIGS.find((n) => {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, n, 'character.json'), 'utf8'));
    return j.id === 'norrie';
  });
  if (!id) return;
  const { scene } = await load(id);
  const hasTail = [];
  scene.traverse((o) => o.isSkinnedMesh && /tail/i.test(o.name) && hasTail.push(o));
  if (!hasTail.length) return; // しっぽの部品が無い版のノリー
  const t = autoTail(scene, scene.getObjectByName('body'));
  assert.ok(t && t.bone.name === 'tail_auto' && t.len > 0.2, '骨が足される');
  for (const m of hasTail) {
    const sw = m.geometry.attributes.skinWeight;
    const si = m.geometry.attributes.skinIndex;
    const ti = m.skeleton.bones.indexOf(t.bone);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < sw.count; i++) {
      const sum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      assert.ok(Math.abs(sum - 1) < 0.02, `${m.name} ${i} 重みの和 ${sum}`);
      const w = si.getY(i) === ti ? sw.getY(i) : 0;
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
    assert.ok(lo < 0.02 && hi > 0.95, `${m.name} 根元 ${lo} 先 ${hi}`);
  }
});
