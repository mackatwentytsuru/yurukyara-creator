// 声の役(男の子・女の子)の試験(11-07 第 11 波)。どのキャラにも役があり、キャラから自動で決まり、性格の画面で「おまかせ / 男の子 / 女の子」に替えられる。
// 本物の声のサービスは呼ばない(fetch を偽物にする)。偽の鍵は実行のときに組み立てる。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROLE_DEFAULT_VOICES,
  VOICE_CHOICES,
  VOICE_LABELS,
  VOICE_MODEL_ID,
  applyVoiceChoice,
  isVoiceId,
  normalizeVoiceChoice,
  personaVoice,
  resolveVoice,
  voiceRoleOf,
} from '../src/conversation/voiceRole.js';
import { DEFAULT_MODEL_ID, DEFAULT_VOICE_ID, ELEVEN_TTS } from '../src/conversation/elevenDirect.js';
import { Speaker } from '../src/conversation/speaker.js';
import { Dialogue } from '../src/conversation/dialogue.js';
import { clearVoiceKey, setVoiceKey } from '../src/conversation/voiceKey.js';

const CHARS = join(import.meta.dirname, '..', '..', 'characters');
const persona = (id) => readFileSync(join(CHARS, id, 'persona.md'), 'utf8');
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const KEY = ['sk', 'beadfeed'.repeat(6)].join('_');
const OWN_ID = ['Own', 'Voice', 'Id', '12345'].join(''); // 形の正しい、試しの声の id
// 司令室 Q-0103(ノリーの声)の候補。本人の答えは A(11-07 15:49 に読んだ)。男の子の既定とノリーの「声の id」は A
const Q0103 = { A: 'A4AyGcPAjb1pHgflyZZp', B: 'j210dv0vWm7fCknyQpbA', C: 'EbuvaInXUGWtpYRUnKLQ', D: 'GKDaBI8TKSBJVhsCLD6n', E: 'b34JylakFZPlGS0BnwyY', F: '4sirbXwrtRlmPV80MJkQ' };
const OWN_PERSONA = `# ためしくん\n- 声: 男の子\n- 声の id: ${['Own', 'Voice', 'Id', '12345'].join('')}`;

/** 通信の偽物。宛先ごとに返事を決め、送った物を全部覚える */
function fakeFetch(routes) {
  const sent = [];
  const fn = async (url, init = {}) => {
    sent.push({ url: String(url), headers: { ...(init.headers ?? {}) }, body: String(init.body ?? '') });
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

const pcm = () => new Response(new Uint8Array(4800), { status: 200 });

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  clearVoiceKey();
});

test('選べる値は 3 つ(おまかせ・男の子・女の子)。知らない値・空は「おまかせ」', () => {
  assert.deepEqual([...VOICE_CHOICES], ['auto', 'male', 'female']);
  assert.deepEqual({ ...VOICE_LABELS }, { auto: 'おまかせ', male: '男の子', female: '女の子' });
  for (const c of VOICE_CHOICES) assert.equal(normalizeVoiceChoice(c), c);
  for (const bad of [undefined, null, '', 'MALE', 'robot', 1, {}, ['male']]) assert.equal(normalizeVoiceChoice(bad), 'auto');
});

test('作例と主役の役: ノリーは「声: 男の子」の行、みかんちゃんは「声: 女の子」の行。ようこそくん・ロボくん・パネルくん・ちょうちんくんは名前の「くん」で男の子。CRLF でも同じ', () => {
  const want = {
    norrie: ['male', 'line'],
    mikan: ['female', 'line'],
    yokoso: ['male', 'guess'],
    robo: ['male', 'guess'],
    f_led: ['male', 'guess'],
    d_lantern: ['male', 'guess'],
    _test: ['female', 'default'],
  };
  for (const [id, [role, source]] of Object.entries(want)) {
    const p = persona(id);
    assert.deepEqual([personaVoice(p).role, personaVoice(p).source], [role, source], id);
    assert.deepEqual(personaVoice(crlf(p)), personaVoice(p), `${id}(CRLF)`);
    assert.equal(voiceRoleOf(p), role, id);
  }
  assert.match(persona('norrie'), /^- 声: 男の子\r?$/m, 'ノリーは執事見習いの男の子の役(11-07 本人)');
  assert.equal(personaVoice(persona('norrie')).voiceId, Q0103.A, 'ノリーの声は本人が選んだ A(Q-0103)');
  for (const id of ['mikan', 'yokoso', 'robo', 'f_led', 'd_lantern', '_test']) assert.equal(personaVoice(persona(id)).voiceId, null, `${id} は役の既定の声`);
});

test('見当の決まり: 一人称 → 役どころの言葉 → 名前の終わり → 女の子。わたくし・名前の一人称は役どころで決める。好きなことの行では決めない', () => {
  const cases = [
    ['# たろう\n- 一人称は「ぼく」。', 'male', 'guess'],
    ['# たろう\n- 一人称: オレ', 'male', 'guess'],
    ['# はな\n- 一人称は「わたし」。', 'female', 'guess'],
    ['# はな\n- 一人称は「あたし」。', 'female', 'guess'],
    ['# セバス\n- 役どころ: 王さまの執事。\n- 一人称は「わたくし」。', 'male', 'guess'],
    ['# メイ\n- 役どころ: お屋敷のメイド。\n- 一人称は「わたくし」。', 'female', 'guess'],
    ['# ポチ\n- 一人称は「ポチ」。\n- 役どころ: 執事見習い。', 'male', 'guess'],
    ['# くまくん\n緑のぬいぐるみ。', 'male', 'guess'],
    ['# うさちゃん\n白いうさぎ。', 'female', 'guess'],
    ['# ぽちくん\n- 好きなこと: お姫さまごっこ', 'male', 'guess'],
    ['# ぽち\n- 好きなこと: 王子さまの絵本', 'female', 'default'],
    ['# さくらさん\nやさしい木。', 'female', 'default'],
    ['', 'female', 'default'],
    ['# たろう\n- 一人称は「ぼく」。\n- 声: 女の子', 'female', 'line'],
    ['# はなちゃん\n* 声:男の子', 'male', 'line'],
  ];
  for (const [text, role, source] of cases) assert.deepEqual([personaVoice(text).role, personaVoice(text).source], [role, source], text);
  // 画面(性格の画面)が後ろに足す節は見ない
  const added = `${persona('norrie')}\n\n# 性格と話し方(使う人が画面で選んだ設定)\n- 性格: 元気\n- 声: 女の子\n- 一人称は「わたし」。`;
  assert.equal(voiceRoleOf(added), 'male');
});

test('声の id の行: 形の正しい物だけ。話す役がその子の役と同じ時だけ使う(ノリーに「女の子」を選んだら、男の子の声は使わない)', () => {
  const p = `# ノリー\n- 声: 男の子\n- 声の id: ${OWN_ID}`;
  assert.equal(personaVoice(p).voiceId, OWN_ID);
  assert.equal(personaVoice('# x\n- 声の ID: ../../evil').voiceId, null, 'おかしな id は使わない');
  assert.deepEqual(resolveVoice({ persona: p }), { choice: 'auto', role: 'male', source: 'line', voiceId: OWN_ID, ownVoiceId: OWN_ID });
  assert.deepEqual(resolveVoice({ choice: 'male', persona: p }), { choice: 'male', role: 'male', source: 'choice', voiceId: OWN_ID, ownVoiceId: OWN_ID });
  assert.deepEqual(resolveVoice({ choice: 'female', persona: p }), { choice: 'female', role: 'female', source: 'choice', voiceId: ROLE_DEFAULT_VOICES.female, ownVoiceId: null });
});

test('声の id の順: その子の声 > 役の既定(サーバーの環境変数 > 決まった既定)> ELEVEN_VOICE_ID。男の子の既定は本人が選んだ A、女の子は Yui', () => {
  for (const id of [...Object.values(Q0103), ...Object.values(ROLE_DEFAULT_VOICES)]) assert.ok(isVoiceId(id), id);
  assert.equal(ROLE_DEFAULT_VOICES.male, Q0103.A, '男の子の既定は、本人がノリーの声に選んだ A(Q-0103)。あいづちの声もこの声');
  assert.equal(ROLE_DEFAULT_VOICES.female, 'fUjY9K2nAIwlALOwSiwc', '女の子は Yui(前からの既定)');
  assert.equal(ROLE_DEFAULT_VOICES.female, DEFAULT_VOICE_ID, '声の鍵の道の既定と同じ');
  assert.equal(VOICE_MODEL_ID, 'eleven_v4_turbo');
  assert.equal(DEFAULT_MODEL_ID, VOICE_MODEL_ID, '声の鍵の道のモデルも同じ');
  const yokoso = persona('yokoso'); // 男の子で、声の id の行が無い子
  assert.equal(resolveVoice({ persona: yokoso }).voiceId, ROLE_DEFAULT_VOICES.male);
  const env = { male: 'EnvMaleVoice0001', female: 'EnvFemaleVoice01' };
  assert.equal(resolveVoice({ persona: yokoso, defaults: env }).voiceId, env.male);
  assert.equal(resolveVoice({ persona: persona('mikan'), defaults: env }).voiceId, env.female);
  assert.equal(resolveVoice({ persona: yokoso, defaults: { male: 'x' } }).voiceId, ROLE_DEFAULT_VOICES.male, '形の違う既定は飛ばす');
  const legacy = 'LegacyVoice00001';
  assert.equal(resolveVoice({ persona: yokoso, fallback: legacy }).voiceId, ROLE_DEFAULT_VOICES.male, 'ELEVEN_VOICE_ID は役の既定より後(.env の例の Yui が男の子に付かない)');
  assert.equal(resolveVoice({ persona: OWN_PERSONA, defaults: env, fallback: legacy }).voiceId, OWN_ID, 'その子の声がいちばん先');
  assert.equal(resolveVoice({ persona: persona('norrie'), defaults: env }).voiceId, Q0103.A, 'ノリーは環境変数の男の子の声より、自分の声');
  assert.equal(resolveVoice({ persona: '# x', ownVoiceId: OWN_ID }).voiceId, OWN_ID, 'キャラの設計図の声(setVoice)も、その子の声として使う');
});

test('S4 が呼ぶ口 applyVoiceChoice: speaker の setVoiceChoice を呼び、同じ形を返す。speaker が無い・古い時も計算して返す', () => {
  const calls = [];
  const fake = { setVoiceChoice: (c, o) => (calls.push([c, o]), { choice: c, role: 'female', voiceId: 'FakeVoiceId00001' }) };
  assert.deepEqual(applyVoiceChoice(fake, 'female', { persona: 'p' }), { choice: 'female', role: 'female', voiceId: 'FakeVoiceId00001' });
  assert.deepEqual(applyVoiceChoice(fake, 'robot'), { choice: 'auto', role: 'female', voiceId: 'FakeVoiceId00001' });
  assert.deepEqual(calls, [['female', { persona: 'p' }], ['auto', {}]], '知らない値は auto で渡す。persona を省くと渡さない');
  const norrie = persona('norrie');
  assert.deepEqual(applyVoiceChoice(null, 'auto', { persona: norrie }), { choice: 'auto', role: 'male', voiceId: Q0103.A });
  assert.deepEqual(applyVoiceChoice({ setVoice() {} }, 'female', { persona: norrie }), { choice: 'female', role: 'female', voiceId: ROLE_DEFAULT_VOICES.female });
  const sp = new Speaker();
  assert.deepEqual(applyVoiceChoice(sp, 'auto', { persona: norrie }), { choice: 'auto', role: 'male', voiceId: Q0103.A });
  assert.equal(sp.voiceId, Q0103.A, '初めての会話の 7 歩目が読む声(鍵を確かめる時の声)');
  assert.deepEqual(applyVoiceChoice(sp, 'female'), { choice: 'female', role: 'female', voiceId: ROLE_DEFAULT_VOICES.female }, '人格の文を省くと、前に渡した文のまま');
});

test('サーバーの道: 話す役と、その子自身の声の id だけを送る(おまかせはその子の役、選べばその役)', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([['/api/tts', () => pcm()]]);
  globalThis.fetch = f.fn;
  try {
    const sp = new Speaker();
    Object.assign(sp, { ctx: fakeCtx(), analyser: {} });
    const body = () => JSON.parse(f.sent.at(-1).body);
    await sp.enqueue('こんにちは');
    assert.deepEqual(body(), { text: 'こんにちは', voice: 'female' }, '人格の文がまだ無い時は女の子');
    sp.setVoiceChoice('auto', { persona: persona('norrie') });
    await sp.enqueue('はじめまして');
    assert.deepEqual(body(), { text: 'はじめまして', voice: 'male', voiceId: Q0103.A }, 'ノリーは男の子で、自分の声(本人が選んだ A)');
    sp.setVoiceChoice('female');
    await sp.enqueue('やあ');
    assert.deepEqual(body(), { text: 'やあ', voice: 'female' }, '選んだ値は人格の文より先。役を替えたら、その子の声の id は送らない');
    sp.setVoiceChoice('auto', { persona: persona('yokoso') });
    await sp.enqueue('こんにちは');
    assert.deepEqual(body(), { text: 'こんにちは', voice: 'male' }, '声の id の行が無い男の子は、役だけを送る(サーバーが役の既定の声を使う)');
    sp.setVoiceChoice('auto', { persona: OWN_PERSONA });
    await sp.enqueue('うん');
    assert.deepEqual(body(), { text: 'うん', voice: 'male', voiceId: OWN_ID }, 'その子自身の声の id も送る');
    sp.setVoiceChoice('female');
    await sp.enqueue('ええ');
    assert.deepEqual(body(), { text: 'ええ', voice: 'female' }, '役を替えたら、その子の声の id は送らない');
    assert.ok(f.sent.every((s) => s.url === '/api/tts'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('声の鍵(BYOK)の道: 役の声で、eleven_v4_turbo で直接頼む。送る本文は文・モデル・言葉だけ', async () => {
  const realFetch = globalThis.fetch;
  const f = fakeFetch([[ELEVEN_TTS, () => pcm()]]);
  globalThis.fetch = f.fn;
  try {
    setVoiceKey(KEY);
    const sp = new Speaker();
    Object.assign(sp, { ctx: fakeCtx(), analyser: {} });
    sp.setVoiceChoice('auto', { persona: persona('norrie') });
    await sp.enqueue('はじめまして');
    assert.ok(f.sent[0].url.startsWith(`${ELEVEN_TTS}${Q0103.A}/stream`), f.sent[0].url);
    assert.deepEqual(JSON.parse(f.sent[0].body), { text: 'はじめまして', model_id: 'eleven_v4_turbo', language_code: 'ja' });
    applyVoiceChoice(sp, 'auto', { persona: persona('mikan') });
    await sp.enqueue('こんにちは');
    assert.ok(f.sent[1].url.startsWith(`${ELEVEN_TTS}${ROLE_DEFAULT_VOICES.female}/stream`), 'みかんちゃんは女の子の声');
  } finally {
    clearVoiceKey();
    globalThis.fetch = realFetch;
  }
});

test('会話の 1 回ごとに、今の子の人格の文で役が決まる(おまかせ)。空の文では前の文を消さない。選んだ値は残る', async () => {
  const sp = new Speaker();
  sp.setVoicePersona(persona('norrie'));
  assert.equal(sp.currentVoice().role, 'male');
  sp.setVoicePersona('');
  sp.setVoicePersona(undefined);
  assert.equal(sp.currentVoice().role, 'male', '空の文では消さない');
  sp.setVoicePersona(persona('mikan'));
  assert.equal(sp.currentVoice().role, 'female', '舞台の子が替われば役も替わる');
  sp.setVoiceChoice('male');
  sp.setVoicePersona(persona('mikan'));
  assert.equal(sp.currentVoice().role, 'male', '選んだ値は、次に選び直すまで残る');
  assert.deepEqual(sp.setVoiceChoice('auto', { persona: '' }), { choice: 'auto', role: 'female', voiceId: ROLE_DEFAULT_VOICES.female }, '性格の画面からは空の文も受ける');

  // Dialogue は送る前に、画面の文脈の人格の文を speaker に渡す
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([['/api/chat', () => new Response(JSON.stringify({ brain: 'mock', fallback: true, events: [] }), { status: 200, headers: { 'content-type': 'application/json' } })]]).fn;
  try {
    const given = [];
    const speaker = { speaking: false, pending: 0, stop() {}, playFiller: () => null, enqueue: async () => {}, setVoicePersona: (p) => given.push(p) };
    const noop = () => {};
    const d = new Dialogue({
      character: { setMouth: noop, play: noop, setEmotion: noop, expressions: ['neutral'] },
      speaker,
      ui: { userSaid: noop, thought: noop, say: noop, caption: noop, error: noop, notice: noop },
      getContext: () => ({ scene: '', character: { name: 'ノリー', persona: persona('norrie') }, place: {} }),
      setGaze: () => null,
      onMetric: noop,
    });
    await d.send({ text: 'こんにちは' });
    assert.deepEqual(given, [persona('norrie')]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('あいづちの声: サーバーが役ごとの組を返したら、今の役の組を使い、役が替わると組も替わる。前の形(fillers だけ)も読む', async () => {
  const realFetch = globalThis.fetch;
  const list = (role) => [{ text: 'はい。', url: `/api/fillers/${role === 'male' ? 'aaaaaaaaaa' : 'bbbbbbbbbb'}.pcm` }, { text: 'ええ。', url: `/api/fillers/${role === 'male' ? 'cccccccccc' : 'dddddddddd'}.pcm` }];
  const routes = (data) => [
    ['/api/fillers/', () => new Response(new Uint8Array(4800), { status: 200 })],
    ['/api/fillers', () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })],
  ];
  try {
    const roles = { male: list('male').slice(0, 1), female: list('female') };
    let f = fakeFetch(routes({ sampleRate: 24000, fillers: roles.female, roles }));
    globalThis.fetch = f.fn;
    const sp = new Speaker();
    sp.setVoiceChoice('auto', { persona: persona('norrie') });
    assert.equal(await sp.loadFillers(), 1, 'ノリーは男の子の組(1 種類)');
    assert.ok(f.sent.some((s) => s.url.endsWith('aaaaaaaaaa.pcm')) && f.sent.some((s) => s.url.endsWith('bbbbbbbbbb.pcm')), '両方の組を読む');
    sp.setVoiceChoice('female');
    assert.equal(sp.fillers.length, 2, '女の子を選ぶと女の子の組');
    sp.setVoiceChoice('auto');
    assert.equal(sp.fillers.length, 1);

    f = fakeFetch(routes({ sampleRate: 24000, fillers: list('female') }));
    globalThis.fetch = f.fn;
    const old = new Speaker();
    old.setVoiceChoice('male');
    assert.equal(await old.loadFillers(), 2, '前の形のサーバーなら、その組をそのまま使う');
    old.setVoiceChoice('female');
    assert.equal(old.fillers.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
