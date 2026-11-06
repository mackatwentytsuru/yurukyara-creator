// 初めての会話の台本(web/src/ui/onboarding/script.js)を、画面なしで 7 歩とも通す試験。
// 頭脳・声・作る道は偽物(返事は仮の頭脳と同じ文)。画面での通しは onboarding_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, VOICE_THANKS, NOTE_MAX } from '../src/ui/onboarding/script.js';
import { createSampleCreator, pickSample } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom, normalize } from '../src/ui/persona/settings.js';

const MAIN = { id: 'tegaki_neko', name: 'ねこ' };
const MOCK = { lines: [{ text: 'こんにちは。', expression: 'happy', motion: 'wave' }, { text: '今日は、どんなお話をしようか。' }], brain: 'mock' };

function harness({ creator = createSampleCreator({ main: MAIN }), voice = {}, talk = async () => MOCK, show = async () => true, seed = 7 } = {}) {
  const said = [];
  const steps = [];
  const stored = new Map();
  const snaps = [];
  const talks = [];
  const personas = [];
  let offered = [];
  let done = false;
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(seed)) },
    talk: async (text, ctx) => {
      talks.push({ text, ctx });
      return talk(text, ctx);
    },
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '鍵の説明', useKey: async (k) => ({ ok: k === 'good-key', message: 'だめでした' }), ...voice },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: show,
    onStep: (n) => steps.push(n),
    onPersona: (s, c) => personas.push({ s, c }),
    save: (s) => snaps.push(s),
    onDone: () => {
      done = true;
    },
  });
  return {
    fr, said, steps, stored, snaps, talks, personas,
    get offered() { return offered.map((a) => a.id); },
    get done() { return done; },
    texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text),
  };
}

test('言葉の入口: 7 歩を最後まで通す(仮の頭脳・鍵を入れて本物の声のお礼)', async () => {
  const h = harness();
  await h.fr.start();
  assert.deepEqual(h.offered, ['photo', 'pick', 'words']);
  assert.ok(h.texts('guide').includes('どんな子を生み出そうか?'));
  assert.ok(h.texts('note').some((t) => t.includes('見本の子')), '見本の道だと正直に出す');

  assert.equal(await h.fr.act('words', { text: '赤い提灯の子' }), true);
  assert.equal(h.fr.character.id, 'd_lantern', '提灯 → ちょうちんくん');
  assert.ok(h.texts('note').some((t) => t.startsWith('見本: ちょうちんくん')));
  assert.ok(h.texts('guide').includes('ちょうちんくんだよ。この子はどうかな?'), '見本は「できたよ」と言わない');
  assert.deepEqual(h.offered, ['keep', 'fix', 'again']);

  await h.fr.act('keep');
  assert.equal(h.fr.step, 4);
  const s = h.stored.get('d_lantern');
  assert.ok(s, 'おまかせの性格をこの子の id で覚えた');
  assert.ok(h.texts('guide').some((t) => /^この子、少し.+みたい!$/.test(t)));
  assert.deepEqual(h.offered, ['persona_ok', 'persona_edit', 'persona_roll']);

  await h.fr.act('persona_ok');
  assert.equal(h.fr.step, 5);
  assert.equal(h.talks[0].text, 'はじめまして');
  const hello = h.said.filter((l) => l.who === 'char').at(-1);
  assert.notEqual(hello.text, 'こんにちは。今日は、どんなお話をしようか。', '仮の頭脳の返事を、性格の話し方にそろえた');
  assert.equal(hello.voice, true);
  assert.ok(h.texts('note').some((t) => t.startsWith('仮の頭脳です')), '仮の頭脳だと出す');

  await h.fr.act('to_retro');
  assert.equal(h.fr.step, 6);
  assert.ok(h.texts('guide').includes('まだ声が出せないから、文字とレトロな音で話すね。なにか話しかけてみて。'));
  await h.fr.act('say', { text: '好きな食べ物はなに?' });
  assert.equal(h.talks.at(-1).text, '好きな食べ物はなに?');
  assert.equal(h.fr.history.length, 4);

  await h.fr.act('to_voice');
  assert.equal(h.fr.step, 7);
  assert.deepEqual(h.offered, ['key', 'later']);
  assert.ok(h.texts('note').includes('鍵の説明'), '何をどこへ送るかを、鍵の前に出す');
  await h.fr.act('key', { key: 'good-key', remember: false });
  const thanks = h.said.filter((l) => l.who === 'char').at(-1);
  assert.equal(thanks.text, VOICE_THANKS);
  assert.equal(thanks.voice, true);
  assert.equal(h.stored.get('d_lantern').voice.provider, 'elevenlabs', '声の出し方を ElevenLabs にした');
  assert.ok(!JSON.stringify(h.said).includes('good-key'), '鍵の文字は、どの文にも出さない');
  assert.ok(!JSON.stringify([...h.stored.values()]).includes('good-key'), '鍵の文字は、性格の設定にも残さない');

  await h.fr.act('close');
  assert.equal(h.done, true);
  assert.deepEqual(h.steps, [1, 3, 4, 5, 6, 7, 8]);
});

test('絵の入口(見本の道): 人の絵なら「ゆるキャラにしてみる?」。主役の子が出る', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('pick', { url: 'blob:fake', name: 'face.png' });
  assert.equal(h.fr.step, 2);
  assert.equal(h.said.find((l) => l.who === 'user').img, 'blob:fake');
  assert.deepEqual(h.offered, ['kind_yuru', 'kind_human', 'kind_complex']);
  await h.fr.act('kind_human');
  assert.ok(h.texts('guide').includes('これはちょっとリアルな写真みたい。ゆるキャラにしてみる?'));
  assert.ok(h.texts('note').some((t) => t.includes('どんな写真でもきれいに作れるわけではありません')));
  assert.deepEqual(h.offered, ['yurufy', 'other']);
  await h.fr.act('yurufy');
  assert.equal(h.fr.character.id, 'tegaki_neko');
  assert.equal(h.fr.input.yurufy, true);
  assert.equal(h.fr.snapshot().words, null, '絵の住所は残さない');
  assert.ok(!JSON.stringify(h.fr.snapshot()).includes('blob:'));
});

test('こまかい絵 → 別の絵にする → 1 歩目に戻る。古いボタンと 2 回押しは捨てる', async () => {
  const h = harness();
  await h.fr.start();
  assert.equal(await h.fr.act('keep'), false, '今出していないボタンは効かない');
  await h.fr.act('photo', { url: 'blob:x' });
  await h.fr.act('kind_complex');
  assert.ok(h.texts('guide').includes('いろんな物が描いてあるね。主役を 1 つ選んで、描き直してみる?'));
  await h.fr.act('other');
  assert.equal(h.fr.step, 1);
  assert.deepEqual(h.offered, ['photo', 'pick', 'words']);
  const [a, b] = await Promise.all([h.fr.act('words', { text: 'みかん' }), h.fr.act('words', { text: 'ロボ' })]);
  assert.deepEqual([a, b], [true, false], '動いている最中の 2 回目は捨てる');
  assert.equal(h.fr.character.id, 'mikan');
});

test('手元の道(つながった時の形): チェックは Claude の結果、言葉は「こんな子ができたよ」、直しは 40 字で渡す', async () => {
  const reviews = [];
  const creator = {
    mode: 'local',
    check: async () => ({ class: 'yuru', by: 'claude' }),
    make: async () => ({ id: 'aka', name: 'あかちゃん', sample: false }),
    review: async (id, decision, note) => {
      reviews.push({ id, decision, note });
      return { ok: true };
    },
  };
  const h = harness({ creator });
  await h.fr.start();
  assert.ok(!h.texts('note').some((t) => t.includes('見本')), '手元の道では見本の注を出さない');
  await h.fr.act('photo', { url: 'blob:y' });
  assert.ok(h.texts('guide').includes('ゆるキャラにぴったりの絵だね。この絵から作るよ。'));
  await h.fr.act('next_meet');
  assert.ok(h.texts('guide').includes('こんな子ができたよ。どうかな?'));
  const long = 'あ'.repeat(NOTE_MAX + 10);
  await h.fr.act('fix', { text: long });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].decision, 'redo');
  assert.equal([...reviews[0].note].length, NOTE_MAX);
  assert.ok(h.texts('guide').some((t) => t.startsWith('PC の Claude Code に伝えたよ')));
});

test('鍵が違う → もう一度。あとで → 文字で話す。鍵の受け口が無い → 正直に言う', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'ねこ' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('key', { key: 'bad-key' });
  assert.equal(h.texts('char').at(-1), 'うまくいかなかったみたい。');
  assert.deepEqual(h.offered, ['key', 'later']);
  await h.fr.act('later');
  assert.equal(h.texts('char').at(-1), 'じゃあ、文字とレトロな音で話そうね。');

  const n = harness({ voice: { canTakeKey: () => false } });
  await n.fr.start();
  await n.fr.act('words', { text: 'ねこ' });
  await n.fr.act('keep');
  await n.fr.act('persona_ok');
  await n.fr.act('to_retro');
  await n.fr.act('to_voice');
  assert.ok(n.texts('guide').some((t) => t.includes('まだこの画面につながっていない')));
  assert.deepEqual(n.offered, ['close']);
});

test('声がもうある(サーバーの声)なら、6 歩目をとばして声で話す', async () => {
  const h = harness({ voice: { realVoice: (p) => (p === 'elevenlabs' ? 'server' : null) } });
  await h.fr.start();
  await h.fr.act('words', { text: 'みかん' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  assert.equal(h.fr.step, 7);
  assert.ok(h.fr.skipped.has(6));
  assert.equal(h.fr.settings.voice.provider, 'elevenlabs');
  assert.equal(h.texts('char').at(-1), '声でも話せるよ。よろしくね!');
});

test('性格: 画面で選んだ設定を覚える。もう一度ひくと型が変わることがある', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'みかん' });
  await h.fr.act('keep');
  const chosen = normalize({ preset: 'shy', tone: 'ending', ending: 'にゃ', energy: 2, length: 'short' });
  await h.fr.act('persona_edit', { settings: chosen });
  assert.deepEqual(h.stored.get('mikan'), chosen);
  assert.ok(h.texts('guide').includes('恥ずかしがり屋にしたよ。'));
  assert.ok(h.personas.at(-1).s.preset === 'shy');
  await h.fr.act('persona_ok');
  const hello = h.texts('char').at(-1);
  assert.match(hello, /^(あ、あの…|えっと…)こんにちはにゃ。$/, `恥ずかしがり屋・語尾にゃ・短め: ${hello}`);
  const presets = new Set();
  for (let seed = 1; seed < 12; seed++) {
    const r = harness({ seed });
    await r.fr.start();
    await r.fr.act('words', { text: 'みかん' });
    await r.fr.act('keep');
    presets.add(r.fr.settings.preset);
  }
  assert.ok(presets.size >= 2, 'おまかせは毎回同じ型ではない');
});

test('安全の決まった返事は、話し方を変えない(仮の頭脳でも)', async () => {
  const fixed = { lines: [{ text: 'つらい気持ちを話してくれて、ありがとう。' }, { text: '身近な大人に相談してね。' }], brain: 'mock', safety: 'distress' };
  const h = harness({ talk: async () => fixed });
  await h.fr.start();
  await h.fr.act('words', { text: 'みかん' });
  await h.fr.act('keep');
  await h.fr.act('persona_edit', { settings: normalize({ preset: 'genki', tone: 'ending', ending: 'にゃ', length: 'short' }) });
  await h.fr.act('persona_ok');
  assert.equal(h.texts('char').at(-1), 'つらい気持ちを話してくれて、ありがとう。身近な大人に相談してね。');
});

test('読み込み直しをまたぐ: 3 歩目で状態を残し、続きから「この子はどうかな?」', async () => {
  const h = harness({ show: async () => false });
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  assert.equal(h.snaps.length, 1);
  const snap = JSON.parse(JSON.stringify(h.snaps[0]));
  assert.equal(snap.character.id, 'robo');
  assert.deepEqual(h.offered, [], '移る前はボタンを出さない');
  const r = harness();
  await r.fr.resume(snap);
  assert.equal(r.fr.step, 3);
  assert.ok(r.texts('guide').includes('ロボくんだよ。この子はどうかな?'));
  assert.deepEqual(r.offered, ['keep', 'fix', 'again']);
  const bad = harness();
  await bad.fr.resume({ v: 99 });
  assert.equal(bad.fr.step, 1, '形の違う控えは捨てて、はじめから');
});

test('見本えらび: 言葉に近い子。当たらなければ言葉から作った見本', () => {
  assert.equal(pickSample('ちょうちん').id, 'd_lantern');
  assert.equal(pickSample('ＬＥＤのパネル').id, 'f_led');
  assert.equal(pickSample('ふしぎな くも').id, 'mikan');
});
