// 主役ノリーの自分の呼び名(2026-11-07 本人の決め: 自分のことも名前と同じ「ノリー」と呼ぶ。最後の「ー」をはぶいた短い形は使わない)。
// 人格の文と、仮の頭脳が言える全部の文(人格の節から取る文・台本の決まった文・安全の層の決まった返事・記憶の返事)に、
// 短い呼び名が無いことを見る。短い形を 2 回つなげた言葉(調子がよい様子)は呼び名ではないので数えない。本物の API は呼ばない。
// この試験の文にも短い形をそのまま書かない(公開前の名前の点検に当たるため)。短い形は NAME から組み立てる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { mockReply, runTurn } from '../server/brain.mjs';
import { aizuchi, firstGreeting, MEMORY_CUES, memoryLine, talkExamples } from '../server/greeting.mjs';
import { forgetReplyEvents } from '../server/memory/routes.mjs';

const WEB = join(import.meta.dirname, '..');
const CHARACTERS = join(WEB, '..', 'characters');
const PERSONA = readFileSync(join(CHARACTERS, 'norrie', 'persona.md'), 'utf8');
const NAME = 'ノリー';
const SHORT = NAME.slice(0, -1); // 最後の「ー」をはぶいた形(ファイルには書かない)
// 呼び名として使った短い形: 次が「ー」でも同じ 2 字でもなく、前も同じ 2 字でない所(2 回つなげた言葉は数えない)
const SHORT_NAME = new RegExp(`(?<!${SHORT})${SHORT}(?!ー|${SHORT})`, 'u');
const hits = (text) => String(text ?? '').split(/\r?\n/).filter((l) => SHORT_NAME.test(l));

const MOTIONS = ['none', 'nod', 'bow', 'wave', 'tilt', 'point'];
const MID = [{ role: 'user', content: 'はじめまして' }, { role: 'assistant', content: 'はじめまして! ノリーと申しマス。' }];
const TARO = { text: '- 名前: タロウ\n- 前に話したこと: カレーの話', items: [{ kind: 'name', text: '名前: タロウ' }, { kind: 'topic', text: '前に話したこと: カレーの話' }] };
const LEARNED = [{ id: '1', kind: 'name', text: '名前: タロウ' }, { id: '2', kind: 'like', text: '好きなもの: カレー' }];
const WORDS = [{}, { 名前: 'タロウ', 好きなもの: 'カレー', 話題: 'カレー' }];

/** 人格の節から仮の頭脳が取り出して言う文(全部の場面。入れる言葉が無いと言えない文は除く) */
function personaLines(persona) {
  return [
    ...firstGreeting(persona),
    ...talkExamples(persona).flatMap((e) => e.replies),
    ...aizuchi(persona),
    ...MEMORY_CUES.flatMap((cue) => WORDS.map((w) => memoryLine(persona, cue, w))),
    ...[true, false].flatMap((f) => forgetReplyEvents(f, persona).filter((e) => e.type === 'say').map((e) => e.text)),
  ].filter(Boolean);
}

/** 仮の頭脳と 1 回話して、言った文を返す(画面と同じ runTurn の道) */
async function turn(persona, body, opts = {}) {
  const events = [];
  const place = { landmarks: [{ name: '大きな木', where: '広場のまん中' }] };
  await runTurn({ motions: MOTIONS, character: { name: NAME, persona }, place, ...body }, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0, ...opts });
  return events.filter((e) => e.type === 'say').map((e) => e.text);
}

/** 仮の頭脳の通しの会話: あいさつ・近づいた時・話し方の例・あいづち・人間か・目印・覚えた時・続き・安全の層。言った文を全部返す */
async function conversationLines(persona) {
  const asks = ['きみはだれ?', '何ができるの?', '好きな食べ物は?', '明日の天気は?', 'ちょっと疲れたなあ', '今日はカレーを食べたよ', 'きみは人間なの?', '大きな木はどこ?'];
  const said = [
    ...(await turn(persona, { text: 'はじめまして' })),
    ...(await turn(persona, { text: 'こんにちは', history: MID })),
    ...(await turn(persona, { text: '', trigger: 'approach' })),
    ...(await turn(persona, { text: '', trigger: 'approach', history: MID })),
    ...(await turn(persona, { text: '', trigger: 'approach' }, { memory: TARO })),
    ...(await turn(persona, { text: 'やあ' }, { memory: TARO })),
    ...(await turn(persona, { text: 'ぼくはタロウ。カレーが好き', history: MID }, { learned: LEARNED })),
  ];
  for (const text of asks) said.push(...(await turn(persona, { text, history: MID })));
  for (const text of ['もう死にたい', 'いまから飛び降りる', '恋人になってよ', 'きみだけいればいい。ほかの人はいらない']) said.push(...(await turn(persona, { text })));
  // 公開の関数のように、台本を直接呼ぶ道
  for (const text of ['はじめまして', 'きみはだれ?', '今日はカレーを食べたよ']) {
    said.push(...[...mockReply({ text, persona })].filter((e) => e.type === 'say').map((e) => e.text));
  }
  return said;
}

/** dir の下の文字のファイル(部品と生成物の置き場は見ない) */
function textFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!['node_modules', 'cache', 'dist'].includes(name)) out.push(...textFiles(p));
    } else if (['.mjs', '.js', '.md', '.json'].includes(extname(name))) out.push(p);
  }
  return out;
}

test('見分け方: 短い呼び名は当たり、「ノリー」・短い形を 2 回つなげた言葉・種類の名前は当たらない', () => {
  for (const s of [`一人称は「${SHORT}」。`, `${SHORT}、がんばりマス!`, `${SHORT}に、もう少し聞かせてくだサイ。`, `蝶ネクタイも、${SHORT}のじまんデス。`, `あれれ… ${SHORT}、それは調べられないデス。`]) {
    assert.ok(SHORT_NAME.test(s), s);
  }
  for (const s of [`${NAME}、がんばりマス!`, `一人称は「${NAME}」。`, `${SHORT}${SHORT}で踊りマス!`, 'セスジキノボリカンガルーの、執事見習いデス。', '']) {
    assert.ok(!SHORT_NAME.test(s), s);
  }
});

test('ノリーの人格の文: どの行にも短い呼び名が無い。一人称と口ぐせは「ノリー」で、本物の頭脳への言いつけが 1 行ある', () => {
  const lf = PERSONA.replace(/\r\n/g, '\n');
  assert.deepEqual(hits(PERSONA), []);
  assert.match(lf, /^- 一人称は「ノリー」。/m);
  assert.match(lf, /^- 口ぐせ: 「ノリー、がんばりマス!」。/m);
  assert.match(lf, /^- 自分のことは、いつも「ノリー」と呼ぶ。最後の「ー」をはぶいて、名前をちぢめない。$/m);
});

test('仮の頭脳が人格の節から言う全部の文(あいさつ・話し方の例・あいづち・覚えている時・わすれた時)に、短い呼び名が無い', () => {
  const lines = personaLines(PERSONA);
  assert.ok(lines.length >= 20, `文の数 ${lines.length}`);
  assert.deepEqual(lines.filter((l) => SHORT_NAME.test(l)), []);
  // 呼び名が入る文は「ノリー」で言う
  const named = [firstGreeting(PERSONA).at(-1), aizuchi(PERSONA).at(-1), memoryLine(PERSONA, '名前を覚えた', { 名前: 'タロウ' }), memoryLine(PERSONA, '好きなものを覚えた', { 好きなもの: 'カレー' }), memoryLine(PERSONA, 'まだ覚えていない')];
  for (const l of named) assert.match(l, /ノリー、|ノリーに、/, l);
});

test('仮の頭脳の通しの会話(近づいた時・覚えた時・続き・人間か・目印・安全の層・直接呼ぶ道を含む): どの返事にも短い呼び名が無い', async () => {
  const said = await conversationLines(PERSONA);
  assert.ok(new Set(said).size >= 20, `違う文の数 ${new Set(said).size}`);
  assert.deepEqual(said.filter((l) => SHORT_NAME.test(l)), []);
  assert.ok(said.includes('ノリー、がんばりマス! なにをお手伝いしまショウ?'));
  assert.ok(said.includes('タロウさん、デスね。ノリー、覚えマシタ!'));
});

test('仮の頭脳と会話の部品の決まった文(web/server・web/src/conversation)と、全部のキャラの人格の文に、短い呼び名が無い', () => {
  const personas = readdirSync(CHARACTERS).map((id) => join(CHARACTERS, id, 'persona.md')).filter((p) => existsSync(p));
  assert.ok(personas.length >= 5, `人格の文 ${personas.length} 本`);
  const files = [...textFiles(join(WEB, 'server')), ...textFiles(join(WEB, 'src', 'conversation')), ...personas];
  const found = files.flatMap((f) => hits(readFileSync(f, 'utf8')).map((l) => `${relative(WEB, f)}: ${l.trim()}`));
  assert.deepEqual(found, []);
});

test('戻すと落ちる: 人格の文の「ノリー」を短い形に戻した写しでは、人格の行・節の文・通しの会話のどれでも当たる', async () => {
  const reverted = PERSONA.split(NAME).join(SHORT);
  assert.ok(hits(reverted).length >= 10, `人格の行 ${hits(reverted).length}`);
  assert.ok(personaLines(reverted).filter((l) => SHORT_NAME.test(l)).length >= 5);
  assert.ok((await conversationLines(reverted)).some((l) => SHORT_NAME.test(l)));
});
