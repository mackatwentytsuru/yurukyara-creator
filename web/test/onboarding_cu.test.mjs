// CU(本人 11/8): 作る画面の「おまかせ」の直し。画面なしで台本(script.js)を通す。
// (2)「途中まで駅を選んでたのに お任せを押したら、みかんちゃんができた。駅の名前を お任せにしたつもりが、全部おまかせになった」
//   - 問いごとの「おまかせ」(どんな子?)は、その問いだけを おまかせにする。選んだ役目と場所から説明を作る
//   - 全体の「のこりを ぜんぶ おまかせ」は、押すとまず確かめる。「やめる」は今の問いに戻る
//   - 子がまだいない時の全体おまかせは、役目と関係のない見本(surprise)でなく、役目の説明で子を作る(描ける時は描く)
// 画面での見え方(札の見た目・押せる大きさ・横にはみ出さない)は onboarding_cu_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, OMAKASE_ALL, OMAKASE_ASK, OMAKASE_CHIP, OMAKASE_NO, OMAKASE_YES, WORDS_MAX } from '../src/ui/onboarding/script.js';
import { ROLES, ROLE_AUTO_WORDS, autoWords } from '../src/ui/onboarding/roles.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };

function harness({ creator = createSampleCreator({ main: MAIN }), talk = async () => MOCK, thinking = null } = {}) {
  const said = [];
  const stored = new Map();
  const shown = [];
  let offered = [];
  let done = false;
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(7)) },
    talk,
    ...(thinking ? { thinking } : {}),
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: true }) },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: async (c) => {
      shown.push(c?.id);
      return true;
    },
    onDone: () => {
      done = true;
    },
  });
  return {
    fr, said, stored, shown,
    get offered() { return offered.map((a) => a.id); },
    get offeredAll() { return offered; },
    get done() { return done; },
    texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text),
  };
}

/** surprise を呼んだ数を数える見本の道 */
function spyCreator() {
  const base = createSampleCreator({ main: MAIN });
  const calls = { surprise: 0, make: [] };
  return {
    calls,
    creator: {
      ...base,
      surprise: (...a) => {
        calls.surprise += 1;
        return base.surprise(...a);
      },
      make: async (input, o) => {
        calls.make.push(input);
        return base.make(input, o);
      },
    },
  };
}

test('役目ごとの おまかせの説明: ひらがな多めの 1 文。場所の名前があれば頭に付く(お店と駅だけ)。60 字に収まる', () => {
  assert.deepEqual(Object.keys(ROLE_AUTO_WORDS).sort(), [...ROLES].sort(), '4 つの役目に 1 行ずつ');
  assert.equal(autoWords('station'), 'えきで みちを あんないする 子');
  assert.equal(autoWords('home'), 'おうちで いっしょに あそぶ 子');
  assert.equal(autoWords('facility'), 'がっこうで みんなを まもる 子');
  assert.equal(autoWords('shop'), 'おみせで あんないする 子');
  assert.equal(autoWords('station', { name: 'みどり駅' }), 'みどり駅で みちを あんないする 子', '名前があれば「みどり駅で〜」');
  assert.equal(autoWords('shop', { name: 'ひだまり パン' }), 'ひだまり パンで あんないする 子');
  assert.equal(autoWords('home', { name: 'ぼくの家' }), 'おうちで いっしょに あそぶ 子', 'おうち・学校は名前を使わない');
  assert.equal(autoWords('へんな値'), 'おうちで いっしょに あそぶ 子', '知らない役目は おうち');
  assert.ok([...autoWords('station', { name: 'あ'.repeat(80) })].length <= WORDS_MAX);
  for (const r of ROLES) assert.doesNotMatch(autoWords(r), /[A-Za-z]|サーバー|プロンプト/, '開発の言葉を出さない');
});

test('問いごとの おまかせ(どんな子?): 駅 + 名前から「みどり駅で〜」の子を作る。役目と場所は残る。ほかの選びは自分で決める', async () => {
  const { creator, calls } = spyCreator();
  const h = harness({ creator });
  await h.fr.start();
  await h.fr.act('role_station');
  await h.fr.act('place_name', { text: 'みどり駅' });
  await h.fr.act('place_skip');
  assert.ok(h.offered.includes('what_auto'), '「どんな子?」の札に おまかせがある');
  const chip = h.offeredAll.find((a) => a.id === 'what_auto');
  assert.equal(chip.label, OMAKASE_CHIP);
  assert.ok(!chip.noAuto, '全体の「のこりを ぜんぶ おまかせ」(点線の札)も並べて出せる。名前と見た目が違うので、間違えない');
  assert.notEqual(OMAKASE_CHIP, OMAKASE_ALL, '問いごとと全体は、名前を分ける');

  assert.equal(await h.fr.act('what_auto'), true);
  assert.deepEqual(calls.make, [{ from: 'words', words: 'みどり駅で みちを あんないする 子' }], '役目と場所から作った説明で、言葉の道と同じ作り方');
  assert.equal(calls.surprise, 0);
  assert.equal(h.fr.character.id, 'yokoso', '駅 → ようこそくん(ロボくんではない)');
  assert.equal(h.fr.role, 'station');
  assert.equal(h.fr.place.name, 'みどり駅');
  assert.equal(h.fr.auto, false, '問いごとの おまかせは、残りを自動にしない(ここで止まって、「この子にする」を自分で押す)');
  assert.equal(h.done, false);
  assert.deepEqual(h.offered, ['keep', 'choose_sample', 'again']);
  assert.ok(h.texts('user').includes('おまかせ'), '押した札が右の吹き出しに残る');
  assert.ok(!h.texts('user').includes('みどり駅で みちを あんないする 子'), '説明は、使う人が書いた言葉のようには出さない(知らせで言う)');
  assert.ok(h.texts('note').includes('「みどり駅で みちを あんないする 子」で つくるよ。'));
});

test('問いごとの おまかせ: 役目をとばして来ても おうち の説明で作れる', async () => {
  const { creator, calls } = spyCreator();
  const h = harness({ creator });
  await h.fr.start();
  await h.fr.act('role_auto');
  await h.fr.act('what_auto');
  assert.equal(calls.make[0].words, 'おうちで いっしょに あそぶ 子');
  assert.equal(h.fr.role, 'home');
});

test('全体の おまかせ: 押すとまず確かめる。「やめる」は、今の問い(駅の名前)にそのまま戻り、役目も場所も消えない', async () => {
  const { creator, calls } = spyCreator();
  const h = harness({ creator });
  await h.fr.start();
  await h.fr.act('role_station');
  assert.deepEqual(h.offered, ['place_name', 'place_skip']);
  assert.equal(await h.fr.omakaseAsk(), true);
  assert.deepEqual(h.offered, ['omakase_yes', 'omakase_no'], '確かめの 2 択だけ(全体のおまかせは、また出さない)');
  assert.deepEqual(h.offeredAll.map((a) => a.label), [OMAKASE_YES, OMAKASE_NO]);
  assert.ok(h.offeredAll.every((a) => a.noAuto));
  assert.ok(h.texts('guide').includes(OMAKASE_ASK), 'ここから さきを ぜんぶ おまかせに するよ。いい?');
  assert.ok(h.texts('user').includes(OMAKASE_ALL));
  assert.equal(h.done, false);
  assert.equal(h.fr.character, null, '確かめの間は何も決めない');
  assert.equal(calls.make.length + calls.surprise, 0);

  assert.equal(await h.fr.act('omakase_no'), true);
  assert.deepEqual(h.offered, ['place_name', 'place_skip'], '同じ問いに戻る');
  assert.equal(h.fr.role, 'station', '役目は駅のまま');
  assert.equal(h.fr.auto, false);
  assert.equal(h.done, false);
  assert.equal(h.fr.character, null);
  assert.ok(h.texts('user').includes(OMAKASE_NO));
  // 戻った問いに、そのまま答えて進める(確かめる前と同じ)
  await h.fr.act('place_name', { text: 'みどり駅' });
  assert.equal(h.fr.place.name, 'みどり駅');
});

test('全体の おまかせ: 「やめる」の後も、確かめの古い札(はい)は使えない。確かめ中に、別の選びは受けない', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_station');
  await h.fr.omakaseAsk();
  assert.equal(await h.fr.act('place_skip'), false, '確かめている間に、後ろの問いの札は押せない');
  await h.fr.act('omakase_no');
  assert.equal(await h.fr.act('omakase_yes'), false, '戻った後に「はい」は効かない');
  assert.equal(h.done, false);
});

test('全体の おまかせ + はい(駅を選んだ後): 役目は駅のまま・surprise を呼ばず、駅の子(ようこそくん)で最後まで', async () => {
  const { creator, calls } = spyCreator();
  const h = harness({ creator });
  await h.fr.start();
  await h.fr.act('role_station');
  await h.fr.act('place_name', { text: 'みどり駅' });
  await h.fr.omakaseAsk();
  assert.equal(await h.fr.act('omakase_yes'), true);
  assert.equal(calls.surprise, 0, '役目と関係のない見本(surprise)を出さない(前は、駅を選んだのにロボくんが出た)');
  assert.equal(h.fr.character.id, 'yokoso');
  assert.deepEqual(h.shown, ['yokoso']);
  assert.equal(h.done, true);
  const s = h.stored.get('yokoso');
  assert.equal(s.role, 'station', '性格の設定に、駅が残る');
  assert.equal(s.place.name, 'みどり駅', '場所の名前も残る');
  assert.ok(h.texts('guide').includes('おまかせで えらんだのは、ようこそくん!'));
  assert.ok(h.texts('note').includes('「みどり駅で みちを あんないする 子」で つくるよ。'));
  assert.equal(h.texts('user').filter((t) => t === OMAKASE_YES).length, 1, '「はい」の吹き出しは 1 つ(おまかせの名前を 2 回言わない)');
  assert.deepEqual(h.offered, ['begin']);
});

test('全体の おまかせ + はい: 役目ごとに、その役目の子になる(お店 → ようこそくん・学校 → ロボくん)。役目は替わらない', async () => {
  for (const [role, id] of [['shop', 'yokoso'], ['facility', 'robo']]) {
    const { creator, calls } = spyCreator();
    const h = harness({ creator });
    await h.fr.start();
    await h.fr.act(`role_${role}`);
    if (role === 'shop') await h.fr.act('place_skip');
    await h.fr.omakaseAsk();
    await h.fr.act('omakase_yes');
    assert.equal(calls.surprise, 0, role);
    assert.equal(h.fr.character.id, id, role);
    assert.equal(h.stored.get(id).role, role, role);
  }
});

test('全体の おまかせ: ブラウザから描ける設定なら、役目の説明で描く。描けなかったら近い見本と言う', async () => {
  const drawn = [];
  const base = createSampleCreator({ main: MAIN });
  const drawing = {
    ...base,
    canDraw: true,
    make: async (input) => {
      drawn.push(input.words);
      return { id: 'yb1108_1', name: 'みどりちゃん', sample: false, drawn: true, twod: true, note: 'Claude が描いた子' };
    },
  };
  const a = harness({ creator: drawing });
  await a.fr.start();
  await a.fr.act('role_station');
  await a.fr.act('place_name', { text: 'みどり駅' });
  await a.fr.omakaseAsk();
  await a.fr.act('omakase_yes');
  assert.deepEqual(drawn, ['みどり駅で みちを あんないする 子']);
  assert.equal(a.fr.character.id, 'yb1108_1', '描けた子で進む(役目と関係のない見本でない)');
  assert.ok(a.texts('guide').some((t) => t.startsWith('おまかせで 描いたのは、みどりちゃん!')));
  assert.equal(a.stored.get('yb1108_1').role, 'station');
  assert.equal(a.done, true);

  const failing = { ...base, canDraw: true, make: async (input) => ({ ...(await base.make(input)), drawFailed: '描けなかったよ' }) };
  const b = harness({ creator: failing });
  await b.fr.start();
  await b.fr.act('role_station');
  await b.fr.omakaseAsk();
  await b.fr.act('omakase_yes');
  assert.ok(b.texts('note').some((t) => t.startsWith('描けなかったよ。にた 見本の子を 出すね。')), '正直に言う');
  assert.equal(b.fr.character.id, 'yokoso');
});

test('全体の おまかせ: 近い見本が案内役そのものなら、別の子を出す(案内役のまま「できあがり」と言わない)', async () => {
  const base = createSampleCreator({ main: MAIN });
  const h = harness({ creator: { ...base, make: async () => ({ id: MAIN.id, name: MAIN.name, sample: true, note: '' }) } });
  await h.fr.start();
  await h.fr.omakaseAsk();
  await h.fr.act('omakase_yes');
  assert.notEqual(h.fr.character.id, MAIN.id);
  assert.equal(h.done, true);
});

test('おまかせ(ふだんの呼び方 omakase())は、今までどおり確かめずに進む(性格の画面・作る画面の道)', async () => {
  const h = harness();
  await h.fr.start();
  assert.equal(await h.fr.omakase(), true);
  assert.equal(h.done, true);
  assert.equal(h.fr.role, 'home');
  assert.ok(h.fr.character.id && h.fr.character.id !== MAIN.id);
});

test('頭脳の返事を待つ間は「…」の吹き出し(thinking)。返事が来ても、失敗しても、必ず消す', async () => {
  const calls = [];
  const a = harness({ thinking: (on, info) => calls.push([on, info?.name ?? null]) });
  await a.fr.start();
  await a.fr.act('role_home');
  await a.fr.act('words', { text: '赤い提灯の子' });
  await a.fr.act('keep');
  await a.fr.act('persona_ok'); // 5 歩目: はじめまして
  assert.deepEqual(calls, [[true, 'ちょうちんくん'], [false, null]], '返事を待つ前に出し、返事が来たら消す');

  const failCalls = [];
  const b = harness({ thinking: (on) => failCalls.push(on), talk: async () => { throw new Error('つながらない'); } });
  await b.fr.start();
  await b.fr.act('role_home');
  await b.fr.act('words', { text: '赤い提灯の子' });
  await b.fr.act('keep');
  await b.fr.act('persona_ok');
  assert.deepEqual(failCalls, [true, false], '失敗しても、「…」を残さない');
  assert.ok(b.texts('note').some((t) => t.startsWith('うまく すすめなかったよ')));
});
