// 声の役(男の子・女の子)のサーバー側の試験(11-07 第 11 波)。本物の声のサービスは呼ばない:
// 手元のサーバーを偽の声のサービス(ELEVEN_API_URL)に向けて起こし、/api/tts とあいづちの声づくりが、どの声の id とモデルで頼むかを見る。
// 偽の鍵は実行のときに組み立てる(ファイルに鍵の形の文字を置かない)。記録・記憶・あいづちの声は一時のフォルダに置く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLE_DEFAULT_VOICES } from '../src/conversation/voiceRole.js';
import { FILLER_PHRASES } from '../server/fillers.mjs';
import { knownVoiceIds, roleVoiceId, voiceForRequest } from '../server/tts.mjs';

const WEB = join(import.meta.dirname, '..');
const FAKE_VOICE_KEY = ['fake', 'voice', 'value', 'not', 'real'].join('-');
const LEGACY = ['Legacy', 'Voice', '00001'].join(''); // ELEVEN_VOICE_ID(最後の控え)
const OWN = ['Own', 'Voice', 'Id', '12345'].join('');
const STRANGER = 'Z'.repeat(20); // 形は正しいが、使ってよい声の表に無い id(CRITsec3 L4)
const FAKE_DETAIL = ['upstream', 'detail', 'text', 'for', 'the', 'log', 'only'].join('-'); // 声のサービスの返事の文(画面に返さない)

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** 偽の声のサービス。頼まれた声の id(道の中)とモデル(本文)を覚え、短い PCM を返す */
async function fakeVoice({ failWith = 0 } = {}) {
  const asked = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const m = /\/v1\/text-to-speech\/([^/]+)\/stream/.exec(req.url);
      const body = JSON.parse(raw || '{}');
      asked.push({ voiceId: m?.[1] ?? '', model: body.model_id, text: body.text, key: req.headers['xi-api-key'] === FAKE_VOICE_KEY });
      if (failWith) return res.writeHead(failWith, { 'content-type': 'text/plain' }).end(FAKE_DETAIL);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(4800));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/v1/text-to-speech/`, asked, close: () => server.close() };
}

async function startServer(voiceBase, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-voice-role-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory'), FILLER_DIR: join(dir, 'fillers') };
  // 鍵と声の設定は空の値で渡す(web/.env があっても埋め戻さない)。モデルは空 = 既定(eleven_v4_turbo)
  Object.assign(env, { ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: FAKE_VOICE_KEY, ELEVEN_API_URL: voiceBase, ELEVEN_VOICE_ID: LEGACY, ELEVEN_VOICE_MALE: '', ELEVEN_VOICE_FEMALE: '', ELEVEN_MODEL_ID: '', ELEVEN_VOICE_IDS: OWN, APP_PASSPHRASE: '' });
  Object.assign(env, extraEnv);
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, log: () => out };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** あいづちの声が両方の役でそろうまで待つ(起こした時に作り始める) */
async function waitFillers(base) {
  let data = null;
  for (let i = 0; i < 100; i++) {
    data = await (await fetch(`${base}/api/fillers`)).json();
    if (data.roles?.male?.length === FILLER_PHRASES.length && data.roles?.female?.length === FILLER_PHRASES.length) return data;
    await new Promise((r) => setTimeout(r, 100));
  }
  return data;
}

async function speak(base, body) {
  const res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await res.arrayBuffer();
  return res;
}

test('声を決める関数: 話す役の既定(環境変数 > 決まった既定)> ELEVEN_VOICE_ID。その子の声の id は形が正しい時だけ。auto・知らない値は女の子', () => {
  const cfg = { voiceMale: '', voiceFemale: '', voiceId: LEGACY, voiceIds: [OWN] }; // OWN = 使ってよい声の表への追加(ELEVEN_VOICE_IDS)
  assert.deepEqual(voiceForRequest({ voice: 'male' }, cfg), { role: 'male', voiceId: ROLE_DEFAULT_VOICES.male });
  assert.deepEqual(voiceForRequest({ voice: 'female' }, cfg), { role: 'female', voiceId: ROLE_DEFAULT_VOICES.female });
  for (const v of [undefined, 'auto', 'robot', 3]) assert.deepEqual(voiceForRequest({ voice: v }, cfg), { role: 'female', voiceId: ROLE_DEFAULT_VOICES.female }, String(v));
  assert.deepEqual(voiceForRequest(null, cfg), { role: 'female', voiceId: ROLE_DEFAULT_VOICES.female });
  assert.deepEqual(voiceForRequest({ voice: 'male', voiceId: OWN }, cfg), { role: 'male', voiceId: OWN });
  assert.deepEqual(voiceForRequest({ voice: 'male', voiceId: '../../evil' }, cfg), { role: 'male', voiceId: ROLE_DEFAULT_VOICES.male }, '形の違う id は使わない');
  // CRITsec3 L4: 形が正しくても、使ってよい声の表(役の既定・環境変数・characters の persona.md の声の id)に無い id は使わない
  assert.deepEqual(voiceForRequest({ voice: 'male', voiceId: STRANGER }, cfg), { role: 'male', voiceId: ROLE_DEFAULT_VOICES.male }, '表に無い id は役の既定');
  for (const bad of ['../../../v1/user', 'abc%2F..%2Fuser', 'abcdefgh?x=1', ['abcdefgh1'], { toString: () => OWN }]) {
    assert.deepEqual(voiceForRequest({ voice: 'female', voiceId: bad }, cfg), { role: 'female', voiceId: ROLE_DEFAULT_VOICES.female }, JSON.stringify(bad));
  }
  const known = knownVoiceIds(cfg);
  for (const id of [ROLE_DEFAULT_VOICES.male, ROLE_DEFAULT_VOICES.female, LEGACY, OWN]) assert.ok(known.has(id), `表に ${id.slice(0, 4)}… がある`);
  assert.ok(!known.has(STRANGER));
  assert.deepEqual(voiceForRequest({ voice: 'male', voiceId: 'Persona' + 'Voice0001' }, cfg, new Set(['Persona' + 'Voice0001'])), { role: 'male', voiceId: 'Persona' + 'Voice0001' }, '表を渡せば、その表の id');
  const env = { ...cfg, voiceMale: 'EnvMaleVoice0001', voiceFemale: 'bad id' };
  assert.equal(roleVoiceId('male', env), 'EnvMaleVoice0001');
  assert.equal(roleVoiceId('female', env), ROLE_DEFAULT_VOICES.female, '形の違う環境変数は飛ばす');
});

test('/api/tts: 男の子・女の子の役の声で頼む(モデルは eleven_v4_turbo)。あいづちの声も役ごとに作り、/api/fillers は役ごとの組を返す。ELEVEN_VOICE_ID は役の既定より後', async () => {
  const voice = await fakeVoice();
  const server = await startServer(voice.base);
  try {
    const fillers = await waitFillers(server.base);
    assert.equal(fillers.roles.male.length, FILLER_PHRASES.length, `男の子のあいづち(${server.log()})`);
    assert.equal(fillers.roles.female.length, FILLER_PHRASES.length);
    assert.deepEqual(fillers.fillers, fillers.roles.female, '前の形の fillers は女の子の組');
    assert.notDeepEqual(fillers.roles.male.map((f) => f.url), fillers.roles.female.map((f) => f.url), '役ごとに別の声の物');
    const made = voice.asked.splice(0);
    assert.deepEqual([...new Set(made.map((a) => a.voiceId))].sort(), [ROLE_DEFAULT_VOICES.male, ROLE_DEFAULT_VOICES.female].sort(), 'あいづちは 2 つの役の声で作った');
    assert.equal(made.length, FILLER_PHRASES.length * 2);

    const cases = [
      [{ text: 'はじめまして', voice: 'male' }, ROLE_DEFAULT_VOICES.male, 'male'],
      [{ text: 'こんにちは', voice: 'female' }, ROLE_DEFAULT_VOICES.female, 'female'],
      [{ text: 'やあ', voice: 'auto' }, ROLE_DEFAULT_VOICES.female, 'female'],
      [{ text: 'うん' }, ROLE_DEFAULT_VOICES.female, 'female'],
      [{ text: 'ええ', voice: 'male', voiceId: OWN }, OWN, 'male'],
      [{ text: 'はい', voice: 'male', voiceId: '../evil' }, ROLE_DEFAULT_VOICES.male, 'male'],
      [{ text: 'どうも', voice: 'male', voiceId: STRANGER }, ROLE_DEFAULT_VOICES.male, 'male'], // 形は正しいが表に無い id(CRITsec3 L4)
      [{ text: 'そう', voice: 'robot' }, ROLE_DEFAULT_VOICES.female, 'female'],
    ];
    for (const [body, voiceId, role] of cases) {
      const res = await speak(server.base, body);
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(res.headers.get('x-voice-role'), role, JSON.stringify(body));
      const a = voice.asked.at(-1);
      assert.deepEqual([a.voiceId, a.model, a.text, a.key], [voiceId, 'eleven_v4_turbo', body.text, true], JSON.stringify(body));
    }
    assert.ok(!voice.asked.some((a) => a.voiceId === LEGACY), 'ELEVEN_VOICE_ID は使われない(役の既定が先)');
    const status = await (await fetch(`${server.base}/api/status`)).json();
    assert.deepEqual(status.tts.roles, ['male', 'female']);
    assert.equal(status.tts.model, 'eleven_v4_turbo');
    assert.ok(!JSON.stringify(status).includes(ROLE_DEFAULT_VOICES.male), '状態には声の id を出さない');
  } finally {
    server.proc.kill();
    voice.close();
  }
});

test('/api/tts: 環境変数 ELEVEN_VOICE_MALE・ELEVEN_VOICE_FEMALE で役の既定を替えられる', async () => {
  const voice = await fakeVoice();
  const male = ['Env', 'Male', 'Voice', '0001'].join('');
  const female = ['Env', 'Female', 'Voice', '01'].join('');
  const server = await startServer(voice.base, { ELEVEN_VOICE_MALE: male, ELEVEN_VOICE_FEMALE: female });
  try {
    await waitFillers(server.base);
    assert.deepEqual([...new Set(voice.asked.splice(0).map((a) => a.voiceId))].sort(), [male, female].sort(), 'あいづちも環境変数の声');
    await speak(server.base, { text: 'はじめまして', voice: 'male' });
    assert.equal(voice.asked.at(-1).voiceId, male);
    await speak(server.base, { text: 'こんにちは', voice: 'female' });
    assert.equal(voice.asked.at(-1).voiceId, female);
    await speak(server.base, { text: 'うん', voice: 'male', voiceId: OWN });
    assert.equal(voice.asked.at(-1).voiceId, OWN, 'その子自身の声の id が環境変数より先');
  } finally {
    server.proc.kill();
    voice.close();
  }
});

test('/api/tts: 読み方の表(執事 → しつじ)を当ててから声のサービスへ渡す。画面が先に当てた文でも同じ(11-07 第 11b 波)', async () => {
  const voice = await fakeVoice();
  const server = await startServer(voice.base);
  try {
    await waitFillers(server.base);
    voice.asked.splice(0);
    for (const text of ['執事見習いのノリーデス。', 'しつじ見習いのノリーデス。']) {
      const res = await speak(server.base, { text, voice: 'male' });
      assert.equal(res.status, 200, text);
      assert.equal(voice.asked.at(-1).text, 'しつじ見習いのノリーデス。', text);
    }
    assert.equal(voice.asked.length, 2);
    assert.ok(!voice.asked.some((a) => a.text.includes('執事')), '声のサービスには「執事」の字を渡さない');
  } finally {
    server.proc.kill();
    voice.close();
  }
});

test('声の鍵が無いサーバーは、今までどおり 204(役を送っても、声のサービスを呼ばない)', async () => {
  const voice = await fakeVoice();
  const server = await startServer(voice.base, { ELEVENLABS_API_KEY: '' });
  try {
    const res = await speak(server.base, { text: 'はじめまして', voice: 'male' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('x-tts-reason'), 'no-key');
    const fillers = await (await fetch(`${server.base}/api/fillers`)).json();
    assert.deepEqual(fillers.roles, { male: [], female: [] });
    assert.equal(voice.asked.length, 0);
  } finally {
    server.proc.kill();
    voice.close();
  }
});

test('/api/tts: 声のサービスが失敗した時、返事の文を画面へ返さない(手元の記録にだけ書く)。文字数は返す(CRITsec3 L4)', async () => {
  const voice = await fakeVoice({ failWith: 500 });
  const server = await startServer(voice.base);
  try {
    const res = await speak(server.base, { text: 'はじめまして', voice: 'male' });
    assert.equal(res.status, 502);
    const text = JSON.stringify(await fetch(`${server.base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'もう一度' }) }).then((r) => r.json()));
    assert.ok(!text.includes(FAKE_DETAIL), '声のサービスの返事の文は、画面へ返さない');
    assert.match(text, /読み上げに失敗 \(500\)/);
    assert.ok(server.log().includes(FAKE_DETAIL), '手元の記録には書く');
  } finally {
    server.proc.kill();
    voice.close();
  }
});
