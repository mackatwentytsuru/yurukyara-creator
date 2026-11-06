// 2D のキャラ(SVG の部品を板に描く)に、動きの意図(契約 K2)の列 10 個を流す試験。
// 合格: 10 個とも例外なく最後まで動き、表情は出せる物へ落ち、口は 3 形、まばたき・動きが板に出る。
// K2 の正本(S5 の web/src/character/intent.js)が出来たら、その applyIntent で同じ列を流す。無ければ S2 の仮の版。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Svg2DCharacter } from '../src/char2d/svg2dCharacter.js';
import * as localIntent from '../src/char2d/intentLocal.js';
import { STANDARD_EXPRESSIONS } from '../src/character/expressionNames.js';

const DIR = new URL('../../characters/yokoso/2d/', import.meta.url);
const spec = JSON.parse(fs.readFileSync(new URL('parts.json', DIR), 'utf8'));
const svg = fs.readFileSync(new URL(spec.svg, DIR), 'utf8');

let k2 = null;
try {
  const mod = await import('../src/character/intent.js');
  if (typeof mod.applyIntent === 'function') k2 = mod;
} catch {
  // まだ無い(S5 が金 20:00 に固める)
}
const intentApi = k2 ?? localIntent;

function make() {
  const sizes = [];
  const rasterize = (text, size) => {
    assert.match(text, /^<svg [^>]*viewBox="[\d.\s-]+"/);
    sizes.push(size);
    return new THREE.Texture();
  };
  const c = new Svg2DCharacter({ spec, svg, rasterize });
  return { c, sizes };
}

const visibleIn = (c, slot) => c.slotGroups[slot]?.children.filter((m) => m.visible).map((m) => m.name.replace('2d:', '')) ?? [];
const visibleMouth = (c) => ['mouth_closed', 'mouth_half', 'mouth_open'].flatMap((s) => visibleIn(c, s));

function run(c, seconds, onFrame) {
  const dt = 1 / 30;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    c.update(dt);
    onFrame?.(c);
  }
}

function allFinite(c) {
  let ok = true;
  c.object3d.updateMatrixWorld(true);
  c.object3d.traverse((o) => {
    if (!o.matrixWorld.elements.every(Number.isFinite)) ok = false;
  });
  return ok;
}

// 意図の列 10 個。want は流した後の 2D の状態
const INTENTS = [
  { intent: { emotion: 'neutral', intensity: 1, gesture: 'none', gaze: 'user', mouth: 0 }, want: { emotion: 'neutral', mouth: 'face.neutral.mouth_closed', eyes: 'face.neutral.eyes', brows: null } },
  { intent: { emotion: 'happy', intensity: 1, gesture: 'wave', gaze: 'user', mouth: 0.7 }, want: { emotion: 'happy', mouth: 'face.happy.mouth_open', eyes: 'face.happy.eyes', brows: null, played: true }, check: 'armUp' },
  { intent: { emotion: 'surprised', intensity: 0.9, gesture: 'none', gaze: 'user', mouth: 0.3 }, want: { emotion: 'surprised', mouth: 'face.surprised.mouth_half', eyes: 'face.surprised.eyes', brows: 'face.surprised.brows' } },
  { intent: { emotion: 'sad', intensity: 0.8, gesture: 'bow', gaze: 'away', mouth: 0 }, want: { emotion: 'sad', mouth: 'face.sad.mouth_closed', eyes: 'face.sad.eyes', brows: 'face.sad.brows', played: true }, check: 'bow' },
  { intent: { emotion: 'angry', intensity: 0.7, gesture: 'shake', gaze: 'user', mouth: 0.9 }, want: { emotion: 'angry', mouth: 'face.angry.mouth_open', eyes: 'face.angry.eyes', brows: 'face.angry.brows', played: true }, check: 'shake' },
  // relaxed に半開きの口は描いていない → neutral の半開きに落ちる
  { intent: { emotion: 'relaxed', intensity: 0.6, gesture: 'nod', gaze: 'user', mouth: 0.25 }, want: { emotion: 'relaxed', mouth: 'face.neutral.mouth_half', eyes: 'face.relaxed.eyes', brows: null, played: true }, check: 'nod' },
  { intent: { emotion: 'think', intensity: 1, gesture: 'think', gaze: { x: 1, y: 1.6, z: 1 }, mouth: 0 }, want: { emotion: 'think', mouth: 'face.think.mouth_closed', eyes: 'face.think.eyes', brows: 'face.think.brows', played: true }, check: 'tilt' },
  // 2D に無い表情 wink → 近い happy
  { intent: { emotion: 'wink', intensity: 1, gesture: 'tilt', gaze: 'user', mouth: 0 }, want: { emotion: 'wink', mouth: 'face.happy.mouth_closed', eyes: 'face.happy.eyes', brows: null, played: true }, check: 'tilt' },
  // 知らない表情と知らない動き → neutral、動きは始まらない(例外も出ない)
  { intent: { emotion: 'なぞの表情', intensity: 1, gesture: 'dance', gaze: [0.5, 1.2, 2], mouth: 0.5 }, want: { emotion: 'なぞの表情', mouth: 'face.neutral.mouth_open', eyes: 'face.neutral.eyes', brows: null, played: false } },
  // 弱い表情は neutral。壊れた値(NaN・欄なし)でも止まらない
  { intent: { emotion: 'happy', intensity: 0.1, gesture: 'shrug', gaze: 'away', mouth: Number.NaN }, want: { emotion: 'neutral', mouth: 'face.neutral.mouth_closed', eyes: 'face.neutral.eyes', brows: null, played: true }, check: 'shrug' },
];

test(`意図の列 10 個を 2D に流す(受け手: ${k2 ? 'K2 の intent.js' : 'S2 の仮の版'})`, () => {
  const { c } = make();
  assert.equal(INTENTS.length, 10);
  for (const [i, { intent, want, check }] of INTENTS.entries()) {
    const label = `${i + 1}: ${intent.emotion}/${intent.gesture}`;
    const res = intentApi.applyIntent(c, intent, { userPosition: [0, 1.4, 2] });
    if ('played' in want && res && 'played' in res) assert.equal(res.played, want.played, `${label} 動きが始まったか`);
    const seen = { armMin: 0, armMax: 0, headYMin: Infinity, headYMax: -Infinity, upperMin: 1, headRotMax: 0, headXMin: Infinity, headXMax: -Infinity };
    const headY0 = c.groups.head.userData.base.y;
    run(c, 1.6, (cc) => {
      const h = cc.groups.head;
      seen.armMin = Math.min(seen.armMin, cc.groups.arm_r.rotation.z, cc.groups.arm_l.rotation.z);
      seen.armMax = Math.max(seen.armMax, cc.groups.arm_r.rotation.z, cc.groups.arm_l.rotation.z);
      seen.headYMin = Math.min(seen.headYMin, h.position.y - headY0);
      seen.headYMax = Math.max(seen.headYMax, h.position.y - headY0);
      seen.headXMin = Math.min(seen.headXMin, h.position.x);
      seen.headXMax = Math.max(seen.headXMax, h.position.x);
      seen.upperMin = Math.min(seen.upperMin, cc.upper.scale.y);
      seen.headRotMax = Math.max(seen.headRotMax, Math.abs(h.rotation.z));
    });
    const wantEmotion = want.emotion === 'neutral' || c.canShow(want.emotion) ? want.emotion : null;
    if (wantEmotion) assert.equal(c.state2d.emotion, wantEmotion, `${label} 表情`);
    assert.deepEqual(visibleMouth(c), [want.mouth.replace(/^face\./, 'face.')], `${label} 口`);
    assert.deepEqual(visibleIn(c, 'eyes'), [want.eyes], `${label} 目`);
    assert.deepEqual(visibleIn(c, 'brows'), want.brows ? [want.brows] : [], `${label} 眉`);
    assert.ok(allFinite(c), `${label} 板の位置が数になっている`);
    if (check === 'armUp') assert.ok(seen.armMin < -1.2, `${label} 右腕が上がる (${seen.armMin.toFixed(2)})`);
    if (check === 'bow') assert.ok(seen.upperMin < 0.8, `${label} 上半身が前へ倒れる (${seen.upperMin.toFixed(2)})`);
    if (check === 'nod') assert.ok(seen.headYMax - seen.headYMin > 0.01, `${label} 頭が上下にうなずく (${(seen.headYMax - seen.headYMin).toFixed(3)})`);
    if (check === 'shake') assert.ok(seen.headXMax - seen.headXMin > 0.02, `${label} 頭が左右に動く`);
    if (check === 'tilt') assert.ok(seen.headRotMax > 0.05, `${label} 頭がかしぐ (${seen.headRotMax.toFixed(3)})`);
    if (check === 'shrug') assert.ok(seen.armMax > 0.1 && seen.armMin < -0.1, `${label} 両腕が少し上がる`);
  }
});

test('まばたき: 目を開いた表情では閉じる時があり、目を閉じた絵(happy)ではつぶさない', () => {
  const { c } = make();
  c.setEmotion('neutral', 1);
  let min = 1;
  run(c, 8, (cc) => (min = Math.min(min, cc.state2d.eyesScaleY)));
  assert.ok(min < 0.3, `neutral でまばたきする (${min.toFixed(2)})`);
  c.setEmotion('happy', 1);
  run(c, 0.5);
  let minHappy = 1;
  run(c, 8, (cc) => (minHappy = Math.min(minHappy, cc.state2d.eyesScaleY)));
  assert.equal(minHappy, 1);
});

test('口 3 形: 話す音の大きさに合わせて閉じ・半開き・開きを行き来する', () => {
  const { c } = make();
  const shapes = new Set();
  for (let i = 0; i < 90; i++) {
    c.setMouth(0.5 + 0.5 * Math.sin(i * 0.4));
    c.update(1 / 30);
    shapes.add(c.state2d.mouthShape);
  }
  assert.deepEqual([...shapes].sort(), ['mouth_closed', 'mouth_half', 'mouth_open']);
});

test('標準の 7 表情は全部 2D で描いてあり、どの表情でも目と口 3 形が必ず 1 つ出る', () => {
  const { c } = make();
  for (const e of STANDARD_EXPRESSIONS) assert.ok(c.canShow(e), `${e} が描いてある`);
  for (const e of [...STANDARD_EXPRESSIONS, 'wink', 'shy', 'cry', 'pout', '照れ', 'unknown']) {
    for (const m of [0, 0.3, 0.9]) {
      c.setEmotion(e, 1);
      c.setMouth(m);
      run(c, 0.6);
      assert.equal(visibleIn(c, 'eyes').length, 1, `${e} 目`);
      assert.equal(visibleMouth(c).length, 1, `${e} 口 ${m}`);
    }
  }
});

test('部品の画像は部品の箱の大きさだけ作る(全身の大きさを部品の数だけ作らない)', () => {
  const { c, sizes } = make();
  const total = sizes.reduce((a, s) => a + s.w * s.h, 0);
  const full = spec.viewBox[2] * spec.viewBox[3];
  assert.ok(total < full * 2, `部品の画素の合計 ${total} が全身 2 枚分 ${full * 2} より少ない`);
  assert.equal(c.kind, '2d');
  assert.ok(c.object3d.getObjectByName('2d:head'));
});
