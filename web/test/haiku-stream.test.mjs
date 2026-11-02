// 本物の API の代わりに偽の Anthropic サーバーを立てて、流し読みの読み取りを確かめる。
// 本物の鍵が無くても、Haiku の返事の形(1 行 1 つの JSON)を正しく扱えるかを試験する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
const delta = (text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });

async function withFakeApi(chunks, fn) {
  let seen = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // 行の途中で切れる形で、少しずつ流す
      let i = 0;
      const tick = () => {
        if (i < chunks.length) {
          res.write(sse([delta(chunks[i++])]));
          setTimeout(tick, 5);
        } else {
          res.write(sse([{ type: 'message_stop' }]));
          res.end();
        }
      };
      tick();
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  const { runTurn } = await import(`../server/brain.mjs?${Math.random()}`);
  try {
    return await fn(runTurn, () => seen);
  } finally {
    server.close();
  }
}

test('Haiku の流れから thought と say を 1 行ずつ取り出す(途中で切れても)', async () => {
  const chunks = [
    '{"type":"thought","seen":"1 人が近くにいる","intent":"お手洗い","stage":"gu',
    'ide","handoff":false}\n{"type":"say","text":"お手洗いですね。","expression":"happy","motion":"nod","gaze":"person"}\n{"type":"sa',
    'y","text":"左奥です。","expression":"happy","motion":"point","gaze":"landmark:お手洗い"}',
  ];
  await withFakeApi(chunks, async (runTurn, seen) => {
    const events = [];
    await runTurn(
      { text: 'お手洗いはどこ', scene: '1 人が見えている', place: { name: '試し', landmarks: [{ name: 'お手洗い', where: '左奥' }] } },
      { onEvent: (e) => events.push(e), signal: new AbortController().signal },
    );
    const types = events.map((e) => e.type);
    assert.deepEqual(types, ['meta', 'thought', 'say', 'say', 'meta']);
    assert.equal(events[0].brain, 'haiku');
    assert.equal(events[1].stage, 'guide');
    assert.equal(events[3].gaze, 'landmark:お手洗い');
    assert.equal(events[3].motion, 'point');
    // 送った内容: モデル名・ストリーム・見えている様子・システム指示に目印
    const sent = seen();
    assert.equal(sent.body.model, 'claude-haiku-5-5');
    assert.equal(sent.body.stream, true);
    assert.match(sent.body.messages.at(-1).content, /1 人が見えている/);
    assert.match(sent.body.system[0].text, /お手洗い: 左奥/);
    assert.equal(sent.headers['x-api-key'], 'test-key-not-real');
  });
});

test('API がエラーを返したら、分かる言葉で例外にする', async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(401).end('{"error":"invalid x-api-key"}'));
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  const { runTurn } = await import(`../server/brain.mjs?${Math.random()}`);
  try {
    await assert.rejects(
      runTurn({ text: 'こんにちは' }, { onEvent: () => {}, signal: new AbortController().signal }),
      /401/,
    );
  } finally {
    server.close();
  }
});
