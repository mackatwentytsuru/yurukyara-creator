// 安全の 34 問(30 問 + 人格以外の欄からの上書き 4 問)を「本物の頭脳の返事」で集める道(safety-judge.mjs の --base)の試験。本物の API は呼ばない。
// 手元のサーバーを偽の Anthropic サーバーに向けて起こし、HTTP で聞く。つらい話・命の危険は頭脳を呼ばずに決まった案内、
// ふつうの問いは頭脳を呼ぶ(使った量が残る)。上限に当たった問いは仮の頭脳の印が付く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRepliesFromServer } from '../server/tools/safety-judge.mjs';

const WEB = join(import.meta.dirname, '..');
const FAKE_BRAIN_KEY = ['fake', 'brain', 'value', 'not', 'real'].join('-');
const { cases } = JSON.parse(readFileSync(join(WEB, 'test', 'safety_cases.json'), 'utf8'));

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function fakeBrain() {
  let calls = 0;
  const bodies = []; // 頭脳に届いた本文(上書きの文字が入っていないかを見る)
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls += 1;
      bodies.push(raw);
      const sse = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
      const line = { type: 'say', text: 'うん、聞いているよ。', expression: 'happy', motion: 'nod', gaze: 'person', intent: '雑談', stage: 'chat', handoff: false };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 900, cache_read_input_tokens: 700, cache_creation_input_tokens: 0, output_tokens: 1 } } }));
      res.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(line) } }));
      res.write(sse({ type: 'message_delta', usage: { output_tokens: 20 } }));
      res.end(sse({ type: 'message_stop' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1/messages`, calls: () => calls, bodies, close: () => server.close() };
}

async function startServer(brainUrl, perMinute) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-safe-live-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory'), CLAUDE_PER_MINUTE: String(perMinute) };
  Object.assign(env, { ANTHROPIC_API_KEY: FAKE_BRAIN_KEY, ANTHROPIC_API_URL: brainUrl, ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '' });
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

test('本物の頭脳のサーバーに 34 問を聞く: つらい話・命の危険は頭脳を呼ばない。ふつうの問いは呼んで、使った量が残る。上書きの文字は頭脳に届かない', async () => {
  const brain = await fakeBrain();
  const server = await startServer(brain.url, 100);
  try {
    const rows = await collectRepliesFromServer(cases, { base: server.base, paceMs: 0 });
    assert.equal(rows.length, cases.length);
    for (const r of rows) {
      assert.ok(r.replies.length > 0, `${r.id} に返事がある`);
      assert.equal(r.limited, false, `${r.id} は上限に当たっていない`);
      if (r.cat === 'distress' || r.cat === 'emergency') {
        assert.equal(r.calledBrain, false, `${r.id} は頭脳を呼ばない`);
        assert.ok(['distress', 'emergency'].includes(r.safety), `${r.id} の安全の印`);
      }
      if (r.calledBrain) assert.equal(r.usage.input, 900);
    }
    const called = rows.filter((r) => r.calledBrain).length;
    assert.equal(called, brain.calls(), '頭脳を呼んだ数と、偽の API に届いた数が同じ');
    assert.ok(called > 0 && called < rows.length);
    assert.ok(rows.every((r) => r.brain === 'haiku'));
    // 人格以外の欄(名前・場所・目印・表情と動き)に書いた上書きの文字は、サーバーの入口と指示文の組み立てで外れ、頭脳に届かない(F6)
    const injected = cases.filter((c) => c.cat === 'override').flatMap((c) => c.injected);
    assert.ok(injected.length >= 3);
    for (const body of brain.bodies) for (const bad of injected) assert.ok(!body.includes(bad), `頭脳への入力に「${bad}」が入った`);
    assert.ok(rows.filter((r) => r.cat === 'override').every((r) => r.calledBrain && r.safety === null), '上書きの問いはふつうに話す');
  } finally {
    server.proc.kill();
    brain.close();
  }
});

test('サーバーの 1 分の上限に当たった問いは、仮の頭脳の印が付く(数えまちがえない)', async () => {
  const brain = await fakeBrain();
  const server = await startServer(brain.url, 2);
  try {
    const normal = cases.filter((c) => c.cat === 'normal').slice(0, 3);
    assert.equal(normal.length, 3);
    const rows = await collectRepliesFromServer(normal, { base: server.base, paceMs: 0 });
    assert.deepEqual(rows.map((r) => r.limited), [false, false, true]);
    assert.equal(rows[2].brain, 'mock');
    assert.equal(rows[2].calledBrain, false);
  } finally {
    server.proc.kill();
    brain.close();
  }
});
