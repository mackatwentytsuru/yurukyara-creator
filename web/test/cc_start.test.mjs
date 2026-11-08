// npm run start:claude-code の試験: claude が無い・ログインしていない時の止まり方と、偽の claude を使った通し(中継 + 本物の会話サーバー)。
// 本物の claude も本物のモデルも使わない。使う番号は 9480〜9489。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DRAW_MODEL_DEFAULT } from '../src/conversation/models.js';
import { checkClaude } from '../../tools/claude-code-relay/cli.mjs';
import { problemMessage, startClaudeCode } from '../scripts/start-claude-code.mjs';

const WEB = join(import.meta.dirname, '..');
const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake_claude.mjs');
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PORT = 9481;

/** 環境変数を一時的に替えて、終わったら元に戻す */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const cleanup = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // 一時の場所なので、残っても害は無い
  }
};
const waitFor = async (fn, ms = 40_000) => {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // まだ
    }
    if (Date.now() > until) throw new Error('待っても立ち上がりませんでした');
    await new Promise((r) => setTimeout(r, 200));
  }
};

// ---- 先の確かめ ----

test('確かめ: ログイン済みなら通る。claude が無い・未ログイン・読めない出力は、それぞれ違う日本語で止める', async () => {
  const base = { ...process.env, RELAY_CLAUDE_BIN: FAKE_CLAUDE };
  assert.deepEqual(await checkClaude({ env: { ...base, FAKE_CLAUDE_AUTH: 'in' } }), { ok: true });
  const out = await checkClaude({ env: { ...base, FAKE_CLAUDE_AUTH: 'out' } });
  assert.equal(out.reason, 'not-logged-in');
  assert.match(problemMessage(out), /ログインしていません/);
  assert.equal((await checkClaude({ env: { ...base, FAKE_CLAUDE_AUTH: 'garbage' } })).reason, 'unknown');
  const missing = await checkClaude({ env: { ...process.env, RELAY_CLAUDE_BIN: join(tmpdir(), 'no-such-claude-here') } });
  assert.equal(missing.reason, 'not-found');
  const msg = problemMessage(missing);
  assert.match(msg, /見つかりません/);
  assert.match(msg, /README/);
  assert.notEqual(problemMessage(out), msg);
  assert.match(problemMessage({ ok: false, reason: 'unknown', detail: '' }), /確かめられませんでした/);
});

test('claude が無い時、startClaudeCode は中継もアプリも起こさず、理由を返す', async () => {
  await withEnv({ RELAY_CLAUDE_BIN: join(tmpdir(), 'no-such-claude-here'), ANTHROPIC_API_KEY: undefined, ANTHROPIC_API_URL: undefined, YC_BRAIN_VIA: undefined }, async () => {
    const r = await startClaudeCode({ port: PORT, build: false });
    assert.equal(r.ok, false);
    assert.match(r.message, /見つかりません/);
    assert.equal(process.env.ANTHROPIC_API_URL, undefined, '環境変数を書き換えていない');
    assert.equal(process.env.YC_BRAIN_VIA, undefined);
  });
});

test('npm run start:claude-code の台本: claude が無いと、日本語で理由を出して終わりの番号 2 で止まる(アプリは起こさない)', async () => {
  const env = { ...process.env, RELAY_CLAUDE_BIN: join(tmpdir(), 'no-such-claude-here'), PORT: String(PORT) };
  delete env.ANTHROPIC_API_KEY;
  const p = spawn(process.execPath, [join(WEB, 'scripts', 'start-claude-code.mjs'), '--no-build'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let err = '';
  let out = '';
  p.stderr.on('data', (c) => (err += c));
  p.stdout.on('data', (c) => (out += c));
  const code = await new Promise((r) => p.on('close', r));
  assert.equal(code, 2);
  assert.match(err, /Claude Code/);
  assert.match(err, /見つかりません/);
  assert.equal(out.trim(), '', '何も起こしていない');
  await assert.rejects(fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(1500) }), '会話サーバーは立っていない');
});

// ---- 通し(偽の claude + 本物の会話サーバー) ----

test('通し: 中継と会話サーバーが立ち、/api/status が「Claude Code につないでいる」と答え、会話と絵の呼び出しが claude まで届き、止めると両方消える', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-e2e-'));
  const log = join(dir, 'claude_calls.jsonl');
  await withEnv({
    RELAY_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_AUTH: 'in',
    ANTHROPIC_API_KEY: 'fake-real-looking-value', ANTHROPIC_API_URL: undefined, YC_BRAIN_VIA: undefined,
    ELEVENLABS_API_KEY: undefined, APP_PASSPHRASE: undefined, YC_BROWSER_DRAW: '1',
    LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory'), FILLER_DIR: join(dir, 'fillers'), PORT: String(PORT), HOST: '127.0.0.1',
  }, async () => {
    const run = await startClaudeCode({ port: PORT, host: '127.0.0.1', build: false, stateDir: join(dir, 'relay'), log: () => {} });
    assert.equal(run.ok, true, run.message);
    const base = `http://127.0.0.1:${PORT}`;
    try {
      const status = await waitFor(async () => (await fetch(`${base}/api/status`)).json());
      assert.equal(status.brain, 'haiku', '鍵ありと同じ道');
      assert.equal(status.brainVia, 'claude-code', '画面の「おためしモード」を出さない印');
      assert.equal(status.draw.on, true);

      // 会話: 画面の呼び出し → 会話サーバー → 中継 → (偽の)claude
      const chat = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'こんにちは' }) });
      assert.equal(chat.status, 200);
      const events = (await chat.text()).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
      const meta = events.find((e) => e.type === 'meta');
      assert.equal(meta.brain, 'haiku', '仮の頭脳に落ちていない');
      assert.ok(events.some((e) => e.type === 'say' && /Claude Code から/.test(e.text)), JSON.stringify(events).slice(0, 400));

      // 絵の道: アプリが使う合図で、絵つきの呼び出しを中継へ直接送る → 絵が claude まで届く
      const draw = await fetch(run.relay.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY },
        body: JSON.stringify({ model: DRAW_MODEL_DEFAULT, max_tokens: 8000, system: '描く決まり', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX } }, { type: 'text', text: '描いて' }] }] }),
      });
      assert.equal(draw.status, 200);
      assert.match((await draw.json()).content[0].text, /<svg/);

      // 本物の鍵(環境にあった値)はアプリにも claude にも渡っていない。合図は鍵の形ではない
      assert.notEqual(process.env.ANTHROPIC_API_KEY, 'fake-real-looking-value');
      const rows = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(rows.length >= 2);
      for (const r of rows) {
        assert.deepEqual(r.secretEnvNames, [], `鍵の名前の環境変数が claude に届いた: ${r.secretEnvNames}`);
        assert.deepEqual(r.args.slice(r.args.indexOf('--tools'), r.args.indexOf('--tools') + 2), ['--tools', '']);
        assert.ok(r.args.includes('--strict-mcp-config'));
      }
      assert.ok(rows.some((r) => r.images === 1 && r.args[r.args.indexOf('--model') + 1] === DRAW_MODEL_DEFAULT));
    } finally {
      run.stop();
      await run.done;
    }
    // 止めたら、中継も会話サーバーも消え、環境変数は元に戻る
    await assert.rejects(fetch(run.relay.url, { method: 'POST', signal: AbortSignal.timeout(1500) }));
    await waitFor(async () => {
      try {
        await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(500) });
        return false; // まだ答える
      } catch {
        return true; // つながらない = 消えた
      }
    }, 8000);
    assert.equal(process.env.ANTHROPIC_API_KEY, 'fake-real-looking-value');
    assert.equal(process.env.ANTHROPIC_API_URL, undefined);
    assert.equal(process.env.YC_BRAIN_VIA, undefined);
  });
  cleanup(dir);
});

// ---- /api/status の印 ----

test('config.brainVia: 鍵なし = mock、鍵だけ = api-key、印 + この PC の中の行き先 = claude-code(印だけ・外の行き先では名乗らない)', async () => {
  const { config } = await import('../server/env.mjs');
  const loopback = 'http://127.0.0.1:9482/v1/messages';
  await withEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_API_URL: undefined, YC_BRAIN_VIA: undefined }, async () => {
    assert.equal(config.brainVia, 'mock');
    process.env.YC_BRAIN_VIA = 'claude-code';
    assert.equal(config.brainVia, 'mock', '鍵が無ければ、印があっても mock');
    delete process.env.YC_BRAIN_VIA;
    process.env.ANTHROPIC_API_KEY = 'fake-value-for-test';
    assert.equal(config.brainVia, 'api-key');
    process.env.YC_BRAIN_VIA = 'claude-code';
    assert.equal(config.brainVia, 'api-key', '行き先が外(既定)の時は名乗らない');
    process.env.ANTHROPIC_API_URL = 'https://example.invalid/v1/messages';
    assert.equal(config.brainVia, 'api-key');
    process.env.ANTHROPIC_API_URL = 'http://127.0.0.1.example.invalid/v1/messages';
    assert.equal(config.brainVia, 'api-key', '名前が 127.0.0.1 で始まるだけの外の住所では名乗らない');
    process.env.ANTHROPIC_API_URL = loopback;
    assert.equal(config.brainVia, 'claude-code');
    delete process.env.YC_BRAIN_VIA;
    assert.equal(config.brainVia, 'api-key', '印が無ければ、中の行き先でも api-key');
  });
});
