// 役目(この子は、どこで だれと。B4 12b)の試験: 値の決まり・性格の設定への入り方・人格の文の 1 行・お店と駅の 1〜2 問。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, ROLE_LABELS, ROLE_CHIPS, normalizeRole, placeLine, ASKS_PLACE } from '../src/ui/onboarding/roles.js';
import { normalize, personaBlock, randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { FirstRun, summary } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

test('役目の値は 4 つ。知らない値は おうち。画面の言葉でも受ける(B3 の会話と同じ形)', () => {
  assert.deepEqual(ROLES, ['home', 'shop', 'station', 'facility']);
  assert.deepEqual(ROLE_LABELS, { home: 'おうち', shop: 'お店の案内', station: '駅や町の案内', facility: '学校や施設' });
  assert.equal(normalizeRole('お店の案内'), 'shop');
  assert.equal(normalizeRole(ROLE_CHIPS.station), 'station');
  assert.equal(normalizeRole('evil'), 'home');
  assert.equal(normalizeRole(undefined), 'home');
  assert.deepEqual([...ASKS_PLACE], ['shop', 'station'], '名前を聞くのはお店と駅だけ');
  assert.equal(placeLine({ name: 'ひだまりパン', about: 'パンの しゅるい' }), 'ひだまりパン。案内すること: パンの しゅるい');
  assert.equal(placeLine({}), '');
});

test('性格の設定: 役目と場所が入り、人格の文に「- 役目:」の 1 行が出る(場所は書いた時だけ)', () => {
  const home = normalize({});
  assert.equal(home.role, 'home');
  assert.ok(personaBlock(home).split('\n').includes('- 役目: おうち'));
  assert.ok(!personaBlock(home).includes('置く場所'));
  const shop = normalize({ role: 'shop', place: { name: 'ひだまりパン'.repeat(5), about: 'パン' } });
  assert.equal([...shop.place.name].length, 30, '30 字まで');
  const block = personaBlock(shop);
  assert.ok(block.includes('- 役目: お店の案内'));
  assert.match(block, /- 置く場所: (ひだまりパン)+.*。案内すること: パン/);
  assert.ok(!/スタッフに聞いて/.test(personaBlock(home)), 'おうちの子に「スタッフに聞いて」を言わせない');
});

test('台本: 役目を先に聞き、お店は名前と案内することを聞いてから、どんな子を聞く。選んだ役目は性格に入る', async () => {
  const said = [];
  let offered = [];
  const stored = new Map();
  const fr = new FirstRun({
    guide: MAIN,
    creator: createSampleCreator({ main: MAIN }),
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(3)) },
    talk: async () => ({ lines: [{ text: 'こんにちは' }], brain: 'mock' }),
    voice: { realVoice: () => null, canTakeKey: () => false },
    present: async (l) => said.push(...l),
    offer: (a) => { offered = a; },
  });
  await fr.start();
  assert.deepEqual(said.map((l) => l.text).slice(0, 2), [`はじめまして! ${MAIN.name}デス。いっしょに ゆるキャラを 生み出しマス!`, 'この子は、どこで だれと?']);
  assert.ok(!said.some((l) => l.text === 'どんな子を生み出そうか?'), '役目の前に「どんな子」を聞かない');
  await fr.act('role_shop');
  assert.ok(said.some((l) => l.text === 'おみせの なまえは?'));
  assert.deepEqual(offered.map((a) => a.id), ['place_name', 'place_skip']);
  await fr.act('place_name', { text: 'ひだまりパン' });
  assert.deepEqual(offered.map((a) => a.id), ['place_about', 'place_skip']);
  await fr.act('place_skip');
  assert.ok(said.some((l) => l.text === 'どんな子を生み出そうか?'));
  await fr.act('words', { text: 'パンの子' });
  assert.equal(fr.character.id, 'mikan', 'パンは食べ物の仲間 → みかんちゃん');
  await fr.act('keep');
  assert.equal(stored.get('mikan').role, 'shop');
  assert.deepEqual(stored.get('mikan').place, { name: 'ひだまりパン', about: '' });
  assert.equal(fr.snapshot().role, 'shop', '読み込み直しても役目が残る');
});

test('決めたことの 1 文(UIR 15)', () => {
  assert.equal(summary({ preset: 'calm', energy: 2, length: 'normal' }), 'おっとりで、ゆっくり 話す 子');
  assert.equal(summary({ preset: 'genki', energy: 5, length: 'short', tone: 'polite' }), 'げんき いっぱいで、はきはき、みじかく、ていねいに 話す 子');
  assert.ok(!/ElevenLabs|元気さ|レトロ|・/.test(summary({ voice: { provider: 'elevenlabs' } })));
});
