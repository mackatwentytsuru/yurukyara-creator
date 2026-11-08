// 名前の向け直し(DNS rebinding)と、よそのページからの書き込みを、どの道でも頭で断ることを、本物のサーバーで確かめる:
// よその Host は /api/chat も配るファイルも 403 で、頭脳(Claude)の受け手には 1 回も届かない。
// よその Origin の POST も 403。localhost・--lan の住所・.ts.net の名前は通る。Origin が無い頼みも通る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer, request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { allowedHostNames, originAllowed } from '../server/staticGuard.mjs';

const WEB = join(import.meta.dirname, '..');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** 頭脳の受け手のかわり。届いた数を数える */
async function startFakeBrain() {
  const state = { hits: 0 };
  const srv = createHttpServer((req, res) => {
    state.hits++;
    req.resume();
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { state, srv, url: `http://127.0.0.1:${srv.address().port}/v1/messages` };
}

async function startServer(env) {
  const port = await freePort();
  const full = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE', 'YC_ALLOWED_HOSTS']) delete full[k];
  Object.assign(full, { PORT: String(port), HOST: '127.0.0.1' }, env);
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env: full, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  for (let i = 0; i < 150; i++) {
    try {
      if ((await send(port, 'GET', '/api/status')).status === 200) return { proc, port };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** Host と Origin をそのまま送る(fetch は Host を変えられないので node:http で) */
function send(port, method, path, { host = `127.0.0.1:${port}`, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const CHAT = JSON.stringify({ text: 'こんにちは', history: [] });

test('originAllowed: Origin が無ければ通り、表の名前と .ts.net だけが通る', () => {
  const names = allowedHostNames({ bindHost: '127.0.0.1', extra: '', nets: {}, machine: 'mybox' });
  assert.equal(originAllowed(undefined, names), true);
  for (const o of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787', 'https://pc.example.ts.net', 'http://pc.example.ts.net:8787']) assert.equal(originAllowed(o, names), true, o);
  for (const o of ['http://evil.example:8787', 'null', '', 'file://', 'http://127.0.0.1.evil.example', 'https://evilts.net', 'chrome-extension://abc', 'http://[bad']) assert.equal(originAllowed(o, names), false, o);
});

test('本物のサーバー: よその Host は /api/chat も配るファイルも 403 で、頭脳に届かない。よその Origin の POST も 403', async () => {
  const brain = await startFakeBrain();
  const logs = mkdtempSync(join(tmpdir(), 'hog-log-'));
  const { proc, port } = await startServer({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_API_URL: brain.url, LOG_DIR: logs, MEMORY_DIR: join(logs, 'm'), FILLER_DIR: join(logs, 'f') });
  try {
    // よその Host: どの道でも 403
    for (const host of ['evil.example', `evil.example:${port}`, 'rebind.test', '192.0.2.99', '127.0.0.1.evil.example']) {
      const chat = await send(port, 'POST', '/api/chat', { host, body: CHAT });
      assert.equal(chat.status, 403, `POST /api/chat Host ${host}`);
      assert.equal((await send(port, 'POST', '/api/tts', { host, body: '{"text":"a"}' })).status, 403, `tts ${host}`);
      assert.equal((await send(port, 'GET', '/api/status', { host })).status, 403, `status ${host}`);
      assert.equal((await send(port, 'GET', '/', { host })).status, 403, `/ ${host}`);
      assert.equal((await send(port, 'GET', '/characters/x/persona.md', { host })).status, 403, `static ${host}`);
    }
    // Host が正しくても、よその Origin の書き込みは 403
    for (const origin of ['http://evil.example:8787', 'null', 'https://evil.example']) {
      assert.equal((await send(port, 'POST', '/api/chat', { origin, body: CHAT })).status, 403, `Origin ${origin}`);
      assert.equal((await send(port, 'DELETE', '/api/chat', { origin })).status, 403, `DELETE Origin ${origin}`);
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(brain.state.hits, 0, '頭脳の受け手には 1 回も届かない');

    // 正しい使い方は今までどおり
    assert.equal((await send(port, 'GET', '/api/status')).status, 200);
    assert.equal((await send(port, 'GET', '/api/status', { host: `localhost:${port}` })).status, 200);
    assert.equal((await send(port, 'GET', '/api/status', { host: `[::1]:${port}` })).status, 200);
    assert.equal((await send(port, 'GET', '/api/status', { host: 'pc.example.ts.net' })).status, 200, 'tailscale serve(https)');
    assert.equal((await send(port, 'GET', '/api/status', { host: `pc.example.ts.net:${port}` })).status, 200, 'tailscale(http)');
    const same = await send(port, 'POST', '/api/chat', { origin: `http://127.0.0.1:${port}`, body: CHAT });
    assert.notEqual(same.status, 403, '同じ場所の Origin は通る');
    const viaTs = await send(port, 'POST', '/api/chat', { host: 'pc.example.ts.net', origin: 'https://pc.example.ts.net', body: CHAT });
    assert.notEqual(viaTs.status, 403, '.ts.net の Origin は通る');
    const noOrigin = await send(port, 'POST', '/api/chat', { body: CHAT });
    assert.notEqual(noOrigin.status, 403, 'Origin が無い(curl)は通る');
  } finally {
    proc.kill();
    brain.srv.close();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(logs, { recursive: true, force: true });
  }
});

test('本物のサーバー: --lan(HOST=0.0.0.0)なら、この端末の LAN の住所と YC_ALLOWED_HOSTS の名前も通る。住所は他人のものは 403', async () => {
  const lanAddr = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
  const logs = mkdtempSync(join(tmpdir(), 'hog-lan-'));
  const { proc, port } = await startServer({ HOST: '0.0.0.0', YC_ALLOWED_HOSTS: 'shop.test', LOG_DIR: logs, MEMORY_DIR: join(logs, 'm'), FILLER_DIR: join(logs, 'f') });
  try {
    if (lanAddr) {
      assert.equal((await send(port, 'GET', '/api/status', { host: `${lanAddr}:${port}` })).status, 200, `LAN ${lanAddr}`);
      assert.equal((await send(port, 'POST', '/api/client-event', { host: `${lanAddr}:${port}`, origin: `http://${lanAddr}:${port}`, body: '{}' })).status === 403, false, 'LAN の Origin');
    }
    assert.equal((await send(port, 'GET', '/api/status', { host: `shop.test:${port}` })).status, 200);
    assert.equal((await send(port, 'GET', '/api/status', { host: 'pc.example.ts.net' })).status, 200);
    assert.equal((await send(port, 'GET', '/api/status', { host: '192.0.2.99' })).status, 403, '他人の住所は断る');
    assert.equal((await send(port, 'GET', '/api/status', { host: 'evil.example' })).status, 403);
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(logs, { recursive: true, force: true });
  }
});
