// 声が無いときの、レトロ RPG 風の「ピッ」と文字送りの試験。WebAudio は記録するだけの偽物で、本物の音は鳴らさない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRO, blipHz, crawlSchedule, isBlipChar, scheduleRetro, voiceFor } from '../src/conversation/retroVoice.js';
import { Speaker } from '../src/conversation/speaker.js';
import { Dialogue } from '../src/conversation/dialogue.js';

/** 鳴らす予定だけを記録する、WebAudio の偽物 */
function fakeAudio() {
  const oscs = [];
  const param = () => ({ calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); } });
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

test('文字送りの予定: 1 字ずつ出し、句読点で少し止まる。空白と記号は鳴らさない', () => {
  const { steps, totalMs } = crawlSchedule('やあ、元気?');
  assert.deepEqual(steps.map((s) => s.shown), ['や', 'やあ', 'やあ、', 'やあ、元', 'やあ、元気', 'やあ、元気?']);
  assert.deepEqual(steps.map((s) => s.blip), [true, true, false, true, true, false]);
  const step = 1000 / RETRO.cps;
  assert.equal(steps[3].atMs - steps[2].atMs, RETRO.punctPauseMs, '「、」の後は止まる');
  assert.equal(Math.round(steps[1].atMs - steps[0].atMs), Math.round(step));
  assert.ok(totalMs > steps.at(-1).atMs);
  assert.equal(isBlipChar(' '), false);
  assert.deepEqual(crawlSchedule('').steps, []);
  assert.equal(crawlSchedule('😀あ').steps[0].shown, '😀', '絵文字を 2 つに割らない');
});

test('声の高さと音色は、名前で決まる(同じ名前は同じ)。字ごとの高さは決まった幅の中', () => {
  assert.deepEqual(voiceFor('みかんちゃん'), voiceFor('みかんちゃん'));
  const names = ['みかんちゃん', 'ようこそくん', 'ロボくん', 'ねこ', 'パネルくん'];
  assert.ok(new Set(names.map((n) => voiceFor(n).baseHz)).size > 1, 'キャラごとに違う高さになる');
  const v = voiceFor('ねこ');
  for (const ch of 'あいうえおかきくけこ') {
    const hz = blipHz(v, ch);
    assert.ok(hz >= v.baseHz * 2 ** (-2 / 12) - 0.1 && hz <= v.baseHz * 2 ** (7 / 12) + 0.1, `${ch} ${hz}`);
  }
});

test('「ピッ」を予定どおりに鳴らす: 鳴らす字の数だけ、順に、短く', () => {
  const { ctx, oscs } = fakeAudio();
  const { steps } = crawlSchedule('こんにちは。');
  const nodes = scheduleRetro(ctx, {}, steps, voiceFor('テスト'), 10);
  assert.equal(nodes.length, 5, '「。」は鳴らさない');
  for (let i = 1; i < oscs.length; i++) assert.ok(oscs[i].at > oscs[i - 1].at);
  for (const o of oscs) assert.ok(o.until - o.at < 0.1, '1 つの音は短い');
  assert.equal(oscs[0].at, 10);
});

test('声が取れないとき: 話し始めに「文字送り」と知らせ、字幕を 1 字ずつ渡し、「ピッ」を口の分析器へつなぐ。サーバーに声が無いと分かったら次から聞かない', async () => {
  const realFetch = globalThis.fetch;
  let ttsCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === '/api/tts') {
      ttsCalls += 1;
      return new Response(JSON.stringify({ error: '読み上げの鍵がありません' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`想定していない通信 ${url}`);
  };
  try {
    const sp = new Speaker();
    const { ctx, oscs } = fakeAudio();
    sp.ctx = ctx;
    sp.analyser = {};
    sp.setVoice({ seed: 'みかんちゃん' });
    const shown = [];
    let info = null;
    await sp.enqueue('やあ。', { onStart: (_t, i) => (info = i), onCrawl: (s) => shown.push(s) });
    assert.deepEqual(info, { crawl: true });
    assert.deepEqual(shown, ['や', 'やあ', 'やあ。']);
    assert.equal(oscs.length, 2);
    assert.equal(sp.serverTtsOff, '読み上げの鍵がありません');
    await sp.enqueue('うん', { onCrawl: (s) => shown.push(s) });
    assert.equal(ttsCalls, 1, '2 文目はサーバーに聞かない');
    assert.equal(shown.at(-1), 'うん');
    sp.retro = false;
    await sp.enqueue('しずか', {});
    assert.equal(oscs.length, 4, '音を切ると「ピッ」を足さない(文字送りだけ)');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('音がまだ使えない(タップの前)ときも、文字送りは順番に進む', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  try {
    const sp = new Speaker();
    const shown = [];
    const t0 = performance.now();
    await sp.enqueue('あい', { onCrawl: (s) => shown.push(s) });
    await sp.enqueue('う', { onCrawl: (s) => shown.push(s) });
    assert.deepEqual(shown, ['あ', 'あい', 'う']);
    assert.ok(performance.now() - t0 >= 400, '1 文ずつ、話し終えてから次へ');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('公開のリンクの通し: まとめた返事(仮の頭脳)→「仮の頭脳です」を出す → 声が無いので字幕が 1 字ずつ出る。会話の欄の鍵らしい文字は送らない', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url, init });
    if (url === '/api/chat') {
      const data = {
        brain: 'fallback',
        fallback: true,
        reason: 'no-key',
        notice: '仮の頭脳です(本物の頭脳の鍵が入っていません)',
        events: [
          { type: 'meta', brain: 'mock' },
          { type: 'thought', seen: '', intent: '雑談', stage: 'chat', handoff: false },
          { type: 'say', text: 'そうなんだ。', expression: 'think', motion: 'nod', gaze: 'person' },
        ],
        ms: 4,
      };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const captions = [];
    const notices = [];
    const events = [];
    const ui = { thought() {}, say() {}, userSaid: (t) => captions.push(`user:${t}`), caption: (t) => captions.push(t), error: (m) => assert.fail(m), notice: (t) => notices.push(t) };
    const character = { expressions: ['neutral', 'happy', 'think'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false };
    const speaker = new Speaker();
    const d = new Dialogue({ character, speaker, ui, getContext: () => ({ scene: '', character: { name: 'テスト' }, place: {} }), setGaze: () => null, onMetric() {}, onEvent: (e) => events.push(e.type) });
    const fakeKey = ['sk', 'ab12'.repeat(12)].join('_');
    await d.send({ text: `これ ${fakeKey} です` });
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(notices.includes('仮の頭脳です(本物の頭脳の鍵が入っていません)'));
    assert.ok(notices.some((n) => n.includes('鍵らしい文字')), '鍵らしい文字を消したと知らせる');
    assert.ok(captions.includes('そ') && captions.includes('そうなんだ。'), '字幕が 1 字ずつ出る');
    assert.ok(events.includes('memory') === false && events.includes('say'), 'イベントを onEvent に渡す');
    const chat = sent.find((s) => s.url === '/api/chat');
    assert.ok(!chat.init.body.includes(fakeKey), 'サーバーへ鍵を送らない');
    assert.ok(!captions.some((c) => String(c).includes(fakeKey)), '画面にも鍵を出さない');
  } finally {
    globalThis.fetch = realFetch;
  }
});
