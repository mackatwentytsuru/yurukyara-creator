// 第 12 波 b(B3): 会話の画面の側。
// (6) 続けて 2 回送っても、後の言葉(と前の言葉)を落とさない(11-07 SIM2: 二重送信で後の文が無視された見込み)
// (4) 返事の全部を早く字幕に(届いた文は話す前から薄く出す。声は 1 文ずつのまま)・相づちは録ってある声で(声の文字数を使わない)
// 本物の頭脳・声のサービスは呼ばない(偽の /api/chat・偽の音)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dialogue } from '../src/conversation/dialogue.js';
import { createCaptionFlow } from '../src/ui/panel.js';
import { Speaker } from '../src/conversation/speaker.js';

const fakeCharacter = () => ({ expressions: ['neutral', 'happy'], play() {}, setEmotion() {}, setMouth() {}, isCustomExpression: () => false });
const say = (text, extra = {}) => ({ type: 'say', text, expression: 'happy', motion: 'none', gaze: 'person', ...extra });

/**
 * 偽の /api/chat(流れる形)。plan[i] は i 回目の返事: { events: [...], hang: true なら最後に止められるまで待つ }。
 * 送られた本文を bodies に、届けた時刻を marks に残す。
 */
function fakeStreamChat(plan) {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (url !== '/api/chat') return new Response('{}', { status: 404 });
    bodies.push(JSON.parse(init.body));
    const step = plan[bodies.length - 1] ?? { events: [say('はい。')] };
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // 本物の fetch と同じく、止められたら本文の流れも止まる(止められた後は、もう何も送らない)
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        };
        if (init.signal?.aborted) return stop();
        init.signal?.addEventListener('abort', stop, { once: true });
        for (const ev of step.events ?? []) {
          if (stopped) return;
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
          await new Promise((r) => setTimeout(r, step.gapMs ?? 5));
        }
        if (stopped || step.hang) return;
        controller.enqueue(enc.encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { bodies, restore: () => (globalThis.fetch = realFetch) };
}

/** 偽の読み上げ: 文を受けても話し始めない(話し始めの時刻を試験で決める) */
function quietSpeaker() {
  const queued = [];
  return {
    queued,
    speaking: false,
    pending: 0,
    setVoicePersona() {},
    playFiller: () => null,
    stop() {},
    enqueue(text, cbs) {
      queued.push({ text, cbs });
      return new Promise(() => {});
    },
  };
}

function newDialogue({ speaker = quietSpeaker(), ui = {} } = {}) {
  const log = [];
  const baseUi = {
    thought() {},
    say: (ev) => log.push(['say', ev.text]),
    sayAhead: (ev) => log.push(['ahead', ev.text]),
    userSaid: (t) => log.push(['user', t]),
    caption() {},
    error: (m) => assert.fail(m),
    ...ui,
  };
  const d = new Dialogue({ character: fakeCharacter(), speaker, ui: baseUi, getContext: () => ({ scene: '', character: { name: 'ノリー', persona: '# ノリー' }, place: {} }), setGaze: () => null, onMetric() {} });
  return { d, log, speaker };
}

const until = async (cond, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('待ちきれなかった');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('(6) 返事が届く前に 2 回目を送った: 前の言葉と後の言葉をつないで 1 回で聞く。見せる言葉も、つないだ形', async () => {
  const chat = fakeStreamChat([{ events: [], hang: true }, { events: [say('いち、に、デスね。')] }]);
  try {
    const { d, log } = newDialogue();
    const first = d.send({ text: 'いち' });
    const second = d.send({ text: 'に' }); // 同じ時に 2 回(Enter を 2 回)
    await Promise.all([first, second]);
    assert.equal(chat.bodies.length, 2);
    assert.equal(chat.bodies[1].text, 'いち、に', '後の言葉が消えない(前の言葉もつく)');
    assert.deepEqual(log.filter((l) => l[0] === 'user').map((l) => l[1]), ['いち', 'いち、に']);
    assert.deepEqual(d.history.slice(-2).map((m) => m.role), ['user', 'assistant']);
    assert.equal(d.history.at(-2).content, 'いち、に');
  } finally {
    chat.restore();
  }
});

test('(6) 3 回続けて送っても、3 つとも 1 回の言葉に入る', async () => {
  const chat = fakeStreamChat([{ events: [], hang: true }, { events: [], hang: true }, { events: [say('はい。')] }]);
  try {
    const { d } = newDialogue();
    await Promise.all([d.send({ text: 'あか' }), d.send({ text: 'あお' }), d.send({ text: 'きいろ' })]);
    assert.equal(chat.bodies.at(-1).text, 'あか、あお、きいろ');
  } finally {
    chat.restore();
  }
});

test('(6) 返事が途中まで届いた所で 2 回目を送った: 後の言葉はそのまま聞き、前の言葉と届いた返事は履歴に残る', async () => {
  const chat = fakeStreamChat([
    { events: [{ type: 'thought', intent: 'すきなもの', stage: 'chat', handoff: false }, say('カレー、いいデスね。')], hang: true },
    { events: [say('ハンバーグも、おいしいデス。')] },
  ]);
  try {
    const { d, log } = newDialogue();
    const first = d.send({ text: 'カレーがすき' });
    await until(() => log.some((l) => l[0] === 'ahead'));
    await d.send({ text: 'ハンバーグもすき' });
    await first;
    const second = chat.bodies[1];
    assert.equal(second.text, 'ハンバーグもすき', '後の言葉は、そのまま');
    assert.deepEqual(second.history.map((m) => m.role), ['user', 'assistant'], '前の回が履歴に入って送られる');
    assert.equal(second.history[0].content, 'カレーがすき');
    const line = JSON.parse(second.history[1].content.split('\n')[0]);
    assert.equal(line.text, 'カレー、いいデスね。');
    assert.equal(line.intent, 'すきなもの', '1 行目に用件');
    assert.deepEqual(d.history.map((m) => m.content.includes('ハンバーグ') || m.content.includes('カレー')), [true, true, true, true]);
    assert.equal(d.history.length, 4, '前の回 2 つ + 後の回 2 つ(同じ回を 2 回入れない)');
  } finally {
    chat.restore();
  }
});

test('(4) 届いた文は、話し始める前から全部、字幕に先に出す(声は 1 文ずつ、話し始めた時に say)', async () => {
  const chat = fakeStreamChat([{ events: [{ type: 'thought', intent: '試し', stage: 'chat', handoff: false }, say('こんにちは!'), say('きょうは晴れデス。'), say('お散歩、いいデスね。')] }]);
  try {
    const { d, log, speaker } = newDialogue();
    await d.send({ text: 'やあ' });
    assert.deepEqual(log.filter((l) => l[0] === 'ahead').map((l) => l[1]), ['こんにちは!', 'きょうは晴れデス。', 'お散歩、いいデスね。'], '3 文とも先に出た');
    assert.equal(log.filter((l) => l[0] === 'say').length, 0, 'まだ 1 文も話していない(声が始まるまで say は来ない)');
    assert.equal(speaker.queued.length, 3, '声は 3 文とも順に頼んである');
    speaker.queued[0].cbs.onStart(performance.now(), { crawl: false });
    assert.deepEqual(log.filter((l) => l[0] === 'say').map((l) => l[1]), ['こんにちは!'], '話し始めた文だけ say');
  } finally {
    chat.restore();
  }
});

test('(4) 字幕の流れ: 先に届いた文は next(薄く)。話し始めると今の文になり、話し終わると全部を同じ大きさで残す', () => {
  const f = createCaptionFlow();
  assert.deepEqual(f.ahead('こんにちは!'), { reply: true, prev: '', current: '', settled: false, next: 'こんにちは!' });
  assert.deepEqual(f.ahead('晴れデス。'), { reply: true, prev: '', current: '', settled: false, next: 'こんにちは!晴れデス。' });
  f.say('こんにちは!');
  assert.deepEqual(f.caption('こんにちは!'), { reply: true, prev: '', current: 'こんにちは!', settled: false, next: '晴れデス。' });
  f.say('晴れデス。');
  assert.deepEqual(f.caption('晴れデス。'), { reply: true, prev: 'こんにちは!', current: '晴れデス。', settled: false }, '全部話したら next は無い');
  assert.deepEqual(f.caption(null, 1200), { reply: true, prev: '', current: 'こんにちは!晴れデス。', settled: true });
  assert.equal(f.ahead('もう一文。'), null, '話し終わった後に届いた文は、話す時に足す(前の決まり)');
});

test('(4) 字幕の流れ(声が無い時の文字送り): 先に見せた文は、出ていない残りを薄く出したまま 1 字ずつ濃くなる', () => {
  const f = createCaptionFlow();
  f.ahead('やあ。');
  f.say('やあ。');
  assert.deepEqual(f.caption(''), { reply: true, prev: '', current: '', settled: false, next: 'やあ。' }, '始まりでも消えない');
  assert.deepEqual(f.caption('やあ'), { reply: true, prev: '', current: 'やあ', settled: false, next: '。' });
  // 先に見せていない文(前からの道)は、今までどおり残りを出さない
  const g = createCaptionFlow();
  g.say('うん。');
  assert.deepEqual(g.caption('う'), { reply: true, prev: '', current: 'う', settled: false });
});

/** node で動く偽の音(読み上げの部品が、声を順に並べられる最小限) */
function fakeAudio() {
  return {
    currentTime: 5,
    createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
  };
}

test('(4) 相づちだけの文(録ってある声の言葉)は、声のサービスに頼まず録った声で話す。ほかの文は今までどおり頼む', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(new Uint8Array(4800), { status: 200, headers: { 'x-sample-rate': '24000' } });
  };
  try {
    const sp = new Speaker();
    sp.ctx = fakeAudio();
    sp.analyser = {};
    sp.fillers = [{ text: 'はい。', samples: new Float32Array(2400), ms: 100 }];
    let first = null;
    let started = 0;
    await sp.enqueue('はい。', { onFirstByte: (ms) => (first = ms), onStart: () => (started += 1) });
    assert.deepEqual(calls, [], '録った声: 頼まない(声の文字数を使わない)');
    assert.equal(first, 0, '最初のバイトは 0 ms');
    assert.equal(started, 1, '話し始めの知らせは同じに来る(字幕・口・動き)');
    await sp.enqueue('はい、そうデス。', {});
    assert.deepEqual(calls, ['/api/tts'], '相づちだけでない文は頼む');
    // その子自身の声が役の既定と違う時は、録った声を使わない(声がちがって聞こえるため)
    sp.setVoice({ voiceId: 'AbCdEfGh12345678' });
    sp.setVoiceChoice('female', { persona: '# テスト\n- 声: 女の子\n- 声の id: AbCdEfGh12345678' });
    await sp.enqueue('はい。', {});
    assert.equal(calls.length, 2, 'その子の声の時は頼む');
  } finally {
    globalThis.fetch = realFetch;
  }
});
