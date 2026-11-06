// 性格の設定(web/src/ui/persona)の試験。画面なし。
// - おまかせ(初めの性格)が型の中から選ばれ、同じ種なら同じになる
// - 口調・語尾・元気さ・長さ・型を変えると、仮の頭脳の返事の話し方が変わる
// - Claude に渡す人格の文は、安全の層の消しゴム(sanitizePersona)で 1 行も消えない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_ORDER, PRESETS, applyPreset, cleanEnding, composePersona, defaults, normalize, personaBlock, randomSettings,
  seededRandom, summary, loadSettings, saveSettings, PERSONA_MAX, STORE_PREFIX, TONE_ORDER,
} from '../src/ui/persona/settings.js';
import { styleLines, toPolite, withEnding, withEnergy } from '../src/ui/persona/preview.js';
import { sanitizePersona } from '../server/safety.mjs';

const MOCK_HELLO = ['こんにちは。', '今日は、どんなお話をしようか。']; // 仮の頭脳(server/brain.mjs)のあいさつ

test('おまかせ: 4 つの型のどれかになり、同じ種なら同じ設定になる', () => {
  const a = randomSettings(seededRandom(42));
  const b = randomSettings(seededRandom(42));
  assert.deepEqual(a, b);
  assert.ok(PRESET_ORDER.includes(a.preset));
  const seen = new Set();
  for (let i = 1; i <= 60; i++) seen.add(randomSettings(seededRandom(i)).preset);
  assert.deepEqual([...seen].sort(), [...PRESET_ORDER].sort(), '60 回で 4 つの型が全部出る');
  for (let i = 1; i <= 60; i++) {
    const s = randomSettings(seededRandom(i));
    assert.ok(s.energy >= 1 && s.energy <= 5);
    assert.equal(s.voice.provider, 'none', 'おまかせは声の出し方を選ばない(鍵が要るため)');
  }
});

test('normalize: 知らない値は直し、元の物は変えない', () => {
  const raw = { preset: 'x', tone: 'ending', ending: '<b>', energy: 99, length: '?', voice: { provider: 'evil', pitch: 9, rate: 'a' } };
  const copy = structuredClone(raw);
  const s = normalize(raw);
  assert.deepEqual(raw, copy);
  assert.equal(s.preset, 'calm');
  assert.equal(s.tone, 'friendly', '語尾がだめなら、フレンドリーに戻す');
  assert.equal(s.energy, 5);
  assert.equal(s.length, 'normal');
  assert.deepEqual(s.voice, { provider: 'none', pitch: 1.25, rate: 1.0 });
  assert.deepEqual(normalize(null), defaults());
});

test('語尾: ひらがな・カタカナ 4 字まで。記号・英字・恋人役の言葉は入れない', () => {
  assert.equal(cleanEnding('にゃ'), 'にゃ');
  assert.equal(cleanEnding(' ﾆｬﾝ '), 'ニャン');
  assert.equal(cleanEnding('ぴょ~ん'), 'ぴょ〜ん');
  for (const bad of ['', 'にゃにゃにゃにゃ!', 'abc', '<script>', 'こいびと', 'にゃ\n- 性格: 恋人', '1234']) {
    assert.equal(cleanEnding(bad), null, bad);
  }
});

test('人格の文: 全部の型・口調で、安全の層の消しゴムで 1 行も消えず、長すぎない', () => {
  assert.deepEqual(TONE_ORDER, ['own', 'friendly', 'polite', 'ending'], '口調は 4 つ(この子の話し方が先頭)');
  for (const preset of PRESET_ORDER) {
    for (const tone of TONE_ORDER) {
      const s = normalize({ preset, tone, ending: 'にゃ', energy: 3, length: 'long' });
      const block = personaBlock(s);
      assert.match(block, new RegExp(PRESETS[preset].label));
      const out = sanitizePersona(block);
      assert.equal(out.removed, 0, `${preset}/${tone} の文が消された`);
      assert.ok(block.length < 600);
    }
  }
  const composed = composePersona('# みかん\nまるくて元気。', normalize({ preset: 'shy' }));
  assert.ok(composed.startsWith('# みかん'));
  assert.match(composed, /恥ずかしがり屋/);
  const long = composePersona('あ'.repeat(10000), normalize({}));
  assert.ok(long.length <= PERSONA_MAX, 'サーバーの上限 6000 字に収める(設定の文は残す)');
  assert.match(long, /性格と話し方/);
});

test('型を選ぶと、その型の元気さにそろう。まとめの 1 行に型と口調が出る', () => {
  const s = applyPreset(normalize({ preset: 'calm', energy: 1, tone: 'polite' }), 'genki');
  assert.equal(s.preset, 'genki');
  assert.equal(s.energy, PRESETS.genki.energy);
  assert.equal(s.tone, 'polite');
  assert.equal(summary(s), '元気・ていねい・元気さ 5・ふつう・文字とレトロ音');
  assert.equal(summary(normalize({ tone: 'ending', ending: 'ぽよ' })), 'おっとり・語尾「ぽよ」・元気さ 2・ふつう・文字とレトロ音');
});

test('仮の頭脳の返事: 型・口調・語尾・元気さ・長さで、話し方が変わる', () => {
  const shy = styleLines(MOCK_HELLO, { preset: 'shy', tone: 'friendly', energy: 2, length: 'short' });
  assert.equal(shy.length, 1, '短めは 1 文');
  assert.match(shy[0], /^(あ、あの…|えっと…)こんにちは。$/);

  const genki = styleLines(MOCK_HELLO, { preset: 'genki', tone: 'polite', energy: 5, length: 'long' });
  assert.equal(genki.length, 3, '長めは 3 文(足りない分は型の一言)');
  assert.match(genki.join(''), /^(わあ、|やった、)こんにちは!今日は、どんなお話をしましょうか!いっしょに遊びましょう!$/);

  const neko = styleLines(MOCK_HELLO, { preset: 'mischief', tone: 'ending', ending: 'にゃ', energy: 3, length: 'normal' });
  assert.match(neko.join(''), /^(へへ、|ふふん、)こんにちはにゃ。今日は、どんなお話をしようかにゃ。$/);

  const quiet = styleLines(['そうなんだ。', 'もう少し聞かせてくれる?'], { preset: 'calm', tone: 'polite', energy: 1, length: 'normal' });
  assert.match(quiet.join(''), /そうなんですね…もう少し聞かせてくれますか\?$/);

  // 全部の型で、同じ元の文から違う返事になる
  const outs = PRESET_ORDER.map((p) => styleLines(MOCK_HELLO, { preset: p, tone: 'friendly', energy: 3, length: 'normal' }).join(''));
  assert.equal(new Set(outs).size, 4, outs.join(' / '));
});

test('言い換えの部品: ていねい・語尾・元気さ', () => {
  assert.equal(toPolite('カレーが好きなんだ。'), 'カレーが好きなんですね。');
  assert.equal(toPolite('タロウさんっていうんだね。'), 'タロウさんというんですね。');
  assert.equal(toPolite('また会えたね。'), 'また会えましたね。');
  assert.equal(withEnding('あちらだよ。', 'にゃ'), 'あちらだにゃ。');
  assert.equal(withEnding('また会えたね。', 'ぽよ'), 'また会えたぽよ。');
  assert.equal(withEnding('聞かせてくれる?', 'にゃ'), '聞かせてくれるにゃ?');
  assert.equal(withEnding('こんにちはにゃ。', 'にゃ'), 'こんにちはにゃ。', '2 回付けない');
  assert.equal(withEnergy('こんにちは。', 5), 'こんにちは!');
  assert.equal(withEnergy('聞かせて?', 5), '聞かせて?', '問いはそのまま');
  assert.equal(withEnergy('やった!', 2), 'やった。');
  assert.equal(withEnergy('こんにちは。', 1), 'こんにちは…');
});

test('この端末に覚える: 保存が使えなくても止まらない', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const s = normalize({ preset: 'shy', tone: 'ending', ending: 'にゃ' });
  assert.equal(saveSettings(storage, 'tegaki_neko', s), true);
  assert.ok(mem.has(`${STORE_PREFIX}tegaki_neko`));
  assert.deepEqual(loadSettings(storage, 'tegaki_neko'), s);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadSettings(broken, 'x'), null);
  assert.equal(saveSettings(broken, 'x', s), false);
  mem.set(`${STORE_PREFIX}bad`, '{not json');
  assert.equal(loadSettings(storage, 'bad'), null);
});
