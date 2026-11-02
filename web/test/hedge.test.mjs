// ヘッジ(最初の文字が遅いとき、2 本目を送って早い方を使う)の試験。本物の API の代わりに偽のサーバーを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

const delta = (text) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
const start = (usage) => `data: ${JSON.stringify({ type: 'message_start', message: { usage } })}\n\n`;

/** 1 本目は firstDelays[0] ms 後に最初の文字、2 本目は firstDelays[1] ms 後。呼ばれた回数と、止められた回数を数える */
async function fakeApi(firstDelays) {
  const state = { requests: 0, aborted: 0 };
  const server = createServer((req, res) => {
    const n = state.requests++;
    req.resume();
    let closedEarly = true;
    res.on('close', () => closedEarly && state.aborted++);
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(start({ input_tokens: 10, cache_read_input_tokens: 1200 }));
      setTimeout(() => {
        res.write(delta(`{"type":"say","text":"返事${n}","expression":"happy","motion":"none","gaze":"person"}\n`));
        closedEarly = false;
        res.end();
      }, firstDelays[n] ?? 0);
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  return { state, close: () => server.close() };
}

async function turn(hedge) {
  const { runTurn } = await import(`../server/brain.mjs?${Math.random()}`);
  const events = [];
  await runTurn({ text: 'こんにちは' }, { onEvent: (e) => events.push(e), signal: new AbortController().signal, hedge });
  return events;
}

test('最初の文字が遅いとき、2 本目が先に来れば、2 本目を使う', async () => {
  const api = await fakeApi([600, 0]);
  try {
    const events = await turn({ afterMs: 100, take: () => true });
    const says = events.filter((e) => e.type === 'say');
    assert.deepEqual(says.map((e) => e.text), ['返事1']); // 1 本目の返事は混ざらない
    const meta = events.at(-1);
    assert.equal(meta.hedged, true);
    assert.equal(meta.winner, 'b');
    assert.equal(meta.usage.cacheRead, 1200);
    assert.equal(api.state.requests, 2);
  } finally {
    api.close();
  }
});

test('1 本目が間に合えば、2 本目は送らない(費用が増えない)', async () => {
  const api = await fakeApi([20, 0]);
  try {
    const events = await turn({ afterMs: 300, take: () => true });
    assert.equal(events.at(-1).hedged, false);
    assert.equal(events.at(-1).winner, 'a');
    assert.equal(api.state.requests, 1);
  } finally {
    api.close();
  }
});

test('回数の上限で断られたら、2 本目は送らず、1 本目を待つ', async () => {
  const api = await fakeApi([300, 0]);
  try {
    const events = await turn({ afterMs: 50, take: () => false });
    assert.equal(events.at(-1).hedged, false);
    assert.deepEqual(events.filter((e) => e.type === 'say').map((e) => e.text), ['返事0']);
    assert.equal(api.state.requests, 1);
  } finally {
    api.close();
  }
});

test('ヘッジが無効(0)なら、1 本だけ', async () => {
  const api = await fakeApi([200, 0]);
  try {
    const events = await turn({ afterMs: 0, take: () => true });
    assert.equal(events.at(-1).hedged, false);
    assert.equal(api.state.requests, 1);
  } finally {
    api.close();
  }
});
