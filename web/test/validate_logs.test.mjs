// 鍵がサーバーの記録に残らないことの試験。手元のサーバーを、別の記録の場所(LOG_DIR・MEMORY_DIR)で起こし、
// 偽の声の鍵を、見出し・会話の言葉・履歴・記憶・読み上げ・測定に混ぜて送る。
// そのあと、サーバーの画面の出力・記録のファイル・記憶のファイル・返事のどれにも、鍵(とその 12 字の切れ端)が無いことを見る。
// 本物の頭脳と声は呼ばない(鍵は空にして、頭脳の宛先も届かない所にする)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { REDACTED, redactSecrets } from '../src/conversation/secrets.js';
import { sanitizeChatBody } from '../server/validate.mjs';

const WEB = join(import.meta.dirname, '..');
// 偽の鍵は実行のときに組み立てる(ファイルの中に鍵の形の文字を置かない)
const HEX = '0a1b2c3d'.repeat(6);
const FAKE_VOICE_KEY = ['sk', HEX].join('_');
const FAKE_CLAUDE_KEY = ['sk', 'ant', 'api03', 'Zz9'.repeat(12)].join('-');

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** 鍵そのものと、12 字以上の切れ端が無いか */
function assertNoKey(text, where) {
  assert.ok(!text.includes(FAKE_VOICE_KEY), `${where} に声の鍵があります`);
  assert.ok(!text.includes(FAKE_CLAUDE_KEY), `${where} に頭脳の鍵があります`);
  for (let i = 0; i + 12 <= HEX.length; i += 4) assert.ok(!text.includes(HEX.slice(i, i + 12)), `${where} に鍵の切れ端があります`);
}

test('入口の検査: 会話の言葉・履歴・人格に混ざった鍵らしい文字を消す', () => {
  const body = sanitizeChatBody({
    text: `声の鍵は ${FAKE_VOICE_KEY} です`,
    history: [{ role: 'user', content: `前に ${FAKE_CLAUDE_KEY} を貼った` }],
    character: { name: 'テスト', persona: `鍵 ${HEX}` },
  });
  assertNoKey(JSON.stringify(body), '検査の後の本文');
  assert.match(body.text, new RegExp(REDACTED.replace(/[[\]]/g, '\\$&')));
  assert.equal(redactSecrets('カレーが好き。ぼくはタロウ').count, 0, 'ふつうの言葉は消さない');
});

test('サーバーの記録・画面の出力・記憶・返事のどこにも、送られた鍵が残らない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-logs-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory') };
  // 空の値にしておくと、web/.env があっても本物の鍵で埋められない
  Object.assign(env, { ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '', ANTHROPIC_API_URL: 'http://127.0.0.1:9/v1/messages' });
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  const replies = [];
  let memKey = '';
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {
        // まだ立っていない
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const leak = { 'xi-api-key': FAKE_VOICE_KEY, 'x-eleven-key': FAKE_VOICE_KEY, authorization: `Bearer ${FAKE_CLAUDE_KEY}`, 'x-api-key': FAKE_CLAUDE_KEY };
    memKey = (await (await fetch(`${base}/api/memory/new`, { method: 'POST' })).json()).key;
    const call = async (path, body, headers = {}) => {
      const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-memory-key': memKey, ...leak, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
      replies.push(await res.text());
      return res.status;
    };
    assert.equal(await call('/api/chat', { text: `声の鍵は ${FAKE_VOICE_KEY} です。${FAKE_VOICE_KEY}が好き`, history: [{ role: 'user', content: FAKE_CLAUDE_KEY }], character: { name: 'テスト', persona: HEX } }), 200);
    assert.equal(await call('/api/chat', { text: `ぼくは${HEX}です` }), 200);
    assert.equal(await call('/api/memory/reflect', { text: `${FAKE_VOICE_KEY}が好き。わたしの名前は${HEX}` }), 200);
    assert.equal(await call('/api/tts', { text: FAKE_VOICE_KEY }), 503, '声の鍵がサーバーに無いので断る');
    assert.equal(await call('/api/metrics', { totalMs: 5, note: FAKE_VOICE_KEY, brain: FAKE_VOICE_KEY }), 200);
    assert.equal(await call('/api/chat', `{"text":"${FAKE_VOICE_KEY}"`), 400, '壊れた本文');
    const list = await (await fetch(`${base}/api/memory`, { headers: { 'x-memory-key': memKey } })).text();
    replies.push(list);
    assert.equal(JSON.parse(list).items.length, 0, '鍵らしい文字から何も覚えない');
  } finally {
    proc.kill();
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.match(memKey, /^[A-Za-z0-9_-]{43}$/);
  assertNoKey(out, 'サーバーの画面の出力');
  assert.ok(!out.includes(memKey), 'サーバーの画面に記憶の合鍵が無い');
  const files = walk(dir);
  assert.ok(files.length > 0, '記録のファイルが作られている(試験が空振りしていない)');
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assertNoKey(text, f);
    assert.ok(!text.includes(memKey), `${f} に記憶の合鍵があります`);
  }
  for (const r of replies) assertNoKey(r, '返事');
});
