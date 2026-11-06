// 動きの意図(契約 K2)の試験。形をそろえる・近い物へ落とす・5 つの呼び方に流す・2D と 3D の両方で止まらない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  EMOTIONS, INTENT_GESTURES, INTENT_VERSION, RECEIVER_METHODS, applyIntent, gestureOrder, intentFromSay,
  missingReceiverMethods, normalizeIntent, resolveEmotion, toStandardEmotion,
} from '../src/character/intent.js';
import { CharacterBase } from '../src/character/characterBase.js';
import { GESTURES } from '../src/character/gestures.js';
import { Svg2DCharacter } from '../src/char2d/svg2dCharacter.js';

/** 呼ばれた順を記録する受け手。canShow と play できる名前を決められる */
function recorder({ expressions = EMOTIONS, motions = Object.keys(GESTURES), custom = [] } = {}) {
  const calls = [];
  return {
    calls,
    expressions,
    isCustomExpression: (n) => custom.includes(n),
    lookAt: (p) => calls.push(['lookAt', p]),
    setExpression: (n, w) => calls.push(['setExpression', n, w]),
    setEmotion: (n, w) => calls.push(['setEmotion', n, w]),
    setMouth: (m) => calls.push(['setMouth', m]),
    play: (n, o) => {
      calls.push(['play', n, o]);
      return motions.includes(n);
    },
    update: () => {},
  };
}

// 今の作例の 3D(rig)と同じ表情・動きの一覧(characters/robo/character.json)
const RIG = { expressions: ['neutral', 'happy', 'surprised', 'sad', 'think'], motions: ['bow', 'nod', 'wave'] };

test('版と 7 つの表情・動きの言葉・5 つの呼び方', () => {
  assert.equal(INTENT_VERSION, 1);
  assert.deepEqual([...EMOTIONS], ['neutral', 'happy', 'surprised', 'sad', 'angry', 'relaxed', 'think']);
  for (const g of INTENT_GESTURES.filter((n) => n !== 'none' && n !== 'jump')) assert.ok(GESTURES[g], `${g} は 3D の手続きの動きにある`);
  assert.deepEqual([...RECEIVER_METHODS], ['lookAt', 'setExpression', 'setMouth', 'play', 'update']);
});

test('形をそろえる: 足りない欄・壊れた値は既定にし、例外を出さない', () => {
  assert.deepEqual(normalizeIntent(), { emotion: 'neutral', intensity: 1, gesture: 'none', gaze: null, mouth: 0 });
  for (const bad of [null, 'happy', 3, [], { emotion: 5, intensity: 'x', gesture: {}, gaze: 7, mouth: Number.NaN }]) {
    const n = normalizeIntent(bad);
    assert.equal(n.emotion, 'neutral');
    assert.equal(n.gesture, 'none');
    assert.equal(n.gaze, null);
    assert.equal(n.mouth, 0);
    assert.ok(n.intensity >= 0 && n.intensity <= 1);
  }
  assert.equal(normalizeIntent({ intensity: 3 }).intensity, 1);
  assert.equal(normalizeIntent({ intensity: -1 }).intensity, 0);
  assert.equal(normalizeIntent({ mouth: 0.4 }).mouth, 0.4);
  assert.equal(normalizeIntent({ gaze: 'person' }).gaze, 'user');
  assert.equal(normalizeIntent({ gaze: 'landmark:受付' }).gaze, 'landmark:受付');
  assert.equal(normalizeIntent({ gaze: 'landmark:' }).gaze, null);
  assert.deepEqual(normalizeIntent({ gaze: { x: 1, y: 1.6, z: 1 } }).gaze, [1, 1.6, 1]);
  assert.deepEqual(normalizeIntent({ gaze: [0.5, 1.2, 2] }).gaze, [0.5, 1.2, 2]);
  assert.equal(normalizeIntent({ gaze: [1, Number.NaN, 2] }).gaze, null);
  assert.equal(normalizeIntent({ gaze: 'どこか' }).gaze, null);
});

test('名前を 7 つの表情に直す(大文字・別名・日本語・カスタム)', () => {
  const cases = { Happy: 'happy', thinking: 'think', wink: 'happy', smile: 'happy', pout: 'angry', worried: 'sad', confused: 'surprised', びっくり: 'surprised', 照れ: 'happy', 'なぞの表情': 'neutral', '': 'neutral' };
  for (const [name, want] of Object.entries(cases)) assert.equal(toStandardEmotion(name), want, name);
});

test('出せない表情は近い物へ: rig は angry → sad、relaxed → happy。出せる独自の表情はそのまま', () => {
  const rig = (n) => RIG.expressions.includes(n);
  assert.equal(resolveEmotion('angry', rig), 'sad');
  assert.equal(resolveEmotion('relaxed', rig), 'happy');
  assert.equal(resolveEmotion('think', rig), 'think');
  assert.equal(resolveEmotion('wink', rig), 'happy');
  assert.equal(resolveEmotion('dance', rig), 'neutral');
  assert.equal(resolveEmotion('wink', (n) => n === 'wink' || n === 'neutral'), 'wink');
  assert.equal(resolveEmotion('think', (n) => n === 'neutral'), 'neutral');
  assert.equal(resolveEmotion('happy', () => false), 'neutral'); // 何も出せない受け手でも止まらない
  for (const e of EMOTIONS) assert.ok(rig(resolveEmotion(e, rig)), `${e} は rig が出せる名前になる`);
});

test('動きを試す順: 頼まれた名前 → 近い動き。知らない名前は 1 つだけ試して止める', () => {
  assert.deepEqual(gestureOrder('none'), []);
  assert.deepEqual(gestureOrder(''), []);
  assert.deepEqual(gestureOrder('think'), ['think', 'tilt', 'nod']);
  assert.deepEqual(gestureOrder('Nod'), ['Nod', 'nod']);
  assert.deepEqual(gestureOrder('おじぎ'), ['おじぎ', 'bow', 'nod']);
  assert.deepEqual(gestureOrder('dance'), ['dance']);
});

test('意図を 5 つの呼び方に流す: 表情 → 口 → 視線 → 動き の順', () => {
  const r = recorder();
  const res = applyIntent(r, { emotion: 'happy', intensity: 0.7, gesture: 'wave', gaze: 'user', mouth: 0.3 }, { userPosition: [0, 1.5, 2] });
  assert.deepEqual(r.calls, [['setEmotion', 'happy', 0.7], ['setMouth', 0.3], ['lookAt', [0, 1.5, 2]], ['play', 'wave', {}]]);
  assert.equal(res.emotion, 'happy');
  assert.equal(res.gesture, 'wave');
  assert.equal(res.played, true);
});

test('rig に無い動きは近い動きで: shake → tilt(無い)→ 動かない、think → nod', () => {
  const r = recorder(RIG);
  assert.equal(applyIntent(r, { gesture: 'shake' }).played, false);
  const res = applyIntent(r, { emotion: 'angry', gesture: 'think' });
  assert.equal(res.emotion, 'sad');
  assert.equal(res.gesture, 'nod');
  assert.equal(res.played, true);
  const tried = r.calls.filter((c) => c[0] === 'play').map((c) => c[1]);
  assert.deepEqual(tried, ['shake', 'tilt', 'think', 'tilt', 'nod']);
  assert.equal(applyIntent(r, { gesture: 'dance' }).played, false);
});

test('neutral は強さ 0(ほかの表情を戻す)、独自の表情は 1、視線 null は lookAt を呼ばない', () => {
  const r = recorder({ expressions: [...EMOTIONS, 'wink'], custom: ['wink'] });
  applyIntent(r, { emotion: 'neutral', intensity: 1 });
  applyIntent(r, { emotion: 'wink', intensity: 0.4 });
  assert.deepEqual(r.calls.filter((c) => c[0] === 'setEmotion'), [['setEmotion', 'neutral', 0], ['setEmotion', 'wink', 1]]);
  assert.equal(r.calls.filter((c) => c[0] === 'lookAt').length, 0);
});

test('画面の setGaze があれば視線はそれに任せ、目印の位置を指さしに渡す', () => {
  const r = recorder();
  const asked = [];
  const setGaze = (spec, ms) => {
    asked.push([spec, ms]);
    return spec === 'landmark:受付' ? [-1, 1, 0.5] : null;
  };
  applyIntent(r, { gaze: 'user' }, { setGaze });
  const res = applyIntent(r, { gaze: 'landmark:受付', gesture: 'point' }, { setGaze, gazeMs: 2000 });
  assert.deepEqual(asked, [['person', 2400], ['landmark:受付', 2000]]);
  assert.equal(r.calls.filter((c) => c[0] === 'lookAt').length, 0);
  assert.deepEqual(r.calls.at(-1), ['play', 'point', { dx: -1, dz: 0.5 }]);
  assert.equal(res.played, true);
});

test('setGaze が無い時: away は lookAt(null)、座標はそのまま、目印は何もしない', () => {
  const r = recorder();
  applyIntent(r, { gaze: 'away' });
  applyIntent(r, { gaze: { x: 1, y: 1.6, z: 1 } });
  applyIntent(r, { gaze: 'landmark:受付' });
  assert.deepEqual(r.calls.filter((c) => c[0] === 'lookAt'), [['lookAt', null], ['lookAt', [1, 1.6, 1]]]);
});

test('会話の say のイベントを意図にする', () => {
  assert.deepEqual(intentFromSay({ type: 'say', text: 'やあ', expression: 'happy', motion: 'nod', gaze: 'person' }), { emotion: 'happy', intensity: 0.9, gesture: 'nod', gaze: 'user', mouth: 0 });
  assert.deepEqual(intentFromSay({ type: 'say', text: '…' }), { emotion: 'neutral', intensity: 0.9, gesture: 'none', gaze: null, mouth: 0 });
  assert.deepEqual(intentFromSay(null), { emotion: 'neutral', intensity: 0.9, gesture: 'none', gaze: null, mouth: 0 });
});

// three の本物の CharacterBase(体に書く所だけ空)。表情の値・動きが本当に入るかを見る
class Probe extends CharacterBase {
  _apply(s) {
    this.last = s;
  }
}

test('本物の CharacterBase: 7 つの表情 × 動きの言葉を全部流しても止まらず、表情の値が入る', () => {
  const c = new Probe({ id: 'probe', expressions: RIG.expressions });
  assert.deepEqual(missingReceiverMethods(c), []);
  for (const emotion of [...EMOTIONS, 'wink', 'なぞ']) {
    for (const gesture of INTENT_GESTURES) {
      const res = applyIntent(c, { emotion, intensity: 0.8, gesture, gaze: 'user', mouth: 0.5 });
      assert.ok(RIG.expressions.includes(res.emotion), `${emotion} → ${res.emotion}`);
      for (let i = 0; i < 10; i++) c.update(1 / 30);
      assert.ok(Number.isFinite(c.last.headYaw) && Number.isFinite(c.last.mouth));
    }
  }
  applyIntent(c, { emotion: 'surprised', intensity: 1, gesture: 'nod' });
  for (let i = 0; i < 30; i++) c.update(1 / 30);
  assert.ok(c.exprValue.get('surprised') > 0.9, `surprised の値 ${c.exprValue.get('surprised')}`);
  assert.equal(c.playing, null); // うなずき(0.9 秒)は 1 秒で終わる
});

test('2D の板(ようこそくん)にも同じ意図が流れる: 7 つの表情が 2D の顔に出る', () => {
  const dir = new URL('../../characters/yokoso/2d/', import.meta.url);
  const spec = JSON.parse(fs.readFileSync(new URL('parts.json', dir), 'utf8'));
  const svg = fs.readFileSync(new URL(spec.svg, dir), 'utf8');
  const c = new Svg2DCharacter({ spec, svg, rasterize: () => new THREE.Texture() });
  assert.deepEqual(missingReceiverMethods(c), []);
  for (const emotion of EMOTIONS) {
    const res = applyIntent(c, { emotion, intensity: 1, gesture: 'nod', gaze: 'user' });
    assert.equal(res.emotion, emotion);
    for (let i = 0; i < 30; i++) c.update(1 / 30);
    assert.equal(c.state2d.emotion, emotion, `${emotion} が 2D の顔に出る`);
  }
});
