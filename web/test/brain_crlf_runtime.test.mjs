// 実際に動く道で、頭脳に渡る文が改行の形で変わらないかの試験(本物の API は呼ばない。合わせ③の差し戻しの直し)。
// 手元のサーバーを偽の Anthropic サーバー(ANTHROPIC_API_URL)に向けて起こし、画面と同じに /characters/norrie/persona.md を
// サーバーから読んで /api/chat へ送る。取り出したまま・LF・CRLF の 3 通りで、偽の頭脳が受け取った指示文(system の 2 段)が
// 1 文字も違わず、CR を含まず、1 段目が安全の決まりのままであることを見る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAFETY_RULES } from '../server/safety.mjs';

const WEB = join(import.meta.dirname, '..');
const PERSONA_FILE = join(WEB, '..', 'characters', 'norrie', 'persona.md');
const FAKE_BRAIN_KEY = ['fake', 'brain', 'value', 'not', 'real'].join('-'); // 実行のときに組み立てる(鍵の形にしない)
const lf = (s) => s.replace(/\r\n/g, '\n');
const crlf = (s) => lf(s).replace(/\n/g, '\r\n');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** 偽の Anthropic サーバー。受け取った本文を控え、決まった 1 文を返す */
async function fakeBrain() {
  const seen = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(JSON.parse(raw));
      const line = { type: 'say', text: 'はじめまして! ノリーと申しマス。', expression: 'happy', motion: 'bow', gaze: 'person', intent: '未確認', stage: 'greet', handoff: false };
      const sse = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }));
      res.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(line) } }));
      res.write(sse({ type: 'message_delta', usage: { output_tokens: 12 } }));
      res.end(sse({ type: 'message_stop' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1/messages`, seen, close: () => server.close() };
}

async function startServer(brainUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-crlf-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory') };
  // 空の値にしておくと、web/.env があっても本物の鍵で埋められない。頭脳は偽のサーバーだけ
  Object.assign(env, { ANTHROPIC_API_KEY: FAKE_BRAIN_KEY, ANTHROPIC_API_URL: brainUrl, ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '', MEMORY_PEPPER: '' });
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, dir };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

test('ノリーの人格の文: 取り出したまま・LF・CRLF のどれを送っても、頭脳が受け取る指示文は 1 文字も違わない', async (t) => {
  const brain = await fakeBrain();
  const server = await startServer(brain.url);
  try {
    // 画面と同じ道: サーバーが配る persona.md をそのまま読む(この木の取り出しの形のまま)
    const served = await (await fetch(`${server.base}/characters/norrie/persona.md`)).text();
    assert.equal(served, readFileSync(PERSONA_FILE, 'utf8'), 'サーバーはファイルをそのまま配る');
    t.diagnostic(`この木の persona.md の改行: ${served.includes('\r\n') ? 'CRLF' : 'LF'}`);

    for (const persona of [served, lf(served), crlf(served)]) {
      const res = await fetch(`${server.base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'はじめまして', history: [], character: { name: 'ノリー', persona } }),
      });
      assert.equal(res.status, 200);
      const stream = await res.text();
      assert.match(stream, /ノリーと申しマス/, '偽の頭脳の返事が届く');
    }
    assert.equal(brain.seen.length, 3, '頭脳は 3 回だけ呼ばれる');
    const systems = brain.seen.map((b) => b.system.map((block) => block.text));
    assert.deepEqual(systems[1], systems[0], 'LF でも同じ');
    assert.deepEqual(systems[2], systems[0], 'CRLF でも同じ');
    assert.equal(systems[0][0], SAFETY_RULES, '1 段目は安全の決まりのまま');
    assert.ok(systems[0][1].includes('ノリー') && systems[0][1].includes('ノリ、がんばりマス!'), '2 段目にノリーの人格');
    for (const block of systems[0]) assert.ok(!block.includes('\r'), '頭脳に CR が届いていない');
  } finally {
    server.proc.kill();
    brain.close();
  }
});
