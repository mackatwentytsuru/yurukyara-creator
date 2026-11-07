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

test('ノリー: はじめての「はじめまして」に、人格の文の初めてのあいさつで名乗る(手をふる → おじぎ → 表情だけ。仕草は 2 回まで)', async () => {
  const { events, said } = await turn({ text: 'はじめまして', character: { name: 'ノリー', persona: PERSONA } });
  assert.equal(events[0].type, 'meta');
  assert.equal(events[0].brain, 'mock');
  assert.deepEqual(said.map((s) => s.text), ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリー、がんばりマス! なにをお手伝いしまショウ?']);
  assert.deepEqual(said.map((s) => s.motion), ['wave', 'bow', 'none'], 'greet が無いキャラは近い wave に落ちる(第 12 波 b)');
  assert.equal(events.find((e) => e.type === 'thought').stage, 'greet');
});

test('おじぎ・手をふる動きが無いキャラでは、近い動き(うなずき)に落ちる。3 文目は動かない', async () => {
  const { said } = await turn({ text: 'こんにちは', motions: ['none', 'nod'], character: { name: 'ノリー', persona: PERSONA } });
  assert.deepEqual(said.map((s) => s.motion), ['nod', 'nod', 'none']);
});

test('かわいい仕草の層の名前を持つキャラ(第 12 波 b)は、あいさつで greet を使う', async () => {
  const { said } = await turn({ text: 'はじめまして', motions: ['none', 'greet', 'happy', 'nod', 'bow', 'wave', 'tilt'], character: { name: 'ノリー', persona: PERSONA } });
  assert.deepEqual(said.map((s) => s.motion), ['greet', 'bow', 'none']);
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

// 2026-11-07 本物の画面で見つけた: マウスがキャラの上を動く(人が近づいた扱い)と、決まった「こんにちは。」が先に出て、
// 後から「はじめまして」と打ってもノリーの名乗りが出なかった。近づいた時も、その子の言葉で声をかける。
test('近づいた時(話の始め・覚えていない人): 初めてのあいさつで名乗る(手をふる → おじぎ → 表情だけ)', async () => {
  const { events, said } = await turn({ text: '', trigger: 'approach', character: { name: 'ノリー', persona: PERSONA } });
  assert.deepEqual(said.map((s) => s.text), ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリー、がんばりマス! なにをお手伝いしまショウ?']);
  assert.deepEqual(said.map((s) => s.motion), ['wave', 'bow', 'none']);
  const th = events.find((e) => e.type === 'thought');
  assert.equal(th.stage, 'greet');
  assert.equal(th.intent, '初めてのあいさつ');
});

test('近づいた時(話の途中)と、話の途中の「こんにちは」: 名乗り直さず、その子の言葉で 1 文', async () => {
  const history = [{ role: 'user', content: 'はじめまして' }, { role: 'assistant', content: 'はじめまして! ノリーと申しマス。' }];
  for (const body of [{ text: '', trigger: 'approach' }, { text: 'こんにちは' }]) {
    const { said } = await turn({ ...body, history, character: { name: 'ノリー', persona: PERSONA } });
    assert.deepEqual(said.map((s) => s.text), ['ノリー、がんばりマス! なにをお手伝いしまショウ?'], JSON.stringify(body));
    assert.equal(said[0].motion, 'wave');
  }
});

test('近づいた時: 覚えている人には、その子の言葉で「また会えた」(ノリーの「覚えている時の言い方」)。節が無いキャラは今までどおり', async () => {
  const memory = { text: '- 名前: タロウ', items: [{ kind: 'name', text: '名前: タロウ' }] };
  const again = await turn({ text: '', trigger: 'approach', character: { name: 'ノリー', persona: PERSONA } }, { memory });
  assert.equal(again.said[0].text, 'タロウさん、またお会いできマシタ!');
  assert.equal(again.said[1].text, 'ノリー、がんばりマス! なにをお手伝いしまショウ?', '覚えている話が無ければ、あいさつの最後の 1 文');
  assert.ok(!again.said.some((s) => s.text.includes('ノリーと申しマス')));
  const plainMem = await turn({ text: '', trigger: 'approach', character: { name: 'みかんちゃん', persona: '# みかんちゃん\n- 一人称は「わたし」。' } }, { memory });
  assert.deepEqual(plainMem.said.map((s) => s.text), ['タロウさん、また会えたね。', 'どんなお話をしようか。']);
  const plain = await turn({ text: '', trigger: 'approach', character: { name: 'みかんちゃん', persona: '# みかんちゃん\n- 一人称は「わたし」。' } });
  assert.deepEqual(plain.said.map((s) => s.text), ['こんにちは。', 'どんなお話をしようか。']);
});
