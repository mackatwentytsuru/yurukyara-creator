// 第 12 波 b(B3): 頭脳と声のモデルの名前は 1 か所(src/conversation/models.js の既定 + 環境変数 CLAUDE_MODEL・ELEVEN_MODEL_ID)。
// 本人の案「新しいモデルが出たら 1 行で賢くなる」の裏付け。サーバー・公開の関数・画面・台本が、どれもそこを読むことを確かめる。
// 本物の頭脳と声は呼ばない(偽のサーバーだけ)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MODEL_DEFAULTS, MODEL_ENV, isModelName, modelsFrom } from '../src/conversation/models.js';
import { VOICE_MODEL_ID } from '../src/conversation/voiceRole.js';
import { DEFAULT_MODEL_ID } from '../src/conversation/elevenDirect.js';

const WEB = join(import.meta.dirname, '..');

test('既定と環境変数: 空・形の違う値は既定。名前を入れれば、その名前', () => {
  assert.deepEqual({ ...MODEL_DEFAULTS }, { brain: 'claude-haiku-5-5', voice: 'eleven_v4_turbo' });
  assert.deepEqual({ ...MODEL_ENV }, { brain: 'CLAUDE_MODEL', voice: 'ELEVEN_MODEL_ID' });
  assert.deepEqual(modelsFrom({}), { brain: 'claude-haiku-5-5', voice: 'eleven_v4_turbo' });
  assert.deepEqual(modelsFrom(), { brain: 'claude-haiku-5-5', voice: 'eleven_v4_turbo' });
  assert.deepEqual(modelsFrom({ CLAUDE_MODEL: 'claude-haiku-9-9', ELEVEN_MODEL_ID: 'eleven_v9' }), { brain: 'claude-haiku-9-9', voice: 'eleven_v9' });
  assert.deepEqual(modelsFrom({ CLAUDE_MODEL: '  claude-next  ' }), { brain: 'claude-next', voice: 'eleven_v4_turbo' }, '前後の空白は外す');
  for (const bad of ['', '   ', 'a b', 'x/../y', 'モデル', '-lead', 'a'.repeat(81), 'name"quote']) {
    assert.deepEqual(modelsFrom({ CLAUDE_MODEL: bad, ELEVEN_MODEL_ID: bad }), { brain: 'claude-haiku-5-5', voice: 'eleven_v4_turbo' }, JSON.stringify(bad));
    assert.equal(isModelName(bad), false, JSON.stringify(bad));
  }
});

test('サーバーの設定は、呼ぶたびに環境変数を読む(起こし直さずに替わる。空なら既定)', async () => {
  const { config } = await import('../server/env.mjs');
  const keep = { b: process.env.CLAUDE_MODEL, v: process.env.ELEVEN_MODEL_ID };
  try {
    delete process.env.CLAUDE_MODEL;
    delete process.env.ELEVEN_MODEL_ID;
    assert.equal(config.model, MODEL_DEFAULTS.brain);
    assert.equal(config.ttsModel, MODEL_DEFAULTS.voice);
    process.env.CLAUDE_MODEL = 'claude-test-1';
    process.env.ELEVEN_MODEL_ID = 'eleven_test_2';
    assert.equal(config.model, 'claude-test-1');
    assert.equal(config.ttsModel, 'eleven_test_2');
    process.env.CLAUDE_MODEL = '';
    process.env.ELEVEN_MODEL_ID = '';
    assert.equal(config.model, MODEL_DEFAULTS.brain, '空は既定(.env の例の空欄)');
    assert.equal(config.ttsModel, MODEL_DEFAULTS.voice);
  } finally {
    if (keep.b === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = keep.b;
    if (keep.v === undefined) delete process.env.ELEVEN_MODEL_ID;
    else process.env.ELEVEN_MODEL_ID = keep.v;
  }
});

test('画面の声の鍵の道も同じ既定: voiceRole.js の VOICE_MODEL_ID と elevenDirect.js の控え', () => {
  assert.equal(VOICE_MODEL_ID, MODEL_DEFAULTS.voice);
  assert.equal(DEFAULT_MODEL_ID, MODEL_DEFAULTS.voice, 'elevenDirect.js も models.js の同じ値を読む(文字の控えは持たない)');
});

test('頭脳を呼ぶ時(手元のサーバーも公開の関数も runTurn)、CLAUDE_MODEL の名前で頼む', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const line = '{"type":"say","text":"はい。","expression":"happy","motion":"nod","gaze":"person","intent":"試し","stage":"chat","handoff":false}';
      res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: line } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const keep = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_API_URL, model: process.env.CLAUDE_MODEL };
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  try {
    const { runTurn } = await import('../server/brain.mjs');
    const events = [];
    delete process.env.CLAUDE_MODEL;
    await runTurn({ text: 'こんにちは' }, { onEvent: (e) => events.push(e) });
    process.env.CLAUDE_MODEL = 'claude-haiku-7-7';
    await runTurn({ text: 'こんにちは' }, { onEvent: (e) => events.push(e) });
    assert.deepEqual(seen.map((b) => b.model), ['claude-haiku-5-5', 'claude-haiku-7-7']);
    assert.deepEqual(events.filter((e) => e.type === 'meta' && e.brain === 'haiku').map((e) => e.model), ['claude-haiku-5-5', 'claude-haiku-7-7'], '画面に出す名前も同じ');
  } finally {
    server.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', keep.key], ['ANTHROPIC_API_URL', keep.url], ['CLAUDE_MODEL', keep.model]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// コメントを外したコード(行末の「//」と、かたまりのコメント。文字列の中の「://」は URL なので残す)
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(m?js|py)$/.test(name)) out.push(p);
  }
  return out;
}

test('モデルの名前の文字は、models.jsの外のコードに無い(elevenDirect.js も、そこを読む)', () => {
  const MODEL_LITERAL = /claude-(?:haiku|sonnet|opus)-\d|eleven_(?:v\d|flash|multilingual|turbo|monolingual)/;
  const allowed = new Set(['src/conversation/models.js']);
  const hits = [];
  for (const dir of ['server', 'src', 'api', 'scripts']) {
    for (const f of files(join(WEB, dir))) {
      const rel = relative(WEB, f).split('\\').join('/');
      if (allowed.has(rel) || rel.includes('/_test/')) continue;
      const code = codeOnly(readFileSync(f, 'utf8'));
      if (MODEL_LITERAL.test(code)) hits.push(rel);
    }
  }
  assert.deepEqual(hits, [], `モデルの名前を直接書いているコード: ${hits.join(', ')}`);
  // .env の例も空欄(書くと既定と食い違う。前は古い声のモデルが書いてあった)
  const example = readFileSync(join(WEB, '.env.example'), 'utf8');
  assert.match(example, /^CLAUDE_MODEL=$/m);
  assert.match(example, /^ELEVEN_MODEL_ID=$/m);
});
