// 使う人の声の鍵(BYOK)の試験。鍵はブラウザの中だけ: 声のサービスへの直接の読み上げにだけ付き、私たちのサーバーへの通信には付かない。
// 本物の声のサービスは呼ばない(fetch を偽物にする)。偽の鍵は実行のときに組み立てる(ファイルに鍵の形の文字を置かない)。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearVoiceKey, getVoiceKey, isPlausibleVoiceKey, isVoiceKeyRemembered, maskVoiceKey, setVoiceKey } from '../src/conversation/voiceKey.js';
import { DEFAULT_VOICE_ID, ELEVEN_TTS, checkVoiceKey, elevenRequest } from '../src/conversation/elevenDirect.js';
import { Speaker } from '../src/conversation/speaker.js';
import { streamChat } from '../src/conversation/brainClient.js';
import { setDemoPass } from '../src/conversation/demoPass.js';

const KEY = ['sk', 'f00dcafe'.repeat(6)].join('_');

/** ブラウザの保存の偽物(何を書いたかを覚える) */
function fakeStorage() {
  const m = new Map();
  const log = [];
  return { log, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => (log.push(['set', k]), m.set(k, String(v))), removeItem: (k) => (log.push(['remove', k]), m.delete(k)) };
}

/** 通信の偽物。宛先ごとに返事を決め、送った物を全部覚える */
function fakeFetch(routes) {
  const sent = [];
  const fn = async (url, init = {}) => {
    sent.push({ url: String(url), headers: { ...(init.headers ?? {}) }, body: String(init.body ?? '') });
    for (const [prefix, make] of routes) if (String(url).startsWith(prefix)) return make(url, init);
    return new Response('{}', { status: 404 });
  };
  return { fn, sent };
}

function fakeCtx() {
  const played = [];
  return {
    played,
    ctx: {
      currentTime: 3,
      createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
      createBufferSource: () => ({ connect() {}, start(at) { played.push(at); }, stop() {}, onended: null }),
      createOscillator: () => ({ type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, onended: null }),
      createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
    },
  };
}

let storage;
beforeEach(() => {
  storage = fakeStorage();
  globalThis.localStorage = storage;
  clearVoiceKey();
  storage.log.length = 0;
});

test('鍵の置き場: 既定は覚えない(ブラウザの保存に書かない)。選んだときだけ覚える。消すと保存からも消える', () => {
  assert.equal(isPlausibleVoiceKey(KEY), true);
  assert.equal(isPlausibleVoiceKey('短い'), false);
  assert.equal(isPlausibleVoiceKey(`${KEY} `.repeat(2)), false, '空白の入った物は断る');
  assert.throws(() => setVoiceKey('abc'));
  setVoiceKey(KEY);
  assert.equal(getVoiceKey(), KEY);
  assert.equal(isVoiceKeyRemembered(), false);
  assert.ok(!storage.log.some(([op]) => op === 'set'), '覚えないを選んだら、保存に書かない');
  setVoiceKey(KEY, { remember: true });
  assert.equal(isVoiceKeyRemembered(), true);
  assert.equal(maskVoiceKey(), `sk_…${KEY.slice(-4)}`);
  assert.ok(!maskVoiceKey().includes(KEY.slice(3, 20)), '画面には中身を出さない');
  clearVoiceKey();
  assert.equal(getVoiceKey(), '');
  assert.equal(isVoiceKeyRemembered(), false);
});

test('声のサービスへ頼む中身: 宛先は 1 つ、送るのは文・モデル・言葉だけ、クッキーを送らない', () => {
  const { url, init } = elevenRequest('こんにちは', { key: KEY });
  assert.equal(url, `${ELEVEN_TTS}${DEFAULT_VOICE_ID}/stream?output_format=pcm_24000`);
  assert.equal(init.headers['xi-api-key'], KEY);
  assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['language_code', 'model_id', 'text']);
  assert.equal(init.credentials, 'omit');
  assert.equal(elevenRequest('x', { key: KEY, voiceId: '../../evil' }).url.includes('evil'), false, 'おかしな声の名前は既定に戻す');
});

test('鍵があれば、読み上げは声のサービスへ直接(サーバーの /api/tts を使わない)。音はそのまま再生される', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([[ELEVEN_TTS, () => new Response(new Uint8Array(4800), { status: 200 })]]);
  globalThis.fetch = f.fn;
  try {
    setVoiceKey(KEY);
    const sp = new Speaker();
    const { ctx, played } = fakeCtx();
    Object.assign(sp, { ctx, analyser: {} });
    let info = null;
    await sp.enqueue('こんにちは', { onStart: (_t, i) => (info = i) });
    assert.equal(f.sent.length, 1);
    assert.ok(f.sent[0].url.startsWith(ELEVEN_TTS));
    assert.equal(f.sent[0].headers['xi-api-key'], KEY);
    assert.ok(played.length > 0, '声を再生した');
    assert.deepEqual(info, { crawl: false });
    assert.equal(sp.ttsError, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('鍵が違う(401)ときは、分かる言葉を出し、文字送りで話し続ける', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([[ELEVEN_TTS, () => new Response('{}', { status: 401 })]]).fn;
  try {
    setVoiceKey(KEY);
    const sp = new Speaker();
    const shown = [];
    await sp.enqueue('うん', { onCrawl: (s) => shown.push(s) });
    assert.equal(sp.voiceKeyStatus, 401);
    assert.match(sp.ttsError, /声の鍵が違う/);
    assert.deepEqual(shown, ['う', 'うん']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('鍵を確かめる: 使えたら「声が出せるようになったよ、ありがとう!」、だめなら理由', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = fakeFetch([[ELEVEN_TTS, () => new Response(new Uint8Array(10), { status: 200 })]]).fn;
    assert.deepEqual(await checkVoiceKey(KEY), { ok: true, status: 200, message: '声が出せるようになったよ、ありがとう!' });
    globalThis.fetch = fakeFetch([[ELEVEN_TTS, () => new Response('{}', { status: 429 })]]).fn;
    const r = await checkVoiceKey(KEY);
    assert.equal(r.ok, false);
    assert.match(r.message, /枠が足りない/);
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    assert.equal((await checkVoiceKey(KEY)).message, '声のサービスにつながりません');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('会話と記憶の通信には、声の鍵が付かない(見出しにも本文にも)。合言葉は見出しで送る', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([['/api/chat', () => new Response(JSON.stringify({ brain: 'real', fallback: false, events: [{ type: 'say', text: 'うん' }] }), { status: 200, headers: { 'content-type': 'application/json' } })]]);
  globalThis.fetch = f.fn;
  try {
    setVoiceKey(KEY, { remember: true });
    setDemoPass('pass-for-test');
    const got = [];
    await streamChat({ text: 'こんにちは', history: [] }, (e) => got.push(e), new AbortController().signal);
    assert.deepEqual(got.map((e) => e.type), ['say', 'done']);
    const chat = f.sent.find((s) => s.url === '/api/chat');
    assert.equal(chat.headers['x-demo-pass'], 'pass-for-test');
    for (const s of f.sent) {
      assert.ok(!JSON.stringify(s.headers).includes(KEY.slice(3)), `${s.url} の見出しに鍵`);
      assert.ok(!s.body.includes(KEY.slice(3)), `${s.url} の本文に鍵`);
    }
  } finally {
    globalThis.fetch = realFetch;
    setDemoPass('');
  }
});
