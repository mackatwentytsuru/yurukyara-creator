// 「ひとつ もどる」(本人 11/8: つくっている最中にも、ひとつ前に戻れるように)の台本の試験。画面なしで、1 点ずつ確かめる。
// 画面(札の見た目・押した時の動き)は onboarding_back_browser.test.mjs。ここは台本(script.js)の戻りの道だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, BACK_ARIA, BACK_ARIA_AUTO, BACK_LABEL, REUSE_ID, progressText } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 描いた子を作る作り手(描いた回数を数える。ブラウザから描ける設定のまね) */
// かなだけの名前にする(数字や英字だと、読みを聞く問いが入って、問いの数が変わる)
const KANA_NO = ['いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち'];
function drawingCreator() {
  const base = createSampleCreator({ main: MAIN });
  const made = [];
  return {
    made,
    creator: {
      ...base,
      canDraw: true,
      make: async (input) => {
        made.push(input.words ?? input.from);
        const n = made.length;
        return { id: `yb${n}`, name: `みどり${KANA_NO[n - 1] ?? 'の'}`, sample: false, drawn: true, twod: true, note: 'Claude が描いた子' };
      },
    },
  };
}

function harness({ creator = createSampleCreator({ main: MAIN }), show = async () => true, stuckMs, present, seed = 7 } = {}) {
  const saves = [];
  const said = [];
  const stored = new Map();
  const offers = []; // 出した選び(空でない物)ごとの { ids, actions, back }
  const stepInfos = [];
  const log = { marks: 0, rewinds: [], undone: 0, shown: [], pins: [] };
  let offered = [];
  let meta;
  let done = false;
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    stuckMs,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(seed)) },
    talk: async () => MOCK,
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async (k) => ({ ok: k === 'good-key', message: 'だめでした' }) },
    present: async (lines) => {
      if (present) await present(lines);
      said.push(...lines);
    },
    offer: (a, m) => {
      offered = a;
      meta = m;
      if (a.length) offers.push({ ids: a.map((x) => x.id), actions: a, back: m?.back ?? null });
    },
    showCharacter: async (c) => {
      log.shown.push(c?.id);
      return show(c);
    },
    pin: (p) => log.pins.push(p),
    save: (snap) => saves.push(snap),
    mark: () => {
      log.marks += 1;
      return said.length; // 会話の位置の代わり: 言った文の数
    },
    rewind: (m) => log.rewinds.push(m),
    onUndone: () => {
      log.undone += 1;
    },
    onStep: (n, info) => stepInfos.push({ n, ...info }),
    onDone: () => {
      done = true;
    },
  });
  return {
    fr, said, stored, offers, stepInfos, log, saves,
    get offered() { return offered.map((a) => a.id); },
    get offeredAll() { return offered; },
    get back() { return meta?.back ?? null; },
    get done() { return done; },
    texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text),
  };
}

const ROLE_IDS = ['role_home', 'role_shop', 'role_station', 'role_facility', 'role_auto'];
const START_IDS = ['pick', 'photo', 'what_auto', 'words'];
const prevOf = (h) => h.offeredAll.filter((a) => a.prev).map((a) => a.id);

/** 7 歩の道を、最後の「はなしてみる」まで通す(見本の道) */
async function walkAll(h) {
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: '赤い提灯の子' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('say', { text: '好きな食べ物はなに?' });
  await h.fr.act('to_voice');
  await h.fr.act('key', { key: 'good-key' });
  await h.fr.act('close');
}

test('札の出し方: 最初の問いには出さず、2 つ目の問いから最後まで、どの札にも「ひとつ もどる」が付く', async () => {
  const h = harness();
  await walkAll(h);
  assert.equal(h.offers[0].back, null, '最初の問い(役目)には出さない');
  assert.deepEqual(h.offers[0].ids, ROLE_IDS);
  for (const [i, o] of h.offers.slice(1).entries()) {
    assert.ok(o.back, `${i + 2} つ目の選び ${o.ids.join(',')} に「ひとつ もどる」が無い`);
    assert.equal(o.back.label, BACK_LABEL);
    assert.ok(o.back.aria.includes('もどります'), '読み上げの名前がある');
  }
  assert.equal(h.offered.join(), 'begin', '最後の「はなしてみる」');
  assert.ok(h.back, '作り終わった後にも出す');
  // 札の一覧そのものには混ぜない(ほかの試験の「選びの並び」を変えない。画面が meta から足す)
  assert.ok(h.offers.every((o) => !o.ids.includes('back')));
});

test('役目の後の場所の問いにも出す。戻ると、ひとつ前の問いと さっきの こたえ(言葉は欄に入れ直す)', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_station');
  assert.deepEqual(h.offered, ['place_name', 'place_auto', 'place_skip']); // 作る画面の「おまかせ」(place_auto)が入る
  assert.ok(h.back, '場所の問い(2 つ目)にも出す');
  await h.fr.act('place_name', { text: 'みどり駅' });
  assert.deepEqual(h.offered, ['place_about', 'place_skip']);
  assert.equal(h.fr.place.name, 'みどり駅');

  assert.equal(await h.fr.act('back'), true);
  assert.deepEqual(h.offered, ['place_name', 'place_auto', 'place_skip'], 'ひとつ前の問い');
  const field = h.offeredAll.find((a) => a.id === 'place_name');
  assert.equal(field.value, 'みどり駅', 'さっきの言葉を欄に入れ直す');
  assert.equal(field.prev, true, 'さっきの こたえに しるし');
  assert.equal(h.fr.place, null, '場所の効き目だけ戻る(名前を覚えていない)');
  assert.equal(h.fr.role, 'station', '役目の こたえは、この問いの前なので、そのまま');
  assert.ok(h.texts('note').some((t) => t.startsWith('ひとつ もどったよ。')), '戻ったことを言う');

  assert.equal(await h.fr.act('back'), true);
  assert.deepEqual(h.offered, ROLE_IDS, '役目の問いまで戻れる');
  assert.deepEqual(prevOf(h), ['role_station'], 'さっき選んだ役目に しるし');
  assert.equal(h.fr.role, null);
  assert.equal(h.back, null, '最初の問いには出さない');
  assert.equal(await h.fr.act('back'), false, '最初の問いで押しても何も起きない');
  // しるしの付いた札を、そのまま押して進める
  await h.fr.act('role_station');
  assert.deepEqual(h.offered, ['place_name', 'place_auto', 'place_skip']); // 作る画面の「おまかせ」(place_auto)が入る
});

test('その問いの効き目だけを戻す: 描いた子のまま「この子はどうかな?」へ戻り、もう一度は描かない', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'みどりの 子' });
  assert.equal(d.made.length, 1);
  assert.deepEqual(h.offered, ['keep', 'fix', 'again']);
  await h.fr.act('keep');
  assert.equal(h.fr.step, 4);
  const before = JSON.stringify(h.stored.get('yb1'));
  assert.ok(before, '性格を覚えた');
  assert.deepEqual(h.offered, ['persona_ok', 'persona_edit', 'persona_roll']);

  await h.fr.act('back'); // 性格 → できた子
  assert.equal(h.fr.step, 3);
  assert.deepEqual(h.offered, ['keep', 'fix', 'again']);
  assert.equal(h.fr.character.id, 'yb1', '描いた子はそのまま');
  assert.equal(h.fr.settings, null, '性格の効き目だけ戻る');
  assert.equal(d.made.length, 1, 'もう一度は描かない');
  assert.deepEqual(prevOf(h), ['keep']);
  await h.fr.act('keep');
  assert.equal(JSON.stringify(h.stored.get('yb1')), before, '同じ子の性格は、くじを引き直さない');

  await h.fr.act('back');
  await h.fr.act('back'); // できた子 → 「どんな子?」
  assert.deepEqual(h.offered, [REUSE_ID, ...START_IDS], 'さっき描いた子を、使う札として残す(札の列の最初)');
  assert.equal(h.offeredAll[0].primary, true, '目立つ札(おすすめ)');
  assert.equal(h.fr.character, null);
  const words = h.offeredAll.find((a) => a.id === 'words');
  assert.equal(words.value, 'みどりの 子', '言葉を欄に入れ直す');
  assert.equal(words.prev, true);
  assert.equal(d.made.length, 1, '戻っただけでは描かない');

  await h.fr.act(REUSE_ID);
  assert.equal(h.fr.character.id, 'yb1');
  assert.equal(h.fr.step, 3);
  assert.deepEqual(h.offered, ['keep', 'fix', 'again']);
  assert.equal(d.made.length, 1, '使うだけなら、描かない');
  assert.equal(h.fr.input.words, 'みどりの 子');

  await h.fr.act('back');
  await h.fr.act('words', { text: 'べつの 子' });
  assert.equal(d.made.length, 2, '頼んだ時だけ、もう一度描く');
  assert.equal(h.fr.character.id, 'yb2');
});

test('「あと ◯ つ」: 戻ると、その問いの時の歩みとおなじ数に戻る', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: '赤い提灯の子' });
  const at3 = h.stepInfos.filter((s) => s.n === 3).at(-1);
  assert.deepEqual(at3.skipped, [2], '言葉の道はチェックをとばす');
  assert.equal(progressText(3, at3).main, 'あと 4 つ');
  await h.fr.act('keep');
  assert.equal(h.stepInfos.at(-1).n, 4);
  assert.equal(progressText(4, h.stepInfos.at(-1)).main, 'あと 3 つ');

  await h.fr.act('back');
  const now = h.stepInfos.at(-1);
  assert.equal(now.n, 3, '歩みが 3 に戻る');
  assert.deepEqual(now.skipped, [2]);
  assert.equal(progressText(now.n, now).main, 'あと 4 つ', '「あと ◯ つ」が戻る');
  await h.fr.act('back');
  const first = h.stepInfos.at(-1);
  assert.equal(first.n, 1);
  assert.deepEqual(first.skipped, [], 'とばした歩みも戻る');
  assert.equal(progressText(first.n, first).main, 'あと 6 つ');
  // 進み直すと、また数が減る
  await h.fr.act('words', { text: 'ロボット' });
  assert.equal(h.stepInfos.at(-1).n, 3);
  assert.equal(h.fr.character.id, 'robo');
});

test('何回でも続けて戻れる: 最初の問いまで 1 つずつ。進み直しもできる', async () => {
  const h = harness();
  await walkAll(h);
  assert.equal(h.fr.done, true);
  let n = 0;
  const seen = [];
  while (h.back) {
    assert.equal(await h.fr.act('back'), true, `${n + 1} 回目`);
    n += 1;
    seen.push(h.offered.join(' '));
    assert.equal(h.fr.busy, false);
    assert.ok(h.offered.length, '選びが空にならない');
    assert.ok(n < 30);
  }
  assert.ok(n >= 8, `戻った回数 ${n}`);
  assert.deepEqual(h.offered, ROLE_IDS);
  assert.equal(h.fr.step, 1);
  assert.equal(h.fr.done, false);
  assert.equal(h.fr.role, null);
  assert.equal(h.fr.character, null);
  assert.equal(h.fr.input, null);
  assert.equal(h.fr.settings, null);
  assert.equal(h.fr.history.length, 0, 'あいさつの記録も戻る');
  assert.equal(h.fr.skipped.size, 0);
  assert.equal(await h.fr.act('back'), false);
  // 途中の問いを順に見る: 声の鍵 → 文字と音 → あいさつ → 性格 → できた子 → どんな子
  assert.ok(seen.some((s) => s.startsWith('key later')), '声の問いに戻る');
  assert.ok(seen.some((s) => s.startsWith('say to_voice')), '文字と音の問いに戻る');
  assert.ok(seen.some((s) => s.startsWith('persona_ok')), '性格の問いに戻る');
});

test('進み直し: 最初まで戻った後も、同じ道を最後まで通れる', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: '赤い提灯の子' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  while (h.back) await h.fr.act('back');
  await h.fr.act('role_shop');
  await h.fr.act('place_skip');
  await h.fr.act('place_skip');
  await h.fr.act('words', { text: 'ロボット' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('later');
  await h.fr.act('close');
  assert.equal(h.fr.done, true);
  assert.equal(h.fr.character.id, 'robo');
  assert.equal(h.stored.get('robo').role, 'shop', '戻った後に選び直した役目が効く');
});

test('問いごとの おまかせ(役目・どんな子)の後でも戻れる', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_auto');
  assert.equal(h.fr.role, 'home');
  assert.deepEqual(h.offered, START_IDS);
  await h.fr.act('what_auto');
  assert.ok(h.fr.character, 'おまかせで子ができる');
  assert.equal(h.fr.step, 3);

  await h.fr.act('back'); // できた子 → どんな子(おまかせに しるし)
  assert.deepEqual(h.offered, START_IDS);
  assert.deepEqual(prevOf(h), ['what_auto']);
  assert.equal(h.fr.character, null);
  assert.equal(h.fr.role, 'home', '役目のおまかせは、この問いの前の こたえ');

  await h.fr.act('back'); // どんな子 → 役目(おまかせに しるし)
  assert.deepEqual(h.offered, ROLE_IDS);
  assert.deepEqual(prevOf(h), ['role_auto']);
  assert.equal(h.fr.role, null, '役目のおまかせの効き目が戻る');
  await h.fr.act('role_shop');
  assert.equal(h.fr.role, 'shop');
});

test('「のこりを ぜんぶ おまかせ」が終わった後: 押した時の問いに戻れる(終わりで閉じる待ちも止める)', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_station');
  await h.fr.act('place_name', { text: 'みどり駅' });
  assert.deepEqual(h.offered, ['place_about', 'place_skip']);
  await h.fr.omakaseAsk();
  assert.deepEqual(h.offered, ['omakase_yes', 'omakase_no']);
  await h.fr.act('omakase_yes');
  assert.equal(h.done, true);
  assert.equal(h.fr.done, true);
  assert.equal(h.offered.join(), 'begin');
  assert.equal(h.back?.aria, BACK_ARIA_AUTO, 'おまかせの後だと分かる名前');
  assert.ok(h.fr.character, 'おまかせで子ができた');
  assert.equal(h.log.undone, 0);

  assert.equal(await h.fr.act('back'), true);
  assert.equal(h.log.undone, 1, '閉じる待ちを止める知らせ');
  assert.equal(h.fr.done, false);
  assert.equal(h.fr.auto, false);
  assert.deepEqual(h.offered, ['place_about', 'place_skip'], 'のこりを ぜんぶ おまかせ を押した時の問い');
  assert.equal(h.fr.character, null, 'おまかせで決めたことは戻る');
  assert.equal(h.fr.settings, null);
  assert.equal(h.fr.step, 1);
  assert.equal(h.fr.place.name, 'みどり駅', 'その前の こたえは そのまま');
  assert.equal(h.fr.skipped.size, 0);
  assert.ok(h.back, 'さらに前にも戻れる');

  // そのまま自分で進めて、最後まで行ける
  await h.fr.act('place_skip');
  await h.fr.act('words', { text: 'ロボット' });
  await h.fr.act('keep');
  assert.equal(h.fr.step, 4);
  assert.equal(h.fr.settings.role, 'station');
  // もう一度おまかせを押して「やめる」: 同じ問いに戻るだけで、戻りの道が増えない
  await h.fr.act('persona_ok');
  const depth = h.fr.trail.length;
  await h.fr.omakaseAsk();
  await h.fr.act('omakase_no');
  assert.equal(h.fr.trail.length, depth, 'やめるでは、戻りの道を増やさない');
  assert.deepEqual(h.offered, ['to_retro']);
  await h.fr.act('back');
  assert.deepEqual(h.offered, ['persona_ok', 'persona_edit', 'persona_roll'], 'ひとつ前の問い(同じ問いが 2 回出ない)');
});

test('おまかせの確かめの上でも、「ひとつ もどる」は元の問いに戻る', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.omakaseAsk();
  assert.ok(h.back);
  await h.fr.act('back');
  assert.deepEqual(h.offered, START_IDS, 'のこりを おまかせ を押した時の問い');
  assert.equal(h.fr.auto, false);
  assert.ok(h.back, '役目の問いにも戻れる');
  await h.fr.act('back');
  assert.deepEqual(h.offered, ROLE_IDS);
});

test('止まらない: 戻る間の舞台の入れ替えが長くても、止まりの見張りが出し直さない。動いている間の押し直しは捨てる', async () => {
  let slow = false;
  const h = harness({
    stuckMs: 40,
    show: async () => {
      if (slow) await sleep(220);
      return true;
    },
  });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: '赤い提灯の子' }); // ちょうちんくん
  await h.fr.act('again');
  await h.fr.act('words', { text: 'ロボット' }); // ロボくん(舞台が替わる)
  assert.equal(h.fr.character.id, 'robo');
  await h.fr.act('keep');
  slow = true;
  await h.fr.act('back'); // できた子(ロボくん)
  await h.fr.act('back'); // 「どんな子?」(まだ ロボくん は舞台にいる)
  await h.fr.act('back'); // やりなおす前のちょうちんくん → 舞台を入れ替える(長い)
  assert.equal(h.fr.character.id, 'd_lantern');
  assert.equal(h.fr.stuckCount, 0, `長い入れ替えの間に、止まりと見て出し直した(${h.fr.stuckCount} 回)`);
  assert.equal(h.fr.busy, false);
  assert.deepEqual(h.log.shown.slice(-1), ['d_lantern']);

  // 動いている間の押し直しは捨てる
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  slow = false;
  const g = harness({ present: async (lines) => (lines.some((l) => l.text.startsWith('ひとつ もどったよ。')) ? gate : undefined) });
  await g.fr.start();
  await g.fr.act('role_home');
  const first = g.fr.act('back'); // 戻っている最中
  await sleep(10);
  assert.equal(await g.fr.act('back'), false, '戻っている最中の 2 回押しは捨てる');
  assert.equal(await g.fr.act('role_shop'), false, '戻っている最中の別の札も捨てる');
  release();
  assert.equal(await first, true);
  assert.deepEqual(g.offered, ROLE_IDS);
  assert.equal(g.fr.busy, false);
});

test('止まらない: 戻る途中で舞台を読み込み直すと言われたら、続きの状態を残して終わる(動いたままにしない)', async () => {
  let reload = false;
  const h = harness({ show: async () => !reload });
  const fr = h.fr;
  await fr.start();
  await fr.act('role_home');
  await fr.act('words', { text: 'ロボット' });
  await fr.act('again');
  await fr.act('words', { text: '赤い提灯の子' });
  await fr.act('back'); // 「どんな子?」(舞台は ちょうちんくん のまま)
  reload = true;
  await fr.act('back'); // ロボくんの「この子はどうかな?」へ戻る → 舞台の入れ替えが読み込み直し
  assert.equal(h.saves.length, 1, '続きの状態を残した(読み込み直しの後、resume が続ける)');
  assert.equal(h.saves[0].character.id, 'robo');
  assert.equal(fr.busy, false);
});

test('無作為に進んだり戻ったりしても、止まらず、選びが空にならず、戻る札の有無が戻りの道と合う', async () => {
  for (const mode of ['sample', 'draw']) {
    const rnd = seededRandom(mode === 'sample' ? 11 : 29);
    const d = drawingCreator();
    const h = harness({ creator: mode === 'draw' ? d.creator : createSampleCreator({ main: MAIN }) });
    await h.fr.start();
    const payload = (a) => {
      if (a.id === 'pick' || a.id === 'photo') return { url: 'blob:test', name: 'a.png' };
      if (a.id === 'key') return { key: rnd() < 0.5 ? 'good-key' : 'bad-key' };
      if (a.kind === 'text') return { text: ['あおい子', '赤い提灯の子', 'ロボット', 'みどり'][Math.floor(rnd() * 4)] };
      if (a.kind === 'persona') return { settings: h.fr.settings };
      return {};
    };
    for (let i = 0; i < 400; i++) {
      // 作り終わった後は「はなしてみる」しか無い(押すと札が閉じて終わる)ので、続きは戻るだけ
      const goBack = h.back && (h.fr.done || rnd() < 0.35);
      if (goBack) {
        assert.equal(await h.fr.act('back'), true, `${mode} ${i}: 戻れる`);
      } else {
        const pool = h.offeredAll.filter((a) => a.kind !== 'frame');
        assert.ok(pool.length, `${mode} ${i}: 選びが空`);
        const a = pool[Math.floor(rnd() * pool.length)];
        if (!(a.kind === 'text' && !payload(a).text)) await h.fr.act(a.id, payload(a));
      }
      assert.equal(h.fr.busy, false, `${mode} ${i}: 動いたまま`);
      assert.ok(h.offered.length > 0, `${mode} ${i}: 選びが空(${h.fr.step})`);
      assert.equal(Boolean(h.back), h.fr.trail.length > 0, `${mode} ${i}: 戻る札の有無が戻りの道と合わない`);
      assert.equal(h.fr.stuckCount, 0);
      if (h.fr.step === 1 && h.offered.join() === ROLE_IDS.join()) assert.equal(h.fr.role, null, `${mode} ${i}: 最初の問いでは、役目が決まっていない`);
    }
  }
});

test('戻りの道は、「はじめから」で空になり、古い物から捨てて 60 を越えない', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'ロボット' });
  assert.ok(h.back);
  h.fr.freshNext = true;
  h.fr._offer(h.fr.actions); // 続きの途中の「はじめから」の札を足す
  await h.fr.act('fresh');
  assert.equal(h.fr.trail.length, 0);
  assert.deepEqual(h.offered, ROLE_IDS);
  assert.equal(h.back, null, 'はじめからの後は、最初の問い');
  assert.equal(await h.fr.act('back'), false);

  await h.fr.act('role_home');
  for (let i = 0; i < 90; i++) {
    await h.fr.act('words', { text: 'ロボット' });
    await h.fr.act('again');
  }
  assert.ok(h.fr.trail.length <= 60, `戻りの道 ${h.fr.trail.length}`);
  assert.ok(h.back);
});

test('通り道の問い(失敗の「もう一度」)の上から戻ると、失敗する前の問いに戻る', async () => {
  const base = createSampleCreator({ main: MAIN });
  let fail = true;
  const h = harness({
    creator: {
      ...base,
      make: async (input, o) => {
        if (fail) throw new Error('つながらない');
        return base.make(input, o);
      },
    },
  });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'ロボット' });
  assert.deepEqual(h.offered, ['retry', 'finish'], '失敗の選び');
  assert.ok(h.back);
  await h.fr.act('back');
  assert.deepEqual(h.offered, START_IDS, '失敗した問いに戻る(失敗の選びを戻り先にしない)');
  assert.equal(h.fr.input, null, '失敗した入力は戻る');
  fail = false;
  await h.fr.act('words', { text: 'ロボット' });
  assert.equal(h.fr.character.id, 'robo');
});

test('手元の PC の作る道: 作る画面の問いに戻り、描いた子を「そのまま使う」札で残す(もう一度は頼まない)', async () => {
  const creator = { mode: 'local', frameUrl: 'http://127.0.0.1:8796/m/#k=x', note: '', picUrl: null, main: () => MAIN, list: () => [] };
  const h = harness({ creator });
  await h.fr.start();
  await h.fr.act('role_home');
  assert.deepEqual(h.offered, ['frame']);
  await h.fr.makeEvent({ ev: 'sent', from: 'words', words: 'まるい子' });
  await h.fr.makeEvent({ ev: 'drawn', id: 'yc1108_0001_abcd', name: 'まるこ', round: 1 });
  await h.fr.makeEvent({ ev: 'decided', decision: 'ok', id: 'yc1108_0001_abcd', name: 'まるこ', round: 1 });
  assert.deepEqual(h.offered, ['keep'], '2D を待つ間の選び');
  await h.fr.makeEvent({ ev: 'twod', id: 'yc1108_0001_abcd' });
  assert.deepEqual(h.offered, ['want3d', 'no3d']);
  assert.ok(h.back);
  await h.fr.act('no3d');
  assert.equal(h.fr.step, 4);

  await h.fr.act('back'); // 性格 → 3D の問い
  assert.deepEqual(h.offered, ['want3d', 'no3d']);
  assert.equal(h.fr.character.id, 'yc1108_0001_abcd', '描いた子は そのまま');
  assert.deepEqual(prevOf(h), ['no3d']);
  assert.equal(h.fr.step, 3);
  await h.fr.act('back'); // 3D の問い → 作る画面の問い
  assert.deepEqual(h.offered, [REUSE_ID, 'frame'], '作る画面と、さっきの子を使う札(札は最初)');
  assert.equal(h.fr.character, null);
  await h.fr.act(REUSE_ID);
  assert.equal(h.fr.character.id, 'yc1108_0001_abcd');
  assert.deepEqual(h.offered, ['want3d', 'no3d'], '2D は できているので、3D の問いへ(描き直さない)');
});

test('会話の欄を戻す印: 問いを出した時の位置に戻し、同じ位置を 2 回使える', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'ロボット' });
  const markAtMeet = h.said.length;
  await h.fr.act('keep');
  await h.fr.act('back');
  assert.equal(h.log.rewinds.at(-1), markAtMeet, '「この子はどうかな?」を出した時の位置まで会話を戻す');
  await h.fr.act('back');
  await h.fr.act('words', { text: 'ロボット' });
  await h.fr.act('back');
  assert.ok(h.log.rewinds.every((m) => Number.isInteger(m)));
});

test('戻り先の札の名前: 戻る札は読み上げの名前を持つ(作り終わりと おまかせの後で言い方が変わる)', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('role_home');
  assert.equal(h.back.aria, BACK_ARIA);
  assert.match(BACK_ARIA, /^ひとつ もどる/);
  assert.notEqual(BACK_ARIA, BACK_ARIA_AUTO);
});

/* ---------- BK1_2: 戻って同じ頼みを送り直しても、もう一度は描かない(描くのは 1 人 2 回まで) ---------- */

test('戻って同じ言葉を送り直しても、描かない(さっきの子を使う)。何回くり返しても 1 回のまま', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'みどりの かえるの子' });
  assert.equal(d.made.length, 1);
  for (let i = 0; i < 4; i++) {
    await h.fr.act('back'); // できた子 → どんな子(言葉が欄に入り直す)
    const words = h.offeredAll.find((a) => a.id === 'words');
    assert.equal(words.value, 'みどりの かえるの子');
    await h.fr.act('words', { text: words.value }); // 欄に入っている言葉を、そのまま「送る」
    assert.equal(d.made.length, 1, `${i + 1} 回戻って送り直しても、描かない`);
    assert.equal(h.fr.character.id, 'yb1', 'さっきの子');
    assert.equal(h.fr.step, 3);
    assert.deepEqual(h.offered, ['keep', 'fix', 'again']);
    assert.ok(h.texts('note').some((t) => t.includes('もう一度は 描かないよ')), '描かずに使うことを言う');
    assert.equal(h.fr.busy, false);
  }
  // 言葉を かえた時と、「やりなおす」の後は、ふつうに描く
  await h.fr.act('back');
  await h.fr.act('words', { text: 'あかい 子' });
  assert.equal(d.made.length, 2);
  await h.fr.act('again');
  await h.fr.act('words', { text: 'あかい 子' });
  assert.equal(d.made.length, 3, '「やりなおす」は、新しく描いてほしいということ');
});

test('戻って「どんな子?」の おまかせを押し直しても、描かない', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_station');
  await h.fr.act('place_skip');
  await h.fr.act('place_skip');
  await h.fr.act('what_auto');
  assert.equal(d.made.length, 1);
  await h.fr.act('back');
  assert.deepEqual(prevOf(h), ['what_auto'], 'しるしの付いた おまかせ');
  await h.fr.act('what_auto');
  assert.equal(d.made.length, 1, '同じ頼みなので、描かない');
  assert.equal(h.fr.character.id, 'yb1');
  await h.fr.act('back');
  await h.fr.act('back'); // 場所の問いまで戻って、進み直す
  await h.fr.act('place_skip');
  await h.fr.act('what_auto');
  assert.equal(d.made.length, 1, 'もっと前に戻っても、頼みが同じなら描かない');
});

test('戻って「のこりを ぜんぶ おまかせ」を押し直しても、子は描かない', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.omakaseAsk();
  await h.fr.act('omakase_yes');
  assert.equal(h.fr.done, true);
  assert.equal(d.made.length, 1);
  await h.fr.act('back');
  assert.equal(h.fr.done, false);
  await h.fr.omakaseAsk();
  await h.fr.act('omakase_yes');
  assert.equal(h.fr.done, true);
  assert.equal(d.made.length, 1, 'おまかせの描き直しをしない');
  assert.equal(h.fr.character.id, 'yb1');
});

test('戻って同じ写真を選び直しても、描かない(選び直すと仮の住所は変わる)。べつの写真は描く', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  const file = { name: 'cat.png', size: 1234, lastModified: 1700000000000 };
  await h.fr.act('photo', { url: 'blob:one', name: 'cat.png', file });
  await h.fr.act('rights_yes'); // 使っていい絵か 1 回だけ聞く(絵の枝)。答えてから描く
  assert.equal(d.made.length, 1);
  assert.equal(h.fr.character.id, 'yb1');
  await h.fr.act('back'); // 「使っていい絵?」の問いへ(ふつうの問いなので、戻りの道に入る)
  assert.ok(h.offered.includes('rights_yes'));
  await h.fr.act('rights_yes'); // 同じ絵で進み直す: 描かずに さっきの子
  assert.equal(d.made.length, 1, '同じ絵のまま進み直しても描かない');
  assert.equal(h.fr.character.id, 'yb1');
  await h.fr.act('back');
  await h.fr.act('back'); // 絵を選ぶ問いまで
  assert.deepEqual(h.offered, [REUSE_ID, ...START_IDS].filter((id) => h.offered.includes(id)), 'さっきの子の札が最初');
  await h.fr.act('photo', { url: 'blob:two', name: 'cat.png', file: { ...file } });
  await h.fr.act('rights_yes');
  assert.equal(d.made.length, 1, '同じ写真(名前・大きさ・日付が同じ)は描かない');
  assert.equal(h.fr.character.id, 'yb1');
  await h.fr.act('back');
  await h.fr.act('back');
  await h.fr.act('photo', { url: 'blob:three', name: 'dog.png', file: { name: 'dog.png', size: 99, lastModified: 1 } });
  await h.fr.act('rights_yes');
  assert.equal(d.made.length, 2, 'べつの写真は、頼んだ時だけ描く');
});
test('さっきの子の札: 札の列の最初で、おすすめの札(幅の狭い画面で、横に流れる列の外に隠れない)', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('words', { text: 'みどりの 子' });
  await h.fr.act('back');
  const reuse = h.offeredAll[0];
  assert.equal(reuse.id, REUSE_ID);
  assert.equal(reuse.primary, true);
  assert.ok(reuse.aria.includes('もう一度は 描きません'), '名前がある');
  assert.equal(h.offeredAll.findIndex((a) => a.primary), 0, 'おすすめの札のうち、いちばん最初');
});

test('描いた子: 戻る・進むを何度くり返しても、描く回数は「ちがう頼みを送った回数」だけ', async () => {
  const d = drawingCreator();
  const h = harness({ creator: d.creator });
  await h.fr.start();
  await h.fr.act('role_home');
  const texts = ['あおい子', 'あおい子', 'みどりの 子', 'みどりの 子', 'あおい子'];
  for (const text of texts) {
    await h.fr.act('words', { text });
    await h.fr.act('keep'); // 性格まで進む
    await h.fr.act('back');
    await h.fr.act('back'); // 「どんな子?」まで戻る
    assert.equal(h.fr.busy, false);
    assert.equal(h.fr.stuckCount, 0);
  }
  // あおい子 → みどり → あおい子 と、ちがう頼みに変わった 3 回だけ描く(同じ頼みの送り直しは描かない)
  assert.equal(d.made.length, 3);
});
