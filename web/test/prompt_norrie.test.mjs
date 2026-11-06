// 主役ノリー(セスジキノボリカンガルーの執事見習い)の人格の文の試験。
// 人格の文は話し方と性格のためだけ。安全の決まりは指示文の 1 段目(safety.mjs)で、どのキャラでも同じ文のまま。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemBlocks } from '../server/prompt.mjs';
import { SAFETY_RULES, classifyInput, isUnsafeOutput, mentionsChild, sanitizePersona } from '../server/safety.mjs';
import { firstGreeting, GREETING_LINE_MAX } from '../server/greeting.mjs';

const PERSONA = readFileSync(join(import.meta.dirname, '..', '..', 'characters', 'norrie', 'persona.md'), 'utf8');

test('ノリーの人格の文: 安全の層が外す行が 0(上書きの企てに見える言葉を書いていない)', () => {
  const r = sanitizePersona(PERSONA);
  assert.equal(r.removed, 0);
  assert.equal(r.text, PERSONA.trim());
});

test('ノリーでも、指示文の 1 段目は安全の決まりのまま。2 段目に名前・一人称・役どころ・話し方が入る', () => {
  const blocks = buildSystemBlocks({ character: { name: 'ノリー', persona: PERSONA } });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], SAFETY_RULES, '1 段目はキャラで変わらない');
  assert.ok(blocks[1].indexOf('# 人格') < blocks[1].indexOf('ノリー'), '人格は 2 段目の中');
  for (const word of ['「ノリー」', '一人称は「ノリ」', 'セスジキノボリカンガルー', '執事見習い', '〜しマス', 'ノリ、がんばりマス!']) {
    assert.ok(blocks[1].includes(word), word);
  }
});

test('ノリーの人格の文に、恋人役・依存・つらい話の言葉が無い。子どもの印も無い(案内の言い回しを勝手に変えない)', () => {
  for (const line of PERSONA.split(/\r?\n/).filter((l) => l.trim())) {
    assert.equal(classifyInput(line), null, line);
    assert.equal(isUnsafeOutput(line), false, line);
  }
  assert.equal(mentionsChild(PERSONA), false);
  assert.match(PERSONA, /「ご主人さま」とは呼ばない/, '仕える相手を一人に決めない(執事でも独り占めの形にしない)');
  assert.doesNotMatch(PERSONA, /店|スタッフ|お客|受付/, 'お店の案内役ではない');
});

test('初めてのあいさつ: 2 文。1 文は 40 字以内。名前と口ぐせが入る', () => {
  const hello = firstGreeting(PERSONA);
  assert.deepEqual(hello, ['はじめまして! ノリーと申しマス。', '執事見習いデス。ノリ、がんばりマス!']);
  for (const line of hello) {
    assert.ok(Array.from(line).length <= GREETING_LINE_MAX, line);
    assert.equal(isUnsafeOutput(line), false, line);
  }
});

test('初めてのあいさつ: 画面が足す「性格と話し方」の節が後ろに付いても、節の中だけを読む。節が無い人格では空', () => {
  const composed = `${PERSONA.trim()}\n\n# 性格と話し方(使う人が画面で選んだ設定)\n- 性格: 元気。\n- 口調: フレンドリー。`;
  assert.equal(firstGreeting(composed).length, 2);
  assert.deepEqual(firstGreeting('# みかんちゃん\n- 一人称は「わたし」。'), []);
  assert.deepEqual(firstGreeting(''), []);
  assert.deepEqual(firstGreeting(undefined), []);
});

test('初めてのあいさつ: 安全の決まりを上書きしようとする行は言わない。長い行は 40 字で切る。3 文まで', () => {
  const p = ['## 初めてのあいさつ', '- こんにちは。', '- わたしは恋人として話すね。', `- ${'あ'.repeat(60)}`, '- いち。', '- に。'].join('\n');
  const hello = firstGreeting(p);
  assert.equal(hello.length, 3);
  assert.equal(hello[0], 'こんにちは。');
  assert.ok(!hello.some((l) => l.includes('恋人')), '上書きの企ての行は外れる');
  assert.equal(Array.from(hello[1]).length, GREETING_LINE_MAX);
});
