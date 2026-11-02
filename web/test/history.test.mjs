import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_KEEP, assistantLines, trimHistory } from '../src/conversation/dialogue.js';
import { parseLine } from '../server/brain.mjs';

test('履歴の返事は、指示どおりの JSON の形(1 行 1 つ、最初の行に用件と段階)に戻す', () => {
  const says = [
    { type: 'say', text: 'お手洗いですね。', expression: 'happy', motion: 'nod', gaze: 'person' },
    { type: 'say', text: '左奥です。', expression: 'happy', motion: 'point', gaze: 'landmark:お手洗い' },
  ];
  const text = assistantLines(says, { intent: 'お手洗いの案内', stage: 'guide', handoff: false });
  const lines = text.split('\n').map(parseLine);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, 'say');
  assert.equal(lines[0].stage, 'guide');
  assert.equal(lines[0].intent, 'お手洗いの案内');
  assert.equal(lines[1].intent, undefined); // 用件は最初の行だけ
  assert.equal(lines[1].gaze, 'landmark:お手洗い');
});

test('履歴は直近 24 件で止まり、先頭は user から(長い一日の後でも本文が増え続けない)', () => {
  let h = [];
  for (let i = 0; i < 500; i++) h = trimHistory([...h, { role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` }]);
  assert.ok(h.length <= HISTORY_KEEP);
  assert.equal(h[0].role, 'user');
  assert.equal(h.at(-1).content, 'a499');
});

test('履歴の切り方: 返事が無い回があって assistant から始まる位置で切れたら、user まで進める', () => {
  const h = [{ role: 'user', content: '1' }, { role: 'assistant', content: 'a' }, { role: 'user', content: '2' }];
  assert.deepEqual(trimHistory(h, 2).map((m) => m.content), ['2']); // 末尾 2 件は [assistant, user] なので、assistant を捨てる
  assert.deepEqual(trimHistory([{ role: 'assistant', content: 'x' }], 5), []);
  assert.deepEqual(trimHistory([], 5), []);
});

test('用件が無い返事でも、say だけの JSON になる', () => {
  const [line] = assistantLines([{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }], null).split('\n').map(parseLine);
  assert.equal(line.text, 'はい。');
  assert.equal(line.stage, undefined);
});
