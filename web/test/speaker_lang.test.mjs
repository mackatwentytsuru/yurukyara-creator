// 画面の声(speaker.js)の多言語(ML1)の試験。日本語だけの時は、サーバーへ送る本文・おぼえ書きの名前・端末の声の lang が今までと同じ。
// 多言語の時だけ、文ごとの言葉(en・zh・ko)を送る。日本語以外を聞いている間は、日本語のあいづちを出さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../src/conversation/speaker.js';
import { clearVoiceKey, setVoiceKey } from '../src/conversation/voiceKey.js';

const pcmBytes = (n) => new Uint8Array(n * 2).fill(5);

function setup() {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
    return new Response(pcmBytes(2400), { status: 200 });
  };
  const sp = new Speaker();
  return { sp, sent, restore: () => (globalThis.fetch = realFetch) };
}
const drain = async (sp, text) => {
  for await (const _ of sp._fetchPcmRaw(text, new AbortController().signal, null, {})) void _;
};

test('サーバーの声: 日本語だけ(言葉の指定なし・ja)は、本文に lang を付けない(今までと同じ本文)', async () => {
  const t = setup();
  try {
    await drain(t.sp, 'こんにちは。');
    t.sp.setLangMode('ja');
    await drain(t.sp, 'Hello, this is English.'); // 日本語だけの時は、英語の文でも ja のまま
    assert.equal(t.sent.length, 2);
    for (const s of t.sent) assert.equal(Object.hasOwn(s.body, 'lang'), false);
    assert.deepEqual(Object.keys(t.sent[0].body), ['text', 'voice']);
  } finally {
    t.restore();
  }
});

test('サーバーの声: 多言語の時は、文ごとの言葉を送る(日本語の文には付けない)', async () => {
  const t = setup();
  try {
    t.sp.setLangMode('multi');
    await drain(t.sp, 'Where is the restroom?');
    await drain(t.sp, '洗手间在哪里?');
    await drain(t.sp, '화장실은 어디에 있어요?');
    await drain(t.sp, 'こんにちは。');
    assert.deepEqual(t.sent.map((s) => s.body.lang), ['en', 'zh', 'ko', undefined]);
  } finally {
    t.restore();
  }
});

test('日本語の読み替え表(執事 → しつじ)は日本語の時だけ当てる', async () => {
  const t = setup();
  try {
    await drain(t.sp, '執事です。');
    t.sp.setLangMode('multi');
    await drain(t.sp, 'I am a 執事 butler');
    await drain(t.sp, '執事です。');
    assert.equal(t.sent[0].body.text, 'しつじです。');
    assert.equal(t.sent[1].body.text, 'I am a 執事 butler', '英語の文には当てない');
    assert.equal(t.sent[2].body.text, 'しつじです。');
  } finally {
    t.restore();
  }
});

test('声の鍵の道: 多言語の時だけ language_code を en・zh・ko にする。日本語は ja のまま', async () => {
  const t = setup();
  setVoiceKey('test-key-not-real-0123456789');
  try {
    await drain(t.sp, 'こんにちは。');
    t.sp.setLangMode('multi');
    await drain(t.sp, 'Hello there.');
    await drain(t.sp, '你好,欢迎光临。');
    await drain(t.sp, '안녕하세요.');
    const codes = t.sent.map((s) => s.body.language_code);
    assert.deepEqual(codes, ['ja', 'en', 'zh', 'ko']);
    assert.ok(t.sent.every((s) => s.url.startsWith('https://api.elevenlabs.io/')));
  } finally {
    clearVoiceKey();
    t.restore();
  }
});

test('おぼえ書きの名前: 日本語は今までの形。ほかの言葉は言葉が入る(同じ文字でも別の物)', () => {
  const sp = new Speaker();
  sp.langMode = 'ja';
  const ja = sp._cacheKey('Hello');
  assert.equal(ja, `s|${sp.currentVoice().voiceId}|${sp.currentVoice().role}|${sp.currentVoice().ownVoiceId ?? ''}|Hello`, '今までの形');
  sp.setLangMode('multi');
  const en = sp._cacheKey('Hello');
  assert.notEqual(en, ja);
  assert.match(en, /\|en\|Hello$/);
  assert.equal(sp._cacheKey('こんにちは。'), `s|${sp.currentVoice().voiceId}|${sp.currentVoice().role}|${sp.currentVoice().ownVoiceId ?? ''}|こんにちは。`, '日本語の文は多言語でも今までの形');
});

test('端末の声: 日本語は ja-JP のまま。多言語の時は文の言葉', () => {
  const made = [];
  const prevU = globalThis.SpeechSynthesisUtterance;
  const prevS = globalThis.speechSynthesis;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      made.push(this);
    }
  };
  globalThis.speechSynthesis = { speak() {} };
  try {
    const sp = new Speaker();
    sp._speakDevice('Hello there');
    assert.equal(made.at(-1).lang, 'ja-JP', '日本語だけの時は、英語の文でも ja-JP');
    sp.setLangMode('multi');
    sp._speakDevice('Hello there');
    assert.equal(made.at(-1).lang, 'en-US');
    sp._speakDevice('你好,欢迎光临');
    assert.equal(made.at(-1).lang, 'zh-CN');
    sp._speakDevice('안녕하세요');
    assert.equal(made.at(-1).lang, 'ko-KR');
    sp._speakDevice('こんにちは');
    assert.equal(made.at(-1).lang, 'ja-JP');
  } finally {
    globalThis.SpeechSynthesisUtterance = prevU;
    globalThis.speechSynthesis = prevS;
  }
});

test('あいづち: 日本語以外を聞いている間は、録ってある日本語のあいづちを出さない', () => {
  const sp = new Speaker();
  const starts = [];
  const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
  sp.ctx = {
    currentTime: 1,
    createBuffer: (_c, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start: (t) => starts.push(t), stop() {} }),
    createGain: () => ({ gain: param, connect() {} }),
  };
  sp.analyser = {};
  sp.fillers = [{ text: 'うん', samples: new Float32Array(2400), ms: 100 }];
  assert.ok(sp.playFiller(), '聞く言葉の指定が無い時は今までどおり出す');
  sp.setHearLang('ja');
  assert.ok(sp.playFiller());
  sp.setHearLang('en');
  assert.equal(sp.playFiller(), null);
  sp.setHearLang('ko');
  assert.equal(sp.playFiller(), null);
  sp.setHearLang('ja');
  assert.ok(sp.playFiller(), '日本語に戻したら、また出す');
});
