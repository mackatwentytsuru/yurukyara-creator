// Claude Code 中継(tools/claude-code-relay)の試験。本物の claude も本物のモデルも使わない(偽の runner と偽の claude)。
// 絵は自分たちで作った 1x1 の PNG だけ。鍵の形の値は使わない(合図は試験用の文字)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DRAW_MODEL_DEFAULT, MODEL_DEFAULTS } from '../src/conversation/models.js';
import { IMAGE_MAX_BYTES, RequestError, allowedModels, buildInput, cleanEnv, parseRequest, readCliLine, streamInputLine } from '../../tools/claude-code-relay/lib.mjs';
import { cliArgs, createCliRunner, resolveClaude } from '../../tools/claude-code-relay/cli.mjs';
import { createCounter, createRelayServer, hostAllowed, startRelay } from '../../tools/claude-code-relay/relay.mjs';

const HANDSHAKE = 'test-relay-handshake-0123456789';
const BRAIN = MODEL_DEFAULTS.brain;
const DRAW = DRAW_MODEL_DEFAULT;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake_claude.mjs');
const img = (over = {}) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1PX, ...over } });
const user = (content) => [{ role: 'user', content }];

// アプリが実際に送る 2 つの形(web/server/brain.mjs の callHaiku と、web/server/draw.mjs)
const brainBody = (extra = {}) => ({
  model: BRAIN,
  max_tokens: 700,
  stream: true,
  thinking: { type: 'disabled' },
  system: [{ type: 'text', text: '安全の決まり' }, { type: 'text', text: 'キャラの指示', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'こんにちは' }],
  ...extra,
});
const drawBody = (extra = {}) => ({
  model: DRAW,
  max_tokens: 8000,
  system: '描く決まり',
  messages: user([img(), { type: 'text', text: '描いてください' }]),
  ...extra,
});

// ---- 受けてよい形 / 断る形 ----

test('アプリが送る 2 つの形(会話 = 流れる・thinking 切り・system の段、絵の道 = 絵つき・長い)を通す', () => {
  const a = parseRequest(brainBody());
  assert.equal(a.stream, true);
  assert.equal(a.system, '安全の決まり\n\nキャラの指示');
  assert.equal(a.prompt, 'こんにちは');
  assert.deepEqual(a.images, []);
  assert.equal(a.long, false);
  const b = parseRequest(drawBody());
  assert.equal(b.stream, false);
  assert.equal(b.images.length, 1);
  assert.equal(b.long, true, '絵つき・長い呼び出しは待つ時間を長く');
  assert.equal(parseRequest(brainBody({ max_tokens: 8000 })).long, true);
});

test('前の往復は記録にして、最後の使う人の発言を最後に置く', () => {
  const r = buildInput([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
  assert.equal(r.prompt, '<conversation_so_far>\n<user>\na\n</user>\n<assistant>\nb\n</assistant>\n</conversation_so_far>\n\nc');
});

test('使えるモデルは、会話と絵の道の既定(と、環境変数で替えた物)だけ', () => {
  assert.deepEqual(allowedModels({}), [BRAIN, DRAW]);
  assert.ok(allowedModels({ CLAUDE_MODEL: 'claude-test-9', YC_DRAW_MODEL: 'bad name!' }).includes('claude-test-9'));
  assert.ok(!allowedModels({ YC_DRAW_MODEL: 'bad name!' }).includes('bad name!'));
  assert.throws(() => parseRequest(brainBody({ model: 'claude-opus-9' })), /モデル/);
  assert.throws(() => parseRequest(brainBody({ model: undefined })), RequestError);
});

test('断る物: 道具・MCP・知らない項目・thinking・上限を超える max_tokens・本文の形', () => {
  assert.throws(() => parseRequest(brainBody({ tools: [{ name: 'bash' }] })), /道具や MCP/);
  assert.throws(() => parseRequest(brainBody({ tool_choice: { type: 'auto' } })), RequestError);
  assert.throws(() => parseRequest(brainBody({ mcp_servers: [{ url: 'x' }] })), RequestError);
  assert.throws(() => parseRequest(brainBody({ thinking: { type: 'enabled', budget_tokens: 1024 } })), /thinking/);
  assert.throws(() => parseRequest(brainBody({ max_tokens: 99999 })), /max_tokens/);
  assert.throws(() => parseRequest(brainBody({ max_tokens: 'a' })), /max_tokens/);
  assert.throws(() => parseRequest(null), RequestError);
  assert.throws(() => parseRequest([]), RequestError);
  assert.throws(() => parseRequest(brainBody({ messages: [] })), /空/);
  assert.throws(() => parseRequest(brainBody({ messages: [{ role: 'assistant', content: 'x' }] })), /user/);
  assert.throws(() => parseRequest(brainBody({ messages: user([{ type: 'tool_use', id: 'x' }]) })), RequestError);
  assert.throws(() => parseRequest(brainBody({ system: { a: 1 } })), RequestError);
});

test('断る絵: 種類・base64 でない・大きすぎる・4 枚を超える・url の絵・前の往復の絵', () => {
  const body = (content) => drawBody({ messages: user(content) });
  assert.throws(() => parseRequest(body([img({ media_type: 'image/gif' })])), /png/);
  assert.throws(() => parseRequest(body([img({ data: 'あ' })])), /base64/);
  assert.throws(() => parseRequest(body([img({ data: 'A'.repeat(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 8) })])), /大きすぎ/);
  assert.throws(() => parseRequest(body([img(), img(), img(), img(), img(), { type: 'text', text: 'x' }])), /4 枚まで/);
  assert.throws(() => parseRequest(body([{ type: 'image', source: { type: 'url', url: 'https://example.invalid/a.png' } }])), /base64/);
  const earlier = [{ role: 'user', content: [img(), { type: 'text', text: 'a' }] }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
  assert.throws(() => parseRequest(drawBody({ messages: earlier })), /最後の使う人/);
});

// ---- claude に渡す引数と環境 ----

test('claude -p の引数: 道具なし(--tools "")・MCP を読まない・設定を読まない。権限を飛ばす指定は無い', () => {
  const a = cliArgs({ model: BRAIN, systemFile: 'x.md' });
  assert.deepEqual(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2), ['--tools', '']);
  for (const need of ['-p', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(a.includes(need), need);
  for (const never of ['--mcp-config', '--dangerously-skip-permissions', '--allowedTools', '--allow-dangerously-skip-permissions', '--add-dir']) assert.ok(!a.includes(never), never);
  assert.ok(!a.includes('--input-format'), '文だけの時は stream-json にしない');
  assert.ok(a.includes('--effort'), '短い会話は考える量を最低に');
  const b = cliArgs({ model: DRAW, systemFile: 'x.md', withImages: true, long: true });
  assert.equal(b[b.indexOf('--input-format') + 1], 'stream-json');
  assert.ok(!b.includes('--effort'), '長く書く絵の道は既定のまま');
  assert.deepEqual(b.slice(b.indexOf('--tools'), b.indexOf('--tools') + 2), ['--tools', '']);
});

test('子に渡す環境: 鍵・トークン・ANTHROPIC*・ELEVEN*・RELAY_*・CLAUDE_CODE_* を外し、場所だけの 2 つは残す。元の物は変えない', () => {
  const env = {
    PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', ANTHROPIC_API_URL: 'u', ELEVENLABS_API_KEY: 'e', RELAY_TOKEN: 't', RELAY_CLAUDE_BIN: 'b',
    CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'o', MY_SECRET: 's', DB_PASSWORD: 'p', AWS_CREDENTIAL: 'c',
    CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_GIT_BASH_PATH: 'C:/bash',
  };
  const kept = cleanEnv(env, { ADDED: '1' });
  assert.deepEqual(Object.keys(kept).sort(), ['ADDED', 'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CONFIG_DIR', 'HOME', 'PATH']);
  assert.equal(env.ANTHROPIC_API_KEY, 'a');
});

test('claude の探し方: 試験用の指定 > 普通は claude', () => {
  assert.deepEqual(resolveClaude({ RELAY_CLAUDE_BIN: 'C:/x/fake.mjs' }), { cmd: process.execPath, prefix: ['C:/x/fake.mjs'] });
  assert.deepEqual(resolveClaude({ RELAY_CLAUDE_BIN: '/x/claude' }), { cmd: '/x/claude', prefix: [] });
  assert.deepEqual(resolveClaude({}, 'darwin'), { cmd: 'claude', prefix: [] });
  assert.deepEqual(resolveClaude({}, 'linux'), { cmd: 'claude', prefix: [] });
});

test('claude -p の出力の 1 行を読む', () => {
  assert.deepEqual(readCliLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'あ' } } })), { kind: 'text', text: 'あ' });
  assert.equal(readCliLine('not json').kind, 'junk');
  assert.equal(readCliLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'x' })).ok, true);
  assert.equal(readCliLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true })).ok, false);
  const line = JSON.parse(streamInputLine('描いて', [{ media_type: 'image/png', data: PNG_1PX }]));
  assert.deepEqual(line.message.content.map((b) => b.type), ['image', 'text']);
});

// ---- 1 日の回数 ----

test('回数: 上限まで数え、超えたら断る。ファイルに残る(起こし直しても戻らない)。日付が替わると 0 から。読めないファイルは上限扱い', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-count-'));
  try {
    const file = join(dir, 'sub', 'calls.json');
    let now = new Date('2026-11-08T10:00:00');
    const c = createCounter(file, 2, () => now);
    assert.equal(c.calls, 0);
    assert.ok(c.take());
    assert.ok(createCounter(file, 2, () => now).take(), '別の持ち主でも続きから数える');
    assert.equal(c.take(), false, '3 回目は断る');
    assert.equal(c.calls, 2);
    now = new Date('2026-11-09T00:30:00');
    assert.equal(c.calls, 0, '日付が替わった');
    assert.ok(c.take());
    writeFileSync(file, '{broken');
    assert.equal(c.take(), false, '読めないファイルは上限に達した扱い');
    assert.equal(c.calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 止めた子の作業フォルダは、Windows では少しのあいだ消せない。消せなくても試験は落とさない
const cleanup = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // 一時の場所なので、残っても害は無い
  }
};

// ---- 中継のサーバー ----

const getRaw = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

async function withRelay(runner, fn, { cap = 50, maxWaiting } = {}) {
  const counter = { cap, calls: 0, take() { if (this.calls >= cap) return false; this.calls += 1; return true; } };
  const server = createRelayServer({ runner, counter, token: HANDSHAKE, ...(maxWaiting ? { maxWaiting } : {}) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server.address().port, counter);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}
const waitUntil = async (cond, ms = 5000) => {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('待っても条件が満たされませんでした');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const post = (port, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': HANDSHAKE, ...headers }, body: JSON.stringify(body) });
const okRunner = (text = '{"type":"say","text":"やあ"}\n') => async ({ onText }) => {
  onText(text.slice(0, 5));
  onText(text.slice(5));
  return { text };
};

test('中継: 合図が違う・別の名前・別の道は断る(モデルは呼ばない)', async () => {
  let called = 0;
  await withRelay(async () => { called += 1; return { text: 'x' }; }, async (port) => {
    assert.equal((await post(port, brainBody(), { 'x-api-key': 'wrong' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', body: JSON.stringify(brainBody()) })).status, 401, '合図なし');
    assert.equal((await getRaw(port, '/v1/messages', { host: `evil.example:${port}` })).status, 403, '別の名前(DNS の化け)');
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/complete`, { method: 'POST', headers: { 'x-api-key': HANDSHAKE } })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'GET' })).status, 404);
    assert.equal((await post(port, brainBody({ tools: [{ name: 'bash' }] }))).status, 400);
    assert.equal((await post(port, brainBody({ model: 'claude-opus-9' }))).status, 400);
    const raw = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'x-api-key': HANDSHAKE }, body: '{oops' });
    assert.equal(raw.status, 400);
    assert.equal(called, 0);
    assert.equal((await getRaw(port, '/health')).status, 200);
  });
});

test('中継: 127.0.0.1 だけで待つ。合図が短すぎる起こし方はしない', async () => {
  const relay = await startRelay({ token: HANDSHAKE, stateDir: mkdtempSync(join(tmpdir(), 'cc-bind-')), runner: okRunner() });
  try {
    assert.equal(relay.server.address().address, '127.0.0.1');
    assert.match(relay.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/messages$/);
  } finally {
    await relay.close();
  }
  assert.throws(() => createRelayServer({ runner: okRunner(), counter: { cap: 1, calls: 0, take: () => true }, token: 'short' }), /16 字/);
  assert.ok(hostAllowed('127.0.0.1:9', 9) && hostAllowed('localhost:9', 9) && hostAllowed('[::1]:9', 9));
  assert.ok(!hostAllowed('127.0.0.1:10', 9) && !hostAllowed(undefined, 9) && !hostAllowed('evil.example:9', 9));
});

test('中継: 会話は流れる形で、絵の道はまとめた形で返す。使った量は 0', async () => {
  await withRelay(okRunner('{"type":"say","text":"やあ"}\n'), async (port) => {
    const s = await post(port, brainBody());
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-type'), /text\/event-stream/);
    const t = await s.text();
    for (const ev of ['message_start', 'content_block_delta', 'message_stop']) assert.match(t, new RegExp(ev));
    const deltas = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).filter((e) => e.type === 'content_block_delta').map((e) => e.delta.text).join('');
    assert.equal(deltas, '{"type":"say","text":"やあ"}\n');
    const d = await post(port, drawBody());
    assert.equal(d.status, 200);
    const j = await d.json();
    assert.equal(j.content[0].type, 'text');
    assert.equal(j.model, DRAW);
    assert.equal(j.usage.output_tokens, 0);
  });
});

test('中継: 絵は runner まで通り、long が付く。文だけの呼び出しには絵が無い', async () => {
  const seen = [];
  await withRelay(async (o) => { seen.push({ n: o.images.length, long: o.long, model: o.model }); return { text: '<svg/>' }; }, async (port) => {
    await post(port, drawBody());
    await post(port, brainBody({ stream: false }));
  });
  assert.deepEqual(seen, [{ n: 1, long: true, model: DRAW }, { n: 0, long: false, model: BRAIN }]);
});

test('中継: 1 日の上限に達したら 429 で断り、モデルを呼ばない', async () => {
  let called = 0;
  await withRelay(async () => { called += 1; return { text: 'x' }; }, async (port) => {
    assert.equal((await post(port, brainBody({ stream: false }))).status, 200);
    assert.equal((await post(port, brainBody({ stream: false }))).status, 200);
    const r = await post(port, brainBody({ stream: false }));
    assert.equal(r.status, 429);
    assert.match((await r.json()).error.message, /上限/);
    assert.equal(called, 2);
  }, { cap: 2 });
});

test('中継: 1 回に 1 つだけ動かす(重ならない)。待つ数が多すぎたら 529', async () => {
  let running = 0;
  let maxRunning = 0;
  const gate = [];
  const runner = async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => gate.push(r));
    running -= 1;
    return { text: 'x' };
  };
  await withRelay(runner, async (port) => {
    const ps = [1, 2, 3].map(() => post(port, brainBody({ stream: false })));
    await waitUntil(() => gate.length === 1);
    await new Promise((r) => setTimeout(r, 100)); // 残りの 2 つが待ちに入るのを待つ
    assert.equal(running, 1);
    const over = await post(port, brainBody({ stream: false }));
    assert.equal(over.status, 529, '待ちが 2 つ(上限)を超えた');
    for (let i = 0; i < 3; i++) {
      await waitUntil(() => gate.length > 0);
      gate.shift()();
    }
    assert.deepEqual((await Promise.all(ps)).map((r) => r.status), [200, 200, 200]);
    assert.equal(maxRunning, 1);
  }, { maxWaiting: 2 });
});

test('中継: 時間切れは 504、失敗は 502(流れる途中の失敗は error の行)', async () => {
  await withRelay(async () => { throw Object.assign(new Error('おそい'), { code: 'timeout' }); }, async (port) => {
    assert.equal((await post(port, brainBody({ stream: false }))).status, 504);
  });
  await withRelay(async () => { throw Object.assign(new Error('こわれた'), { code: 'cli' }); }, async (port) => {
    assert.equal((await post(port, brainBody({ stream: false }))).status, 502);
  });
  await withRelay(async ({ onText }) => { onText('あ'); throw Object.assign(new Error('途中'), { code: 'cli' }); }, async (port) => {
    const s = await post(port, brainBody());
    assert.match(await s.text(), /"type":"error"/);
  });
});

test('中継: 呼んだ側が切れたら、動いている claude にも止めの合図(signal)が届く', async () => {
  let aborted = false;
  let resolveStarted;
  const started = new Promise((r) => (resolveStarted = r));
  await withRelay(async ({ signal }) => {
    resolveStarted();
    await new Promise((r) => signal.addEventListener('abort', () => { aborted = true; r(); }, { once: true }));
    return { text: '' };
  }, async (port) => {
    const ac = new AbortController();
    const p = fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': HANDSHAKE }, body: JSON.stringify(brainBody()), signal: ac.signal }).catch(() => {});
    await started;
    ac.abort(); // 呼ぶ側の接続を切る
    await p;
    await waitUntil(() => aborted);
  });
  assert.equal(aborted, true);
});

// ---- 偽の claude を本当に動かす(runner → 子のプロセス) ----

test('runner + 偽の claude: 引数は道具なし・MCP なし、鍵の名前の環境変数は子に届かず、絵つきなら stream-json で渡る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-fake-'));
  const log = join(dir, 'calls.jsonl');
  const env = { ...process.env, RELAY_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: 'fake-should-not-reach', ELEVENLABS_API_KEY: 'fake-should-not-reach', RELAY_TOKEN: 'fake-should-not-reach' };
  const run = createCliRunner({ baseEnv: env, workRoot: dir });
  try {
    const got = [];
    const a = await run({ model: BRAIN, system: 'さしず', prompt: 'こんにちは', onText: (t) => got.push(t) });
    assert.match(a.text, /Claude Code から こんにちは/);
    assert.ok(got.length >= 2, '少しずつ届く');
    const b = await run({ model: DRAW, system: 'さしず', prompt: '描いて', images: [{ media_type: 'image/png', data: PNG_1PX }], long: true, onText() {} });
    assert.match(b.text, /<svg/);
    const rows = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.deepEqual(r.args.slice(r.args.indexOf('--tools'), r.args.indexOf('--tools') + 2), ['--tools', '']);
      assert.ok(r.args.includes('--strict-mcp-config') && !r.args.includes('--mcp-config'));
      assert.deepEqual(r.secretEnvNames, [], `鍵の名前の環境変数が子に届いた: ${r.secretEnvNames}`);
      assert.match(r.cwd, /claude-code-relay-/, '空の作業フォルダで動く');
    }
    assert.equal(rows[1].images, 1);
    assert.ok(rows[1].args.includes('--input-format'));
  } finally {
    run.close();
    cleanup(dir);
  }
});

test('runner + 偽の claude: 失敗は code=cli、時間切れは code=timeout で、子を止める', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-fake-'));
  try {
    const failing = createCliRunner({ baseEnv: { ...process.env, RELAY_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_FAIL: '1' }, workRoot: dir });
    await assert.rejects(failing({ model: BRAIN, system: 's', prompt: 'p' }), (e) => e.code === 'cli' && /わざと失敗/.test(e.message));
    failing.close();
    const slow = createCliRunner({ baseEnv: { ...process.env, RELAY_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_SLOW_MS: '5000' }, workRoot: dir, timeoutMs: 400 });
    const t0 = Date.now();
    await assert.rejects(slow({ model: BRAIN, system: 's', prompt: 'p' }), (e) => e.code === 'timeout');
    assert.ok(Date.now() - t0 < 4000);
    slow.close();
    const missing = createCliRunner({ baseEnv: { ...process.env, RELAY_CLAUDE_BIN: join(dir, 'no-such-claude') }, workRoot: dir });
    await assert.rejects(missing({ model: BRAIN, system: 's', prompt: 'p' }), (e) => e.code === 'spawn');
    missing.close();
  } finally {
    cleanup(dir);
  }
});
