// 考えの窓の下の「返事が始まるまで ○ 秒」の後ろの一言(11/7 の本物の Haiku の録画:本物の頭脳が声なしで答えた回にも
// 「(仮の頭脳か声なしなので、参考の値)」と出ていた)。「仮の頭脳」と付けるのは、仮の頭脳で話した回だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latencyNote, FAKE_BRAIN_LATENCY_NOTE } from '../src/ui/panel.js';

const read = (...p) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

test('仮の頭脳で話した回だけ「仮の頭脳なので、参考の値」。本物の頭脳なら、声が無くても付けない', () => {
  assert.equal(FAKE_BRAIN_LATENCY_NOTE, '(おためしモードなので、参考の値)');
  assert.equal(latencyNote({ brain: 'mock', tts: 'silent', valid: false }), FAKE_BRAIN_LATENCY_NOTE);
  assert.equal(latencyNote({ brain: 'mock', tts: 'eleven', valid: false }), FAKE_BRAIN_LATENCY_NOTE);
  assert.equal(latencyNote({ brain: 'haiku', tts: 'silent', valid: false }), '', '本物の頭脳・声なし(11/7 の録画の形)');
  assert.equal(latencyNote({ brain: 'haiku', tts: 'eleven', valid: true }), '');
});

test('公開の関数の仮の頭脳(記録に brain が無く、会話のイベントで仮と分かった)も付ける。記録が本物なら、付けない', () => {
  assert.equal(latencyNote({ brain: 'unknown', tts: 'silent', valid: false }, { fakeBrain: true }), FAKE_BRAIN_LATENCY_NOTE);
  assert.equal(latencyNote({ tts: 'silent' }, { fakeBrain: true }), FAKE_BRAIN_LATENCY_NOTE);
  assert.equal(latencyNote({ brain: 'unknown', tts: 'silent', valid: false }), '', '分からない時は、仮の頭脳と言わない');
  assert.equal(latencyNote({ brain: 'haiku', tts: 'silent', valid: false }, { fakeBrain: true }), '', 'この回の記録が本物の頭脳なら、前の知らせより記録を信じる');
  assert.equal(latencyNote(), '');
  assert.equal(latencyNote(null), '');
});

test('main.js: 考えの窓の下の文は latencyNote を通す(「仮の頭脳か声なしなので」を残さない)', () => {
  const main = read('main.js');
  const foot = main.slice(main.indexOf('ui.foot('), main.indexOf('app.dialogue = dialogue;'));
  assert.match(foot, /返事が始まるまで \$\{sec\(entry\.totalMs\)\}\$\{latencyNote\(entry, \{ fakeBrain: currentBrain\(\) === 'mock' \}\)\}/);
  assert.doesNotMatch(main, /仮の頭脳か声なしなので/);
});
