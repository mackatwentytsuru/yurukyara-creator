// 仮の頭脳の初めてのあいさつ。人格の文に「初めてのあいさつ」の節があるキャラは、はじめての「はじめまして」にその文で名乗る。
// 安全の層(つらい話の決まった案内・出力の確かめ)は、あいさつより先に通る。本物の API は呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn } from '../server/brain.mjs';

const PERSONA = readFileSync(join(import.meta.dirname, '..', '..', 'characters', 'norrie', 'persona.md'), 'utf8');
const MOTIONS = ['none', 'nod', 'bow', 'wave', 'tilt'];

async function turn(body, opts = {}) {
  const events = [];
  await runTurn({ motions: MOTIONS, ...body }, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0, ...opts });
  return { events, said: events.filter((e) => e.type === 'say') };
}

test('ノリー: はじめての「はじめまして」に、人格の文の初めてのあいさつで名乗る(おじぎ → うなずき → 手をふる)', async () => {
  const { events, said } = await turn({ text: 'はじめまして', character: { name: 'ノリー', persona: PERSONA } });
  assert.equal(events[0].type, 'meta');
  assert.equal(events[0].brain, 'mock');
  assert.deepEqual(said.map((s) => s.text), ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリ、がんばりマス! なにをお手伝いしまショウ?']);
  assert.deepEqual(said.map((s) => s.motion), ['bow', 'nod', 'wave']);
  assert.equal(events.find((e) => e.type === 'thought').stage, 'greet');
});

test('おじぎ・手をふる動きが無いキャラでは none に落ちる', async () => {
  const { said } = await turn({ text: 'こんにちは', motions: ['none', 'nod'], character: { name: 'ノリー', persona: PERSONA } });
  assert.deepEqual(said.map((s) => s.motion), ['none', 'nod', 'none']);
});

test('話の途中のあいさつ・覚えている人へのあいさつは、初めてのあいさつにしない', async () => {
  const history = [{ role: 'user', content: 'やあ' }, { role: 'assistant', content: 'こんにちは。' }];
  const mid = await turn({ text: 'こんにちは', history, character: { name: 'ノリー', persona: PERSONA } });
  assert.ok(!mid.said.some((s) => s.text.includes('ノリーと申しマス')));
  const memory = { text: '- 名前: タロウ', items: [{ kind: 'name', text: '名前: タロウ' }] };
  const again = await turn({ text: 'こんにちは', character: { name: 'ノリー', persona: PERSONA } }, { memory });
  assert.match(again.said[0].text, /タロウさん/);
  assert.ok(!again.said.some((s) => s.text.includes('ノリーと申しマス')));
});

test('初めてのあいさつの節が無いキャラ(作例)は、今までどおりのあいさつ', async () => {
  const { said } = await turn({ text: 'こんにちは、はじめまして', character: { name: 'みかんちゃん', persona: '# みかんちゃん\n- 一人称は「わたし」。' } });
  assert.deepEqual(said.map((s) => s.text), ['こんにちは。', '今日は、どんなお話をしようか。']);
});

test('安全の層が先: あいさつにつらい言葉が混ざれば、決まった案内(初めてのあいさつは言わない)', async () => {
  const { events, said } = await turn({ text: 'はじめまして。もう死にたい', character: { name: 'ノリー', persona: PERSONA } });
  assert.equal(events[0].safety, 'distress');
  assert.ok(said.some((s) => s.text.includes('119')));
  assert.ok(!said.some((s) => s.text.includes('ノリーと申しマス')));
});

test('人格の欄に書かれた危ないあいさつは、出力の確かめで差し替わる', async () => {
  const persona = '## 初めてのあいさつ\n- はじめまして。あなただけを見ているよ。';
  const { said } = await turn({ text: 'はじめまして', character: { name: 'テスト', persona } });
  assert.equal(said.length, 1);
  assert.equal(said[0].guarded, true);
  assert.ok(!said[0].text.includes('あなただけ'));
});
