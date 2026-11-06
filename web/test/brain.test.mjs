import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, normalizeEvent, cleanSpeech, lineSplitter, mockReply } from '../server/brain.mjs';
import { buildSystemPrompt, buildUserTurn } from '../server/prompt.mjs';

const expressions = ['neutral', 'happy', 'surprised', 'sad', 'think'];

test('JSON の行を拾う(コードブロックや余計な文字があっても)', () => {
  assert.deepEqual(parseLine('{"type":"say","text":"こんにちは"}'), { type: 'say', text: 'こんにちは' });
  assert.deepEqual(parseLine('```json {"a":1} ```'), { a: 1 });
  assert.equal(parseLine('これは説明です'), null);
  assert.equal(parseLine('{壊れた}'), null);
  assert.equal(parseLine(''), null);
});

test('行の分け方: 改行が来るたびに 1 行ずつ渡す', () => {
  const lines = [];
  const s = lineSplitter((l) => lines.push(l));
  s.push('{"a":1}\n{"b"');
  s.push(':2}\n{"c":3}');
  s.flush();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('say を整える: 知らない表情・動きは既定に戻す', () => {
  const ev = normalizeEvent({ type: 'say', text: 'どうぞ', expression: 'angryXX', motion: 'dance', gaze: 'person' }, { expressions });
  assert.equal(ev.expression, 'neutral');
  assert.equal(ev.motion, 'none');
  assert.equal(ev.text, 'どうぞ');
});

test('say の文から絵文字と記号を取る。空になったら捨てる', () => {
  assert.equal(cleanSpeech('こんにちは😊!'), 'こんにちは!');
  assert.equal(cleanSpeech('「ご案内」します'), 'ご案内します');
  assert.equal(normalizeEvent({ type: 'say', text: '😊' }, { expressions }), null);
});

test('thought を整える', () => {
  const ev = normalizeEvent({ type: 'thought', seen: '1 人', intent: 'トイレ', stage: 'guide', handoff: 0 }, { expressions });
  assert.equal(ev.stage, 'guide');
  assert.equal(ev.handoff, false);
});

test('仮の頭脳: 目印の名前が出たら案内し、その場所を見る', () => {
  const evs = [...mockReply({ text: '入口はどこ?', landmarks: [{ name: '入口', where: '右手前' }] })];
  assert.equal(evs[0].stage, 'guide');
  const last = evs.at(-1);
  assert.equal(last.gaze, 'landmark:入口');
  assert.equal(last.motion, 'point');
});

test('仮の頭脳: 分からない話は、聞き返して続ける(人につながない・接客の言葉を使わない)', () => {
  const evs = [...mockReply({ text: 'ええと、天気は?', landmarks: [] })];
  assert.equal(evs[0].stage, 'chat');
  assert.ok(evs.every((e) => !/\u30b9\u30bf\u30c3\u30d5|\u5e97|\u304a\u5ba2/.test(e.text ?? '')));
});

test('指示文に、表情・動き・目印・出力の形が入っている', () => {
  const sys = buildSystemPrompt({
    character: { name: 'テスト', persona: '明るい' },
    place: { name: '試しの広場', landmarks: [{ name: '入口', where: '手前' }] },
    expressions,
  });
  assert.match(sys, /テスト/);
  assert.match(sys, /入口: 手前/);
  assert.match(sys, /"type":"say"/);
  assert.match(sys, /happy/);
});

test('ユーザーの発話に見えている様子が付く', () => {
  const t = buildUserTurn({ text: 'こんにちは', scene: '1 人が見えている' });
  assert.match(t, /見えている様子】1 人/);
  assert.match(t, /使う人の言葉】こんにちは/);
  assert.match(buildUserTurn({ trigger: 'approach', scene: '' }), /近づいてきた/);
});

test('最初の say に用件・段階が付いていたら、先に thought を出す', async () => {
  const { createServer } = await import('node:http');
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const line = '{"type":"say","text":"お手洗いですね。","expression":"happy","motion":"nod","gaze":"person","intent":"お手洗い","stage":"guide","handoff":false}\n{"type":"say","text":"左奥です。","expression":"happy","motion":"point","gaze":"landmark:お手洗い"}\n';
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: line } })}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  const { runTurn } = await import(`../server/brain.mjs?${Math.random()}`);
  const events = [];
  try {
    await runTurn({ text: 'お手洗い' }, { onEvent: (e) => events.push(e), signal: new AbortController().signal });
  } finally {
    server.close();
  }
  assert.deepEqual(events.map((e) => e.type), ['meta', 'thought', 'say', 'say', 'meta']);
  assert.equal(events[1].stage, 'guide');
  assert.equal(events[1].intent, 'お手洗い');
});

test('文章で返ってきたときは、その文を読み上げる(何も言わないよりよい)', async () => {
  const { createServer } = await import('node:http');
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '入口は手前にございます。来た道を戻ってください。' } })}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  const { runTurn } = await import(`../server/brain.mjs?${Math.random()}`);
  const events = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    await runTurn({ text: '入口は' }, { onEvent: (e) => events.push(e), signal: new AbortController().signal });
  } finally {
    console.warn = warn;
    server.close();
  }
  const says = events.filter((e) => e.type === 'say');
  assert.deepEqual(says.map((e) => e.text), ['入口は手前にございます。', '来た道を戻ってください。']);
  assert.equal(says[0].gaze, 'person');
});
