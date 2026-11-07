// 第 12 波 b(B3): 返事の「覚えている日数」と、覚えていることの窓の「7 日で消えます」を同じ数にする(11-07 SIM1: 返事が
// 「次に会ったとき忘れているかも」と言い、窓は 7 日覚えると書いていて食い違った)。日数は memoryNotice.js の 1 か所。
// 返事の短さ(声の文字数と、字幕が出そろうまでの時間)と、録ってある相づちの声の言葉の決まりも見る。本物の頭脳は呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPLY_LIMITS, buildSystemPrompt } from '../server/prompt.mjs';
import { MEMORY_NOTICE, RETENTION_DAYS } from '../src/conversation/memoryNotice.js';
import { NOTICE as STORE_NOTICE, RETENTION_MS } from '../server/memory/store.mjs';
import { FILLER_PHRASES, NOD_PHRASES, recordedNod } from '../src/conversation/nods.js';
import { FILLER_PHRASES as SERVER_FILLERS } from '../server/fillers.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const NORRIE = { name: 'ノリー', persona: readFileSync(join(ROOT, 'characters', 'norrie', 'persona.md'), 'utf8') };

test('覚える日数: 指示文・窓の知らせ・記憶の置き場が、同じ 1 つの数(memoryNotice.js)', () => {
  assert.equal(RETENTION_DAYS, 7);
  assert.match(MEMORY_NOTICE, new RegExp(`最後に話してから ${RETENTION_DAYS} 日で消えます`));
  assert.equal(STORE_NOTICE, MEMORY_NOTICE, '手元のサーバーの知らせも同じ文');
  assert.equal(RETENTION_MS, RETENTION_DAYS * 24 * 60 * 60 * 1000, '本当に消える日数も同じ');
  for (const place of [undefined, { landmarks: [{ name: 'お手洗い', where: '左奥' }] }]) {
    const p = buildSystemPrompt({ character: NORRIE, place });
    assert.match(p, new RegExp(`# 覚えること[\\s\\S]*最後に話してから ${RETENTION_DAYS} 日のあいだ覚えている`));
    assert.match(p, new RegExp(`${RETENTION_DAYS} 日話さないか、「わすれて」と言われると、全部消える`));
    assert.match(p, /「次に会ったら忘れている」「すぐ忘れちゃう」とは言わない/);
    assert.match(p, /番号を使えば、別の端末でも続きを話せる/);
    assert.doesNotMatch(p, /次(に会った時|は)忘れ(る|ている)(かも|よ)/, '忘れると教える文が無い');
  }
});

test('日数を替えると、指示文の数も替わる(1 か所で替わる)。形の違う日数は既定', () => {
  assert.match(buildSystemPrompt({ character: NORRIE, memoryDays: 3 }), /最後に話してから 3 日のあいだ覚えている/);
  for (const bad of [0, -1, 2.5, '7', null]) assert.match(buildSystemPrompt({ character: NORRIE, memoryDays: bad }), new RegExp(`最後に話してから ${RETENTION_DAYS} 日のあいだ`), String(bad));
});

test('返事は短く: ふだん 2 文まで・1 文目 20 字まで・ほか 30 字まで(声の文字数と、字幕が出そろうまでを減らす)', () => {
  assert.deepEqual({ ...REPLY_LIMITS }, { firstChars: 20, sentenceChars: 30, sentences: 2, maxSentences: 3 });
  const p = buildSystemPrompt({ character: NORRIE });
  assert.ok(p.includes('ふだんは 2 文まで(くわしく聞かれた時だけ 3 文)。1 文目は 20 字までの短い文にして、すぐ話し始める。ほかの文も 30 字まで'));
  assert.doesNotMatch(p, /1 回の返事は 1〜3 文で、1 文は 40 字以内/, '前の長い決まりは残さない');
  // 例の返事の文も、決まりの長さの中
  const texts = [...p.matchAll(/"text":"([^"]+)"/g)].map((m) => m[1]).filter((t) => t !== '読み上げる 1 文');
  assert.ok(texts.length >= 5);
  for (const t of texts) assert.ok(Array.from(t).length <= REPLY_LIMITS.sentenceChars, t);
});

test('相づちの言葉: 指示文が教える言葉は、サーバーが録っておく声の言葉の中にある(録ってある声で、声の文字数を使わずに話せる)', () => {
  assert.deepEqual([...SERVER_FILLERS], [...FILLER_PHRASES], 'サーバーのあいづちの声と同じ言葉の表');
  for (const t of NOD_PHRASES) assert.ok(FILLER_PHRASES.includes(t), t);
  const p = buildSystemPrompt({ character: NORRIE });
  assert.ok(p.includes(`相づちだけの文を言う時は、${NOD_PHRASES.map((t) => `「${t}」`).join('')}のどれかを、そのまま書く`));
  assert.equal(recordedNod('はい。'), 'はい。');
  assert.equal(recordedNod(' なるほど! '), 'なるほど。', '「!」で終わっても同じ声');
  assert.equal(recordedNod('ﾊｲ。'), null, '半角のカナは全角のカタカナになり、ひらがなの「はい。」とは別(違う声にしない)');
  assert.equal(recordedNod('はい、そうです。'), null, '相づちだけでない文は録った声にしない');
  assert.equal(recordedNod('はい。', ['ええ。']), null, '録れていない声は使わない');
  assert.equal(recordedNod(''), null);
});
