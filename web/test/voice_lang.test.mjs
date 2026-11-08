// 多言語の声と聞き取り(ML1)の試験。日本語だけ(言葉の指定が無い時)は、声のサービスへ渡す本文・おぼえ書きの名前・係への 1 行が今までと同じ。
// 偽の声のサーバーを立てて、本物の声のサービスは呼ばない(鍵は偽の文字列。声の文字数を使わない)。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cacheKey } from '../server/ttsCache.mjs';
import { createStt } from '../server/stt.mjs';
import { elevenRequest } from '../src/conversation/elevenDirect.js';
import { SR_LANG, VOICE_LANG_CODE } from '../src/conversation/lang.js';
import { effectiveHearLang, getHearLang, onHearLang, resetHearLang, setHearLang, sttLangHeaders, HEAR_LANG_STORE } from '../src/conversation/hearLang.js';
import { encodeWav } from '../src/conversation/wav.js';
import { Listener } from '../src/conversation/listener.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const logDir = mkdtempSync(join(tmpdir(), 'yc-voicelang-'));
let fake;
let upstream = [];
let tts;
const pcm = (n) => Buffer.alloc(n * 2, 3);
const FEMALE = { role: 'female', voiceId: 'fUjY9K2nAIwlALOwSiwc' };

before(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstream.push({ url: req.url, body: JSON.parse(body || '{}'), raw: body });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(pcm(1200));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.ELEVEN_API_URL = `http://127.0.0.1:${fake.address().port}/v1/text-to-speech/`;
  process.env.ELEVENLABS_API_KEY = 'test-dummy-key-not-real-0000000000';
  process.env.ELEVEN_DAILY_CHAR_CAP = '5000';
  process.env.LOG_DIR = logDir;
  tts = await import('../server/tts.mjs');
});

after(() => {
  fake?.close();
  rmSync(logDir, { recursive: true, force: true });
});

function fakeRes() {
  const chunks = [];
  const r = { head: null, ended: false };
  r.writeHead = (status, headers) => {
    r.head = { status, headers: headers ?? {} };
    return r;
  };
  r.write = (c) => chunks.push(Buffer.from(c));
  r.end = (c) => {
    if (c) chunks.push(Buffer.from(c));
    r.ended = true;
    return r;
  };
  r.body = () => Buffer.concat(chunks);
  return r;
}

test('おぼえ書きの名前: 日本語(言葉なし・ja)は今までの式と同じ。ほかの言葉は別の名前', () => {
  const old = (voiceId, modelId, text) => createHash('sha256').update(`${String(voiceId).length}:${voiceId}|${String(modelId).length}:${modelId}|${text}`).digest('hex');
  const a = cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'こんにちは');
  assert.equal(a, old('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'こんにちは'), '今のおぼえ書きをそのまま使える');
  assert.equal(cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'こんにちは', 'ja'), a);
  const en = cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'Hello', 'en');
  assert.notEqual(en, cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'Hello', 'ja'));
  assert.notEqual(en, cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'Hello', 'zh'), '同じ文字でも、言葉が違えば別の声');
  assert.equal(cacheKey('fUjY9K2nAIwlALOwSiwc', 'eleven_v4_turbo', 'Hello', 'en'), en);
});

test('/api/tts の頼み方(サーバー): 言葉なしは language_code が ja のまま。en・zh・ko はその値。知らない値は ja', async () => {
  upstream = [];
  const rows = [
    [undefined, 'ja', '日本語の 1 文目です。'],
    ['ja', 'ja', '日本語の 2 文目です。'],
    ['en', 'en', 'This is the first sentence.'],
    ['zh', 'zh', '这是第一句话。'],
    ['ko', 'ko', '첫 번째 문장이에요.'],
    ['fr', 'ja', 'Ceci est une phrase française.'],
  ];
  for (const [lang, want, text] of rows) {
    const r = fakeRes();
    await tts.streamSpeech(text, r, undefined, lang ? { ...FEMALE, lang } : FEMALE);
    assert.equal(r.head.status, 200, text);
    const sent = upstream.at(-1);
    assert.equal(sent.body.language_code, want, text);
    assert.equal(sent.body.text, text, text);
  }
  assert.equal(upstream.length, rows.length);
});

test('声のサービスへ渡す本文の字: 日本語の言葉なしは今までと同じ並び。日本語の読み替え表は日本語の時だけ', async () => {
  upstream = [];
  const a = fakeRes();
  await tts.streamSpeech('執事のノリーです。', a, undefined, FEMALE);
  assert.equal(upstream.at(-1).body.text, '執事のノリーです。'.replace('執事', 'しつじ'), '日本語は読み替え表を当てる(今までと同じ)');
  assert.deepEqual(Object.keys(upstream.at(-1).body), ['text', 'model_id', 'language_code'], '本文の欄の並びも同じ');
  const b = fakeRes();
  await tts.streamSpeech('執事 butler', b, undefined, { ...FEMALE, lang: 'en' });
  assert.equal(upstream.at(-1).body.text, '執事 butler', '日本語以外には読み替え表を当てない');
});

test('同じ文字でも言葉が違えば、おぼえ書きを使い回さない。同じ言葉は 2 回目がおぼえ書きから', async () => {
  upstream = [];
  const text = 'Hello there';
  const a = fakeRes();
  await tts.streamSpeech(text, a, undefined, { ...FEMALE, lang: 'en' });
  assert.equal(a.head.headers['x-tts-cache'], 'miss');
  const b = fakeRes();
  await tts.streamSpeech(text, b, undefined, { ...FEMALE, lang: 'en' });
  assert.equal(b.head.headers['x-tts-cache'], 'hit');
  const c = fakeRes();
  await tts.streamSpeech(text, c, undefined, { ...FEMALE, lang: 'ko' });
  assert.equal(c.head.headers['x-tts-cache'], 'miss');
  assert.equal(upstream.length, 2);
});

test('声の鍵の道(画面): elevenRequest の language_code は、無い時 ja。渡せば en・zh・ko。形の違う値は ja', () => {
  const body = (o) => JSON.parse(elevenRequest('x', { key: 'k', ...o }).init.body);
  assert.equal(body({}).language_code, 'ja');
  assert.deepEqual(Object.keys(body({})), ['text', 'model_id', 'language_code']);
  for (const code of Object.values(VOICE_LANG_CODE)) assert.equal(body({ languageCode: code }).language_code, code);
  for (const bad of ['', 'EN', 'english', 'ja-JP', null, 5, 'e1']) assert.equal(body({ languageCode: bad }).language_code, 'ja', String(bad));
});

test('聞き取りの言葉: SR_LANG(ブラウザ)と、/api/stt の見出し(日本語は何も付けない)', () => {
  assert.equal(SR_LANG.ja, 'ja-JP');
  assert.deepEqual(sttLangHeaders('ja'), {});
  assert.deepEqual(sttLangHeaders(undefined), {});
  assert.deepEqual(sttLangHeaders('en'), { 'x-stt-lang': 'en' });
  assert.deepEqual(sttLangHeaders('ko'), { 'x-stt-lang': 'ko' });
  assert.deepEqual(sttLangHeaders('fr'), {});
});

test('聞く言葉の置き場: 既定は ja・知らない値は替えない・覚える・替えた時だけ知らせる・日本語だけの時は選びの値を使わない', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  resetHearLang();
  assert.equal(getHearLang(storage), 'ja');
  const seen = [];
  const off = onHearLang((l) => seen.push(l));
  assert.equal(setHearLang('en', storage), 'en');
  assert.equal(mem.get(HEAR_LANG_STORE), 'en');
  assert.equal(setHearLang('en', storage), 'en');
  assert.equal(setHearLang('fr', storage), 'en', '知らない値は替えない');
  assert.equal(setHearLang('zh', storage), 'zh');
  assert.deepEqual(seen, ['en', 'zh'], '替えた時だけ知らせる');
  assert.equal(effectiveHearLang('multi', storage), 'zh');
  assert.equal(effectiveHearLang('ja', storage), 'ja', '日本語だけの時は、いつも日本語');
  assert.equal(effectiveHearLang(undefined, storage), 'ja');
  off();
  resetHearLang();
  assert.equal(getHearLang(storage), 'zh', '覚えた値を読み直せる');
  // 保存が壊れていても止まらない
  resetHearLang();
  assert.equal(getHearLang({ getItem() { throw new Error('x'); } }), 'ja');
  assert.equal(setHearLang('ko', { getItem: () => null, setItem() { throw new Error('x'); } }), 'ko');
  resetHearLang();
});

// ---- サーバーの聞き取り(偽の係) ----
const FAKE = join(HERE, '..', 'scripts', 'lib', 'fake_stt_worker.mjs');
const wav = () => Buffer.from(encodeWav(new Float32Array(1600)));
function fakeStt(mode) {
  process.env.FAKE_STT = mode;
  return createStt({ command: process.execPath, args: [FAKE], engine: 'local' });
}

test('係への 1 行: 言葉が無い時は今までと同じ(欄が 1 つか 2 つ)。言葉がある時だけ 3 つ目の欄', async () => {
  const stt = fakeStt('echoline');
  assert.equal((await stt.transcribe(wav())).text, 'fields=1|hint=|lang=', 'パスだけ');
  assert.equal((await stt.transcribe(wav(), { hint: 'ノリー' })).text, 'fields=2|hint=ノリー|lang=', 'パスと手がかり');
  assert.equal((await stt.transcribe(wav(), { hint: 'ノリー', lang: 'ja' })).text, 'fields=3|hint=ノリー|lang=ja', '日本語を言った時は、手がかりも使う');
  assert.equal((await stt.transcribe(wav(), { hint: 'ノリー', lang: 'xx' })).text, 'fields=2|hint=ノリー|lang=', '知らない値は無いのと同じ');
  stt.stop();
});

test('日本語以外(auto も)では、キャラの名前の手がかりを係へ渡さない', async () => {
  const stt = fakeStt('echoline');
  for (const lang of ['en', 'zh', 'ko', 'auto']) {
    const r = await stt.transcribe(wav(), { hint: 'ノリー', lang });
    assert.equal(r.text, `fields=3|hint=|lang=${lang}`, lang);
  }
  stt.stop();
});

test('日本語の空耳の消しは、日本語の時だけ。日本語以外では、そのまま返す', async () => {
  const stt = fakeStt('text=ご視聴ありがとうございました');
  assert.equal((await stt.transcribe(wav())).text, '', '今までどおり、日本語では空にする');
  assert.equal((await stt.transcribe(wav(), { lang: 'ja' })).text, '');
  assert.equal((await stt.transcribe(wav(), { lang: 'en' })).text, 'ご視聴ありがとうございました', '日本語以外では、日本語の空耳の消しを使わない');
  stt.stop();
  const stt2 = fakeStt('text= Thank you. ');
  assert.equal((await stt2.transcribe(wav(), { lang: 'en' })).text, 'Thank you.', '前後の空白は消す');
  stt2.stop();
});

test('係(stt_worker.py): language_for は、auto = None・ja/en/zh/ko = その値・無い値は STT_LANG の既定', () => {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const code = [
    'import sys,types',
    "m=types.ModuleType('faster_whisper'); m.WhisperModel=object; sys.modules['faster_whisper']=m",
    `sys.path.insert(0, r'${join(HERE, '..', 'server')}')`,
    'import stt_worker as w',
    "print([w.language_for(x) for x in ('auto','ja','en','zh','ko','','xx')])",
  ].join('\n');
  const env = { ...process.env };
  delete env.STT_LANG; // 既定(ja)を見る
  const r = spawnSync(py, ['-I', '-c', code], { encoding: 'utf8', timeout: 20000, env });
  if (r.error || r.status !== 0) return; // python が使えない環境では、この確かめだけ飛ばす
  assert.equal(r.stdout.trim(), "[None, 'ja', 'en', 'zh', 'ko', 'ja', 'ja']");
  env.STT_LANG = 'en';
  const r2 = spawnSync(py, ['-I', '-c', code], { encoding: 'utf8', timeout: 20000, env });
  assert.equal(r2.stdout.trim(), "[None, 'ja', 'en', 'zh', 'ko', 'en', 'en']", '言葉の指定が無い時は、今までの STT_LANG のまま');
});

// ---- ブラウザの聞き取り(偽の SpeechRecognition) ----
function withFakeSpeech(fn) {
  const made = [];
  class FakeSR {
    constructor() {
      made.push(this);
      this.stopped = 0;
      this.started = 0;
    }
    start() {
      this.started += 1;
    }
    stop() {
      this.stopped += 1;
    }
  }
  const prev = globalThis.window;
  globalThis.window = { SpeechRecognition: FakeSR };
  try {
    return fn(made);
  } finally {
    globalThis.window = prev;
  }
}

test('ブラウザの聞き取り: 言葉の指定が無い時は今までの ja-JP。多言語の時は選んだ言葉', () => {
  withFakeSpeech((made) => {
    new Listener({}, { provider: 'web' })._startRecognition();
    assert.equal(made.at(-1).lang, 'ja-JP', '言葉の指定なし = 今までと同じ');
    for (const [lang, want] of [['ja', 'ja-JP'], ['en', 'en-US'], ['zh', 'zh-CN'], ['ko', 'ko-KR'], ['fr', 'ja-JP']]) {
      new Listener({}, { provider: 'web', lang: () => lang })._startRecognition();
      assert.equal(made.at(-1).lang, want, lang);
    }
    new Listener({}, { provider: 'web', lang: () => { throw new Error('x'); } })._startRecognition();
    assert.equal(made.at(-1).lang, 'ja-JP', '言葉が取れなくても、日本語で聞く');
  });
});

test('聞く言葉を替えたら、ブラウザの聞き取りを止める(終わると新しい言葉で始め直す)。聞いていない時・PC の聞き取りは何もしない', () => {
  withFakeSpeech((made) => {
    let lang = 'ja';
    const l = new Listener({}, { provider: 'web', lang: () => lang });
    l.setLang();
    assert.equal(made.length, 0, '聞いていない時は何もしない');
    l.listening = true;
    l._startRecognition();
    const first = made.at(-1);
    assert.equal(first.lang, 'ja-JP');
    lang = 'en';
    l.setLang();
    assert.equal(first.stopped, 1);
    l.listening = false; // 試験では始め直し(200ms 後)を待たず、新しい言葉で作った時の lang だけを見る
    new Listener({}, { provider: 'web', lang: () => lang })._startRecognition();
    assert.equal(made.at(-1).lang, 'en-US');
    const server = new Listener({}, { provider: 'server', lang: () => 'en' });
    server.listening = true;
    server.recognition = first;
    server.setLang();
    assert.equal(first.stopped, 1, 'PC の聞き取りでは止めない(次の区間から新しい言葉で送る)');
  });
});
