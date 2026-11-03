import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, resample, SegmentCollector } from '../src/conversation/wav.js';

test('48kHz を 16kHz にすると、長さが 3 分の 1 で、音の形が保たれる', () => {
  const input = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
  const out = resample(input, 48000, 16000);
  assert.equal(out.length, 1600);
  const expected = Math.sin((2 * Math.PI * 440 * 100) / 16000);
  assert.ok(Math.abs(out[100] - expected) < 0.01);
});

test('同じ周波数なら、そのまま返す', () => {
  const input = new Float32Array(10);
  assert.equal(resample(input, 16000, 16000), input);
});

test('WAV の頭と大きさが正しく、はみ出した音は切る', () => {
  const buf = Buffer.from(encodeWav(Float32Array.from([0, 1, -1, 2])));
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.toString('latin1', 8, 12), 'WAVE');
  assert.equal(buf.readUInt32LE(24), 16000);
  assert.equal(buf.length, 44 + 8);
  assert.equal(buf.readInt16LE(46), 32767);
  assert.equal(buf.readInt16LE(48), -32767);
  assert.equal(buf.readInt16LE(50), 32767);
});

test('声の区間は、直前の音も含み、終わると空になる', () => {
  const c = new SegmentCollector({ rate: 10, prerollS: 0.3 });
  const chunk = (v) => new Float32Array(2).fill(v);
  c.push(chunk(1));
  c.push(chunk(2));
  c.push(chunk(3));
  assert.equal(c.end(), null); // 始まる前は何も返らない
  c.begin();
  c.push(chunk(4));
  const out = c.end();
  assert.deepEqual([...out], [2, 2, 3, 3, 4, 4]); // 最初の 1 は、前の音の幅(0.3 秒 = 3 標本)の外
  assert.equal(c.active, false);
  c.push(chunk(5));
  c.begin();
  assert.equal(c.end().length > 0, true);
});

test('捨てると何も残らず、上限を超えると full になる', () => {
  const c = new SegmentCollector({ rate: 10, prerollS: 0, maxS: 1 });
  c.begin();
  c.push(new Float32Array(11));
  assert.equal(c.full, true);
  c.cancel();
  assert.equal(c.active, false);
  assert.equal(c.end(), null);
});
