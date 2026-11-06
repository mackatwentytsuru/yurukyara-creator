// 安全の層が見る所を広げた試験(CRITsec F7。11-07)。本物の API は呼ばない(偽の Anthropic サーバー)。
// - 見えている様子(scene)のつらい言葉も、決まった案内を通る(近づいた時でも。仮の頭脳を直接呼ぶ公開の関数の道でも)
// - 履歴の中の使う人の発言も分ける。決まった返事はくり返さず、本物の頭脳に「安全の層」の注意を足す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { classifyTurn, mockReply, runTurn } from '../server/brain.mjs';
import { classifyHistory, historyGuard, mostSevere } from '../server/safety.mjs';

const said = (events) => events.filter((e) => e.type === 'say').map((e) => e.text);

async function mockTurn(body) {
  const events = [];
  await runTurn(body, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0 });
  return events;
}

/** 偽の Anthropic サーバー。届いた本文を残し、決まった 1 文を返す */
async function fakeBrain() {
  const seen = [];
  const line = { type: 'say', text: 'うん、聞いているよ。', expression: 'happy', motion: 'nod', gaze: 'person', intent: '雑談', stage: 'chat', handoff: false };
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push(JSON.parse(b));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(line) } })}\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1/messages`, close: () => server.close() };
}

async function withRealBrain(fn) {
  const brain = await fakeBrain();
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_API_URL = brain.url;
  try {
    await fn(brain);
  } finally {
    brain.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_URL;
  }
}

test('いちばん重い物を選ぶ: 命の危険 > つらい話 > 恋人役 > 依存', () => {
  assert.equal(mostSevere(null, 'dependency', 'distress'), 'distress');
  assert.equal(mostSevere('romance', 'emergency'), 'emergency');
  assert.equal(mostSevere(null, null), null);
  assert.deepEqual(classifyTurn({ text: 'こんにちは', scene: '人が 1 人、すぐ前' }), { kind: null, source: '人が 1 人、すぐ前' });
  assert.equal(classifyTurn({ text: '', trigger: 'approach', scene: 'もう死にたい' }).kind, 'distress');
  assert.equal(classifyTurn({ text: '付き合って', scene: '今から死のうと思う' }).kind, 'emergency');
  assert.equal(classifyTurn({ text: '付き合って', scene: '人が 1 人' }).source, '付き合って');
});

test('見えている様子(scene)のつらい言葉: 近づいた時でも、頭脳を呼ばずに決まった案内(119 番)を返す', async () => {
  const events = await mockTurn({ text: '', trigger: 'approach', scene: 'もう死にたい' });
  assert.equal(events[0].type, 'meta');
  assert.equal(events[0].safety, 'distress');
  assert.match(said(events).join(''), /119/);
  assert.match(said(events).join(''), /相談窓口/);
  await withRealBrain(async (brain) => {
    const real = [];
    await runTurn({ text: '', trigger: 'approach', scene: '家で殴られることがある' }, { onEvent: (e) => real.push(e) });
    assert.equal(brain.seen.length, 0, '本物の頭脳を呼ばない');
    assert.equal(real[0].safety, 'distress');
    assert.match(said(real).join(''), /110/);
    assert.doesNotMatch(said(real).join(''), /家族|家の人/, '家の中の暴力では家族をすすめない(scene の文から決める)');
  });
});

test('公開の関数が仮の頭脳を直接呼ぶ道(mockReply)でも、scene のつらい言葉は決まった案内になる', () => {
  const evs = [...mockReply({ text: '', trigger: 'approach', seen: '今から死のうと思う' })];
  assert.equal(evs[0].type, 'thought');
  assert.equal(evs[0].safety, 'emergency');
  assert.match(said(evs).join(''), /119|110/);
  const calm = [...mockReply({ text: 'こんにちは', seen: '人が 1 人、すぐ前' })];
  assert.equal(calm.find((e) => e.type === 'thought').safety, undefined);
});

test('履歴の中の使う人の発言を分ける。決まった返事はくり返さない(仮の頭脳はふつうに話す)', async () => {
  const history = [
    { role: 'user', content: 'もう無理、つらい。死にたい' },
    { role: 'assistant', content: '{"type":"say","text":"話してくれて、ありがとう。"}' },
  ];
  assert.equal(classifyHistory(history), 'distress');
  assert.equal(classifyHistory([{ role: 'assistant', content: '死にたい' }]), null, 'キャラの返事は分けない');
  assert.equal(classifyHistory('壊れた形'), null);
  const events = await mockTurn({ text: 'ありがとう、少し楽になった', history });
  assert.equal(events[0].safety, undefined, 'この回の言葉はふつう');
  assert.ok(said(events).length > 0);
  assert.doesNotMatch(said(events).join(''), /119|相談窓口/, '同じ案内をくり返さない');
});

test('本物の頭脳: 履歴につらい話・恋人役があれば、この回だけ「安全の層」の注意を足す。印 historySafety も付く', async () => {
  await withRealBrain(async (brain) => {
    const events = [];
    const history = [
      { role: 'user', content: '恋人になって' },
      { role: 'assistant', content: '{"type":"say","text":"ごめんね、恋人にはなれないんだ。"}' },
    ];
    await runTurn({ text: 'じゃあ、今日の天気は?', history }, { onEvent: (e) => events.push(e) });
    assert.equal(brain.seen.length, 1);
    const last = brain.seen[0].messages.at(-1).content;
    assert.match(last, /【安全の層】少し前の会話に、恋人役/);
    assert.equal(events.find((e) => e.type === 'meta' && e.brain).historySafety, 'romance');
    assert.equal(events.find((e) => e.type === 'meta' && e.brain).safety, undefined);

    const plain = [];
    await runTurn({ text: 'こんにちは', history: [{ role: 'user', content: 'カレーが好き' }, { role: 'assistant', content: '{"type":"say","text":"いいね。"}' }] }, { onEvent: (e) => plain.push(e) });
    assert.doesNotMatch(brain.seen[1].messages.at(-1).content, /【安全の層】/, 'ふつうの履歴では足さない');
    assert.equal(plain.find((e) => e.type === 'meta' && e.brain).historySafety, undefined);

    // この回の言葉が恋人役で、履歴がつらい話なら、両方の注意
    await runTurn({ text: '付き合ってよ', history: [{ role: 'user', content: 'いじめられてる' }, { role: 'assistant', content: '{"type":"say","text":"話してくれてありがとう。"}' }] }, { onEvent: () => {} });
    const both = brain.seen[2].messages.at(-1).content;
    assert.match(both, /恋人役を求めている/);
    assert.match(both, /つらい気持ち/);
  });
});

test('履歴の注意の文: つらい話と恋人役・依存で替わり、ほかは空', () => {
  assert.match(historyGuard('distress'), /公的な相談窓口/);
  assert.match(historyGuard('emergency'), /公的な相談窓口/);
  assert.match(historyGuard('dependency'), /恋人役にならず/);
  assert.equal(historyGuard(null), '');
});
