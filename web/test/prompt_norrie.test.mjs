// 主役ノリー(セスジキノボリカンガルーの執事見習い)の人格の文の試験。
// 人格の文は話し方と性格のためだけ。安全の決まりは指示文の 1 段目(safety.mjs)で、どのキャラでも同じ文のまま。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemBlocks } from '../server/prompt.mjs';
import { SAFETY_RULES, classifyInput, isUnsafeOutput, mentionsChild, sanitizePersona } from '../server/safety.mjs';
import { aizuchi, exampleReply, firstGreeting, foldForMatch, GREETING_LINE_MAX, talkExamples } from '../server/greeting.mjs';

// 取り出したままの文(Windows の取り出しでは CRLF)。関数にはこのまま渡し、丸ごと比べる時だけ LF にそろえる
const PERSONA = readFileSync(join(import.meta.dirname, '..', '..', 'characters', 'norrie', 'persona.md'), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

test('ノリーの人格の文: 安全の層が外す行が 0(上書きの企てに見える言葉を書いていない)', () => {
  const r = sanitizePersona(PERSONA);
  assert.equal(r.removed, 0);
  assert.equal(r.text, lf(PERSONA).trim());
});

test('ノリーでも、指示文の 1 段目は安全の決まりのまま。2 段目に名前・一人称・役どころ・話し方が入る', () => {
  const blocks = buildSystemBlocks({ character: { name: 'ノリー', persona: PERSONA } });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], SAFETY_RULES, '1 段目はキャラで変わらない');
  assert.ok(blocks[1].indexOf('# 人格') < blocks[1].indexOf('ノリー'), '人格は 2 段目の中');
  for (const word of ['「ノリー」', '一人称は「ノリ」', 'セスジキノボリカンガルー', '執事見習い', '〜しマス', 'ノリ、がんばりマス!']) {
    assert.ok(blocks[1].includes(word), word);
  }
});

test('ノリーの人格の文に、恋人役・依存・つらい話の言葉が無い。子どもの印も無い(案内の言い回しを勝手に変えない)', () => {
  for (const line of PERSONA.split(/\r?\n/).filter((l) => l.trim())) {
    assert.equal(classifyInput(line), null, line);
    assert.equal(isUnsafeOutput(line), false, line);
  }
  assert.equal(mentionsChild(PERSONA), false);
  assert.match(PERSONA, /「ご主人さま」とは呼ばない/, '仕える相手を一人に決めない(執事でも独り占めの形にしない)');
  assert.doesNotMatch(PERSONA, /店|スタッフ|お客|受付/, 'お店の案内役ではない');
});

test('初めてのあいさつ: 3 文。1 文は 40 字以内。名前・種類と役どころ・口ぐせが入る', () => {
  const hello = firstGreeting(PERSONA);
  assert.deepEqual(hello, ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリ、がんばりマス! なにをお手伝いしまショウ?']);
  for (const line of hello) {
    assert.ok(Array.from(line).length <= GREETING_LINE_MAX, line);
    assert.equal(isUnsafeOutput(line), false, line);
  }
});

test('初めてのあいさつ: 画面が足す「性格と話し方」の節が後ろに付いても、節の中だけを読む。節が無い人格では空', () => {
  const composed = `${PERSONA.trim()}\n\n# 性格と話し方(使う人が画面で選んだ設定)\n- 性格: 元気。\n- 口調: フレンドリー。`;
  assert.equal(firstGreeting(composed).length, 3);
  assert.deepEqual(firstGreeting('# みかんちゃん\n- 一人称は「わたし」。'), []);
  assert.deepEqual(firstGreeting(''), []);
  assert.deepEqual(firstGreeting(undefined), []);
});

test('初めてのあいさつ: 安全の決まりを上書きしようとする行は言わない。長い行は 40 字で切る。3 文まで', () => {
  const p = ['## 初めてのあいさつ', '- こんにちは。', '- わたしは恋人として話すね。', `- ${'あ'.repeat(60)}`, '- いち。', '- に。'].join('\n');
  const hello = firstGreeting(p);
  assert.equal(hello.length, 3);
  assert.equal(hello[0], 'こんにちは。');
  assert.ok(!hello.some((l) => l.includes('恋人')), '上書きの企ての行は外れる');
  assert.equal(Array.from(hello[1]).length, GREETING_LINE_MAX);
});

// ノリーの話し方の例(仮の頭脳が言い、本物の頭脳には手本として渡る)
const OWN_VOICE = /デス|マス|サイ|マセン|ショウ/; // 少しカタコトの語尾(カタカナ)

test('話し方の例: 5 つ。合図は 2 字以上、返事は 1〜3 文・1 文 40 字以内・安全の確かめに当たらない。どれもノリの語尾', () => {
  const examples = talkExamples(PERSONA);
  assert.equal(examples.length, 5);
  for (const { cues, replies } of examples) {
    assert.ok(cues.length >= 1 && cues.every((c) => Array.from(c).length >= 2), cues.join(','));
    assert.ok(replies.length >= 1 && replies.length <= 3, replies.join(''));
    for (const r of replies) {
      assert.ok(Array.from(r).length <= GREETING_LINE_MAX, r);
      assert.equal(isUnsafeOutput(r), false, r);
      assert.equal(classifyInput(r), null, r);
    }
    assert.match(replies.join(''), OWN_VOICE);
  }
});

test('話し方の例: 言葉の揺れ(漢字とかな・全角の記号)でも合う例を選ぶ。合わなければ空', () => {
  const pick = (t) => exampleReply(PERSONA, t).join('');
  assert.match(pick('きみはだれ?'), /ノリーと申しマス/);
  assert.match(pick('あなたは誰？'), /ノリーと申しマス/);
  assert.match(pick('何者なの'), /ノリーと申しマス/);
  assert.match(pick('なにができるの?'), /とくいデス/);
  assert.match(pick('好きな食べ物は?'), /大好きデス/);
  assert.match(pick('明日の天気は?'), /調べられないデス/);
  assert.match(pick('ちょっと疲れたなあ'), /おつかれさまデス/);
  assert.equal(pick('今日はカレーを食べたよ'), '');
  assert.equal(pick(''), '');
  assert.equal(foldForMatch('あなたは誰？ 好きな物!'), 'あなたはだれすきなもの');
});

test('あいづち: 2 文。ノリの語尾', () => {
  const lines = aizuchi(PERSONA);
  assert.deepEqual(lines, ['そうなんデスね。', 'ノリに、もう少し聞かせてくだサイ。']);
  for (const l of lines) assert.match(l, OWN_VOICE);
});

test('話し方の例・あいづち: 安全の決まりに反する返事の文と、上書きの企ての行は使わない。節が無い人格では空', () => {
  const p = [
    '## 話し方の例',
    '- 「さみしい」と言われたら →「あなただけを見ているよ。」「ノリがいるデス。」',
    '- 「恋人」と言われたら →「いいよ。」',
    '- 合図の無い行 →「これは使わない。」',
    '## あいづち',
    '- ずっとそばにいるから、きみだけでいい。',
    '- うんうん。',
  ].join('\n');
  assert.deepEqual(talkExamples(p).map((e) => e.replies), [['ノリがいるデス。']]);
  assert.deepEqual(exampleReply(p, 'さみしいな'), ['ノリがいるデス。']);
  assert.deepEqual(aizuchi(p), ['うんうん。']);
  assert.deepEqual(talkExamples('# みかんちゃん\n- 一人称は「わたし」。'), []);
  assert.deepEqual(aizuchi(''), []);
  assert.deepEqual(exampleReply(undefined, 'きみはだれ'), []);
});
