import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionPicker } from '../src/tracking/attention.js';

// 人 = キャラの座標(メートル)での位置と口の開き
const person = (x, z, mouth = 0.05, extra = {}) => ({ position: [x, 1.4, z], mouth, ...extra });

/** 30fps で frames 枚ぶん流し、最後の結果を返す */
function run(picker, frames, makePeople, start = 0, ctx = {}) {
  let out;
  for (let i = 0; i < frames; i++) out = picker.update(makePeople(i), start + i / 30, ctx);
  return out;
}

test('人が 1 人なら、その人を見る', () => {
  const p = new AttentionPicker();
  const out = run(p, 10, () => [person(0, 1)]);
  assert.equal(out.tracks.length, 1);
  assert.equal(out.primaryId, out.tracks[0].id);
  assert.equal(out.speakerId, null);
});

test('誰もいなければ null', () => {
  const p = new AttentionPicker();
  assert.equal(run(p, 5, () => []).primaryId, null);
});

test('2 人のとき、話していなければ、いちばん近い人を見る', () => {
  const p = new AttentionPicker();
  const out = run(p, 20, () => [person(-0.6, 2.5), person(0.4, 0.8)]);
  const near = out.tracks.find((t) => t.position[2] === 0.8);
  assert.equal(out.primaryId, near.id);
});

test('2 人のとき、口が動いている人を見る(遠い人でも)', () => {
  const p = new AttentionPicker();
  const out = run(p, 60, (i) => [person(-0.6, 2.5, i % 2 ? 0.5 : 0.05), person(0.4, 0.8)]);
  const far = out.tracks.find((t) => t.position[2] === 2.5);
  assert.equal(out.speakerId, far.id);
  assert.equal(out.primaryId, far.id);
});

test('見る人は、すぐには替えない(0.5 秒は有利が続かないと替えない)', () => {
  const p = new AttentionPicker();
  run(p, 30, () => [person(-0.6, 2.5), person(0.4, 0.8)]);
  const before = p.currentId;
  const out = run(p, 3, (i) => [person(-0.6, 2.5, i % 2 ? 0.6 : 0.05), person(0.4, 0.8)], 1.0);
  assert.equal(out.primaryId, before);
});

test('同じ人は、少し動いても同じ id のまま追跡される', () => {
  const p = new AttentionPicker();
  const a = run(p, 5, (i) => [person(0 + i * 0.01, 1)]);
  const b = run(p, 5, (i) => [person(0.05 + i * 0.01, 1)], 5 / 30);
  assert.equal(a.tracks[0].id, b.tracks[0].id);
});

test('奥行きの推定が揺れても(±0.4m)、同じ人として追跡される', () => {
  const p = new AttentionPicker();
  const out = run(p, 30, (i) => [person(0.3, 2 + (i % 2 ? 0.4 : -0.4))]);
  assert.equal(p.tracks.length, 1);
  assert.equal(out.tracks.length, 1);
});

test('マイクに声があるときは、小さな口の動きでも話している人とみなす', () => {
  const p = new AttentionPicker();
  const out = run(p, 60, (i) => [person(-0.6, 2.5, i % 2 ? 0.12 : 0.05), person(0.4, 0.8)], 0, { voiceActive: true });
  const far = out.tracks.find((t) => t.position[2] === 2.5);
  assert.equal(out.speakerId, far.id);
});

test('入力が「話している」と教えてくれたら、口の動きがなくてもその人を見る', () => {
  const p = new AttentionPicker();
  const out = run(p, 60, () => [person(-0.6, 2.5, 0, { id: 'a', speaking: true }), person(0.4, 0.8, 0, { id: 'b', speaking: false })]);
  const a = out.tracks.find((t) => t.position[2] === 2.5);
  assert.equal(out.speakerId, a.id);
});

test('入力が id をくれたら、位置が大きく動いても同じ人', () => {
  const p = new AttentionPicker();
  const a = run(p, 5, () => [person(0, 1, 0, { id: 'viewer' })]);
  const b = run(p, 5, () => [person(3, 4, 0, { id: 'viewer' })], 5 / 30);
  assert.equal(a.tracks[0].id, b.tracks[0].id);
});

test('gaze(見るべき点)は、そのまま渡される', () => {
  const p = new AttentionPicker();
  const out = run(p, 3, () => [person(0.5, 1, 0, { gaze: [0.9, 1.4, 2.5] })]);
  assert.deepEqual(out.tracks[0].gaze, [0.9, 1.4, 2.5]);
});

test('見えなくなって 0.8 秒たつと忘れる', () => {
  const p = new AttentionPicker();
  run(p, 10, () => [person(0, 1)]);
  const out = run(p, 40, () => [], 10 / 30);
  assert.equal(out.tracks.length, 0);
  assert.equal(out.primaryId, null);
});
