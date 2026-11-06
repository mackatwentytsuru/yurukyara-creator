// 声の鍵が無い時(CRITux 25。11-07): サーバーは 503 でなく 204(中身なし)と理由の印で「声なし」を返す。
// 画面(speaker.js)は失敗として扱わず、文字送りと「ピッ」で話し、この画面の間は /api/tts を聞きに行かない。
// 公開の URL のように /api/tts が無い所では、main.js が setServerVoice(false) を渡すと、1 回も聞きに行かない(console に 404 を出さない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_SERVER_VOICE, Speaker } from '../src/conversation/speaker.js';

function fakeAudio() {
  const oscs = [];
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {} });
  const ctx = {
    currentTime: 5,
    createOscillator() {
      const o = { type: '', frequency: param(), connect() {}, start(t) { o.at = t; }, stop(t) { o.until = t; }, onended: null };
      oscs.push(o);
      return o;
    },
    createGain: () => ({ gain: param(), connect() {} }),
    createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
  };
  return { ctx, oscs };
}

function speakerWithFetch(handler) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
  const sp = new Speaker();
  const { ctx, oscs } = fakeAudio();
  sp.ctx = ctx;
  sp.analyser = {};
  return { sp, oscs, calls, restore: () => (globalThis.fetch = realFetch) };
}

test('サーバーが 204 と印で「声なし」: 失敗にせず文字送りで話し、次から聞きに行かない', async () => {
  const t = speakerWithFetch(() => new Response(null, { status: 204, headers: { 'x-tts': 'off', 'x-tts-reason': 'no-key' } }));
  try {
    const shown = [];
    let info = null;
    await t.sp.enqueue('やあ。', { onStart: (_x, i) => (info = i), onCrawl: (s) => shown.push(s) });
    assert.deepEqual(info, { crawl: true }, '文字送りで話す');
    assert.deepEqual(shown, ['や', 'やあ', 'やあ。']);
    assert.equal(t.sp.serverTtsOff, '読み上げの鍵がありません');
    assert.equal(t.sp.ttsError, '読み上げの鍵がありません');
    await t.sp.enqueue('うん', {});
    assert.deepEqual(t.calls, ['/api/tts'], '2 文目は聞かない');
  } finally {
    t.restore();
  }
});

test('setServerVoice(false)(公開の URL など、声のサーバーが無い): 1 回も /api/tts を聞かずに文字送り。true に戻せば聞く', async () => {
  const t = speakerWithFetch(() => new Response(null, { status: 204, headers: { 'x-tts': 'off', 'x-tts-reason': 'no-key' } }));
  try {
    t.sp.setServerVoice(false);
    assert.equal(t.sp.serverTtsOff, NO_SERVER_VOICE);
    const shown = [];
    await t.sp.enqueue('こんにちは', { onCrawl: (s) => shown.push(s) });
    assert.equal(shown.at(-1), 'こんにちは');
    assert.deepEqual(t.calls, [], '聞きに行かない');
    t.sp.setServerVoice(true);
    assert.equal(t.sp.serverTtsOff, null);
    await t.sp.enqueue('もう一回', {});
    assert.deepEqual(t.calls, ['/api/tts'], 'また聞きに行く');
    t.sp.setServerVoice(true);
    assert.equal(t.sp.serverTtsOff, '読み上げの鍵がありません', 'サーバーが「鍵なし」と答えた理由は、true でも消さない');
  } finally {
    t.restore();
  }
});

test('今までの 503(古いサーバー)も、同じく次から聞かない', async () => {
  const t = speakerWithFetch(() => new Response(JSON.stringify({ error: '読み上げの鍵がありません' }), { status: 503, headers: { 'content-type': 'application/json' } }));
  try {
    await t.sp.enqueue('やあ', {});
    await t.sp.enqueue('うん', {});
    assert.equal(t.calls.length, 1);
    assert.equal(t.sp.serverTtsOff, '読み上げの鍵がありません');
  } finally {
    t.restore();
  }
});
