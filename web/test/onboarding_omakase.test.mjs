// おまかせ(ぜんぶ じどう)と、あと いくつ・あと 何分(本人 11/7: 「あとどれだけで終わるか見せる」「全部オートでできるパターン」)。
// 台本(script.js)を画面なしで通す。画面での見え方(札の上の段・大きなボタン)は onboarding_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, STEPS, progressText, OMAKASE_LABEL } from '../src/ui/onboarding/script.js';
import { createSampleCreator, cleanMakeEvent } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };

function harness({ creator = createSampleCreator({ main: MAIN }), guide = MAIN, initial = null } = {}) {
  const said = [];
  const steps = [];
  const stored = new Map();
  let offered = [];
  let done = false;
  const fr = new FirstRun({
    guide,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(7)), ...(initial ? { initial } : {}) },
    talk: async () => MOCK,
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '鍵の説明', useKey: async () => ({ ok: true }) },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: async () => true,
    onStep: (n, info) => steps.push({ n, ...info }),
    onDone: () => {
      done = true;
    },
  });
  return { fr, said, steps, stored, get offered() { return offered.map((a) => a.id); }, get done() { return done; }, texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text) };
}

test('あと いくつ・あと 何分: どの歩みでも、子どもに分かる言葉で出る', () => {
  const seen = [];
  for (const s of STEPS) {
    const p = progressText(s.n);
    assert.equal(p.left, STEPS.length - s.n, `歩み ${s.n}`);
    assert.match(p.time, /^あと \d+ 分くらい$/, `歩み ${s.n}: ${p.time}`);
    seen.push(p.main);
  }
  assert.equal(seen[0], 'あと 6 つで できあがり');
  assert.equal(seen[5], 'あと 1 つで できあがり');
  assert.equal(seen[6], 'これで さいご!');
  assert.deepEqual(progressText(8), { left: 0, main: 'できあがり!', time: '' });
  assert.equal(progressText(1).time, 'あと 2 分くらい', '見本の道の 7 歩は 2 分くらい');
  assert.equal(progressText(3, { skipped: [2] }).left, 4, 'とばした歩みは数えない(言葉の時のチェック)');
  assert.ok(Number(progressText(1, { local: true }).time.match(/\d+/)[0]) >= 5, '手元の PC で描く時は、描く時間を足す');
  for (const p of [progressText(1), progressText(4), progressText(7)]) assert.doesNotMatch(p.main + p.time, /[A-Za-z]|段|C0/, '内部の言葉を出さない');
});

test('おまかせ: 1 歩目の 1 回で、最後まで進む(主役・その子の性格・声の鍵なし。あとから変えられると言う)', async () => {
  const h = harness();
  await h.fr.start();
  assert.equal(h.steps.at(-1).n, 1);
  assert.equal(await h.fr.omakase(), true);
  assert.equal(h.done, true, '1 回で終わる');
  assert.equal(h.fr.done, true);
  assert.equal(h.fr.character.id, MAIN.id, '子がまだいなければ、案内役の主役');
  assert.ok(h.stored.get(MAIN.id), '性格を覚えた');
  assert.equal(h.texts('user')[0], OMAKASE_LABEL);
  assert.ok(h.texts('guide').includes('おまかせで、ぜんぶ きめマシタ!'), 'ノリーの口調で言う');
  const note = h.texts('note').find((t) => t.startsWith('きめたこと: '));
  assert.ok(note && /ノリー/.test(note) && /声はおまかせ/.test(note) && /あとから かえられます/.test(note), note);
  assert.deepEqual(h.offered, [], '終わったら選びは出さない');
  assert.equal(h.steps.at(-1).n, 8);
  assert.ok(h.steps.some((s) => s.n === 4), '性格の歩みを通った');
  assert.ok(!h.texts('char').length, 'あいさつの歩みはとばした');
});

test('おまかせ: 見本の子に会った後(3 歩目)・性格(4 歩目)・声(7 歩目)からでも、今の子のまま最後まで', async () => {
  const a = harness();
  await a.fr.start();
  await a.fr.act('words', { text: '赤い提灯の子' });
  assert.equal(a.fr.step, 3);
  await a.fr.omakase();
  assert.equal(a.done, true);
  assert.equal(a.fr.character.id, 'd_lantern', '会った子のまま');

  const b = harness();
  await b.fr.start();
  await b.fr.act('words', { text: '赤い提灯の子' });
  await b.fr.act('keep');
  const before = JSON.stringify(b.stored.get('d_lantern'));
  await b.fr.omakase();
  assert.equal(b.done, true);
  assert.equal(JSON.stringify(b.stored.get('d_lantern')), before, '選んだ性格は替えない');

  const c = harness();
  await c.fr.start();
  await c.fr.act('words', { text: '赤い提灯の子' });
  await c.fr.act('keep');
  await c.fr.act('persona_ok');
  await c.fr.act('to_retro');
  await c.fr.act('to_voice');
  assert.equal(c.fr.step, 7);
  await c.fr.omakase();
  assert.equal(c.done, true, '鍵を入れずに終わる');
  assert.equal(await c.fr.omakase(), false, '終わった後は何もしない');
});

test('おまかせ: 手元の PC の作る道(作る画面のおまかせ)からの知らせで、性格から後も自動で最後まで', async () => {
  const creator = { mode: 'local', frameUrl: 'http://127.0.0.1:8796/m/#k=x', note: '', picUrl: null, main: () => MAIN, list: () => [] };
  const h = harness({ creator });
  await h.fr.start();
  assert.deepEqual(h.offered, ['frame']);
  assert.equal(h.steps.at(-1).local, true, '歩みの知らせに手元の PC の印');
  await h.fr.makeEvent(cleanMakeEvent({ src: 'yc-make', ev: 'sent', from: 'words', words: 'まるくて げんきな ゆるキャラ', auto: true }));
  await h.fr.makeEvent(cleanMakeEvent({ src: 'yc-make', ev: 'drawn', id: 'yc1107_1830_abcd', name: 'まるこ', round: 1, noBrows: true }));
  await h.fr.makeEvent(cleanMakeEvent({ src: 'yc-make', ev: 'decided', decision: 'ok', id: 'yc1107_1830_abcd', name: 'まるこ', round: 2, auto: true }));
  assert.equal(h.done, true, '「この子にする」の後も、おすすめで最後まで');
  assert.ok(h.stored.get('yc1107_1830_abcd'), 'できた子の性格を覚えた');
  assert.ok(!h.offered.includes('persona_ok'), '性格の選びで止まらない');
});

test('作る画面の知らせ: 眉なしとおまかせの印は true の時だけ通す', () => {
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'drawn', id: 'a1', round: 1, noBrows: true }).noBrows, true);
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'drawn', id: 'a1', round: 1, noBrows: 'yes' }).noBrows, undefined);
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'decided', decision: 'ok', id: 'a1', auto: true }).auto, true);
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'decided', decision: 'ok', id: 'a1', auto: 1 }).auto, undefined);
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'progress', text: 'x', auto: true }).auto, undefined, '知らせの種類を決めて通す');
});
