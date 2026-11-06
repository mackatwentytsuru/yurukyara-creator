// 改行の形(LF・CRLF)が違っても、頭脳に同じ文が渡るかの試験(合わせ③の差し戻しの直し)。
// Windows の取り出し(core.autocrlf=true)では characters/<id>/persona.md が CRLF になる。画面は persona.md をそのまま読んで送る。
// サーバーの入口(validate.mjs の sanitizeChatBody)が LF にそろえ、人格の読み込み(sanitizePersona)も行を LF でつなぐ。
// 確かめること: どのキャラでも、LF と CRLF で ①指示文(2 段とも)②初めてのあいさつ ③仮の頭脳の返事 ④長さの上限で切れる所 が同じ。
// この木が LF でも CRLF でも、両方の形をここで作って比べる(取り出し方に左右されない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, sanitizeChatBody } from '../server/validate.mjs';
import { buildSystemBlocks } from '../server/prompt.mjs';
import { firstGreeting } from '../server/greeting.mjs';
import { runTurn } from '../server/brain.mjs';
import { SAFETY_RULES } from '../server/safety.mjs';

const CHARACTERS = join(import.meta.dirname, '..', '..', 'characters');
const lf = (s) => s.replace(/\r\n/g, '\n');
const crlf = (s) => lf(s).replace(/\n/g, '\r\n');

const PERSONAS = readdirSync(CHARACTERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(CHARACTERS, d.name, 'persona.md')))
  .map((d) => ({ id: d.name, raw: readFileSync(join(CHARACTERS, d.name, 'persona.md'), 'utf8') }));

/** サーバーと同じ道: 本文の点検(sanitizeChatBody)→ 指示文(runTurn と同じ材料で buildSystemBlocks) */
function systemFor(persona, place = {}) {
  const body = sanitizeChatBody({ text: 'こんにちは', character: { name: 'テスト', persona }, place });
  return buildSystemBlocks({ character: body.character, place: body.place, expressionHints: body.expressionHints });
}

/** 仮の頭脳の 1 回(安全の層も通る)。返ってきた出来事を順に集める */
async function mockTurn(persona, text) {
  const events = [];
  const body = sanitizeChatBody({ text, character: { name: 'テスト', persona } });
  await runTurn(body, { onEvent: (ev) => events.push(ev), brain: 'mock', paceMs: 0 });
  return events;
}

test('人格の文を読めている(試験が空振りしていない)。主役ノリーを含む', () => {
  assert.ok(PERSONAS.length >= 2, `人格の文が ${PERSONAS.length} 個`);
  assert.ok(PERSONAS.some((p) => p.id === 'norrie'), 'characters/norrie/persona.md が無い');
});

for (const { id, raw } of PERSONAS) {
  test(`${id}: LF と CRLF で、頭脳に渡る指示文が 1 文字も違わず、CR を含まない。1 段目は安全の決まり`, () => {
    const a = systemFor(lf(raw));
    const b = systemFor(crlf(raw));
    const asIs = systemFor(raw); // 取り出したまま
    assert.deepEqual(b, a);
    assert.deepEqual(asIs, a);
    assert.equal(a[0], SAFETY_RULES);
    for (const block of a) assert.ok(!block.includes('\r'), 'CR が残っている');
  });

  test(`${id}: LF と CRLF で、初めてのあいさつと仮の頭脳の返事が同じ`, async () => {
    assert.deepEqual(firstGreeting(crlf(raw)), firstGreeting(lf(raw)));
    for (const text of ['はじめまして', 'こんにちは', 'ねえ、恋人になってよ']) {
      assert.deepEqual(await mockTurn(crlf(raw), text), await mockTurn(lf(raw), text), text);
    }
  });
}

test('長さの上限は、改行をそろえてから数える(CRLF でも同じ所で切れる)', () => {
  const long = Array.from({ length: 4000 }, (_, i) => `- 行${i}`).join('\n');
  assert.ok(long.length > LIMITS.persona && crlf(long).length > long.length);
  const a = sanitizeChatBody({ text: 'x', character: { persona: long } }).character.persona;
  const b = sanitizeChatBody({ text: 'x', character: { persona: crlf(long) } }).character.persona;
  assert.equal(b, a);
  assert.equal(a.length, LIMITS.persona);
  assert.ok(!b.includes('\r'));
});

test('場所の説明は、どの改行(CRLF・LF・古い Mac の CR だけ)でも同じ 1 行の文にする(11-07 F6: 指示文の中に見出しを作らせない)。文の中身は変えない', () => {
  const body = (info) => sanitizeChatBody({ text: 'x', place: { info } }).place.info;
  assert.equal(body('入口は右。\r\nお手洗いは左。'), '入口は右。 お手洗いは左。');
  assert.equal(body('入口は右。\rお手洗いは左。'), '入口は右。 お手洗いは左。');
  assert.equal(body('入口は右。\nお手洗いは左。'), '入口は右。 お手洗いは左。');
  assert.equal(body('改行なし'), '改行なし');
  assert.deepEqual(systemFor('- 一人称は「ぼく」。', { info: 'A\r\nB' }), systemFor('- 一人称は「ぼく」。', { info: 'A\nB' }));
});
