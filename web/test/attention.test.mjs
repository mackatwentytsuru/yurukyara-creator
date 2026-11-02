import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionPicker } from '../src/tracking/attention.js';

const face = (x, y, width, mouth) => ({ x, y, width, mouth });

/** 30fps で frames 枚ぶん流し、最後の結果を返す。mouthFn(i) は各顔の口の開きの列を返す */
function run(picker, frames, makeFaces, start = 0, ctx = {}) {
  let out;
  for (let i = 0; i < frames; i++) out = picker.update(makeFaces(i), start + i / 30, ctx);
  return out;
}

test('顔が 1 つなら、その人を見る', () => {
  const p = new AttentionPicker();
  const out = run(p, 10, () => [face(0.5, 0.5, 0.2, 0.1)]);
  assert.equal(out.tracks.length, 1);
  assert.equal(out.primaryId, out.tracks[0].id);
  assert.equal(out.speakerId, null);
});

test('誰もいなければ null', () => {
  const p = new AttentionPicker();
  const out = run(p, 5, () => []);
  assert.equal(out.primaryId, null);
});

test('2 人のとき、話していなければ、いちばん近い(顔が大きい)人を見る', () => {
  const p = new AttentionPicker();
  const out = run(p, 20, () => [face(0.3, 0.5, 0.1, 0.05), face(0.7, 0.5, 0.25, 0.05)]);
  const near = out.tracks.find((t) => t.width === 0.25);
  assert.equal(out.primaryId, near.id);
});

test('2 人のとき、口が動いている人を見る(遠い人でも)', () => {
  const p = new AttentionPicker();
  // 遠い人(左)の口が動く。近い人(右)は動かない
  const out = run(p, 60, (i) => [face(0.3, 0.5, 0.1, i % 2 ? 0.5 : 0.05), face(0.7, 0.5, 0.25, 0.05)]);
  const far = out.tracks.find((t) => t.width === 0.1);
  assert.equal(out.speakerId, far.id);
  assert.equal(out.primaryId, far.id);
});

test('見る人は、すぐには替えない(0.5 秒は有利が続かないと替えない)', () => {
  const p = new AttentionPicker();
  run(p, 30, () => [face(0.3, 0.5, 0.1, 0.05), face(0.7, 0.5, 0.25, 0.05)]);
  const before = p.currentId;
  // 遠い人が一瞬だけ口を動かす(0.1 秒)
  const out = run(p, 3, (i) => [face(0.3, 0.5, 0.1, i % 2 ? 0.6 : 0.05), face(0.7, 0.5, 0.25, 0.05)], 1.0);
  assert.equal(out.primaryId, before);
});

test('同じ人は同じ id のまま追跡される', () => {
  const p = new AttentionPicker();
  const a = run(p, 5, (i) => [face(0.5 + i * 0.005, 0.5, 0.2, 0.1)]);
  const b = run(p, 5, (i) => [face(0.53 + i * 0.005, 0.5, 0.2, 0.1)], 5 / 30);
  assert.equal(a.tracks[0].id, b.tracks[0].id);
});

test('マイクに声があるときは、小さな口の動きでも話している人とみなす', () => {
  const p = new AttentionPicker();
  const out = run(p, 60, (i) => [face(0.3, 0.5, 0.1, i % 2 ? 0.12 : 0.05), face(0.7, 0.5, 0.25, 0.05)], 0, { voiceActive: true });
  const far = out.tracks.find((t) => t.width === 0.1);
  assert.equal(out.speakerId, far.id);
});

test('見えなくなって 0.8 秒たつと忘れる', () => {
  const p = new AttentionPicker();
  run(p, 10, () => [face(0.5, 0.5, 0.2, 0.1)]);
  const out = run(p, 40, () => [], 10 / 30);
  assert.equal(out.tracks.length, 0);
  assert.equal(out.primaryId, null);
});
