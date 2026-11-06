// 2D の部品の扱い(SVG の切り出し・口 3 形・表情の落とし先・parts.json の点検)。three も DOM も使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractGroup, faceVariants, listGroupIds, mouthShape, partSvg, pickFaceId, validateParts } from '../src/char2d/parts.js';
import { normalizeIntent } from '../src/char2d/intentLocal.js';

const DIR = new URL('../../characters/yokoso/2d/', import.meta.url);
const spec = JSON.parse(fs.readFileSync(new URL('parts.json', DIR), 'utf8'));
const svg = fs.readFileSync(new URL(spec.svg, DIR), 'utf8');

test('作例(ようこそくん)の parts.json と SVG は点検で問題 0 件', () => {
  assert.deepEqual(validateParts(spec, svg), []);
});

test('入れ子の <g> を数えて、部品を丸ごと切り出す', () => {
  const body = extractGroup(svg, 'body');
  assert.match(body, /^<g id="body">/);
  assert.match(body, /ようこそ/); // 中の <g transform> の中身まで入る
  assert.equal((body.match(/<g\b/g) ?? []).length, (body.match(/<\/g>/g) ?? []).length);
  assert.equal(extractGroup(svg, 'ない部品'), null);
  assert.throws(() => extractGroup('<svg><g id="a"><g></svg>', 'a'), /閉じていません/);
});

test('部品の SVG は、viewBox が部品の箱で、グラデーションの defs も持つ', () => {
  const s = partSvg(svg, 'head', spec.parts.head.box, 0.5);
  assert.match(s, /viewBox="220 60 560 560" width="280" height="280"/);
  assert.match(s, /<defs>[\s\S]*gGreen/);
  assert.doesNotMatch(s, /id="body"/);
});

test('口 3 形のしきい値と、行き来を防ぐ余白', () => {
  assert.equal(mouthShape(0), 'mouth_closed');
  assert.equal(mouthShape(0.2), 'mouth_half');
  assert.equal(mouthShape(0.8), 'mouth_open');
  assert.equal(mouthShape(Number.NaN), 'mouth_closed');
  assert.equal(mouthShape(0.44, 'mouth_open'), 'mouth_open'); // 開いていたら少し閉じても開きのまま
  assert.equal(mouthShape(0.44, 'mouth_closed'), 'mouth_half');
  assert.equal(mouthShape(0.1, 'mouth_half'), 'mouth_half');
});

test('表情の落とし先: 描いていない枠は近い表情 → neutral の順', () => {
  const v = faceVariants(listGroupIds(svg));
  assert.equal(pickFaceId(v, 'happy', 'eyes'), 'face.happy.eyes');
  assert.equal(pickFaceId(v, 'relaxed', 'mouth_half'), 'face.neutral.mouth_half');
  assert.equal(pickFaceId(v, 'wink', 'eyes'), 'face.happy.eyes');
  assert.equal(pickFaceId(v, 'happy', 'brows'), null); // 眉はどこにも無い表情がある
  assert.equal(pickFaceId(v, 'wink', 'eyes', { wink: 'think' }), 'face.think.eyes'); // キャラの決めた落とし先が先
});

test('点検は、足りない物を日本語で返す', () => {
  const broken = svg.replace('id="face.neutral.mouth_open"', 'id="face.neutral.mouthopen"');
  const p = validateParts(spec, broken);
  assert.ok(p.some((s) => s.includes('face.neutral.mouth_open が無い')));
  assert.ok(p.some((s) => s.includes('顔の id の形が違う')));
  const noHead = { ...spec, parts: { ...spec.parts } };
  delete noHead.parts.head;
  assert.ok(validateParts(noHead, svg).some((s) => s.includes('head')));
});

test('意図の形をそろえる: 欄が無くても壊れた値でも既定の値になる', () => {
  assert.deepEqual(normalizeIntent(), { emotion: 'neutral', intensity: 1, gesture: 'none', gaze: null, mouth: 0 });
  assert.deepEqual(normalizeIntent({ emotion: 'happy', intensity: 5, mouth: -1, gesture: '' }), { emotion: 'happy', intensity: 1, gesture: 'none', gaze: null, mouth: 0 });
  assert.equal(normalizeIntent(null).emotion, 'neutral');
});
