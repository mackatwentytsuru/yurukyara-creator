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

/** その時刻のまま何フレームか進めた、口の開き(なめらかにする分が落ち着いた値) */
function mouthAt(sp, setNow, ms) {
  setNow(ms);
  let v = 0;
  for (let i = 0; i < 10; i++) v = sp.level();
  return v;
}

test('声が無いときの口: 「ピッ」の小さな音の大きさに頼らず、文字が出ている間は大きく開き、句読点の間と話し終わりで閉じる(合わせ②で 0.69 → 0.33 に下がった件)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try {
    const sp = new Speaker();
    const { ctx, oscs } = fakeAudio();
    sp.ctx = ctx;
    // 本物の分析器と同じく、「ピッ」が鳴っている間は小さな四角い波(大きさ 0.06)を返す
    sp.analyser = { getFloatTimeDomainData: (buf) => buf.forEach((_, i) => (buf[i] = i % 2 ? 0.06 : -0.06)) };
    sp.buf = new Float32Array(64);
    let now = 470; // 口の動きの波が大きくなる所(0.52 秒ごろ)に、文字の出始めを合わせる(どこから始めても 0.35〜0.70 の間で動く)
    sp.clock = () => now;
    const setNow = (ms) => (now = ms);
    const done = sp.enqueue('やあ、げんき。', {});
    for (let i = 0; i < 50 && !sp.fakeUntil; i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(sp.fakeUntil > 0, '文字送りの予定ができた');
    assert.ok(oscs.length > 0 && sp.sources.size === 0, '「ピッ」は鳴らすが、口の音の大きさの元(sources)には入れない');
    const start = 470 + 30; // 音の時計の 30ms 先から文字が出る
    const { steps, totalMs } = crawlSchedule('やあ、げんき。');
    // 文字が出ている間: 口は 0.35 以上で開け閉めし、いちばん大きい所は 0.6 を超える(前は「ピッ」の音から作って 0.33 どまり)
    let max = 0;
    for (let ms = start + 1; ms < start + steps[2].atMs; ms += 5) {
      const v = mouthAt(sp, setNow, ms);
      assert.ok(v >= 0.34, `${ms - start}ms で ${v}`);
      max = Math.max(max, v);
    }
    assert.ok(max > 0.6, `口のいちばん大きい所 ${max}`);
    // 「、」で止まる間は閉じる
    assert.ok(mouthAt(sp, setNow, start + steps[2].atMs + 80) < 0.05, '句読点の間は閉じる');
    // 次の字からまた開く
    assert.ok(mouthAt(sp, setNow, start + steps[3].atMs + 10) >= 0.34, '次の字で開く');
    // 話し終わり(最後の「。」から先)は閉じる
    assert.ok(mouthAt(sp, setNow, start + totalMs + 20) < 0.05, '話し終わりで閉じる');
    // 割り込まれたら、「ピッ」も止めて、話していない扱いにする
    sp.stop();
    assert.equal(sp.retroNodes.size, 0);
    assert.equal(sp.speaking, false);
    assert.equal(mouthAt(sp, setNow, start + 100), 0);
    void done; // 止めた文の約束は、そのまま置いておく(待たない)
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('音を切っている(retro = false)・音がまだ使えないときも、口は同じ予定で動く', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  try {
    for (const withAudio of [true, false]) {
      const sp = new Speaker();
      if (withAudio) {
        sp.ctx = fakeAudio().ctx;
        sp.analyser = { getFloatTimeDomainData: (buf) => buf.fill(0) };
        sp.buf = new Float32Array(8);
        sp.retro = false;
      }
      let now = 650;
      sp.clock = () => now;
      const done = sp.enqueue('うん', {});
      for (let i = 0; i < 50 && !sp.fakeUntil; i++) await new Promise((r) => setTimeout(r, 5));
      assert.ok(mouthAt(sp, (ms) => (now = ms), 650 + 30 + 20) >= 0.34, withAudio ? '音を切っていても口は動く' : 'タップの前でも口は動く');
      assert.equal(sp.retroNodes.size, 0, '「ピッ」は鳴らさない');
      sp.stop();
      void done;
    }
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

test('公開のリンクの通し: まとめた返事(仮の頭脳)→「おためしモードです」を出す → 声が無いので字幕が 1 字ずつ出る。会話の欄の鍵らしい文字は送らない', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url, init });
    if (url === '/api/chat') {
      const data = {
        brain: 'fallback',
        fallback: true,
        reason: 'no-key',
        notice: 'おためしモードです(本物の頭脳の鍵が入っていません)',
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
    assert.ok(notices.includes('おためしモードです(本物の頭脳の鍵が入っていません)'));
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
