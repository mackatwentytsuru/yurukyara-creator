// 読み上げの読み方の表の試験(11-07 第 11b 波)。ノリーの声(司令室 Q-0103 = D)は「執事」を「ひつじ」と読むことがあるので、
// 声に渡す文だけを「しつじ」にする。画面の字幕(文字・文字送り)と会話の履歴は「執事」のまま。どのキャラにも同じ表を使う。
// 本物の声のサービスは呼ばない(fetch を偽物にする)。偽の鍵は実行のときに組み立てる。サーバーの道は voice_role_server.test.mjs。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEECH_READINGS, toSpeechText } from '../src/conversation/speechReading.js';
import { ELEVEN_TTS } from '../src/conversation/elevenDirect.js';
import { Speaker } from '../src/conversation/speaker.js';
import { Dialogue } from '../src/conversation/dialogue.js';
import { clearVoiceKey, setVoiceKey } from '../src/conversation/voiceKey.js';

const CHARS = join(import.meta.dirname, '..', '..', 'characters');
const persona = (id) => readFileSync(join(CHARS, id, 'persona.md'), 'utf8');
const KEY = ['sk', 'feedbead'.repeat(6)].join('_');
const LINE = '執事見習いのノリーデス。'; // 画面に出す文
const SPOKEN = 'しつじ見習いのノリーデス。'; // 声に渡す文

/** 通信の偽物。宛先ごとに返事を決め、送った物を全部覚える */
function fakeFetch(routes) {
  const sent = [];
  const fn = async (url, init = {}) => {
    sent.push({ url: String(url), body: String(init.body ?? '') });
    for (const [prefix, make] of routes) if (String(url).startsWith(prefix)) return make(url, init);
    return new Response('{}', { status: 404 });
  };
  return { fn, sent };
}

function fakeCtx() {
  return {
    currentTime: 3,
    createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, onended: null }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
  };
}

const pcm = () => new Response(new Uint8Array(4800), { status: 200 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  clearVoiceKey();
});

test('読み方の表: 執事 → しつじ。表の言葉だけを、何回出ても替える。ほかの文字はそのまま。2 回通しても同じ', () => {
  assert.deepEqual(
    SPEECH_READINGS.map(([w, s]) => [w, s]),
    [['執事', 'しつじ']],
  );
  assert.ok(Object.isFrozen(SPEECH_READINGS) && SPEECH_READINGS.every((r) => Object.isFrozen(r)), '表は書き換えられない');
  for (const [written, spoken] of SPEECH_READINGS) {
    assert.ok(written && spoken && !spoken.includes(written), `${written} の読みに、書いてある言葉を含めない`);
    assert.match(spoken, /^[ぁ-ゟ゠-ヿ]+$/u, `${written} の読みは、かなだけ`);
  }
  assert.equal(toSpeechText('執事'), 'しつじ');
  assert.equal(toSpeechText(LINE), SPOKEN);
  assert.equal(toSpeechText('執事の執事は、執事見習い。'), 'しつじのしつじは、しつじ見習い。');
  assert.equal(toSpeechText('こんにちは。ひつじもいマス。'), 'こんにちは。ひつじもいマス。', '表に無い言葉はそのまま');
  assert.equal(toSpeechText(toSpeechText(LINE)), SPOKEN, '画面とサーバーの両方で通しても同じ');
  assert.equal(toSpeechText(undefined), '');
  assert.equal(toSpeechText(null), '');
  assert.equal(toSpeechText(12), '12');
});

test('ノリーの人格の文に「執事」があり、表はどの子の文にも同じように当たる(役・声の id によらない)', () => {
  assert.match(persona('norrie'), /執事/u, 'ノリーの文には執事が出てくる(だから読みが要る)');
  const mikanLine = 'みかんは、執事さんとお茶をしマス。';
  assert.equal(toSpeechText(mikanLine), 'みかんは、しつじさんとお茶をしマス。');
});

test('声の鍵(BYOK)の道: 声のサービスへ送る文は「しつじ」。ノリーでもみかんちゃんでも同じ', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([[ELEVEN_TTS, () => pcm()]]);
  globalThis.fetch = f.fn;
  try {
    setVoiceKey(KEY);
    const sp = new Speaker();
    Object.assign(sp, { ctx: fakeCtx(), analyser: {} });
    for (const id of ['norrie', 'mikan']) {
      sp.setVoiceChoice('auto', { persona: persona(id) });
      await sp.enqueue(LINE);
      assert.equal(JSON.parse(f.sent.at(-1).body).text, SPOKEN, id);
    }
    assert.equal(f.sent.length, 2);
    assert.ok(f.sent.every((s) => s.url.startsWith(ELEVEN_TTS)));
  } finally {
    clearVoiceKey();
    globalThis.fetch = realFetch;
  }
});

test('サーバーの道: /api/tts へ送る文は「しつじ」。声が無い時の文字送りの字幕は「執事」のまま(途中にも「しつじ」を出さない)', async () => {
  const realFetch = globalThis.fetch;
  const off = () => new Response(null, { status: 204, headers: { 'x-tts': 'off', 'x-tts-reason': 'no-key' } });
  const f = fakeFetch([['/api/tts', off]]);
  globalThis.fetch = f.fn;
  try {
    const sp = new Speaker();
    sp.setVoiceChoice('auto', { persona: persona('norrie') });
    const shown = [];
    await sp.enqueue(LINE, { onCrawl: (s) => shown.push(s) });
    assert.equal(f.sent.length, 1);
    assert.equal(JSON.parse(f.sent[0].body).text, SPOKEN, '声に渡す文');
    assert.equal(shown.at(-1), LINE, '字幕は、もとの文');
    assert.ok(shown.every((s) => !s.includes('しつ')), '文字送りの途中にも、読みの文字は出ない');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('会話の部品(Dialogue)と本物の読み上げの部品: 画面の字幕・吹き出し・履歴は「執事」、声に渡す文は「しつじ」', async () => {
  const realFetch = globalThis.fetch;
  const say = { type: 'say', text: LINE, expression: 'happy', motion: 'nod', gaze: 'person' };
  const chat = () => new Response(JSON.stringify({ brain: 'mock', events: [say] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const f = fakeFetch([
    ['/api/chat', chat],
    ['/api/tts', () => pcm()],
  ]);
  globalThis.fetch = f.fn;
  try {
    const sp = new Speaker();
    Object.assign(sp, { ctx: fakeCtx(), analyser: {} });
    const captions = [];
    const said = [];
    const noop = () => {};
    const d = new Dialogue({
      character: { setMouth: noop, play: noop, setEmotion: noop, expressions: ['neutral', 'happy'] },
      speaker: sp,
      ui: { userSaid: noop, thought: noop, say: (ev) => said.push(ev.text), caption: (t) => captions.push(t), error: noop, notice: noop },
      getContext: () => ({ scene: '', character: { name: 'ノリー', persona: persona('norrie') }, place: {} }),
      setGaze: () => null,
      onMetric: noop,
    });
    await d.send({ text: 'あなたはだれ?' });
    for (let i = 0; i < 150 && (sp.pending > 0 || !captions.includes(LINE)); i++) await wait(20);
    const tts = f.sent.filter((s) => s.url === '/api/tts').map((s) => JSON.parse(s.body).text);
    assert.deepEqual(tts, [SPOKEN], '声に渡す文');
    assert.ok(captions.includes(LINE), `字幕はもとの文(${JSON.stringify(captions)})`);
    assert.ok(!captions.some((c) => typeof c === 'string' && c.includes('しつ')), '字幕に読みの文字は出ない');
    assert.deepEqual(said, [LINE], '吹き出しも、もとの文');
    const last = d.history.at(-1);
    assert.equal(last.role, 'assistant');
    assert.ok(last.content.includes('執事') && !last.content.includes('しつ'), '履歴(次の回に頭脳へ渡す文)も、もとの文');
  } finally {
    globalThis.fetch = realFetch;
  }
});
