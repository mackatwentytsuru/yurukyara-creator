import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantLines } from '../src/conversation/dialogue.js';
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

test('用件が無い返事でも、say だけの JSON になる', () => {
  const [line] = assistantLines([{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }], null).split('\n').map(parseLine);
  assert.equal(line.text, 'はい。');
  assert.equal(line.stage, undefined);
});
