// カスタムの表情(ウインク・照れ など)の扱い: 出せるキャラはそのまま、出せないキャラは近い表情に落とす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nearestExpression } from '../src/character/expressionNames.js';
import { VrmCharacter } from '../src/character/vrmCharacter.js';
import { buildSystemPrompt } from '../server/prompt.mjs';
import { normalizeEvent } from '../server/brain.mjs';
import { sanitizeChatBody } from '../server/validate.mjs';

const only = (...names) => (n) => names.includes(n);

test('近い表情: 出せるならそのまま、出せなければ標準の物に落とす', () => {
  assert.equal(nearestExpression('wink', only('neutral', 'happy', 'wink')), 'wink');
  assert.equal(nearestExpression('wink', only('neutral', 'happy')), 'happy');
  assert.equal(nearestExpression('cry', only('neutral', 'sad')), 'sad');
  assert.equal(nearestExpression('bigSmile', only('neutral', 'happy')), 'happy'); // 大文字小文字
  assert.equal(nearestExpression('big_smile', only('neutral', 'happy')), 'happy'); // _ の違い
  assert.equal(nearestExpression('泣き顔', only('neutral', 'sad')), 'sad');
  assert.equal(nearestExpression('wink', only('neutral')), 'neutral'); // 近い物も無ければ neutral
  assert.equal(nearestExpression('wink', only('happy')), 'happy'); // neutral が無くても、近い物があればそれ
  assert.equal(nearestExpression('wink', only('surprised')), null); // 近い物も neutral も無ければ null
  assert.equal(nearestExpression('なぞの表情', only('neutral', 'happy')), 'neutral');
});

test('キャラが決めた落とし先(expression_fallback)が先に使われる', () => {
  assert.equal(nearestExpression('wink', only('neutral', 'happy', 'relaxed'), { wink: 'relaxed' }), 'relaxed');
  // 落とし先もまた無ければ、さらに近い物へ(surprised は無い → neutral)
  assert.equal(nearestExpression('wink', only('neutral', 'happy'), { wink: 'surprised' }), 'neutral');
});

/** VRM の代わりの小さな見本(表情の値を記録するだけ) */
function stubVrm(names) {
  const values = new Map(names.map((n) => [n, 0]));
  const nodes = new Map();
  return {
    values,
    scene: new THREE.Object3D(),
    humanoid: {
      getNormalizedBoneNode: (n) => {
        if (!nodes.has(n)) nodes.set(n, new THREE.Object3D());
        return nodes.get(n);
      },
    },
    lookAt: null,
    expressionManager: {
      expressionMap: Object.fromEntries(names.map((n) => [n, {}])),
      setValue: (n, v) => values.has(n) && values.set(n, v),
      getValue: (n) => values.get(n),
    },
    update() {},
  };
}
const run = (c, seconds = 1.5) => {
  for (let i = 0; i < seconds * 30; i++) c.update(1 / 30);
};
const STD = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'blink', 'aa'];

test('VRM にカスタムの表情があれば、そのまま出し、ほかの感情は 0 に戻る', () => {
  const vrm = stubVrm([...STD, 'wink']);
  const c = new VrmCharacter(vrm, { expressions: ['neutral', 'happy', 'wink'] });
  assert.deepEqual(c.customKeys, ['wink']);
  c.setEmotion('happy', 0.9);
  run(c);
  assert.ok(vrm.values.get('happy') > 0.8);
  c.setEmotion('wink', 0.9);
  run(c, 3);
  assert.ok(vrm.values.get('wink') > 0.8);
  assert.ok(vrm.values.get('happy') < 0.05, 'happy は戻る');
});

test('VRM に無い表情は、近い表情に落ちる(wink → happy)。落とし先は expression_fallback で変えられる', () => {
  const vrm = stubVrm(STD);
  const c = new VrmCharacter(vrm, { expressions: ['neutral', 'happy', 'wink'] });
  c.setEmotion('wink', 0.9);
  run(c);
  assert.ok(vrm.values.get('happy') > 0.8);

  const vrm2 = stubVrm(STD);
  const c2 = new VrmCharacter(vrm2, { expressions: ['neutral', 'wink'], expressionFallback: { wink: 'relaxed' } });
  c2.setEmotion('wink', 0.9);
  run(c2);
  assert.ok(vrm2.values.get('relaxed') > 0.8);
  assert.ok(vrm2.values.get('happy') < 0.05);
});

test('think が無い VRM では、relaxed を半分で出す(これまでどおり)', () => {
  const vrm = stubVrm(STD);
  const c = new VrmCharacter(vrm, { expressions: ['neutral', 'think'] });
  c.setEmotion('think', 0.9);
  run(c);
  const v = vrm.values.get('relaxed');
  assert.ok(v > 0.35 && v < 0.5, String(v));
});

test('カスタムの表情が強いあいだは、まばたきを弱める', () => {
  const maxBlink = (emotion) => {
    const vrm = stubVrm([...STD, 'cry']);
    const c = new VrmCharacter(vrm, { expressions: ['neutral', 'cry'] });
    if (emotion) c.setEmotion(emotion, 1);
    let max = 0;
    for (let i = 0; i < 30 * 12; i++) {
      c.update(1 / 30);
      max = Math.max(max, vrm.values.get('blink'));
    }
    return max;
  };
  assert.ok(maxBlink(null) > 0.8, '感情が無ければ、まばたきは深い');
  assert.ok(maxBlink('cry') < 0.4, 'cry のあいだは弱める');
});

test('頭脳への指示に、カスタムの表情と「いつ使うか」が入る。説明が無い表情は名前だけ', () => {
  const s = buildSystemPrompt({ expressions: ['neutral', 'happy', 'wink', 'cry'], expressionHints: { wink: 'いたずらっぽいとき' } });
  assert.match(s, /expression は次から選ぶ: neutral happy wink cry/);
  assert.match(s, /wink: いたずらっぽいとき/);
  assert.doesNotMatch(s, /cry: /);
  assert.doesNotMatch(buildSystemPrompt({ expressions: ['neutral', 'happy'] }), /説明の場面/);
});

test('頭脳が一覧に無い表情を返したら、近い物に落とす(近い物も一覧に無ければ neutral)', () => {
  const ev = (expression, expressions) => normalizeEvent({ type: 'say', text: 'はい。', expression }, { expressions }).expression;
  assert.equal(ev('wink', ['neutral', 'happy']), 'happy');
  assert.equal(ev('wink', ['neutral', 'happy', 'wink']), 'wink');
  assert.equal(ev('cry', ['neutral', 'happy']), 'neutral');
  assert.equal(ev(undefined, ['neutral', 'happy']), 'neutral');
});

test('入口の検査: 表情の説明は、一覧にある名前・文字の物だけ、短くして通す', () => {
  const c = sanitizeChatBody({
    text: 'こんにちは',
    expressions: ['neutral', 'wink'],
    expressionHints: { wink: 'あ'.repeat(500), ghost: '一覧に無い', neutral: 5 },
  });
  assert.deepEqual(Object.keys(c.expressionHints), ['wink']);
  assert.equal(c.expressionHints.wink.length, 60);
  assert.deepEqual(sanitizeChatBody({ text: 'こ', expressionHints: 'x' }).expressionHints, {});
});
