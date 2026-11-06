// 会話の記録の道具(server/tools/talk-transcript.mjs)の試験。本物の API は呼ばない。
// 手元のサーバーを鍵なし(仮の頭脳)で起こし、画面と同じ道(サーバーが配る persona.md → /api/chat)で台本を流す。
// 確かめること: 全部の確かめが通る / 記録にノリーの言葉と安全の層の印が残る / 本物の頭脳のサーバーでは /api/chat を呼ばずに止まる(3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTalkTranscript, SCRIPT_A, SCRIPT_B, transcriptMarkdown } from '../server/tools/talk-transcript.mjs';

const WEB = join(import.meta.dirname, '..');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startMockServer() {
  const dir = mkdtempSync(join(tmpdir(), 'yc-talk-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory') };
  // 空の値にしておくと、web/.env があっても本物の鍵で埋められない(頭脳は仮の頭脳だけ)
  Object.assign(env, { ANTHROPIC_API_KEY: '', ANTHROPIC_API_URL: 'http://127.0.0.1:9/v1/messages', ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '', MEMORY_PEPPER: '' });
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

test('仮の頭脳のサーバーで、ノリーとの台本(A 11 回・B 2 回)が全部の確かめを通る。記録にノリーの言葉と安全の層の印が残る', async () => {
  const server = await startMockServer();
  try {
    const r = await runTalkTranscript({ base: server.base });
    assert.equal(r.ok, true, JSON.stringify(r.failed));
    assert.equal(r.code, 0);
    assert.equal(r.a.length, SCRIPT_A.length);
    assert.equal(r.b.length, SCRIPT_B.length);
    assert.equal(r.brainCalls, 0, '本物の頭脳は呼んでいない');
    assert.equal(r.persona.examples, 5);
    assert.equal(r.persona.removedInB, 1);
    assert.deepEqual(r.a.filter((t) => t.safety).map((t) => t.safety), ['romance', 'dependency', 'distress']);
    const md = transcriptMarkdown(r);
    assert.match(md, /はじめまして! ノリーと申しマス。/);
    assert.match(md, /ノリ、それは調べられないデス/);
    assert.match(md, /恋人にはなれない/);
    assert.match(md, /全部の確かめが通った/);
    assert.doesNotMatch(md, /127\.0\.0\.1/, '送り先の名前は記録しない(番号だけ)');
  } finally {
    server.proc.kill();
  }
});

test('本物の頭脳のサーバーでは、/api/chat を 1 回も呼ばずに止まる(3)', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ brain: 'haiku' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await runTalkTranscript({ base: 'http://127.0.0.1:9', fetchImpl });
  assert.equal(r.code, 3);
  assert.equal(r.ok, false);
  assert.ok(!asked.some((u) => u.includes('/api/chat')), asked.join(','));
});
