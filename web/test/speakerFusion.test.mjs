// 映像(口の動き)と音(向き)から、誰が話しているかを出す。片方だけでも動くこと、食い違ったときの扱いを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseSpeaker, bearingOf } from '../src/tracking/speakerFusion.js';
import { AttentionPicker } from '../src/tracking/attention.js';

const A = (bearingDeg, sigmaDeg = 4) => ({ voiced: true, measurements: [{ kind: 'itd', bearingDeg, sigmaDeg, confidence: 0.8 }] });
const two = (a1 = 0, a2 = 0) => [{ id: 'L', bearingDeg: -20, activity: a1 }, { id: 'R', bearingDeg: 20, activity: a2 }];

test('向き: キャラの座標(+x が お客さんから見て右)から、マイクの正面 0・マイクから見て右が正に直す', () => {
  assert.ok(Math.abs(bearingOf([0, 1.5, 2])) < 1e-9); // 正面
  assert.ok(bearingOf([-1, 1.5, 2]) > 20); // マイクから見て右 = キャラの座標では x が負
  assert.ok(bearingOf([1, 1.5, 2]) < -20);
  assert.ok(Math.abs(bearingOf([0.5, 1.5, 2], { x: 0.5, z: 0, yawDeg: 0 })) < 1e-9); // マイクの位置を引く
  assert.ok(Math.abs(bearingOf([0, 1.5, 2], { x: 0, z: 0, yawDeg: 10 }) + 10) < 1e-9);
});

test('音だけ(口の動きの情報なし): 測った向きに近い人が話し手', () => {
  const r = fuseSpeaker(two(), A(21));
  assert.equal(r.speakerId, 'R');
  assert.equal(r.source, 'audio');
  assert.ok(r.confidence > 0.8);
  assert.equal(fuseSpeaker(two(), A(-19)).speakerId, 'L');
});

test('映像だけ(音なし): 口がよく動く人が話し手。同じくらい動いていれば決めない', () => {
  const r = fuseSpeaker(two(0.002, 0.05), null);
  assert.equal(r.speakerId, 'R');
  assert.equal(r.source, 'video');
  assert.equal(fuseSpeaker(two(0.04, 0.04), null).speakerId, null);
});

test('音も映像も情報なし: 決めない', () => {
  const r = fuseSpeaker(two(0, 0), { voiced: false, measurements: [] });
  assert.equal(r.speakerId, null);
  assert.equal(r.source, 'none');
});

test('確かさの低い音(0.25 未満)は、使わない', () => {
  const weak = { voiced: true, measurements: [{ kind: 'itd', bearingDeg: 20, sigmaDeg: 4, confidence: 0.1 }] };
  assert.equal(fuseSpeaker(two(), weak).speakerId, null);
});

test('両方あって一致: 確かさが上がる。食い違うときは、音が確かならそちら(口の検出は外れやすい)', () => {
  const both = fuseSpeaker(two(0.002, 0.03), A(20));
  const audioOnly = fuseSpeaker(two(0, 0), A(20));
  assert.equal(both.source, 'audio+video');
  assert.ok(both.confidence >= audioOnly.confidence - 1e-9);
  // 口は左が動いているが、音は右から: 音の向きは右 → 右(左は口の検出の外れ)。ただし確かさは下がる
  const conflict = fuseSpeaker(two(0.04, 0.003), A(20));
  assert.ok(conflict.confidence < both.confidence);
});

test('2 人が近い向き(5 度差)のときは、決めきらない(間違えるよりよい)。離れていれば決める', () => {
  const close = [{ id: 'a', bearingDeg: 0, activity: 0 }, { id: 'b', bearingDeg: 5, activity: 0 }];
  assert.equal(fuseSpeaker(close, A(2.5, 8)).speakerId, null);
  const far = [{ id: 'a', bearingDeg: 0, activity: 0 }, { id: 'b', bearingDeg: 30, activity: 0 }];
  assert.equal(fuseSpeaker(far, A(29)).speakerId, 'b');
});

test('映っている誰の向きとも合わない音は、映っていない人の声: 話し手なしで、向きだけ返す', () => {
  const r = fuseSpeaker(two(), A(75, 3));
  assert.equal(r.speakerId, null);
  assert.ok(r.nobody > 0.6);
  assert.equal(r.unseenBearingDeg, 75);
});

test('誰も映っていない: 音の向きだけを返す', () => {
  const r = fuseSpeaker([], A(-33));
  assert.equal(r.speakerId, null);
  assert.equal(r.audioBearingDeg, -33);
  assert.equal(r.unseenBearingDeg, -33);
});

test('1 人だけ映っていて、音がその向き: その人。口が動いていなくても決まる', () => {
  const r = fuseSpeaker([{ id: 1, bearingDeg: 10, activity: 0 }], A(11));
  assert.equal(r.speakerId, 1);
});

test('AttentionPicker: 音があれば、口の動きがなくても話し手が決まり、その人を見る。音が切れても 0.8 秒は同じ人', () => {
  const picker = new AttentionPicker();
  // マイクから見て、左(キャラの座標で +x)と右(−x)の 2 人
  const people = [{ position: [0.7, 1.5, 2] }, { position: [-0.7, 1.5, 2] }];
  const right = bearingOf([-0.7, 1.5, 2]);
  let out;
  for (let i = 0; i < 20; i++) out = picker.update(people, i * 0.05, { audio: A(right) });
  assert.equal(out.speaker.source, 'audio');
  const rightTrack = out.tracks.find((t) => t.position[0] < 0);
  assert.equal(out.speakerId, rightTrack.id);
  assert.equal(out.primaryId, rightTrack.id);
  // 声の切れ目(音の見立てが空)
  const gap = picker.update(people, 1.0 + 0.3, { audio: { voiced: false, measurements: [] } });
  assert.equal(gap.speakerId, rightTrack.id);
  const later = picker.update(people, 1.0 + 2.0, { audio: { voiced: false, measurements: [] } });
  assert.equal(later.speakerId, null);
});

test('AttentionPicker: 音が無ければ、これまでどおり(口の動き → いちばん近い人)', () => {
  const picker = new AttentionPicker();
  const out = picker.update([{ position: [0.5, 1.5, 3] }, { position: [-0.2, 1.5, 1.5] }], 0, {});
  assert.equal(out.speaker.source, 'none');
  assert.equal(out.speakerId, null);
  assert.equal(out.primaryId, out.tracks.find((t) => t.position[2] === 1.5).id);
});
