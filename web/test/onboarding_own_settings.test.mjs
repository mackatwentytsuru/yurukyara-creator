// 性格の画面を開いた時の設定(司令塔の決め D6・CRITux 11)。画面なし(編集ごとの試験に入る)。
// - 性格の画面は、覚えた設定か、その子の人格の文(persona.md)に書いてある性格で開く(くじ引きにしない)
// - 話し方が人格の文で決まっている子(主役ノリー・話し方の手本の節がある子)は、口調の列を止める(fixesOwnSpeech)
// - 見本の子は、どれも persona.md に話し方が書いてある(入口 index.js が、人格の文を読めない時も「この子の話し方」とみなす根拠)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composePersona, definesOwnSpeech, fixesOwnSpeech, normalize, ownSettings, personalityOf, summary } from '../src/ui/persona/settings.js';
import { SAMPLE_CHARACTERS } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const persona = (id) => readFileSync(join(import.meta.dirname, '..', '..', 'characters', id, 'persona.md'), 'utf8');

test('主役ノリーの性格の画面は「おっとり・この子の話し方・元気さ 2」で開く(人格の文の「性格: おっとり」)', () => {
  const text = persona(MAIN.id);
  assert.equal(personalityOf(text), 'calm');
  assert.equal(personalityOf(text.replace(/\n/g, '\r\n')), 'calm', 'CRLF の写しでも同じ');
  const s = ownSettings(text, { ownSpeech: definesOwnSpeech(text) });
  assert.deepEqual(s, normalize({ preset: 'calm', tone: 'own', energy: 2, length: 'normal' }));
  assert.equal(summary(s), 'おっとり・この子の話し方・元気さ 2・ふつう・文字とレトロ音');
  assert.equal(fixesOwnSpeech(MAIN.id, { persona: text, mainId: MAIN.id }), true, '主役の口調の列は止める');
  assert.equal(fixesOwnSpeech(MAIN.id, { persona: '', mainId: MAIN.id }), true, '人格の文が届く前でも');
});

test('見本の子: 人格の文に話し方があり(おまかせは own)、口調は使う人が選べる。性格は人格の文から', () => {
  const want = { mikan: 'genki', d_lantern: 'calm', robo: 'calm', f_led: 'calm', yokoso: 'calm' };
  for (const c of SAMPLE_CHARACTERS) {
    const text = persona(c.id);
    assert.equal(definesOwnSpeech(text), true, `${c.id}: persona.md に話し方の行がある`);
    assert.equal(fixesOwnSpeech(c.id, { persona: text, mainId: MAIN.id }), false, `${c.id}: 口調は選べる`);
    assert.equal(personalityOf(text), want[c.id], c.id);
    assert.equal(ownSettings(text, { ownSpeech: true }).tone, 'own');
  }
});

test('性格の読み方: 「性格:」の行が先。無ければ文の全体。書いていなければ null(4 歩目はおまかせ)', () => {
  assert.equal(personalityOf('# 子\n- 性格: 恥ずかしがり屋。でも元気。'), 'shy', '「性格:」の行で、上の順(恥ずかしがり → いたずら → 元気 → おっとり)');
  assert.equal(personalityOf('# 子\n- 話し方: はずむように。\n- 性格: いたずら好き'), 'mischief', '「性格:」の行が文の全体より先');
  assert.equal(personalityOf('# 子\n明るく話す子。'), 'genki');
  assert.equal(personalityOf('# 子\n好きなことはひなたぼっこ。'), null);
  assert.equal(personalityOf(''), null);
  assert.equal(ownSettings('# 子\n好きなことは歌。', { ownSpeech: false }).preset, 'calm', '書いていない時の性格の画面は、おっとりの基本で開く');
  assert.equal(ownSettings('# 子\n好きなことは歌。', { ownSpeech: false, fallback: null }), null);
  // 画面が足した設定の節(「# 性格と話し方」)は、その子の性格として読まない
  assert.equal(personalityOf(composePersona('# 子\n好きなことは歌。', normalize({ preset: 'genki' }))), null);
  assert.equal(fixesOwnSpeech('kid', { persona: '# 子\n\n## 話し方の例\n- 「好き」→「りんご!」', mainId: MAIN.id }), true, '話し方の手本の節がある子は止める');
  assert.equal(fixesOwnSpeech('kid', { persona: '# 子\n- 話し方: やさしく', mainId: MAIN.id }), false);
  assert.equal(fixesOwnSpeech(null, { persona: '## 話し方の例', mainId: MAIN.id }), false);
});
