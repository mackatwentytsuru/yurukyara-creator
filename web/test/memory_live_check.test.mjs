// 土 10:00 の「本物の頭脳で記憶を 1 回測る」道具(server/tools/memory-live-check.mjs)の試験。本物の API は呼ばない。
// 手元のサーバーを、偽の Anthropic サーバー(ANTHROPIC_API_URL)に向けて起こし、道具を通しで流す。
// 確かめること: 全部の確かめが通る / 本物の頭脳の回数と使った量が記録に残る / 合鍵と番号が記録に無い / 頭脳に合鍵が届かない
// / 1 段目は安全の決まりのまま、主役ノリーの人格で話す / 仮の頭脳のサーバーでは止まる(予行の印なら通す)/ 出力はリポジトリの外だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOutDir, runMemoryLiveCheck, MAX_BRAIN_CALLS } from '../server/tools/memory-live-check.mjs';
import { SAFETY_RULES } from '../server/safety.mjs';

const WEB = join(import.meta.dirname, '..');
const FAKE_BRAIN_KEY = ['fake', 'brain', 'value', 'not', 'real'].join('-'); // 実行のときに組み立てる(鍵の形にしない)
const USAGE = { input_tokens: 2100, cache_creation_input_tokens: 1800, cache_read_input_tokens: 0 };

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** 偽の Anthropic サーバー。覚えていることが渡されたら、名前と好きなものにふれて返す */
async function fakeBrain() {
  const seen = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ raw, body, headers: req.headers });
      const turn = String(body.messages.at(-1)?.content ?? '');
      const lines = turn.includes('名前: タロウ')
        ? [
            { type: 'say', text: 'タロウさん、また会えたデス!', expression: 'happy', motion: 'bow', gaze: 'person', intent: '続きの会話', stage: 'chat', handoff: false },
            { type: 'say', text: 'カレーのお話、また聞かせてくだサイ。', expression: 'happy', motion: 'nod', gaze: 'person' },
          ]
        : [{ type: 'say', text: 'はじめまして! ノリーと申しマス。', expression: 'happy', motion: 'bow', gaze: 'person', intent: '未確認', stage: 'greet', handoff: false }];
      const sse = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse({ type: 'message_start', message: { usage: { ...USAGE, output_tokens: 1 } } }));
      res.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: lines.map((l) => JSON.stringify(l)).join('\n') } }));
      res.write(sse({ type: 'message_delta', usage: { output_tokens: 37 } }));
      res.end(sse({ type: 'message_stop' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1/messages`, seen, close: () => server.close() };
}

async function startServer({ brainUrl = '', withBrain = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-live-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory') };
  // 空の値にしておくと、web/.env があっても本物の鍵で埋められない
  Object.assign(env, { ANTHROPIC_API_KEY: withBrain ? FAKE_BRAIN_KEY : '', ANTHROPIC_API_URL: brainUrl || 'http://127.0.0.1:9/v1/messages', ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '', MEMORY_PEPPER: '' });
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, dir, log: () => out };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** 道具が送った合鍵と、受け取った番号を、横で控える(記録に残っていないかを見るため) */
function recordingFetch(secrets) {
  return async (url, init = {}) => {
    const key = init.headers?.['x-memory-key'];
    if (key) secrets.add(key);
    const res = await fetch(url, init);
    if (/\/api\/memory\/(new|pair|claim)$/.test(new URL(url).pathname)) {
      const data = await res.clone().json().catch(() => null);
      for (const v of [data?.key, data?.code]) if (typeof v === 'string' && v) secrets.add(v);
    }
    return res;
  };
}

test('本物の頭脳(偽の API)のサーバーで通しが全部通り、回数と使った量が残る。合鍵と番号は記録にも頭脳にも出ない', async () => {
  const brain = await fakeBrain();
  const server = await startServer({ brainUrl: brain.url, withBrain: true });
  try {
    const secrets = new Set();
    const logs = [];
    const r = await runMemoryLiveCheck({ base: server.base, fetchImpl: recordingFetch(secrets), log: (s) => logs.push(s) });
    assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.ok !== true)));
    assert.equal(r.code, 0);
    assert.equal(r.brain, 'haiku');
    assert.equal(r.rehearsal, false);
    assert.equal(r.brainCalls, 4, '本物の頭脳は 4 回(「わすれて」では呼ばない)');
    assert.ok(r.brainCalls <= MAX_BRAIN_CALLS);
    assert.equal(brain.seen.length, 4, '偽の API に届いたのも 4 回');
    assert.ok(r.checks.length >= 12 && r.checks.every((c) => c.ok === true));
    assert.deepEqual(r.usageTotal, { input: 4 * 2100, cacheRead: 0, cacheWrite: 4 * 1800, output: 4 * 37 });
    assert.ok(r.turns.filter((t) => t.calledBrain).every((t) => Number.isFinite(t.firstSayMs) && t.usage.input === 2100));
    assert.equal(r.server, `この端末(${new URL(server.base).port} 番)`, '送り先の名前は記録しない');
    // 合鍵(2 つの端末で同じ 1 つ)と番号を控えられたこと、そのどれもが記録・画面の出力・頭脳への本文に無いこと
    assert.ok(secrets.size >= 2);
    const record = JSON.stringify(r) + logs.join('\n');
    for (const s of secrets) {
      assert.ok(!record.includes(s), '記録に合鍵か番号があります');
      assert.ok(!brain.seen.some((x) => x.raw.includes(s) || JSON.stringify(x.headers).includes(s)), '頭脳に合鍵か番号が届いています');
    }
    // 頭脳への本文: 1 段目は安全の決まり、2 段目は主役ノリーの人格。2・3 回目は覚えていることつき、4 回目(消した後)は無し
    assert.equal(brain.seen[0].body.system[0].text, SAFETY_RULES);
    assert.match(brain.seen[0].body.system[1].text, /あなたは「ノリー」/);
    assert.match(brain.seen[0].body.system[1].text, /執事見習い/);
    const memo = brain.seen.map((x) => { const c = String(x.body.messages.at(-1).content); return c.includes('【覚えていること】') && c.includes('名前: タロウ'); });
    assert.ok(String(brain.seen[0].body.messages.at(-1).content).includes('【いま覚えた】'), 'この回に覚えた事は、その回の頭脳にも渡す(UW3)');
    assert.deepEqual(memo, [false, true, true, false]);
    assert.equal(brain.seen[0].headers['x-api-key'], FAKE_BRAIN_KEY, '鍵はサーバーの中にだけある(道具は送らない)');
    assert.ok(!logs.join('\n').includes(FAKE_BRAIN_KEY));
  } finally {
    server.proc.kill();
    brain.close();
  }
});

test('道具を命令として流す: 出力は 2 つのファイル。合鍵の形の長い文字が無い', async () => {
  const brain = await fakeBrain();
  const server = await startServer({ brainUrl: brain.url, withBrain: true });
  const out = mkdtempSync(join(tmpdir(), 'yc-live-out-'));
  try {
    const env = { ...process.env, ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '' };
    const child = spawn(process.execPath, [join(WEB, 'server', 'tools', 'memory-live-check.mjs'), '--base', server.base, '--out', out], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '';
    child.stdout.on('data', (c) => (text += c));
    child.stderr.on('data', (c) => (text += c));
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, text);
    const json = readFileSync(join(out, 'memory_live.json'), 'utf8');
    const md = readFileSync(join(out, 'memory_live.md'), 'utf8');
    assert.equal(JSON.parse(json).ok, true);
    assert.match(md, /本物の頭脳/);
    assert.match(md, /タロウさん、また会えたデス/);
    for (const t of [json, md, text]) assert.doesNotMatch(t, /[A-Za-z0-9_-]{40,}/, '合鍵の形の文字は出さない');
  } finally {
    server.proc.kill();
    brain.close();
  }
});

test('仮の頭脳のサーバーでは測らずに止まる(3)。予行の印があれば、道だけ通す(本物だけで数える所は飛ばす)', async () => {
  const server = await startServer({ withBrain: false });
  try {
    const stop = await runMemoryLiveCheck({ base: server.base });
    assert.equal(stop.ok, false);
    assert.equal(stop.code, 3);
    assert.equal(stop.turns.length, 0, '何も話さない');
    const rehearsal = await runMemoryLiveCheck({ base: server.base, allowMock: true });
    assert.equal(rehearsal.ok, true, JSON.stringify(rehearsal.checks.filter((c) => c.ok === false)));
    assert.equal(rehearsal.rehearsal, true);
    assert.equal(rehearsal.brainCalls, 0);
    assert.ok(rehearsal.checks.some((c) => c.ok === 'skip'), '本物の頭脳だけで数える所は飛ばした印');
  } finally {
    server.proc.kill();
  }
});

test('出力の場所はリポジトリの外だけ。送り先の書き方も確かめる', async () => {
  assert.throws(() => checkOutDir(join(WEB, 'logs', 'x')), /リポジトリの外/);
  assert.throws(() => checkOutDir(''), /--out/);
  assert.ok(checkOutDir(join(tmpdir(), 'yc-live-ok')));
  await assert.rejects(() => runMemoryLiveCheck({ base: 'ftp://127.0.0.1:1' }), /http/);
});
