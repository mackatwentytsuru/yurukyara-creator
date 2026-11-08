// 止まりの試験(BP1。本人の iPhone で 11-08 10:51 と 13:44 に起きた「描いた子が出た後、下の札が空で、何も打てない」)。
// - 読み上げ(speaker.js)の stop() が、話している最中の文・順番待ちの文の待ちを、全部終わらせる(前は終わらず、台本が動いたまま止まった)
// - 初めての会話の台本(script.js)が、動いたまま 8 秒(試験では短くする)、話してもいない・何も進まない時は、札と入力欄を出し直す
//   話している間・長い仕事(描く・返事を待つ)の間・何かが進んでいる間は、出し直さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../src/conversation/speaker.js';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 決まった時間で終わらなければ 'HUNG' を返す */
const settle = (p, ms) => Promise.race([p.then(() => 'resolved'), sleep(ms).then(() => 'HUNG')]);

/** 声のサーバーが無い(204)画面。文字送りと「ピッ」だけで話す = 話し終わるまで、タイマーで待つ */
function retroSpeaker() {
  const sp = new Speaker();
  sp.setVoice({ seed: 'テスト' });
  return sp;
}

async function withNoVoiceServer(fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204, headers: { 'x-tts': 'off', 'x-tts-reason': 'no-key' } });
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('speaker: 止めずに最後まで話すと enqueue は終わる(基準)', async () => {
  await withNoVoiceServer(async () => {
    const sp = retroSpeaker();
    assert.equal(await settle(sp.enqueue('やあ。'), 4000), 'resolved');
  });
});

test('speaker: 話している最中に stop() すると、その文の enqueue は終わる(前は永久に終わらなかった)', async () => {
  await withNoVoiceServer(async () => {
    const sp = retroSpeaker();
    const p = sp.enqueue('こんな子ができたよ。どうかな。気に入ってくれるといいな。');
    await sleep(120); // 話し始めた後
    assert.equal(sp.speaking, true);
    sp.stop();
    assert.equal(await settle(p, 1500), 'resolved', 'stop() の後で enqueue の Promise が終わる');
    assert.equal(sp.waiters.size, 0, '待ちが残らない');
    assert.equal(sp.speaking, false);
  });
});

test('speaker: 順番待ちの文も、stop() で全部終わる。その後の文はふつうに話せる', async () => {
  await withNoVoiceServer(async () => {
    const sp = retroSpeaker();
    const a = sp.enqueue('いちばん めの ながい ぶん です。ながい ながい ぶん です。');
    const b = sp.enqueue('にばんめ。');
    const c = sp.enqueue('さんばんめ。');
    await sleep(120);
    sp.stop();
    assert.deepEqual(await Promise.all([settle(a, 1500), settle(b, 1500), settle(c, 1500)]), ['resolved', 'resolved', 'resolved']);
    assert.equal(await settle(sp.enqueue('もういちど。'), 4000), 'resolved', '止めた後の新しい文は話せる');
  });
});

// ---- 台本 ----

function harness({ present, stuckMs = 60, playing, activity } = {}) {
  const shown = [];
  const offers = [];
  const fr = new FirstRun({
    guide: MAIN,
    creator: createSampleCreator({ main: MAIN }),
    persona: { get: () => null, set() {}, random: () => randomSettings(seededRandom(7)) },
    talk: async () => ({ lines: [{ text: 'こんにちは。' }], brain: 'mock' }),
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
    present: present ?? (async (lines) => shown.push(...lines)),
    offer: (a) => offers.push(a.map((x) => x.id)),
    showCharacter: async () => true,
    stuckMs,
    ...(playing ? { playing } : {}),
    ...(activity ? { activity } : {}),
  });
  return { fr, shown, offers, get last() { return offers.at(-1) ?? []; } };
}

test('台本: 文を出す側が止まって終わらない時、動いたまま止まらず、札が出し直される', async () => {
  let hang = false;
  const h = harness({
    present: async (lines) => {
      if (hang) await new Promise(() => {}); // 読み上げが止まって終わらない
      return lines;
    },
  });
  await h.fr.start();
  assert.ok(h.last.includes('role_home'), '最初は役目の札が出ている');
  hang = true;
  const acting = h.fr.act('role_home'); // 押した後、文を出す所で止まる
  await sleep(20);
  assert.equal(h.fr.busy, true);
  assert.deepEqual(h.last, [], '止まっている間は札が空(本人の画面のとおり)');
  await sleep(300); // 見張りが働く
  assert.equal(h.fr.stuckCount >= 1, true, '止まりを見つけた');
  assert.equal(h.fr.busy, false, '動いている印が下りる');
  assert.ok(h.last.length > 0, '札と入力欄が戻る');
  assert.equal(await settle(acting, 1000), 'resolved', '止まっていた押しの処理も終わる(いつまでも待たない)');
  hang = false;
  assert.equal(await h.fr.act(h.fr.actions[0]?.id ?? 'role_home'), true, 'そのあと、また押せる');
});

test('台本: 入力欄のある問いで止まっても、入力欄(言葉の欄)が戻る', async () => {
  let hang = false;
  const h = harness({
    present: async () => {
      if (hang) await new Promise(() => {});
    },
  });
  await h.fr.start();
  await h.fr.act('role_shop'); // お店の名前を聞く = 入力欄が出る
  assert.ok(h.fr.actions.some((a) => a.kind === 'text'), 'お店の名前の入力欄がある');
  hang = true;
  h.fr.act('place_name', { text: 'ひだまり パン' }); // 押した後、止まる
  await sleep(300);
  assert.equal(h.fr.busy, false);
  assert.ok(h.fr.actions.some((a) => a.kind === 'text'), '入力欄がある選びを出し直した');
});

test('台本: 動いたまま 話していない時間が短ければ、出し直さない。話している間・進んでいる間・長い仕事の間も出し直さない', async () => {
  // 話している間
  let talking = true;
  const a = harness({ stuckMs: 40, playing: () => talking, present: async () => new Promise(() => {}) });
  a.fr.start();
  await sleep(250);
  assert.equal(a.fr.stuckCount, 0, '話している間は、止まりと見ない');
  talking = false;
  await sleep(250);
  assert.ok(a.fr.stuckCount >= 1, '話し終わっても進まなければ、見つける');

  // 何かが進んでいる間(吹き出しが増え続ける)
  let n = 0;
  const b = harness({ stuckMs: 40, activity: () => n, present: async () => new Promise(() => {}) });
  b.fr.start();
  const tick = setInterval(() => (n += 1), 15);
  await sleep(250);
  clearInterval(tick);
  assert.equal(b.fr.stuckCount, 0, '吹き出しが増えている間は、止まりと見ない');

  // 長い仕事(描く・返事を待つ)
  const c = harness({ stuckMs: 40 });
  c.fr.busy = true;
  const work = c.fr._long(sleep(250));
  await sleep(200);
  assert.equal(c.fr.stuckCount, 0, '長い仕事の間は、止まりと見ない');
  await work;
  c.fr.busy = false;
});

test('台本: 終わった(done)後は、見張りは何もしない・動いていなければ見張りも回らない', async () => {
  const h = harness({ stuckMs: 30 });
  await h.fr.start();
  await sleep(150);
  assert.equal(h.fr.stuckCount, 0, '動いていない間は、出し直さない');
  assert.equal(h.fr._busyTimer, null, '見張りは回っていない');
});

test('台本: おまかせで描いている間・できた子を舞台に出している間は、見張りが札を出し直さない(M13C must)', async () => {
  for (const slow of ['make', 'show']) {
    const base = createSampleCreator({ main: MAIN });
    const creator = Object.create(base);
    creator.make = async (input, o) => {
      if (slow === 'make') await sleep(450); // 描く道は 1 分ほど何も増えない
      return base.make(input, o);
    };
    let showing = 0;
    const shown = [];
    const offers = [];
    const fr = new FirstRun({
      guide: MAIN,
      creator,
      persona: { get: () => null, set() {}, random: () => randomSettings(seededRandom(7)) },
      talk: async () => ({ lines: [{ text: 'こんにちは。' }], brain: 'mock' }),
      voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
      present: async (lines) => shown.push(...lines),
      offer: (a) => offers.push(a.map((x) => x.id)),
      showCharacter: async () => {
        if (slow === 'show') {
          showing += 1;
          await sleep(450); // iPhone で舞台に子を読み込むのが遅い
        }
        return true;
      },
      stuckMs: 40,
    });
    await fr.start();
    const running = fr.omakase();
    await sleep(300); // 見張りの間隔の 7 倍以上、描いている最中
    assert.equal(fr.stuckCount, 0, `${slow}: 描いている・出している最中は止まりと見ない`);
    assert.equal(fr.busy, true, `${slow}: 動いている印が下りない(札が二重に押せる状態にならない)`);
    assert.equal(offers.at(-1)?.length ?? 0, 0, `${slow}: 札は空のまま(前の札を出し直さない)`);
    await running;
    assert.equal(fr.stuckCount, 0, `${slow}: 最後まで 1 回も出し直さない`);
    assert.equal(fr.busy, false);
  }
});
