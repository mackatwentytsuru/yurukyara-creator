// QF3(11-07 夜・試験の指摘の直し): 声の上限の知らせ・名前の取り違え・つながらない時の言葉と履歴・端末の声・「全部わすれました」。
// 本物の頭脳・声のサービスは呼ばない(偽の物だけ)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts } from '../server/memory/reflect.mjs';
import { Dialogue, OFFLINE_NOTICE, TEXT_MAX_CHARS, TOO_LONG_NOTICE, friendlyChatError } from '../src/conversation/dialogue.js';
import { Speaker, VOICE_CAP_NOTICE } from '../src/conversation/speaker.js';

const kinds = (text, selfNames = ['ノリー']) => extractFacts(text, { selfNames }).map((f) => f.text);

// ---- 中6: 名前の取り違え ----
test('「名前は」だけでは、使う人の名前を上書きしない(犬の名前など)。自分を指す言い方だけ覚える', () => {
  assert.deepEqual(kinds('犬を飼っています。名前はポチです。'), []);
  assert.deepEqual(kinds('うちの犬の名前はポチです'), []);
  assert.deepEqual(kinds('名前はポチです'), []);
  assert.deepEqual(kinds('ぼくの名前はたろうです'), ['名前: たろう']);
  assert.deepEqual(kinds('わたしの名前はじろう'), ['名前: じろう']);
  assert.deepEqual(kinds('私はハナです'), ['名前: ハナ']);
  assert.deepEqual(kinds('ハナって呼んで'), ['名前: ハナ']);
});

test('「好きな○○は□□です」を覚える。問いの形・「何」は覚えない', () => {
  assert.deepEqual(kinds('好きな食べ物はカレーです'), ['好きなもの: カレー', '前に話したこと: カレーの話']);
  assert.deepEqual(kinds('好きな色は あおです'), ['好きなもの: あお', '前に話したこと: あおの話']);
  assert.deepEqual(kinds('好きな食べ物は何?'), []);
  assert.deepEqual(kinds('好きな食べ物は何'), []);
  assert.deepEqual(kinds('好きな食べ物を教えて'), []);
  assert.deepEqual(kinds('ノリーが好き'), [], '話している子の名前は覚えない');
  assert.deepEqual(kinds('カレーが好き'), ['好きなもの: カレー', '前に話したこと: カレーの話'], '前からの形は変わらない');
});

// ---- 中7: つながらない時 ----
function newDialogue() {
  const log = { captions: [], errors: [], notices: [] };
  const speaker = { speaking: false, pending: 0, capReached: false, setVoicePersona() {}, playFiller: () => null, stop() {}, enqueue: () => Promise.resolve() };
  const d = new Dialogue({
    character: { expressions: ['neutral'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false },
    speaker,
    ui: { thought() {}, say() {}, userSaid() {}, caption: (t) => log.captions.push(t), error: (m) => log.errors.push(m), notice: (m) => log.notices.push(m) },
    getContext: () => ({ scene: '', character: { name: 'ノリー', persona: '' }, place: {} }),
    setGaze: () => null,
    onMetric() {},
  });
  return { d, log, speaker };
}
const withFetch = async (handler, fn) => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(init.body ? JSON.parse(init.body) : null);
    return handler(calls.length);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
};
const okChat = () =>
  new Response(JSON.stringify({ brain: 'mock', events: [{ type: 'say', text: 'はい。', expression: 'neutral', motion: 'none', gaze: 'person' }], ms: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });

test('サーバーが止まっている: 字幕の所にやさしい日本語が出る(英語は出ない)。その言葉は履歴に残らない', async () => {
  const { d, log } = newDialogue();
  await withFetch(
    () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      await d.send({ text: 'こんにちは' });
    },
  );
  assert.deepEqual(log.errors, [OFFLINE_NOTICE]);
  assert.ok(log.captions.includes(OFFLINE_NOTICE), '字幕に出る');
  assert.doesNotMatch(JSON.stringify(log), /Failed to fetch/);
  assert.equal(d.history.length, 0, '断られた言葉は履歴に残さない');
  assert.equal(d.busy, false);
});

test('413(とても長い言葉)で断られても、次の言葉は通る(履歴に長い言葉が残らない)', async () => {
  const { d, log } = newDialogue();
  await withFetch(
    (n) => (n === 1 ? new Response('{}', { status: 413 }) : okChat()),
    async (calls) => {
      await d.send({ text: 'あ'.repeat(300), mode: 'voice' });
      assert.equal(friendlyChatError({ status: 413 }), TOO_LONG_NOTICE);
      assert.equal(d.history.length, 0);
      await d.send({ text: 'やあ' });
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].history, [], '2 回目に、1 回目の言葉は付かない');
      assert.equal(d.history.length, 2, '通った回は残る');
    },
  );
  assert.ok(log.captions.includes(TOO_LONG_NOTICE));
});

test(`文字で ${TEXT_MAX_CHARS} 字を超える言葉は、送らずに断る(字幕・履歴なし)。声は最後の ${TEXT_MAX_CHARS} 字にして送る`, async () => {
  const { d, log } = newDialogue();
  await withFetch(
    () => okChat(),
    async (calls) => {
      await d.send({ text: 'あ'.repeat(TEXT_MAX_CHARS + 1), mode: 'text' });
      assert.equal(calls.length, 0, '送らない');
      assert.ok(log.captions.includes(TOO_LONG_NOTICE));
      assert.equal(d.history.length, 0);
      await d.send({ text: 'い'.repeat(TEXT_MAX_CHARS), mode: 'text' });
      assert.equal(calls.length, 1, 'ちょうど上限は通る');
      await d.send({ text: 'う'.repeat(TEXT_MAX_CHARS + 50), mode: 'voice' });
      assert.equal(Array.from(calls[1].text).length, TEXT_MAX_CHARS);
    },
  );
});

// ---- 中4: 今日の声を使い切った ----
test('今日の声の上限(サーバーの 429)に当たったら、理由を 1 回だけ字幕の上に言う。上限の数字は設定のまま', async () => {
  const sp = new Speaker();
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '今日の声は使い切りました。あしたまた声で話せるよ', reason: 'cap' }), { status: 429, headers: { 'content-type': 'application/json' } });
  try {
    await sp.enqueue('やあ。', {});
    assert.equal(sp.capReached, true);
    assert.match(sp.ttsError, /今日の声は使い切りました/);
    assert.match(VOICE_CAP_NOTICE, /あした/);
    assert.match(VOICE_CAP_NOTICE, /字幕/);
  } finally {
    globalThis.fetch = real;
  }
  // 別の 429(理由の印なし)は、上限の知らせにしない
  const sp2 = new Speaker();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'こみあっています' }), { status: 429, headers: { 'content-type': 'application/json' } });
  try {
    await sp2.enqueue('やあ。', {});
    assert.equal(sp2.capReached, false);
  } finally {
    globalThis.fetch = real;
  }
  const { d, log, speaker } = newDialogue();
  speaker.capReached = true;
  speaker.enqueue = () => Promise.resolve();
  await withFetch(
    () => okChat(),
    async () => {
      await d.send({ text: 'やあ' });
      await d.send({ text: 'もう一回' });
    },
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log.notices, [VOICE_CAP_NOTICE], '1 回だけ');
});

// ---- 中10: この端末の声が、ふつうの返事も読む ----
test('性格の画面で「この端末の声」を選ぶと、ふつうの返事もその声で読む(声の鍵・サーバーの声は使わない・「ピッ」は鳴らさない)', async () => {
  const spoken = [];
  const cancelled = [];
  const realSynth = globalThis.speechSynthesis;
  const realUtt = globalThis.SpeechSynthesisUtterance;
  const realApp = globalThis.__app;
  globalThis.speechSynthesis = { speak: (u) => spoken.push(u), cancel: () => cancelled.push(1) };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  globalThis.__app = { personaSettings: { voice: { provider: 'browser', pitch: 1.2, rate: 0.9 } } };
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    return new Response(null, { status: 204 });
  };
  try {
    const sp = new Speaker();
    const shown = [];
    await sp.enqueue('執事のノリーです。', { onCrawl: (s) => shown.push(s) });
    assert.equal(fetched, 0, '声のサーバーへ聞きに行かない');
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].lang, 'ja-JP');
    assert.equal(spoken[0].pitch, 1.2);
    assert.equal(spoken[0].rate, 0.9);
    assert.match(spoken[0].text, /しつじ/, '読み方の表も効く');
    assert.equal(shown.at(-1), '執事のノリーです。', '字幕は、もとの文');
    sp.stop();
    assert.ok(cancelled.length >= 1, '止める時は、端末の声も止める');
    // ほかの出し方に替えたら、読まない
    globalThis.__app = { personaSettings: { voice: { provider: 'none' } } };
    await sp.enqueue('うん。', {});
    assert.equal(spoken.length, 1);
    assert.equal(fetched, 1, 'この端末の声でなければ、今までどおり聞きに行く');
    // 手で決めた値が先
    sp.setDeviceVoice(true);
    await sp.enqueue('はい。', {});
    assert.equal(spoken.length, 2);
  } finally {
    globalThis.fetch = real;
    globalThis.speechSynthesis = realSynth;
    globalThis.SpeechSynthesisUtterance = realUtt;
    globalThis.__app = realApp;
  }
});
