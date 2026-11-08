// 2D の舞台で、頭と体のつなぎ目を開けない試験(11/8: 描かれた絵で頭が体の上にういていた)。
// parts.json の headLiftMax(to_2d.py が、頭と体の重なりから決める)があれば、頭を上へ動かす量はそこまで。無いキャラは今までどおり。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Svg2DCharacter } from '../src/char2d/svg2dCharacter.js';

const DIR = new URL('../../characters/yokoso/2d/', import.meta.url);
const spec = JSON.parse(fs.readFileSync(new URL('parts.json', DIR), 'utf8'));
const svg = fs.readFileSync(new URL(spec.svg, DIR), 'utf8');

/** 高い所を見上げさせて、頭の上へのずれの最大(メートル)を返す */
function maxLift(extra) {
  const c = new Svg2DCharacter({ spec: { ...spec, ...extra }, svg, rasterize: () => new THREE.Texture() });
  const head = c.groups.head;
  let max = 0;
  for (const target of [[0, 4, 2], [0, -1, 2], [0, 4, 2]]) {
    c.lookAt(target);
    for (let i = 0; i < 90; i++) {
      c.update(1 / 30);
      max = Math.max(max, head.position.y - head.userData.base.y);
    }
  }
  return { max, unit: c.unit };
}

test('headLiftMax が無いキャラは、今までどおり頭が上へ動く(試験の足場: 動く量が 0 ではない)', () => {
  const { max } = maxLift({});
  assert.ok(max > 0, '見上げると頭が上へずれる');
});

test('headLiftMax があれば、頭が上へ動く量はそこまで(すき間を開けない)', () => {
  const free = maxLift({});
  const cap = (free.max / free.unit) * 0.4; // 自由な時の 4 割(元の絵の座標)
  const capped = maxLift({ headLiftMax: cap });
  assert.ok(capped.max <= cap * capped.unit + 1e-9, `上限 ${cap} を超えた: ${capped.max / capped.unit}`);
  assert.ok(capped.max > 0, '上限の中では、ちゃんと動く');
  assert.ok(capped.max < free.max, '上限なしより小さい');
  assert.equal(maxLift({ headLiftMax: 0 }).max, 0, '0 なら上へは動かない');
});

test('下へ動く(おじぎ・うなずき)は、headLiftMax で止めない', () => {
  const c = new Svg2DCharacter({ spec: { ...spec, headLiftMax: 0 }, svg, rasterize: () => new THREE.Texture() });
  const head = c.groups.head;
  let min = 0;
  c.play('bow');
  for (let i = 0; i < 40; i++) {
    c.update(1 / 30);
    min = Math.min(min, head.position.y - head.userData.base.y);
  }
  assert.ok(min < 0, 'おじぎで頭が下がる');
});
