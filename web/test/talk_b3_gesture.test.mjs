// 第 12 波 b(B3): 返事の意図(K2)を、かわいい仕草の層の名前(B5G の約束 work/B12/K2_gesture_names.md)へ渡す。
// - 指示文の説明は約束の言葉。例に出すのは、そのキャラが使える名前だけ。画面が自分で出す仕草(待つ・聞く・考える・話す)は出さない
// - そのキャラに無い名前は近い物へ。知らない名前は none。1 つの返事で仕草は 2 回まで
// - 1 文目で頭脳が仕草を選ばなかったあいさつは greet
// 本物の頭脳は呼ばない(偽の Anthropic サーバー)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSystemPrompt, describeMotions } from '../server/prompt.mjs';
import { MAX_GESTURES_PER_REPLY, MOTION_DESCRIPTIONS, REPLY_GESTURES, SCREEN_GESTURES, gestureBudget, gestureForIntent, promptMotions, resolveMotion } from '../src/conversation/gestureNames.js';

const ROOT = join(import.meta.dirname, '..', '..');
const NORRIE = { name: 'ノリー', persona: readFileSync(join(ROOT, 'characters', 'norrie', 'persona.md'), 'utf8') };
const NORRIE_NOW = ['none', 'bow', 'nod', 'wave']; // 今のノリー(動きのファイルがある物)
// 仕草の層が入った後に画面が送る見込みの一覧(画面が自分で出す仕草も混ぜて、指示文から外れることを見る)
const CUTE_ALL = ['none', 'greet', 'happy', 'cheer', 'shy', 'surprised', 'think', 'nod', 'tilt', 'droop', 'bow', 'wave', 'shake', 'shrug', 'point', 'jump', 'idle', 'listening', 'thinking', 'talking'];
const motionsIn = (prompt) => [...prompt.matchAll(/"motion":"([a-z0-9_:-]+)"/g)].map((m) => m[1]);
const linesIn = (prompt) => [...prompt.matchAll(/^ {2}- ([a-z0-9_:-]+)(?::|$)/gm)].map((m) => m[1]);

test('約束の名前と説明: 返事で頼める名前に、約束の「何をする」と「どんな返事の時」の言葉がある', () => {
  for (const n of REPLY_GESTURES) assert.ok(MOTION_DESCRIPTIONS[n], `${n} の説明`);
  assert.match(MOTION_DESCRIPTIONS.greet, /手をふって小さく弾む.*はじめまして/);
  assert.match(MOTION_DESCRIPTIONS.shy, /うつむいて目をそらし.*照れる/);
  assert.match(MOTION_DESCRIPTIONS.droop, /しょんぼり.*ごめんね/);
  assert.equal(MAX_GESTURES_PER_REPLY, 2);
  for (const n of ['idle', 'listening', 'thinking', 'talking']) assert.ok(SCREEN_GESTURES.includes(n));
});

test('指示文の動きの一覧: 画面が自分で出す仕草は出さない。jump と cheer があれば cheer だけ。名前の形が違う物は入らない', () => {
  assert.deepEqual(promptMotions(CUTE_ALL), ['none', 'greet', 'happy', 'cheer', 'shy', 'surprised', 'think', 'nod', 'tilt', 'droop', 'bow', 'wave', 'shake', 'shrug', 'point']);
  assert.deepEqual(promptMotions(['none', 'jump', 'nod']), ['none', 'jump', 'nod'], 'cheer が無い時の jump は残す');
  const d = describeMotions(CUTE_ALL);
  assert.ok(!d.names.some((n) => SCREEN_GESTURES.includes(n)));
  const p = buildSystemPrompt({ character: NORRIE, motions: CUTE_ALL });
  const listed = linesIn(p.slice(p.indexOf('- motion は')));
  for (const n of ['idle', 'listening', 'thinking', 'talking', 'jump']) assert.ok(!listed.includes(n), `${n} を説明しない`);
  assert.match(p, /- greet: 手をふって小さく弾む/);
  assert.match(p, /1 つの返事で動きを入れるのは 2 文まで/);
});

test('例の仕草は、そのキャラが使える名前だけ(今のノリー・仕草の層のノリー・動きが無いキャラ)', () => {
  for (const motions of [NORRIE_NOW, CUTE_ALL, ['none']]) {
    const allowed = new Set(['none', ...promptMotions(motions)]);
    for (const place of [undefined, { landmarks: [{ name: 'お手洗い', where: '左奥' }] }]) {
      const used = motionsIn(buildSystemPrompt({ character: NORRIE, place, motions }));
      assert.ok(used.length >= 4, JSON.stringify(motions));
      for (const m of used) assert.ok(allowed.has(m), `${JSON.stringify(motions)} の例に ${m}`);
    }
  }
  // 仕草の層が入ったら、あいさつは greet・ほめ言葉は shy・聞き返しは tilt・あやまるのは droop
  const cute = motionsIn(buildSystemPrompt({ character: NORRIE, motions: CUTE_ALL }));
  for (const m of ['greet', 'shy', 'tilt', 'droop']) assert.ok(cute.includes(m), m);
  // 今のノリー: あいさつは wave(greet の近い物)
  assert.equal(motionsIn(buildSystemPrompt({ character: NORRIE, motions: NORRIE_NOW }))[0], 'wave');
});

test('頭脳の選んだ名前を、使える名前にする(近い物へ。画面が出す仕草・知らない名前は none)', () => {
  assert.equal(resolveMotion('greet', NORRIE_NOW), 'wave');
  assert.equal(resolveMotion('cheer', NORRIE_NOW), 'wave');
  assert.equal(resolveMotion('shy', NORRIE_NOW), 'nod');
  assert.equal(resolveMotion('droop', NORRIE_NOW), 'nod');
  assert.equal(resolveMotion('jump', CUTE_ALL), 'jump', '使える名前ならそのまま(画面が cheer と同じに動かす)');
  assert.equal(resolveMotion('jump', ['none', 'cheer', 'nod']), 'cheer');
  assert.equal(resolveMotion('NOD', NORRIE_NOW), 'nod');
  assert.equal(resolveMotion('hello', CUTE_ALL), 'greet');
  for (const n of ['listening', 'thinking', 'talking', 'idle', 'talk', 'dance', '', null, undefined, 'none']) assert.equal(resolveMotion(n, CUTE_ALL), 'none', String(n));
  assert.equal(resolveMotion('greet', ['none']), 'none');
});

test('1 文目の気持ちから仕草: あいさつは greet(無ければ近い物)、驚きは surprised、ほかは none(表情の小さな仕草は画面が付ける)', () => {
  assert.equal(gestureForIntent({ stage: 'greet' }, CUTE_ALL), 'greet');
  assert.equal(gestureForIntent({ stage: 'greet' }, NORRIE_NOW), 'wave');
  assert.equal(gestureForIntent({ stage: 'chat', expression: 'surprised' }, CUTE_ALL), 'surprised');
  assert.equal(gestureForIntent({ stage: 'chat', expression: 'happy' }, CUTE_ALL), 'none');
  const take = gestureBudget();
  assert.deepEqual(['nod', 'none', 'greet', 'shy', 'nod'].map(take), ['nod', 'none', 'greet', 'none', 'none']);
});

async function withFakeBrain(lines, fn) {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const l of lines) res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${l}\n` } })}\n\n`);
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const keep = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_API_URL };
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  try {
    const { runTurn } = await import('../server/brain.mjs');
    return await fn(runTurn);
  } finally {
    server.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', keep.key], ['ANTHROPIC_API_URL', keep.url]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('本物の頭脳の道: 1 文目のあいさつに仕草が無ければ greet。仕草は 2 回まで。使えない名前は近い物へ、画面が出す仕草は none', async () => {
  const say = (text, motion, extra = '') => `{"type":"say","text":"${text}","expression":"happy","motion":"${motion}","gaze":"person"${extra}}`;
  const lines = [
    say('こんにちは!', 'none', ',"intent":"あいさつ","stage":"greet","handoff":false'),
    say('ノリーデス。', 'shy'),
    say('うれしいデス。', 'cheer'),
    say('よろしくデス。', 'listening'),
  ];
  await withFakeBrain(lines, async (runTurn) => {
    for (const [motions, want] of [[CUTE_ALL, ['greet', 'shy', 'none', 'none']], [NORRIE_NOW, ['wave', 'nod', 'none', 'none']]]) {
      const events = [];
      await runTurn({ text: 'こんにちは', character: NORRIE, motions }, { onEvent: (e) => events.push(e) });
      assert.deepEqual(events.filter((e) => e.type === 'say').map((e) => e.motion), want, JSON.stringify(motions));
    }
  });
});

test('約束の相手(B5G の cuteLayer.js)が入ったら、返事の名前がその一覧に全部ある', { skip: !existsSync(join(ROOT, 'web', 'src', 'character', 'cuteLayer.js')) }, async () => {
  const cute = await import(pathToFileURL(join(ROOT, 'web', 'src', 'character', 'cuteLayer.js')).href);
  const list = new Set(Array.isArray(cute.CUTE_GESTURES) ? cute.CUTE_GESTURES : Object.keys(cute.CUTE_GESTURES ?? {}));
  for (const n of REPLY_GESTURES.filter((g) => g !== 'none' && g !== 'jump')) assert.ok(list.has(n), `仕草の層に ${n} が無い`);
});
