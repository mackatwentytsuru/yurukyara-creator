// 作る途中で読み込み直した時に、お金のかかる描き直しをしない・描いた子を見失わない(台本 script.js と入口 index.js の側)。
// - 描く道(Claude に描いてもらう): 言葉を入れて待っている間に読み込み直しても、同じ言葉で描き直さない(サーバーは描き続けていて、できた子は「かえる」の「つくった子」に並ぶ)
// - 見本の道(お金がかからない)は、前と同じく同じ言葉で見本を出し直す
// - 描いた子(drawn)を決めた後の途中経過には、描いた子の印が残る(読み込み直した後、舞台にその子を出し直すため)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };

function harness(creator) {
  const said = [];
  const progress = [];
  let offered = [];
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: () => null, set: () => {}, random: () => randomSettings(seededRandom(7)) },
    pin: () => {},
    talk: async () => MOCK,
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: async () => true,
    onStep: () => {},
    onPersona: () => {},
    save: () => {},
    progress: (s) => progress.push(s),
    onBegin: () => {},
    onDone: () => {},
  });
  return { fr, said, progress, get offered() { return offered.map((a) => a.id); }, texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text) };
}

/** 描く道の作り手(本物の createDrawCreator と同じ形: mode 'sample'・canDraw が true)。描いた子を返す。呼ばれた数を数える */
function drawingCreator() {
  const sample = createSampleCreator({ main: MAIN });
  const calls = [];
  return {
    ...sample,
    mode: 'sample',
    canDraw: true,
    calls,
    async make(input) {
      calls.push(input);
      return { id: 'yb261108_aaaaaa', name: 'あたらしい子', sample: false, drawn: true, twod: true, note: 'Claude が描いた子' };
    },
  };
}

const WORDS_SNAP = { v: 1, step: 3, from: 'words', words: 'みかんの子', check: null, character: null, skipped: [], reload: true };

test('描く道: 言葉を入れて待っている間に読み込み直しても、同じ言葉で描き直さない(お金を使わない)。「つくった子」に並ぶと伝え、入れ方を出し直す', async () => {
  const creator = drawingCreator();
  const h = harness(creator);
  const snap = await (async () => {
    const first = harness(drawingCreator());
    await first.fr.start();
    await first.fr.act('words', { text: 'みかんの子' });
    return first.progress.find((p) => p.step === 3);
  })();
  assert.equal(snap.words, 'みかんの子');
  await h.fr.resume({ ...snap, character: null, reload: true });
  assert.equal(creator.calls.length, 0, '読み込み直しで、描き直さない');
  assert.equal(h.fr.step, 1, '入れ方を選び直せる 1 歩目に戻る');
  assert.ok(h.texts('note').some((t) => t.includes('「つくった子」')), '描き終わった子の行き先を言う');
  assert.deepEqual(h.offered, ['pick', 'photo', 'what_auto', 'words'], '描き直すなら、自分で選ぶ(自動では描かない)');
});

test('見本の道(お金がかからない)の読み込み直しは、前と同じ(同じ言葉で見本を出し直す)', async () => {
  const h = harness(createSampleCreator({ main: MAIN }));
  await h.fr.resume({ ...WORDS_SNAP, words: 'ロボ' });
  assert.equal(h.fr.step, 3);
  assert.equal(h.fr.character.id, 'robo');
});

test('描いた子を決めた後の途中経過には、描いた子の印(drawn)が残る。読み込み直した後も、その子のまま続く', async () => {
  const creator = drawingCreator();
  const h = harness(creator);
  await h.fr.start();
  await h.fr.act('words', { text: 'みかんの子' });
  assert.equal(creator.calls.length, 1);
  await h.fr.act('keep');
  const at3 = h.progress.filter((p) => p.character?.id === 'yb261108_aaaaaa').at(-1);
  assert.equal(at3.character.drawn, true, '描いた子の印');
  assert.equal(at3.character.twod, true);
  const g = harness(drawingCreator());
  await g.fr.resume({ ...JSON.parse(JSON.stringify(at3)), reload: true });
  assert.equal(g.fr.character.id, 'yb261108_aaaaaa');
  assert.equal(g.fr.character.drawn, true);
  assert.equal(g.fr.step, 4, '決めた歩みから続く(描き直さない)');
});

test('「この子で いい?」で読み込み直しても、もう 1 体 描かずに、「この子で いい?」から続く(描いた子が途中経過に残る)', async () => {
  const h = harness(drawingCreator());
  await h.fr.start();
  await h.fr.act('words', { text: 'みかんの子' });
  assert.deepEqual(h.offered.slice(0, 1), ['keep'], '「この子にする」の問い');
  const at3 = h.progress.filter((p) => p.step === 3 && p.character?.id === 'yb261108_aaaaaa').at(-1);
  assert.ok(at3, '描けた子が、3 歩目の途中経過に残っている');
  assert.equal(at3.character.drawn, true);
  const creator = drawingCreator();
  const g = harness(creator);
  await g.fr.resume({ ...JSON.parse(JSON.stringify(at3)), reload: true });
  assert.equal(creator.calls.length, 0, '描き直さない');
  assert.equal(g.fr.step, 3);
  assert.equal(g.fr.character.id, 'yb261108_aaaaaa');
  assert.ok(g.texts('guide').includes('この子で いい?'), '「この子で いい?」から続く');
  assert.ok(!g.texts().some((t) => t.includes('サーバーが 描いているかも')), '1 歩目に戻って「描いているかも」とは言わない');
  assert.deepEqual(g.offered.slice(0, 1), ['keep']);
});
test('見本の子の途中経過には、描いた子の印を付けない', async () => {
  const h = harness(createSampleCreator({ main: MAIN }));
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  await h.fr.act('keep');
  const sample = h.progress.filter((p) => p.character?.id === 'robo').at(-1);
  assert.equal(Object.hasOwn(sample.character, 'drawn'), false);
});
