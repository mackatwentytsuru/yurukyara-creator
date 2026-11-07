// 初めての会話の台本(web/src/ui/onboarding/script.js)を、画面なしで 7 歩とも通す試験。
// 頭脳・声・作る道は偽物(返事は仮の頭脳と同じ文)。画面での通しは onboarding_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, VOICE_THANKS, NOTE_MAX, MAKE_STEPS, README_SECTION } from '../src/ui/onboarding/script.js';
import { createSampleCreator, pickSample, SAMPLE_CHARACTERS, MAIN_NOTE, OTHER_NOTE } from '../src/ui/onboarding/creators.js';
import { randomSettings, seededRandom, normalize } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';
const MOCK = { lines: [{ text: 'こんにちは。', expression: 'happy', motion: 'wave' }, { text: '今日は、どんなお話をしようか。' }], brain: 'mock' };

function harness({ creator = createSampleCreator({ main: MAIN }), guide = MAIN, voice = {}, talk = async () => MOCK, show = async () => true, seed = 7, guideUrl = null, initial = null } = {}) {
  const said = [];
  const pins = [];
  const shown = [];
  const steps = [];
  const stored = new Map();
  const snaps = [];
  const progress = [];
  let begun = 0;
  const talks = [];
  const personas = [];
  let offered = [];
  let done = false;
  const fr = new FirstRun({
    guide,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(seed)), ...(initial ? { initial } : {}) },
    pin: (p) => pins.push(p),
    guideUrl,
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
    showCharacter: async (c) => {
      shown.push(c?.id);
      return show(c);
    },
    onStep: (n) => steps.push(n),
    onPersona: (s, c) => personas.push({ s, c }),
    save: (s) => snaps.push(s),
    progress: (s) => progress.push(s),
    onBegin: () => {
      begun += 1;
    },
    onDone: () => {
      done = true;
    },
  });
  return {
    fr, said, steps, stored, snaps, progress,
    get begun() { return begun; }, talks, personas, pins, shown,
    get offered() { return offered.map((a) => a.id); },
    get offeredAll() { return offered; },
    get labels() { return offered.map((a) => a.label); },
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
  assert.ok(h.texts('guide').includes('見本の中に、近い子が いたよ!'), '見本だと言ってから出す(だまって選ばない)');
  assert.ok(h.texts('guide').includes('ちょうちんくんだよ。この子は どうかな?'), '見本は「できたよ」と言わない');
  assert.deepEqual(h.shown, ['d_lantern'], '舞台に出すのは 1 回(その場で入れ替える)');
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
  assert.ok(h.texts('note').some((t) => t.includes('おためしの あたま')), '仮の頭脳だと、子どもの言葉で出す');

  await h.fr.act('to_retro');
  assert.equal(h.fr.step, 6);
  assert.ok(h.texts('guide').includes('まだ 声が出せないから、文字と レトロな音で 話すね。'));
  await h.fr.act('say', { text: '好きな食べ物はなに?' });
  assert.equal(h.talks.at(-1).text, '好きな食べ物はなに?');
  assert.equal(h.fr.history.length, 4);

  await h.fr.act('to_voice');
  assert.equal(h.fr.step, 7);
  assert.deepEqual(h.offered, ['key', 'later']);
  assert.ok(h.texts('note').includes('かぎは この スマホの 中だけで 使うよ。声を だすと、文字が 声の会社に 送られて、お金が かかるよ。'), '何をどこへ送るかを、子どもの言葉で鍵の前に出す(OL1f)');
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

test('絵の入口(見本の道): 人の絵なら「ゆるキャラにしてみる?」。この画面では作れないと正直に言い、主役はだまって出さない(D1・D3)', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('pick', { url: 'blob:fake', name: 'face.png' });
  assert.equal(h.fr.step, 2);
  assert.equal(h.said.find((l) => l.who === 'user').img, 'blob:fake');
  assert.deepEqual(h.pins, [{ img: 'blob:fake', caption: '選んだ絵' }], '選んだ絵は札の上に出したまま(D3)');
  assert.deepEqual(h.offered, ['kind_yuru', 'kind_human', 'kind_complex']);
  await h.fr.act('kind_human');
  assert.ok(h.texts('guide').includes('人の絵なんだね。ゆるキャラに してみる?'));
  assert.ok(h.texts('note').some((t) => t.includes('どんな写真でも きれいに できるわけでは ないよ')));
  assert.deepEqual(h.offered, ['yurufy', 'other']);
  await h.fr.act('yurufy');
  assert.equal(h.fr.character, null, '絵と関係の無い子を「できた子」にしない');
  assert.equal(h.fr.step, 3);
  assert.ok(h.texts('guide').includes('じゃあ、見本の子で ためしてみよう!'), '見本の子で ためす道を出す');
  assert.equal(h.texts('note').filter((t) => t.includes('パソコンの Claude Code で するよ')).length, 1, '写真や絵の道の限界は、やさしく 1 回だけ言う(OL1)');
  assert.deepEqual(h.offered, ['use_guide', 'choose_sample', 'again']);
  assert.equal(h.pins.length, 1, '絵は出したまま');
  assert.equal(h.fr.input.yurufy, true);
  assert.equal(h.fr.snapshot().words, null, '絵の住所は残さない');
  assert.ok(!JSON.stringify(h.fr.snapshot()).includes('blob:'));
  await h.fr.act('use_guide');
  assert.equal(h.fr.character.id, MAIN.id, '使う人が選んだ時だけ主役で続ける');
  assert.ok(h.texts('guide').includes('じゃあ、ノリーで つづけマス! 性格や あいさつを ためしてくだサイ。'), '主役は自分のことも「ノリー」と呼ぶ');
  assert.equal(h.fr.character.sample, true);
  assert.ok(h.texts('note').some((t) => t.startsWith(`見本: ${MAIN.name}(協力者が手で描いた絵から`)), '主役も見本の子だと書く');
  assert.equal(h.fr.step, 4, '主役は 3 歩目の「この子はどうかな?」をとばして性格へ');
  assert.ok(!h.texts('guide').includes(`${MAIN.name}だよ。この子は どうかな?`), '案内役が自分を「できた子」として紹介しない');
});

test('こまかい絵 → 別の絵にする → 1 歩目に戻る。古いボタンと 2 回押しは捨てる', async () => {
  const h = harness();
  await h.fr.start();
  assert.equal(await h.fr.act('keep'), false, '今出していないボタンは効かない');
  await h.fr.act('photo', { url: 'blob:x' });
  await h.fr.act('kind_complex');
  assert.ok(h.texts('guide').includes('いろんな物が うつってるね。主役を 1 つ えらんで 描きなおす?'));
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
  assert.ok(h.texts('guide').includes('ゆるキャラに ぴったりの絵だね。この絵から 作るよ。'));
  await h.fr.act('next_meet');
  assert.ok(h.texts('guide').includes('こんな子が できたよ。どうかな?'));
  const long = 'あ'.repeat(NOTE_MAX + 10);
  await h.fr.act('fix', { text: long });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].decision, 'redo');
  assert.equal([...reviews[0].note].length, NOTE_MAX);
  assert.ok(h.texts('guide').some((t) => t.startsWith('パソコンの Claude Code に つたえたよ')));
});

test('鍵が違う → もう一度。あとで → 文字で話す。鍵の受け口が無い → 正直に言う', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'ねこ' });
  await h.fr.act('use_guide');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('key', { key: 'bad-key' });
  assert.equal(h.texts('char').at(-1), 'うまくいかなかったみたい。');
  assert.deepEqual(h.offered, ['key', 'later']);
  assert.equal(h.labels[1], 'かぎなしで つづける', '札の右上の「あとで」(会話ごと閉じる)と同じ名前にしない');
  await h.fr.act('later');
  assert.equal(h.texts('char').at(-1), 'じゃあ、文字とレトロな音で話そうね。');

  const n = harness({ voice: { canTakeKey: () => false } });
  await n.fr.start();
  await n.fr.act('words', { text: 'ねこ' });
  await n.fr.act('use_guide');
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
  assert.ok(r.texts('guide').includes('ロボくんだよ。この子は どうかな?'));
  assert.deepEqual(r.offered, ['keep', 'fix', 'again']);
  const bad = harness();
  await bad.fr.resume({ v: 99 });
  assert.equal(bad.fr.step, 1, '形の違う控えは捨てて、はじめから');
});

test('見本えらび: 言葉に当たる子だけ。当たらなければ null(だまって別の子を出さない。D1)', async () => {
  assert.equal(pickSample('ちょうちん').id, 'd_lantern');
  assert.equal(pickSample('ＬＥＤのパネル').id, 'f_led');
  assert.equal(pickSample('ふしぎな くも'), null);
  assert.equal(pickSample('空を飛ぶペンギンの郵便屋さん'), null);
  const c = createSampleCreator({ main: MAIN });
  assert.equal(await c.make({ from: 'picture', url: 'blob:x' }), null, '絵はこの画面では作れない(見本を出さない)');
  assert.equal(await c.make({ from: 'words', words: 'ねこ' }), null);
  assert.deepEqual(c.list().map((x) => x.id), SAMPLE_CHARACTERS.map((x) => x.id));
  assert.equal(c.main().id, MAIN.id);
});

test('D1: 当たらない言葉は、だまって見本を出さない。正直に言い、作り方と自分で選ぶ道を出す', async () => {
  const h = harness({ guideUrl: 'https://example.org/readme#make' });
  await h.fr.start();
  assert.deepEqual(h.offered, ['photo', 'pick', 'words'], '1 歩目の押す札は 1 段(パソコンでの作り方は、見本がいない時に出す。OL1)');
  await h.fr.act('words', { text: '空を飛ぶペンギンの郵便屋さん' });
  assert.equal(h.fr.step, 3);
  assert.equal(h.fr.character, null);
  assert.deepEqual(h.shown, [], '舞台を替えない');
  assert.ok(h.texts('guide').includes('ごめんね。見本の中に、近い子が いないんだ。'));
  assert.ok(!h.texts('guide').some((t) => t.includes('連れてきたよ')), '「近い子を連れてきたよ」と言わない');
  const steps = h.texts('note').find((t) => t.startsWith('あたらしい子は'));
  assert.equal(steps, MAKE_STEPS);
  assert.ok(steps.includes('パソコンの Claude Code で つくれるよ'), steps);
  assert.ok(!/serve_review|yuru-next|README|スキル|make-character|--/.test(steps), '子どもの画面に開発の言葉を出さない(中 9)');
  assert.ok(!/https?:\/\//.test(steps), '画面のコードに外の住所を書かない');
  assert.deepEqual(h.offered, ['use_guide', 'choose_sample', 'readme', 'again']);
  const readme = h.offeredAll.find((a) => a.id === 'readme');
  assert.deepEqual([readme.kind, readme.url], ['link', 'https://example.org/readme#make'], 'README の節へ 1 回で飛ぶ');
  assert.equal(h.offeredAll.find((a) => a.id === 'again').label, 'やりなおす');
  await h.fr.act('choose_sample');
  assert.deepEqual(h.offered, [...SAMPLE_CHARACTERS.map((s) => `s_${s.id}`), 'again']);
  await h.fr.act('s_robo');
  assert.equal(h.fr.character.id, 'robo');
  assert.deepEqual(h.shown, ['robo']);
  assert.ok(h.texts('guide').includes('ロボくんだよ。この子は どうかな?'));
  assert.deepEqual(h.offered, ['keep', 'fix', 'again']);
});

test('D2: 見本の「直したい」は行き止まりにしない(ここで変えられる物と、PC で直す道を言う)', async () => {
  const h = harness({ guideUrl: 'https://example.org/readme#make' });
  await h.fr.start();
  await h.fr.act('words', { text: '赤い提灯の子' });
  await h.fr.act('fix');
  assert.ok(h.texts('guide').some((t) => t.includes('性格と話し方は、次のステップで変えられる')));
  assert.ok(h.texts('note').some((t) => t.includes('パソコンの Claude Code で 作った子なら')));
  assert.deepEqual(h.offered, ['keep', 'readme', 'again']);
  assert.equal(h.offeredAll[0].label, 'この子で 性格を きめる');
  await h.fr.act('keep');
  assert.equal(h.fr.step, 4);
  const noLink = harness();
  await noLink.fr.start();
  await noLink.fr.act('words', { text: 'みかん' });
  await noLink.fr.act('fix');
  assert.deepEqual(noLink.offered, ['keep', 'again'], 'README の住所が無い時はリンクを出さない');
});

test('D3: 選んだ絵は札に出したまま。やり直すと消す', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('photo', { url: 'blob:p1', name: 'a.jpg' });
  assert.deepEqual(h.pins.at(-1), { img: 'blob:p1', caption: '撮った写真' });
  await h.fr.act('kind_yuru');
  assert.equal(h.fr.character, null);
  assert.ok(!h.texts('guide').some((t) => t.includes('ぴったりの絵')), '絵を見ていないので、ほめない(P1)');
  assert.ok(h.texts('guide').includes('ゆるキャラなんだね。教えてくれてありがとう。'));
  assert.ok(!h.texts('guide').some((t) => t.includes('この絵から作るよ')), '見本の道では「この絵から作るよ」と言わない');
  assert.ok(h.texts('note').some((t) => t.includes('写真を見ないで')), '見る前に、見ないと正直に言う(撮った写真を絵と呼ばない)');
  assert.ok(h.texts('guide').includes('この写真は、どれに近い?'));
  assert.equal(h.offeredAll.find((a) => a.id === 'again').aria, 'やりなおす(べつの写真にする)');
  await h.fr.act('again');
  assert.equal(h.pins.at(-1), null);
  assert.equal(h.fr.step, 1);
});

test('4 歩目: 人格の文に性格があれば、その性格で始める(くじ引きにしない)。無ければおまかせ', async () => {
  const calm = normalize({ preset: 'calm', tone: 'own', energy: 2, length: 'normal' });
  const h = harness({ initial: (c) => (c?.id === 'd_lantern' ? calm : null) });
  await h.fr.start();
  await h.fr.act('words', { text: '提灯' });
  await h.fr.act('keep');
  assert.deepEqual(h.fr.settings, calm);
  assert.ok(h.texts('guide').includes('この子、少しおっとりさんみたい!'));
  await h.fr.act('persona_roll');
  assert.ok(h.texts('guide').some((t) => t.startsWith('うーん…この子、')), 'もう一度ひくは、おまかせのまま');
});

test('D4: 終わる時、見本の子なら「舞台は主役に戻る」と言う', async () => {
  const h = harness({ voice: { canTakeKey: () => false } });
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('close');
  assert.equal(h.done, true);
  assert.ok(h.texts('note').includes(`ロボくんは、舞台に立ったままだよ。${MAIN.name}にもどしたい時は、「${MAIN.name}にもどす」を押してね。`), 'Q-0111: 選んだ子は舞台に残る');
  assert.deepEqual(h.offered, ['begin'], '自動で閉じず、「はじめる」を出す(中 5)');
  const g = harness({ voice: { canTakeKey: () => false } });
  await g.fr.start();
  await g.fr.act('words', { text: 'ねこ' });
  await g.fr.act('use_guide');
  await g.fr.act('persona_ok');
  await g.fr.act('to_retro');
  await g.fr.act('to_voice');
  await g.fr.act('close');
  assert.ok(!g.texts('note').some((t) => t.startsWith('舞台は')), '主役のままなら言わない');
});

// ?character=<id> で開いた時は、その子が案内役(CRITux2 高 1)。見本の道の「〜で続きを試す」もその子で、説明はその子の物。
// 見本の一覧は、案内役を入れず、主役を先頭に入れる(主役は「〜で続きを試す」に出ないため)
test('?character=<id> の子が案内役: 名乗り・「〜で続きを試す」・見本の一覧・終わりの文', async () => {
  const lead = { id: 'mikan', name: 'みかんちゃん' };
  const c = createSampleCreator({ main: () => lead });
  const mikan = SAMPLE_CHARACTERS.find((s) => s.id === 'mikan');
  assert.deepEqual(c.main(), { id: 'mikan', name: 'みかんちゃん', sample: true, note: mikan.note, guide: true });
  assert.deepEqual(c.list().map((x) => x.id), [MAIN.id, ...SAMPLE_CHARACTERS.filter((s) => s.id !== 'mikan').map((s) => s.id)]);
  assert.equal(c.list()[0].note, MAIN_NOTE);
  assert.equal(createSampleCreator({ main: { id: 'tameshi', name: 'ためし' } }).main().note, OTHER_NOTE, '一覧にない子は「Claude Code で作った子」');
  assert.equal(createSampleCreator({ main: MAIN }).main().note, MAIN_NOTE);

  const h = harness({ creator: c, guide: lead });
  await h.fr.start();
  assert.match(h.texts('guide')[0], /^はじめまして。みかんちゃんだよ。/);
  assert.ok(!h.texts('guide').join('').includes('ノリー、'), '主役の口調で名乗らない');
  await h.fr.act('words', { text: '空を飛ぶペンギンの郵便屋さん' });
  assert.deepEqual(h.offered, ['use_guide', 'choose_sample', 'again']);
  assert.equal(h.offeredAll[0].label, 'みかんちゃんで ためす');
  await h.fr.act('use_guide');
  assert.ok(h.texts('note').includes(`見本: みかんちゃん(${mikan.note})`), h.texts('note').join(' / '));
  assert.ok(h.texts('guide').includes('じゃあ、みかんちゃんで つづけるね。'));
  assert.deepEqual(h.shown, ['mikan'], '舞台に出すのは案内役(もう舞台にいる子)');
  assert.equal(h.fr.step, 4);
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('later');
  await h.fr.act('close');
  assert.ok(!h.texts('note').some((t) => t.startsWith('舞台は')), '案内役の子のまま終わる時は「舞台は〜に戻ります」と言わない');
});

// ---- QF4: 途中経過・続き・終わり ----
test('QF4 高 1: 歩みごとに途中経過を残し、読み込み直した後は、その歩みから続く(1 歩目に戻らない)', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  assert.deepEqual([...new Set(h.progress.map((p) => p.step))], [1, 3, 4, 5], '歩みごとに残す');
  const last = h.progress.at(-1);
  assert.equal(last.character.id, 'robo');
  assert.ok(last.settings, '性格も残す');
  // 読み込み直した後(別の台本が、残した途中経過から続ける)
  const g = harness();
  await g.fr.resume({ ...last, reload: true });
  assert.equal(g.fr.step, 5, '5 歩目から続く');
  assert.equal(g.fr.character.id, 'robo');
  assert.ok(g.texts('guide').some((t) => t.includes('さっきの つづきからだよ')));
  assert.ok(!g.texts('guide').includes('どんな子を生み出そうか?'), '1 歩目に戻さない');
  assert.deepEqual(g.offered, ['to_retro']);
});

test('OL1f: 子を選ぶ前の 3 歩目(見本が出ただけ)で読み込み直しても、同じ言葉で 3 歩目から続く', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  const snap = JSON.parse(JSON.stringify({ ...h.progress.find((p) => p.step === 3), reload: true, character: null }));
  assert.equal(snap.words, 'ロボ');
  const g = harness();
  await g.fr.resume(snap);
  assert.equal(g.fr.step, 3, '1 歩目に戻らない');
  assert.ok(g.texts('guide').some((t) => t.includes('さっきの つづきからだよ')));
  assert.equal(g.fr.character.id, 'robo', '同じ言葉で見本を出し直す');
});

test('OL1f: 決めたことの 1 行と 7 歩目の説明は、子どもが読める言葉(元気さ・レトロ音・ElevenLabs・かぎは なし を出さない)', async () => {
  const h = harness({ voice: { canTakeKey: () => false } });
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('close');
  const all = h.texts('note').concat(h.texts('guide'), h.texts('char')).join(' / ');
  assert.ok(!/ElevenLabs|元気さ|レトロ音|かぎは なし/.test(all), all);
  assert.ok(h.texts('note').some((t) => /^きめたこと: ロボくん・性格「.*げんき \d.*文字と おと」$/.test(t)), h.texts('note').join('|'));
});

test('QF4 中 5: 最後まで行っても札を自動で閉じない。決めたことと「はじめる」を出し、押した時だけ閉じる', async () => {
  const h = harness({ voice: { canTakeKey: () => false } });
  await h.fr.start();
  await h.fr.act('words', { text: 'ロボ' });
  await h.fr.act('keep');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('close');
  assert.equal(h.done, true);
  assert.equal(h.begun, 0, 'まだ閉じない');
  assert.ok(h.texts('note').some((t) => t.startsWith('きめたこと: ロボくん・性格「')), '決めたこと(子・性格)を見せる');
  assert.deepEqual(h.offered, ['begin']);
  assert.equal(await h.fr.act('begin'), true);
  assert.equal(h.begun, 1, '「はじめる」で閉じる');
});

test('QF4 低 14: 空の鍵は「かぎが からっぽだよ」と言う。ことばから作る時は、チェックをとばす理由を言う', async () => {
  const h = harness();
  await h.fr.start();
  await h.fr.act('words', { text: 'ねこ' });
  assert.ok(h.texts('note').some((t) => t.includes('チェックは とばすよ')));
  await h.fr.act('use_guide');
  await h.fr.act('persona_ok');
  await h.fr.act('to_retro');
  await h.fr.act('to_voice');
  await h.fr.act('key', { key: '   ' });
  assert.ok(h.texts('note').includes('かぎが からっぽだよ。かぎを入れてね。'));
  assert.deepEqual(h.offered, ['key', 'later'], 'もう一度入れられる');
});
