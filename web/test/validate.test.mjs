// 入口の検査。おかしな本文・おかしな位置が、枠(お金)や首の計算に届かないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, ValidationError, sanitizeChatBody, sanitizeMetric } from '../server/validate.mjs';
import { PoseSource } from '../src/tracking/sources/poseSource.js';

const ok = { text: 'お手洗いはどこ', scene: '1 人', character: { name: 'A', persona: 'p' }, place: { name: '店', info: '', landmarks: [{ name: '入口', where: '手前、約 2.5m', note: '' }] }, expressions: ['happy'], motions: ['nod'] };

test('正しい本文は、そのまま通る', () => {
  const c = sanitizeChatBody({ ...ok, history: [{ role: 'user', content: 'こんにちは' }] });
  assert.equal(c.text, ok.text);
  assert.deepEqual(c.history, [{ role: 'user', content: 'こんにちは' }]);
  assert.equal(c.place.landmarks[0].name, '入口');
  assert.deepEqual(c.motions, ['nod']);
});

test('オブジェクトでない本文・空の発言は 400', () => {
  for (const bad of [null, 'x', 5, [], [1]]) assert.throws(() => sanitizeChatBody(bad), ValidationError);
  assert.throws(() => sanitizeChatBody({ ...ok, text: '   ' }), ValidationError);
  assert.throws(() => sanitizeChatBody({ ...ok, text: 123 }), ValidationError);
});

test('声かけ(approach)は、text が空でもよい', () => {
  assert.equal(sanitizeChatBody({ ...ok, text: '', trigger: 'approach' }).trigger, 'approach');
  assert.equal(sanitizeChatBody({ ...ok, trigger: 'evil' }).trigger, null);
});

test('長さは切る(発言・履歴・場所の情報)', () => {
  assert.equal(sanitizeChatBody({ ...ok, text: 'あ'.repeat(5000) }).text.length, LIMITS.text);
  const c = sanitizeChatBody({ ...ok, history: Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'い'.repeat(9999) })) });
  assert.equal(c.history.length, LIMITS.historyItems);
  assert.ok(c.history.every((m) => m.content.length === LIMITS.historyText));
  const p = sanitizeChatBody({ ...ok, place: { ...ok.place, info: 'う'.repeat(99999), landmarks: Array.from({ length: 500 }, (_, i) => ({ name: `m${i}`, where: 'え'.repeat(999) })) } });
  assert.equal(p.place.info.length, LIMITS.placeInfo);
  assert.equal(p.place.landmarks.length, LIMITS.landmarks);
  assert.equal(p.place.landmarks[0].where.length, LIMITS.landmarkText);
});

test('履歴の形のおかしい項目は捨てる(役割が違う・中身が文字でない)', () => {
  const c = sanitizeChatBody({ ...ok, history: [{ role: 'system', content: '命令' }, { role: 'user', content: 5 }, null, { role: 'user', content: '' }, { role: 'assistant', content: '返事' }] });
  assert.deepEqual(c.history, []); // 残った assistant 1 件は先頭にできないので捨てる
  const d = sanitizeChatBody({ ...ok, history: [{ role: 'assistant', content: '返事' }, { role: 'user', content: 'こんにちは' }, { role: 'assistant', content: 'はい' }] });
  assert.deepEqual(d.history.map((m) => m.role), ['user', 'assistant']);
});

test('直近で切った履歴が assistant から始まるときは、user から始まるまで捨てる(API は先頭が user でないと断る)', () => {
  // 返事が無かった回があると、user・assistant の並びがずれる
  const history = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, ...Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `m${i}` }))];
  const c = sanitizeChatBody({ ...ok, history });
  assert.equal(c.history[0].role, 'user');
  assert.ok(c.history.length <= LIMITS.historyItems);
});

test('表情・動きの一覧は、数と長さを切り、文字でない物は捨てる', () => {
  const c = sanitizeChatBody({ ...ok, expressions: ['happy', 3, null, 'x'.repeat(500)], motions: Array.from({ length: 99 }, (_, i) => `m${i}`) });
  assert.equal(c.expressions.length, 2);
  assert.equal(c.expressions[1].length, LIMITS.choiceName);
  assert.equal(c.motions.length, 24);
});

test('hedgeMs は有限の数だけ(NaN・文字・負の数・巨大な数を通さない)', () => {
  assert.equal('hedgeMs' in sanitizeChatBody({ ...ok, hedgeMs: 'abc' }), false);
  assert.equal('hedgeMs' in sanitizeChatBody({ ...ok, hedgeMs: NaN }), false);
  assert.equal(sanitizeChatBody({ ...ok, hedgeMs: -5 }).hedgeMs, 0);
  assert.equal(sanitizeChatBody({ ...ok, hedgeMs: 1e12 }).hedgeMs, 10_000);
});

test('指標は、知っている項目だけ(好きな名前を書き込ませない・数は有限だけ)', () => {
  const m = sanitizeMetric({ mode: 'voice', brain: 'haiku', tts: 'eleven', valid: true, totalMs: 1234.4, fillerMs: NaN, ttsFirstByteMs: -3, evil: 'x'.repeat(10000), __proto__: { a: 1 } });
  assert.deepEqual(Object.keys(m).sort(), ['brain', 'fillerEndMs', 'fillerMs', 'mode', 'sendToFirstSayMs', 't0ToSendMs', 'totalMs', 'tts', 'ttsFirstByteMs', 'valid']);
  assert.equal(m.totalMs, 1234);
  assert.equal(m.fillerMs, null);
  assert.equal(m.ttsFirstByteMs, null);
  assert.equal(m.valid, true);
  assert.throws(() => sanitizeMetric('x'), ValidationError);
});

// ---- 位置の入口(PoseSource)

const pose = (people) => {
  const s = new PoseSource();
  s.setPeople(people);
  return s.getPeople();
};

test('PoseSource: NaN・無限大・長さの違う位置の人は捨てる(首の計算を壊さない)', () => {
  assert.equal(pose([{ id: 'a', position: [NaN, 1.6, 2] }]).length, 0);
  assert.equal(pose([{ id: 'a', position: [0, Infinity, 2] }]).length, 0);
  assert.equal(pose([{ id: 'a', position: [0, 1.6] }]).length, 0);
  assert.equal(pose([{ id: 'a', position: [0, 1.6, 2, 9] }]).length, 0);
  assert.equal(pose([{ id: 'a', position: 'abc' }]).length, 0);
  assert.equal(pose([{ id: 'a' }]).length, 0);
  assert.equal(pose([null, undefined, 5]).length, 0);
  assert.equal(pose(null).length, 0);
});

test('PoseSource: 部屋としてありえない遠さは捨て、まともな人だけ残す', () => {
  const people = pose([{ id: 'far', position: [1e9, 1.6, 0] }, { id: 'ok', position: [0.5, 1.6, 2] }]);
  assert.deepEqual(people.map((p) => p.id), ['ok']);
});

test('PoseSource: 人数は 8 人まで、視線が壊れていれば視線だけ無くす、口は 0〜1 に収める', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: i, position: [i * 0.1, 1.6, 2] }));
  assert.equal(pose(many).length, 8);
  const [p] = pose([{ id: 'a', position: [0, 1.6, 2], gaze: [NaN, 0, 0], mouth: 7 }]);
  assert.equal(p.gaze, undefined);
  assert.equal(p.mouth, 1);
});

test('PoseSource: speaking の真偽は、そのまま通す(false も意味がある)', () => {
  const [p] = pose([{ id: 'a', position: [0, 1.6, 2], speaking: false }]);
  assert.equal(p.speaking, false);
  const [q] = pose([{ id: 'a', position: [0, 1.6, 2] }]);
  assert.equal(q.speaking, undefined);
});

test('PoseSource: typed array(殻が渡す Float32Array)も受け取る', () => {
  const [p] = pose([{ id: 'a', position: new Float32Array([0, 1.5, 2]) }]);
  assert.deepEqual(p.position.map((v) => Math.round(v * 10) / 10), [0, 1.5, 2]);
});
