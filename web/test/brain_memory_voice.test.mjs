// 仮の頭脳が覚えている事を話す時の言い方(CRITux 23。11-07)と、公開の関数から仮の頭脳を記憶つきで呼ぶ口(CRITsec F1)。本物の API は呼ばない。
// - 人格の文に「## 覚えている時の言い方」があれば、その子の言葉で言う(ノリー: 「タロウさん、またお会いできマシタ!」)
// - 節が無いキャラは今までの決まった文
// - runTurn(body, { brain: 'mock', paceMs: 0, memory, learned }) が、記憶と覚えた事を使う(S6 が公開の /api/chat から呼ぶ形)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn } from '../server/brain.mjs';
import { MEMORY_CUES, memoryLine } from '../server/greeting.mjs';
import { forgetReplyEvents } from '../server/memory/routes.mjs';
import { chatMemory } from '../server/memory/handler.mjs';
import { createMemoryStore } from '../api/_lib/store.mjs';

const NORRIE = readFileSync(join(import.meta.dirname, '..', '..', 'characters', 'norrie', 'persona.md'), 'utf8');
const MIKAN = '# みかんちゃん\n- 一人称は「わたし」。';
const TARO = { text: '- 名前: タロウ\n- 前に話したこと: カレーの話', items: [{ kind: 'name', text: '名前: タロウ' }, { kind: 'topic', text: '前に話したこと: カレーの話' }] };

async function mock(body, opts = {}) {
  const events = [];
  await runTurn(body, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0, ...opts });
  return events.filter((e) => e.type === 'say').map((e) => e.text);
}

test('ノリーの人格の文に、覚えている時の言い方が全部の合図ぶんある(どれも 40 字以内・カタコト)', () => {
  const words = { 名前: 'タロウ', 好きなもの: 'カレー', 話題: 'カレー' };
  for (const cue of MEMORY_CUES) {
    const line = memoryLine(NORRIE, cue, words);
    assert.ok(line, `${cue} の文がある`);
    assert.ok(Array.from(line).length <= 40, line);
    assert.match(line, /マス|マシタ|デス|ショウ/, `${cue}: ${line}`);
  }
  assert.equal(memoryLine(NORRIE, 'また会えた', {}), 'また、お会いできマシタ!', '名前を知らない時は 2 本目の行');
  assert.equal(memoryLine(MIKAN, 'また会えた', words), '', '節が無ければ空(決まった文を使う)');
  assert.equal(memoryLine(NORRIE, '知らない合図', words), '');
});

test('入れる言葉は、改行・かぎかっこを外す。40 字を超える文と、安全の決まりに反する文は使わない', () => {
  const persona = '## 覚えている時の言い方\n- 名前を覚えた: {名前}さん、デスね。\n- 好きなものを覚えた: {好きなもの}が好き。\n- また会えた: {名前}さん、恋人だよ。\n- また会えた: また会えマシタ!';
  assert.equal(memoryLine(persona, '名前を覚えた', { 名前: 'タ\nロ「ウ」' }), 'タロウさん、デスね。');
  assert.equal(memoryLine(persona, '好きなものを覚えた', { 好きなもの: 'あ'.repeat(40) }), '', '長すぎる文は言わない');
  assert.equal(memoryLine(persona, 'また会えた', { 名前: 'タロウ' }), 'また会えマシタ!', '恋人役の文は飛ばして次の行');
});

test('runTurn(brain: mock)が記憶を使う: 会話の始めに、ノリーの言葉で「また会えた」と話の続き', async () => {
  assert.deepEqual(await mock({ text: 'やあ', character: { name: 'ノリー', persona: NORRIE } }, { memory: TARO }), ['タロウさん、またお会いできマシタ!', 'カレーのお話の続き、しまショウ!']);
  assert.deepEqual(await mock({ text: 'やあ', character: { name: 'みかん', persona: MIKAN } }, { memory: TARO }), ['タロウさん、また会えたね。', 'カレーの話の続きだね。'], '節の無いキャラは今までどおり');
  const topicOnly = { text: '- 前に話したこと: カレーの話', items: [{ kind: 'topic', text: '前に話したこと: カレーの話' }] };
  assert.deepEqual(await mock({ text: 'やあ', character: { persona: NORRIE } }, { memory: topicOnly }), ['また、お会いできマシタ!', 'カレーのお話の続き、しまショウ!']);
});

test('runTurn(brain: mock)がこの回に覚えた事(learned)を使う: ノリーの言葉で「覚えマシタ」', async () => {
  const learned = [
    { id: '1', kind: 'name', text: '名前: タロウ' },
    { id: '2', kind: 'like', text: '好きなもの: カレー' },
  ];
  assert.deepEqual(await mock({ text: 'ぼくはタロウ。カレーが好き', history: [{ role: 'user', content: 'やあ' }], character: { persona: NORRIE } }, { learned }), ['タロウさん、デスね。ノリー、覚えマシタ!', 'カレーがお好きなんデスね。ノリー、覚えておきマス!', 'おうちの場所や電話は、覚えないので あんしんデス!']);
  assert.deepEqual(await mock({ text: 'ぼくはタロウ。カレーが好き', character: { persona: MIKAN } }, { learned }), ['タロウさんっていうんだね。', 'カレーが好きなんだ。覚えておくね。', 'おうちの場所や電話は、覚えないから あんしんしてね。']);
});

test('近づいた時も、覚えている人にはノリーの言葉(話の続きがあれば続き)', async () => {
  assert.deepEqual(await mock({ text: '', trigger: 'approach', character: { persona: NORRIE } }, { memory: TARO }), ['タロウさん、またお会いできマシタ!', 'カレーのお話の続き、しまショウ!']);
});

test('「わすれて」の返事も、その子の言葉(手元のサーバーと公開の関数で同じ形)', async () => {
  assert.equal(forgetReplyEvents(true, NORRIE).find((e) => e.type === 'say').text, 'わかりマシタ。覚えていたことは、全部わすれマシタ。');
  assert.equal(forgetReplyEvents(false, NORRIE).find((e) => e.type === 'say').text, 'ノリー、まだなにも覚えていなかったデス。');
  assert.equal(forgetReplyEvents(true).find((e) => e.type === 'say').text, 'わかった、覚えていたことは全部消したよ。');
  assert.deepEqual(forgetReplyEvents(true)[0], { type: 'memory', forgotten: true, via: 'chat' });
  // 公開の関数の手伝い chatMemory に人格を渡すと、同じ言葉になる
  const store = createMemoryStore();
  const req = (key) => new Request('https://example.test/api/chat', { method: 'POST', headers: { 'x-memory-key': key } });
  const { createKvMemory } = await import('../server/memory/kv.mjs');
  const { key } = await createKvMemory({ store, pepper: 'p' }).create();
  await chatMemory(req(key), 'ぼくはタロウです', { store, cfg: { pepper: 'p' }, env: {} });
  const r = await chatMemory(req(key), 'わすれて', { store, cfg: { pepper: 'p' }, env: {}, persona: NORRIE });
  assert.equal(r.handled, true);
  assert.equal(r.events.find((e) => e.type === 'say').text, 'わかりマシタ。覚えていたことは、全部わすれマシタ。');
});

test('公開の関数の形(S6 の F1): chatMemory → runTurn(brain: mock, memory, learned)で、端末をまたいだ記憶をノリーが話す', async () => {
  const store = createMemoryStore();
  const { createKvMemory } = await import('../server/memory/kv.mjs');
  const { key } = await createKvMemory({ store, pepper: 'p' }).create();
  const req = new Request('https://example.test/api/chat', { method: 'POST', headers: { 'x-memory-key': key } });
  const deps = { store, cfg: { pepper: 'p' }, env: {}, persona: NORRIE };
  const first = await chatMemory(req, 'ぼくはタロウ。カレーが好き', deps);
  assert.equal(first.handled, false);
  const events = [...first.events];
  await runTurn({ text: 'ぼくはタロウ。カレーが好き', history: [{ role: 'user', content: 'やあ' }], character: { name: 'ノリー', persona: NORRIE } }, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0, memory: first.memory, learned: first.learned });
  assert.equal(events[0].type, 'memory');
  assert.ok(events.some((e) => e.type === 'say' && e.text === 'タロウさん、デスね。ノリー、覚えマシタ!'));
  // 別の端末(同じ合鍵)で、次の会話の始め
  const again = await chatMemory(req, 'こんにちは', deps);
  const said = [];
  await runTurn({ text: 'こんにちは', character: { name: 'ノリー', persona: NORRIE } }, { onEvent: (e) => e.type === 'say' && said.push(e.text), brain: 'mock', paceMs: 0, memory: again.memory, learned: again.learned });
  assert.deepEqual(said, ['タロウさん、またお会いできマシタ!', 'カレーのお話の続き、しまショウ!']);
});
