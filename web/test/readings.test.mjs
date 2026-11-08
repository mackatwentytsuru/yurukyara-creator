// 名前の読み方の試験(11-08 b13-yomi)。お店・駅・場所・その子の名前に、漢字・英字・記号があると、声が読み違える。
// 使う人に「なんて よむの?」と聞き、{ 字: かな } の表をその子といっしょに覚え、声に渡す文だけをその読みにする(字幕・吹き出しはもとの字)。
// 本物の声のサービスは呼ばない(fetch を偽物にする)。偽の鍵は実行のときに組み立てる。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  READINGS_MAX,
  applyReadings,
  cleanReading,
  guessReadings,
  needsReading,
  normalizeReadings,
  readingsFromPersona,
  readingsOf,
  readingsText,
  riskyRuns,
} from '../src/conversation/readings.js';
import { toSpeechText } from '../src/conversation/speechReading.js';
import { normalize, personaBlock, randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';
import { ELEVEN_TTS } from '../src/conversation/elevenDirect.js';
import { Speaker } from '../src/conversation/speaker.js';
import { clearVoiceKey, setVoiceKey } from '../src/conversation/voiceKey.js';
import { voiceForRequest } from '../server/tts.mjs';
import { ROLE_DEFAULT_VOICES } from '../src/conversation/voiceRole.js';

const KEY = ['sk', 'feedbead'.repeat(6)].join('_');
const pcm = () => new Response(new Uint8Array(4800), { status: 200 });

function fakeFetch(routes) {
  const sent = [];
  const fn = async (url, init = {}) => {
    sent.push({ url: String(url), body: String(init.body ?? '') });
    for (const [prefix, make] of routes) if (String(url).startsWith(prefix)) return make(url, init);
    return new Response('{}', { status: 404 });
  };
  return { fn, sent };
}

function fakeCtx() {
  return {
    currentTime: 3,
    createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, onended: null }),
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, onended: null }),
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }),
  };
}

/** 台本の部品を、偽の部品で組み立てる(role_shop まで進めて、お店の名前を聞かれる所へ) */
async function startShop() {
  const said = [];
  const heard = [];
  let offered = [];
  const stored = new Map();
  const readingsSeen = [];
  const fr = new FirstRun({
    guide: MAIN,
    creator: createSampleCreator({ main: MAIN }),
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(3)) },
    talk: async () => ({ lines: [{ text: 'こんにちは' }], brain: 'mock' }),
    voice: { realVoice: () => null, canTakeKey: () => false },
    present: async (l) => said.push(...l),
    offer: (a) => { offered = a; },
    onReadings: (r) => readingsSeen.push(r),
  });
  fr.log = heard;
  await fr.start();
  await fr.act('role_shop');
  return { fr, said, stored, readingsSeen, offered: () => offered };
}

const guideTexts = (said) => said.filter((l) => l.who === 'guide' || l.who === undefined).map((l) => l.text);

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  clearVoiceKey();
  delete globalThis.__app;
});

test('読み違えそうな名前の見つけ方: 漢字 2 字以上・英字・記号。かなだけ・かなに挟まれた漢字 1 字は聞かない', () => {
  assert.deepEqual(riskyRuns('たこ焼きやの 辰三'), ['辰三']);
  assert.deepEqual(riskyRuns('辰三'), ['辰三']);
  assert.deepEqual(riskyRuns('KAZE cafe'), ['KAZE', 'cafe']);
  assert.deepEqual(riskyRuns('ひだまりパン'), [], 'かなだけ(カタカナも)は聞かない');
  assert.deepEqual(riskyRuns('たこ焼きや'), [], 'かなに挟まれた漢字 1 字は、ふつうに読める');
  assert.deepEqual(riskyRuns('駅'), ['駅'], '名前が 1 字だけの時は聞く');
  assert.deepEqual(riskyRuns('C&A'), ['C&A'], '記号も 1 つの並び');
  assert.ok(needsReading('辰三') && needsReading('Cafe') && !needsReading('ノリー') && !needsReading(''));
  assert.deepEqual(riskyRuns(undefined), []);
});

test('読みはかなだけ: 漢字・英字・長すぎ・空は受けない。表は 8 件まで、形の違う行は捨てる', () => {
  assert.equal(cleanReading('たつぞう'), 'たつぞう');
  assert.equal(cleanReading(' タツゾウ '), 'タツゾウ');
  assert.equal(cleanReading('辰三'), null);
  assert.equal(cleanReading('tatsuzo'), null);
  assert.equal(cleanReading(''), null);
  assert.equal(cleanReading('あ'.repeat(21)), null);
  assert.deepEqual(normalizeReadings({ 辰三: 'たつぞう', ひらがな: 'ひらがな', 山田: 'やまだ', 悪い: 'bad', 'a=b': 'えー' }), { 辰三: 'たつぞう', 山田: 'やまだ' });
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`名${String.fromCharCode(0x4e00 + i)}${String.fromCharCode(0x4f00 + i)}`, 'なまえ']));
  assert.equal(Object.keys(normalizeReadings(many)).length, READINGS_MAX);
  assert.deepEqual(normalizeReadings(null), {});
  assert.deepEqual(normalizeReadings('x'), {});
});

test('声に渡す文だけ読みに替わる: 「辰三へ ようこそ」→「たつぞうへ ようこそ」。2 回通しても同じ。全員共通の表(執事)も一緒に効く', () => {
  const table = { 辰三: 'たつぞう' };
  assert.equal(applyReadings('辰三へ ようこそ', table), 'たつぞうへ ようこそ');
  assert.equal(toSpeechText('辰三へ ようこそ', table), 'たつぞうへ ようこそ');
  assert.equal(toSpeechText(toSpeechText('辰三へ ようこそ', table), table), 'たつぞうへ ようこそ');
  assert.equal(toSpeechText('辰三の執事', table), 'たつぞうのしつじ');
  assert.equal(toSpeechText('辰三へ ようこそ'), '辰三へ ようこそ', '表が無ければ、もとの文');
  assert.equal(applyReadings('辰三へ', { 辰: 'たつ' }), '辰三へ'.replace('辰', 'たつ'), '1 字でも漢字なら表に入る');
  // 長い字が先: 「辰三郎」は「辰三」より先に当たる
  assert.equal(applyReadings('辰三郎と辰三', { 辰三: 'たつぞう', 辰三郎: 'たつざぶろう' }), 'たつざぶろうとたつぞう');
});

test('人格の文の 1 行と、性格の設定・character.json の表: 往復しても同じ。後ろが勝つ', () => {
  const s = normalize({ role: 'shop', place: { name: 'たこ焼きやの 辰三', about: '' }, readings: { 辰三: 'たつぞう' } });
  assert.deepEqual(s.readings, { 辰三: 'たつぞう' });
  const block = personaBlock(s);
  assert.match(block, /- 名前の読み方: 辰三=たつぞう/u);
  assert.deepEqual(readingsFromPersona(block), { 辰三: 'たつぞう' }, '人格の文から読み戻せる');
  assert.ok(!personaBlock(normalize({ role: 'shop' })).includes('名前の読み方'), '表が空なら 1 行も足さない');
  assert.equal(readingsText({ 辰三: 'たつぞう', ABC: 'えーびーしー' }), '辰三=たつぞう、ABC=えーびーしー');
  assert.deepEqual(readingsOf({ character: { readings: { 辰三: 'たつざぶろう' } }, persona: block }), { 辰三: 'たつぞう' }, '人格の文が character.json より後ろ');
  assert.deepEqual(readingsOf({ character: { readings: { 山田: 'やまだ' } }, settings: { readings: { 辰三: 'たつぞう' } } }), { 山田: 'やまだ', 辰三: 'たつぞう' });
  assert.deepEqual(readingsOf(), {});
});

test('読みの案は、よくある言葉だけでできている時だけ。ほかは案を出さない(声も頭脳も呼ばない)', () => {
  assert.deepEqual(guessReadings('駅前'), ['えきまえ']);
  assert.deepEqual(guessReadings('花屋'), ['はなや']);
  assert.deepEqual(guessReadings('辰三'), []);
  assert.deepEqual(guessReadings(''), []);
});

test('台本: 「たこ焼きやの 辰三」→ なんて よむの? → 「たつぞう」→ 覚えて、なにを あんないする? へ。性格の設定にも残る', async () => {
  const { fr, said, stored, readingsSeen, offered } = await startShop();
  assert.ok(said.some((l) => l.text === 'おみせの なまえは?'));
  await fr.act('place_name', { text: 'たこ焼きやの 辰三' });
  assert.ok(said.some((l) => l.text === '『辰三』は なんて よむの?(ひらがなで)'), '読みを聞く');
  assert.ok(!said.some((l) => l.text === 'なにを あんないする?'), '読みを聞く前に、次へ進まない');
  const ids = offered().map((a) => a.id);
  assert.ok(ids.includes('read_skip') && ids.includes('read_text'), `選び: ${ids}`);
  assert.equal(offered().find((a) => a.id === 'read_skip').label, 'このままで いい');
  assert.equal(offered().find((a) => a.id === 'read_text').kind, 'text', 'ひらがなの欄');
  await fr.act('read_text', { text: 'たつぞう' });
  assert.deepEqual(fr.readings, { 辰三: 'たつぞう' });
  assert.deepEqual(readingsSeen.at(-1), { 辰三: 'たつぞう' }, '今の画面の声にもすぐ渡す');
  assert.ok(said.some((l) => l.text === 'なにを あんないする?'), '読みの後に、案内することへ');
  await fr.act('place_skip');
  await fr.act('words', { text: 'パンの子' });
  await fr.act('keep');
  const saved = stored.get(fr.character.id);
  assert.deepEqual(saved.readings, { 辰三: 'たつぞう' }, '性格の設定に残る');
  assert.match(personaBlock(saved), /- 名前の読み方: 辰三=たつぞう/u, '人格の文にも 1 行出る');
  assert.deepEqual(fr.snapshot().readings, { 辰三: 'たつぞう' }, '読み込み直しても残る');
});

test('台本: かなだけの名前・かなに挟まれた漢字 1 字は、読みを聞かない', async () => {
  for (const name of ['ひだまりパン', 'たこ焼きや']) {
    const { fr, said, offered } = await startShop();
    await fr.act('place_name', { text: name });
    assert.ok(!said.some((l) => String(l.text).includes('なんて よむの')), `${name} は聞かない`);
    assert.ok(said.some((l) => l.text === 'なにを あんないする?'), `${name}: そのまま次へ`);
    assert.deepEqual(offered().map((a) => a.id), ['place_about', 'place_skip']);
    assert.deepEqual(fr.readings, {});
  }
});

test('台本: 「このままで いい」でとばせる。読みは覚えず、次へ進む', async () => {
  const { fr, said, readingsSeen, stored } = await startShop();
  await fr.act('place_name', { text: '辰三' });
  await fr.act('read_skip');
  assert.deepEqual(fr.readings, {});
  assert.equal(readingsSeen.length, 0);
  assert.ok(said.some((l) => l.text === 'なにを あんないする?'));
  await fr.act('place_skip');
  await fr.act('words', { text: 'パンの子' });
  await fr.act('keep');
  assert.equal(stored.get(fr.character.id).readings, undefined, '設定に表は付けない');
  assert.ok(!('readings' in fr.snapshot()));
});

test('台本: かな以外(漢字・英字)の読みは覚えず、同じ問いに戻る。かなで答えれば覚える', async () => {
  const { fr, said, offered } = await startShop();
  await fr.act('place_name', { text: 'KAZE' });
  assert.ok(said.some((l) => l.text === '『KAZE』は なんて よむの?(ひらがなで)'));
  await fr.act('read_text', { text: 'kaze' });
  assert.deepEqual(fr.readings, {});
  assert.ok(said.some((l) => String(l.text).startsWith('ひらがなで')));
  assert.ok(offered().some((a) => a.id === 'read_text'), '同じ問いに戻る');
  assert.ok(!said.some((l) => l.text === 'なにを あんないする?'));
  await fr.act('read_text', { text: 'かぜ' });
  assert.deepEqual(fr.readings, { KAZE: 'かぜ' });
  assert.ok(said.some((l) => l.text === 'なにを あんないする?'));
});

test('台本: その子の名前に漢字・英字があれば、「これでいい」の後に、読みを聞いてから性格へ', async () => {
  const { fr, said, offered } = await startShop();
  await fr.act('place_name', { text: 'ひだまりパン' });
  await fr.act('place_skip');
  await fr.act('words', { text: 'パンの子' });
  fr.character = { ...fr.character, name: '辰三くん' };
  await fr.act('keep');
  assert.ok(said.some((l) => l.text === '『辰三』は なんて よむの?(ひらがなで)'));
  assert.ok(offered().some((a) => a.id === 'read_text'));
  await fr.act('read_text', { text: 'たつぞう' });
  assert.deepEqual(fr.readings, { 辰三: 'たつぞう' });
});

test('声の鍵(BYOK)の道: 声に渡す文は「たつぞう」、字幕・文字送りは「辰三」のまま。ほかの子(表が無い)には効かない', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([[ELEVEN_TTS, () => pcm()]]);
  globalThis.fetch = f.fn;
  try {
    setVoiceKey(KEY);
    const sp = new Speaker();
    Object.assign(sp, { ctx: fakeCtx(), analyser: {} });
    globalThis.__app = { persona: personaBlock(normalize({ role: 'shop', readings: { 辰三: 'たつぞう' } })) };
    const shown = [];
    await sp.enqueue('辰三へ ようこそ', { onCrawl: (s) => shown.push(s) });
    assert.equal(JSON.parse(f.sent.at(-1).body).text, 'たつぞうへ ようこそ', '声に渡す文');
    assert.ok(shown.length === 0 || shown.every((s) => !s.includes('たつぞう')), '文字送りに読みの文字は出ない');
    globalThis.__app = { persona: personaBlock(normalize({ role: 'shop' })) };
    await sp.enqueue('辰三へ ようこそ');
    assert.equal(JSON.parse(f.sent.at(-1).body).text, '辰三へ ようこそ', '表が無い子は、もとの文');
  } finally {
    clearVoiceKey();
    globalThis.fetch = realFetch;
  }
});

test('サーバーの道: /api/tts へ送る文は「たつぞう」と表(readings)。字幕の文字送りは「辰三」のまま', async () => {
  const realFetch = globalThis.fetch;
  const off = () => new Response(null, { status: 204, headers: { 'x-tts': 'off', 'x-tts-reason': 'no-key' } });
  const f = fakeFetch([['/api/tts', off]]);
  globalThis.fetch = f.fn;
  try {
    const sp = new Speaker();
    globalThis.__app = { personaSettings: normalize({ readings: { 辰三: 'たつぞう' } }), persona: '' };
    const shown = [];
    await sp.enqueue('辰三へ ようこそ', { onCrawl: (s) => shown.push(s) });
    const body = JSON.parse(f.sent[0].body);
    assert.equal(body.text, 'たつぞうへ ようこそ');
    assert.deepEqual(body.readings, { 辰三: 'たつぞう' });
    assert.equal(shown.at(-1), '辰三へ ようこそ', '字幕は、もとの文');
    assert.ok(shown.every((s) => !s.includes('たつ')), '文字送りの途中にも、読みの文字は出ない');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('サーバー: voiceForRequest は readings を整えて返す(かな以外・形の違う行は捨てる。無ければ欄ごと付けない)', () => {
  const cfg = { elevenVoiceId: 'xx' };
  const known = new Set();
  const v = voiceForRequest({ voice: 'female', readings: { 辰三: 'たつぞう', 悪い: '<script>', ひらがな: 'ひらがな' } }, cfg, known);
  assert.deepEqual(v.readings, { 辰三: 'たつぞう' });
  assert.equal(v.role, 'female');
  assert.ok(!('readings' in voiceForRequest({ voice: 'female' }, cfg, known)));
  assert.ok(!('readings' in voiceForRequest({ voice: 'female', readings: 'x' }, cfg, known)));
  assert.equal(typeof ROLE_DEFAULT_VOICES.female, 'string');
});
