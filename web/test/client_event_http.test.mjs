// 声を始められなかった原因の報告の受け口(POST /api/client-event)を、本物のサーバーで確かめる:
// 決まった欄だけが logs/client_events.jsonl に 1 行で残る・形の違う本文は 400・大きすぎる本文は 413・1 分の回数の上限は 429。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const WEB = join(import.meta.dirname, '..');
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer(logDir) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: logDir };
  delete env.ANTHROPIC_API_KEY;
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
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

const good = { kind: 'voice-start-failed', name: 'InvalidStateError', message: 'AudioSession category is not compatible with audio capture', stage: 'mic-open', provider: 'web', camera: true, secure: true, browser: 'ios-chrome', fellBack: false };
const post = (base, body, raw) => fetch(`${base}/api/client-event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });

test('受け口: 報告が 1 行で残る・形の違う本文は 400・大きい本文は 413・回数の上限は 429', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-http-'));
  const { proc, base } = await startServer(dir);
  try {
    const r = await post(base, { ...good, userAgent: 'Mozilla/5.0 full string', text: 'ひみつの話' });
    assert.equal(r.status, 200);
    const file = join(dir, 'client_events.jsonl');
    assert.equal(existsSync(file), true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).name, 'InvalidStateError');
    assert.equal(lines[0].includes('Mozilla'), false);
    assert.equal(lines[0].includes('ひみつ'), false);

    assert.equal((await post(base, { kind: 'nope' })).status, 400);
    assert.equal((await post(base, null, 'not json')).status, 400);
    assert.equal((await post(base, { ...good, message: 'x'.repeat(5000) })).status, 413);

    let last = 200;
    for (let i = 0; i < 10 && last === 200; i++) last = (await post(base, good)).status; // 1 分 6 回まで
    assert.equal(last, 429);
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(dir, { recursive: true, force: true });
  }
});
