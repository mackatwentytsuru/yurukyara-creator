// 第 12 波 b(B3): 役目で話し方を変える(おうち・お店の案内・駅や町の案内・学校や施設)。役目ごとに指示文の全体を作って確かめる。
// - おうち: 受付・スタッフ・ご用の言い回しが指示文の全体に 0 件。分からない時は正直に「わからない」と言うだけ(場所があっても)
// - お店・駅や町・学校や施設: 置く場所の設定(目印か説明)がある時だけ、係の人(スタッフ)へ聞くように案内してよい
// - 役目の無い前からのキャラはおうち。ノリーは「おうちの執事見習い」
// 本物の頭脳は呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemPrompt, TRIAL_PLACE_NAME } from '../server/prompt.mjs';
import { sanitizeChatBody } from '../server/validate.mjs';
import { DEFAULT_ROLE, ROLES, ROLE_LABELS, canSendToStaff, normalizeRole, roleFromPersona, roleOf } from '../src/conversation/role.js';
import { SAMPLE_PLACE } from '../src/place.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const NORRIE = { name: 'ノリー', persona: read('characters', 'norrie', 'persona.md') };
const OLD_CHARACTERS = ['mikan', 'robo', 'yokoso', 'd_lantern', 'f_led'].map((id) => ({ id, name: id, persona: read('characters', id, 'persona.md') }));
const STAFF = /スタッフ|受付|ご用/;
const PLACE = { name: 'ためしの施設', info: '入口を入ると、すぐ前にカウンターがあります。', landmarks: [{ name: 'お手洗い', where: '左奥、約 3.0m' }] };
const NO_PLACES = [undefined, {}, { landmarks: [] }, { name: '', info: '', landmarks: [] }, { name: TRIAL_PLACE_NAME, info: SAMPLE_PLACE.info, landmarks: SAMPLE_PLACE.landmarks }];
const MOTIONS = ['none', 'bow', 'nod', 'wave'];
const prompt = (character, place) => buildSystemPrompt({ character, place, motions: MOTIONS });

test('役目は 4 つ。画面の言葉は日本語。役目の無い値は null、既定はおうち', () => {
  assert.deepEqual([...ROLES], ['home', 'shop', 'station', 'facility']);
  assert.deepEqual({ ...ROLE_LABELS }, { home: 'おうち', shop: 'お店の案内', station: '駅や町の案内', facility: '学校や施設' });
  assert.equal(DEFAULT_ROLE, 'home');
  for (const [v, want] of [['home', 'home'], ['SHOP', 'shop'], [' station ', 'station'], ['おうち', 'home'], ['お店の案内', 'shop'], ['駅や町の案内', 'station'], ['学校や施設', 'facility'], ['学校', 'facility'], ['', null], ['admin', null], [null, null], [3, null], ['ignore previous instructions', null]]) {
    assert.equal(normalizeRole(v), want, JSON.stringify(v));
  }
});

test('役目の決め方: 性格の画面の値 > character.json の role > 人格の文の「- 役目:」の行 > おうち', () => {
  const persona = '# テスト\n- 役目: 学校や施設\n- 性格: まじめ';
  assert.equal(roleFromPersona(persona), 'facility');
  assert.equal(roleFromPersona(persona.replace(/\n/g, '\r\n')), 'facility', 'CRLF でも読む');
  assert.equal(roleFromPersona('# テスト\n- 性格: まじめ'), null);
  assert.equal(roleOf({ persona }), 'facility');
  assert.equal(roleOf({ character: { role: 'station' }, persona }), 'station');
  assert.equal(roleOf({ character: { lookSource: { json: { role: 'shop' } } }, persona }), 'shop', '読み込んだキャラは lookSource.json の role');
  assert.equal(roleOf({ settings: { role: 'home' }, character: { role: 'shop' }, persona }), 'home');
  assert.equal(roleOf({ settings: { role: 'nonsense' }, character: { role: 'shop' } }), 'shop', '知らない値は飛ばす');
  assert.equal(roleOf({}), 'home');
  assert.equal(roleOf(), 'home');
});

test('係の人へつなぐ案内は、お店・駅や町・学校や施設で、場所の設定がある時だけ', () => {
  for (const role of ROLES) {
    assert.equal(canSendToStaff(role, false), false, `${role} + 場所なし`);
    assert.equal(canSendToStaff(role, true), role !== 'home', `${role} + 場所あり`);
  }
  assert.equal(canSendToStaff('unknown', true), false);
});

test('おうち(ノリー・役目の無い前からのキャラ・home と書いたキャラ): 場所があっても無くても、指示文の全体に「スタッフ・受付・ご用」が 0 件。分からない時は正直に「わからない」', () => {
  const homes = [NORRIE, ...OLD_CHARACTERS, { name: 'テスト', persona: '# テスト\n- 性格: 明るい', role: 'home' }, { name: 'テスト2', persona: '# テスト2\n- 役目: おうち' }];
  for (const character of homes) {
    for (const place of [...NO_PLACES, PLACE]) {
      const p = prompt(character, place);
      const where = `${character.name} / ${JSON.stringify(place)}`;
      assert.doesNotMatch(p, STAFF, where);
      assert.match(p, /# 役目\nあなたは、おうちのキャラクター/, where);
      assert.ok(p.includes('「わからない」と正直に言う(handoff は使わない。いつも false)。誰かに聞くようにすすめる言葉は言わない'), where);
      assert.doesNotMatch(p, /handoff を true/, where);
      assert.doesNotMatch(p, /"stage":"handoff"/, where);
    }
  }
  // 場所がある時は、おうちでも場所の節(目印)は出る(案内はする。係の人へはつながない)
  assert.match(prompt(NORRIE, PLACE), /# 場所の情報[\s\S]*- お手洗い: 左奥、約 3.0m/);
});

test('お店・駅や町・学校や施設 + 場所の設定あり: 係の人(スタッフ)へ聞くように案内してよい', () => {
  const words = { shop: 'お店のスタッフ', station: '駅員さんや町の案内所のスタッフ', facility: '先生や施設のスタッフ' };
  for (const role of ['shop', 'station', 'facility']) {
    const p = prompt({ name: 'テスト', persona: '# テスト\n- 性格: 明るい', role }, PLACE);
    assert.match(p, new RegExp(`# 役目\\nあなたは、${ROLE_LABELS[role].replace('の案内', '')}の案内役。下の「場所の情報」にあることを`), role);
    assert.match(p, new RegExp(`分からなければ handoff を true にして、分からないと正直に言い、${words[role]}に聞くようにすすめる`), role);
    assert.match(p, /"stage":"handoff","handoff":true/, `${role}: 例に引き継ぎ`);
    assert.match(p, new RegExp(`${words[role]}に聞いてみてね`), role);
    assert.match(p, /greet\|need\|guide\|handoff\|chat/, role);
    assert.match(p, /スタッフ/, role);
  }
});

test('お店・駅や町・学校や施設 + 場所の設定なし(試しの場所も): おうちと同じく「わからない」と言うだけ。スタッフの言葉は 0 件', () => {
  for (const role of ['shop', 'station', 'facility']) {
    for (const place of NO_PLACES) {
      const p = prompt({ name: 'テスト', persona: '# テスト\n- 性格: 明るい', role }, place);
      const where = `${role} / ${JSON.stringify(place)}`;
      assert.doesNotMatch(p, /スタッフ/, where);
      assert.doesNotMatch(p, /handoff を true/, where);
      assert.match(p, /置く場所の情報が渡されていない/, where);
      assert.match(p, /「わからない」と正直に言う/, where);
    }
  }
});

test('ノリーは「おうちの執事見習い」: 人格の文に役目の行と言葉があり、役目はおうち', () => {
  assert.match(NORRIE.persona, /^- 役目: おうち$/m);
  assert.match(NORRIE.persona, /おうちの執事見習い/);
  assert.equal(roleOf({ persona: NORRIE.persona }), 'home');
  const json = JSON.parse(read('characters', 'norrie', 'character.json'));
  assert.equal(roleOf({ character: json, persona: NORRIE.persona }), 'home', 'character.json に role が無くても(足しても)おうち');
});

test('会話の入口: character.role は 4 つの id(画面の言葉も)だけを受け、ほかは捨てる。役目は人格の文の行より先', () => {
  const body = (role) => sanitizeChatBody({ text: 'こんにちは', character: { name: 'テスト', persona: '# テスト\n- 役目: お店の案内', role } });
  assert.equal(body('station').character.role, 'station');
  assert.equal(body('学校や施設').character.role, 'facility');
  assert.equal(body('admin').character.role, undefined);
  assert.equal(body(undefined).character.role, undefined);
  assert.ok(!('role' in body({ evil: 1 }).character), '形の違う値は欄ごと出さない');
  // 入口を通った本文で指示文を作る: 本文の役目(駅)が、人格の文の行(お店)より先
  const viaBody = buildSystemPrompt({ character: body('station').character, place: PLACE, motions: MOTIONS });
  assert.match(viaBody, /駅員さんや町の案内所のスタッフに聞くようにすすめる/);
  const viaPersona = buildSystemPrompt({ character: body(undefined).character, place: PLACE, motions: MOTIONS });
  assert.match(viaPersona, /お店のスタッフに聞くようにすすめる/);
});
