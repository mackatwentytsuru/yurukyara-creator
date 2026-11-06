// 主役ノリー(セスジキノボリカンガルーの執事見習い)の 2D の試験。
// 協力者が手で描いた正面の絵を、色と形をそのままに部品へ分けて描き直した物(characters/norrie/2d)。
// 合格: 部品の点検 0 件・元の絵の 6 色だけ・決めた部品の <g id> がそろう・前歯 2 本が口の形に残る・
//       動きの意図(K2)の列 10 個が最後まで動く・まばたき・口 3 形・7 表情・鼻が顔と一緒に動く・腕は頭の前に出ない。
// 判定(judge_final)の直し 2026-11-07: おじぎで蝶ネクタイが半分以上見える・手を振る腕は 2 枚でひじで曲がり、肩の継ぎ目は胴が隠す・
//       後ろ姿の板(背中の筋)・考え中のまま話しても考え中の口のまま。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Svg2DCharacter } from '../src/char2d/svg2dCharacter.js';
import { extractGroup, faceVariants, listGroupIds, validateParts } from '../src/char2d/parts.js';
import { applyIntent } from '../src/character/intent.js';
import { STANDARD_EXPRESSIONS } from '../src/character/expressionNames.js';

const DIR = new URL('../../characters/norrie/2d/', import.meta.url);
const spec = JSON.parse(fs.readFileSync(new URL('parts.json', DIR), 'utf8'));
const svg = fs.readFileSync(new URL(spec.svg, DIR), 'utf8');

// 元の絵の色(協力者の絵から取った 6 色)。描き直しで色を足したり変えたりしない
const PALETTE = new Set(['#50403c', '#f0e9de', '#000000', '#ffffff', '#e4b2bc', '#249867']);
const full = (c) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toLowerCase();

function make() {
  const sizes = [];
  const rasterize = (text, size) => {
    assert.match(text, /^<svg [^>]*viewBox="[\d.\s-]+"/);
    sizes.push(size);
    return new THREE.Texture();
  };
  return { c: new Svg2DCharacter({ spec, svg, rasterize, pxPerUnit: spec.pxPerUnit }), sizes };
}

const visibleIn = (c, slot) => c.slotGroups[slot]?.children.filter((m) => m.visible).map((m) => m.name.replace('2d:', '')) ?? [];
const visibleMouth = (c) => ['mouth_closed', 'mouth_half', 'mouth_open'].flatMap((s) => visibleIn(c, s));
const run = (c, seconds, onFrame) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    c.update(1 / 30);
    onFrame?.(c);
  }
};

test('ノリーの parts.json と SVG は点検で問題 0 件', () => {
  assert.deepEqual(validateParts(spec, svg), []);
  assert.equal(spec.id, 'norrie');
});

test('色は元の絵の 6 色だけ(焦げ茶・クリーム・黒・白・ピンク・緑)', () => {
  const used = new Set([...svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => full(m[1])));
  assert.ok(used.size >= 6, `使っている色 ${[...used]}`);
  for (const c of used) assert.ok(PALETTE.has(c), `元の絵に無い色 ${c}`);
  assert.doesNotMatch(svg, /gradient|filter=|opacity=/i, 'ぼかし・グラデーション・透けは使わない(元の絵はベタ塗り)');
  assert.ok(used.has('#249867'), '蝶ネクタイは緑');
});

test('部品は分かれている: 耳・頭・顔・鼻・目・口・体・お腹・腕・手袋・蝶ネクタイ・しっぽ', () => {
  const ids = new Set(listGroupIds(svg));
  for (const id of ['tail', 'body', 'torso', 'belly', 'arm_r', 'arm_l', 'sleeve_r', 'sleeve_l', 'forearm_r', 'forearm_l', 'glove_r', 'glove_l', 'bowtie', 'head', 'ear_r', 'ear_l', 'head_fur', 'face_cream', 'muzzle', 'back']) {
    assert.ok(ids.has(id), `<g id="${id}"> が無い`);
  }
  // 手袋は白、蝶ネクタイは緑、しっぽはクリーム色
  assert.match(extractGroup(svg, 'glove_r'), /fill="#FFFFFF"/);
  assert.match(extractGroup(svg, 'bowtie'), /fill="#249867"/);
  assert.match(extractGroup(svg, 'tail'), /fill="#F0E9DE"/);
  // 体の部品の前後: しっぽ < 上腕(胴の後ろ。肩の継ぎ目を胴が隠す)< 体 < 前腕(袖の下と手袋)< 蝶ネクタイ < 頭
  const z = (n) => spec.parts[n].z;
  for (const s of ['r', 'l']) {
    assert.ok(z('tail') < z(`arm_${s}`) && z(`arm_${s}`) < z('body') && z('body') < z(`forearm_${s}`) && z(`forearm_${s}`) < z('bowtie') && z('bowtie') < z('head'), `前後 ${s}`);
    assert.equal(spec.parts[`forearm_${s}`].parent, `arm_${s}`, '前腕は上腕に付く');
  }
  assert.match(extractGroup(svg, 'forearm_r'), /<g id="glove_r">/, '手袋は前腕の部品');
});

test('ふつうの顔は元の絵のまま: 黒い丸い目 2 つと、前歯 2 本の見える口', () => {
  const eyes = extractGroup(svg, 'face.neutral.eyes');
  const circles = [...eyes.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(circles.length, 2);
  for (const [, , r] of circles) assert.ok(r > 14 && r < 18, `目の大きさ ${r}`);
  assert.ok(Math.abs(circles[0][1] - circles[1][1]) < 0.5, '目の高さがそろう');
  // 口: 黒い形と、白い前歯
  const mouth = extractGroup(svg, 'face.neutral.mouth_closed');
  assert.match(mouth, /fill="#000000"/);
  assert.match(mouth, /fill="#FFFFFF"/);
});

test('口を開いた形(半分・開き)には、どの表情でも前歯が残る', () => {
  const v = faceVariants(listGroupIds(svg));
  let n = 0;
  for (const [emotion, slots] of v) {
    for (const slot of ['mouth_half', 'mouth_open']) {
      if (!slots.has(slot)) continue;
      assert.match(extractGroup(svg, `face.${emotion}.${slot}`), /fill="#FF(?:F|FFFF)"/, `${emotion} ${slot} に前歯`);
      n += 1;
    }
  }
  assert.ok(n >= 10, `開いた口の形 ${n} 個`);
});

// 意図の列 10 個(K2 の applyIntent)。want は流した後の 2D の状態
const INTENTS = [
  { intent: { emotion: 'neutral', gesture: 'none', gaze: 'user', mouth: 0 }, want: { mouth: 'face.neutral.mouth_closed', eyes: 'face.neutral.eyes', brows: null } },
  { intent: { emotion: 'happy', gesture: 'wave', gaze: 'user', mouth: 0.7 }, want: { mouth: 'face.happy.mouth_open', eyes: 'face.happy.eyes', brows: null, played: true }, check: 'armUp' },
  { intent: { emotion: 'surprised', intensity: 0.9, gesture: 'none', gaze: 'user', mouth: 0.3 }, want: { mouth: 'face.surprised.mouth_half', eyes: 'face.surprised.eyes', brows: 'face.surprised.brows' } },
  { intent: { emotion: 'sad', intensity: 0.8, gesture: 'bow', gaze: 'away', mouth: 0 }, want: { mouth: 'face.sad.mouth_closed', eyes: 'face.sad.eyes', brows: 'face.sad.brows', played: true }, check: 'bow' },
  { intent: { emotion: 'angry', intensity: 0.7, gesture: 'shake', gaze: 'user', mouth: 0.9 }, want: { mouth: 'face.angry.mouth_open', eyes: 'face.angry.eyes', brows: 'face.angry.brows', played: true }, check: 'shake' },
  // のんびりの半開きは描いていない → ふつうの半開き
  { intent: { emotion: 'relaxed', intensity: 0.6, gesture: 'nod', gaze: 'user', mouth: 0.25 }, want: { mouth: 'face.neutral.mouth_half', eyes: 'face.relaxed.eyes', brows: null, played: true }, check: 'nod' },
  { intent: { emotion: 'think', gesture: 'think', gaze: { x: 1, y: 1.6, z: 1 }, mouth: 0 }, want: { mouth: 'face.think.mouth_closed', eyes: 'face.think.eyes', brows: 'face.think.brows', played: true }, check: 'tilt' },
  // 2D に無い表情 wink → 近い happy
  { intent: { emotion: 'wink', gesture: 'tilt', gaze: 'user', mouth: 0 }, want: { mouth: 'face.happy.mouth_closed', eyes: 'face.happy.eyes', brows: null, played: true }, check: 'tilt' },
  // 知らない表情と動き → ふつう、動きは始まらない
  { intent: { emotion: 'なぞの表情', gesture: 'dance', gaze: [0.5, 1.2, 2], mouth: 0.5 }, want: { mouth: 'face.neutral.mouth_open', eyes: 'face.neutral.eyes', brows: null, played: false } },
  // 弱い表情はふつう。壊れた値でも止まらない
  { intent: { emotion: 'happy', intensity: 0.1, gesture: 'shrug', gaze: 'away', mouth: Number.NaN }, want: { mouth: 'face.neutral.mouth_closed', eyes: 'face.neutral.eyes', brows: null, played: true }, check: 'shrug' },
];

test('動きの意図(K2)の列 10 個を、ノリーの 2D に流す', () => {
  const { c } = make();
  for (const [i, { intent, want, check }] of INTENTS.entries()) {
    const label = `${i + 1}: ${intent.emotion}/${intent.gesture}`;
    const res = applyIntent(c, intent, { userPosition: [0, 1.0, 2] });
    if ('played' in want) assert.equal(res.played, want.played, `${label} 動きが始まったか`);
    const seen = { armMin: 0, armMax: 0, headYMin: Infinity, headYMax: -Infinity, upperMin: 1, headRotMax: 0, headXMin: Infinity, headXMax: -Infinity, faceYMin: 0, armFront: false };
    const headY0 = c.groups.head.userData.base.y;
    run(c, 1.6, (cc) => {
      const h = cc.groups.head;
      for (const arm of [cc.groups.arm_r, cc.groups.arm_l]) {
        seen.armMin = Math.min(seen.armMin, arm.rotation.z);
        seen.armMax = Math.max(seen.armMax, arm.rotation.z);
        if (arm.children[0].renderOrder >= cc.headOrder) seen.armFront = true;
      }
      seen.headYMin = Math.min(seen.headYMin, h.position.y - headY0);
      seen.headYMax = Math.max(seen.headYMax, h.position.y - headY0);
      seen.headXMin = Math.min(seen.headXMin, h.position.x);
      seen.headXMax = Math.max(seen.headXMax, h.position.x);
      seen.upperMin = Math.min(seen.upperMin, cc.upper.scale.y);
      seen.faceYMin = Math.min(seen.faceYMin, cc.face.position.y);
      seen.headRotMax = Math.max(seen.headRotMax, Math.abs(h.rotation.z));
    });
    assert.deepEqual(visibleMouth(c), [want.mouth], `${label} 口`);
    assert.deepEqual(visibleIn(c, 'eyes'), [want.eyes], `${label} 目`);
    assert.deepEqual(visibleIn(c, 'brows'), want.brows ? [want.brows] : [], `${label} 眉`);
    assert.equal(seen.armFront, false, `${label} 腕は頭の前に出ない(あごの線の上に袖が出ない)`);
    if (check === 'armUp') assert.ok(seen.armMin < -0.5, `${label} 右腕が上がる (${seen.armMin.toFixed(2)})`);
    if (check === 'bow') assert.ok(seen.upperMin < 0.95 && seen.faceYMin < -0.01, `${label} 体が縮み顔が下を向く (${seen.upperMin.toFixed(2)}, ${seen.faceYMin.toFixed(3)})`);
    if (check === 'nod') assert.ok(seen.headYMax - seen.headYMin > 0.01, `${label} 頭が上下にうなずく`);
    if (check === 'shake') assert.ok(seen.headXMax - seen.headXMin > 0.02, `${label} 頭が左右に動く`);
    if (check === 'tilt') assert.ok(seen.headRotMax > 0.05, `${label} 頭がかしぐ`);
    if (check === 'shrug') assert.ok(seen.armMax > 0.05 && seen.armMin < -0.05, `${label} 両腕が少し上がる`);
  }
});

test('まばたき: ふつうでは目を閉じる時があり、目を閉じた絵(うれしい・のんびり)ではつぶさない', () => {
  const { c } = make();
  c.setEmotion('neutral', 1);
  let min = 1;
  run(c, 8, (cc) => (min = Math.min(min, cc.state2d.eyesScaleY)));
  assert.ok(min < 0.3, `ふつうでまばたきする (${min.toFixed(2)})`);
  for (const e of ['happy', 'relaxed']) {
    c.setEmotion(e, 1);
    run(c, 0.5);
    let m = 1;
    run(c, 8, (cc) => (m = Math.min(m, cc.state2d.eyesScaleY)));
    assert.equal(m, 1, `${e} ではつぶさない`);
  }
});

test('口 3 形: 話す音の大きさに合わせて、閉じ・半分・開きを行き来する', () => {
  const { c } = make();
  const shapes = new Set();
  for (let i = 0; i < 90; i++) {
    c.setMouth(0.5 + 0.5 * Math.sin(i * 0.4));
    c.update(1 / 30);
    shapes.add(c.state2d.mouthShape);
  }
  assert.deepEqual([...shapes].sort(), ['mouth_closed', 'mouth_half', 'mouth_open']);
});

test('標準の 7 表情は全部描いてあり、どの表情でも目 1 つ・口 1 つが必ず出る', () => {
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

test('鼻(ピンクと Y の線)は顔の部品と一緒に動き、頭の板より手前・目と口より奥に描く', () => {
  const { c } = make();
  const muzzle = c.faceLayers.muzzle;
  assert.ok(muzzle, '鼻の板がある');
  assert.equal(muzzle.parent, c.face, '顔の枠と同じ親');
  const eyesOrder = c.slotGroups.eyes.children[0].renderOrder;
  assert.ok(muzzle.renderOrder > c.headOrder && muzzle.renderOrder < eyesOrder);
  // 横を向くと、鼻と口が同じだけずれる(はなれない)
  c.lookAt([2, 1.0, 1]);
  run(c, 1.5);
  const mouth = c.slotGroups.mouth_closed;
  const before = muzzle.position.x - mouth.position.x;
  assert.ok(Math.abs(c.face.position.x) > 0.002, '顔の部品がずれた');
  assert.equal(muzzle.position.x - mouth.position.x, before, '鼻と口の間は変わらない');
});

test('顔の上の部品(faceLayers)の点検: SVG に無い名前・壊れた箱・体の部品と同じ名前は問題に出る', () => {
  const bad = (layers) => validateParts({ ...spec, faceLayers: layers }, svg);
  assert.ok(bad([{ id: 'nose_none', box: [0, 0, 10, 10] }]).some((s) => s.includes('nose_none の <g id> が SVG に無い')));
  assert.ok(bad([{ id: 'muzzle', box: [0, 0, -1, 10] }]).some((s) => s.includes('muzzle の box が正しくない')));
  assert.ok(bad([{ id: 'head', box: [0, 0, 10, 10] }]).some((s) => s.includes('体の部品か顔の枠と同じ')));
  assert.ok(bad('muzzle').some((s) => s.includes('faceLayers は')));
  // 腕を頭の前に出す角度: false は出さない、数はその角度、無ければ既定
  const arms = (a) => new Svg2DCharacter({ spec: { ...spec, arms: a }, svg, rasterize: () => new THREE.Texture() }).armFront;
  assert.equal(arms({ front: false }), Infinity);
  assert.equal(arms({ front: 1.4 }), 1.4);
  assert.equal(arms(undefined), 1.0);
});

test('部品の画像は部品の箱の大きさだけ作る(全身の大きさを部品の数だけ作らない)', () => {
  const { c, sizes } = make();
  const px = spec.pxPerUnit ** 2;
  const total = sizes.reduce((a, s) => a + s.w * s.h, 0) / px;
  const fullArea = spec.viewBox[2] * spec.viewBox[3];
  // 後ろ姿の板は全身 1 枚(正面とは別に数える)
  const [, , bw, bh] = spec.back.box;
  const back = bw * bh;
  assert.ok(total - back < fullArea * 1.6, `正面の部品の面積の合計 ${Math.round(total - back)} が全身 1.6 枚分 ${Math.round(fullArea * 1.6)} より少ない`);
  assert.ok(back <= fullArea, `後ろ姿の板 ${back} は全身 1 枚分 ${fullArea} まで`);
  assert.equal(c.kind, '2d');
  assert.ok(c.object3d.getObjectByName('2d:head'));
  assert.ok(Buffer.byteLength(svg) < 130_000, `SVG ${Buffer.byteLength(svg)} バイト`);
});

// ---- 判定(judge_final 2026-11-07)の直し ----

/** 板(mesh)の上下のふち(ワールド座標の y)。板の箱の上と下 */
function boardYRange(c, groupName) {
  c.object3d.updateWorldMatrix(true, true);
  const mesh = c.groups[groupName].children[0];
  const h = mesh.geometry.parameters.height / 2;
  const top = new THREE.Vector3(0, h, 0).applyMatrix4(mesh.matrixWorld).y;
  const bottom = new THREE.Vector3(0, -h, 0).applyMatrix4(mesh.matrixWorld).y;
  return { top, bottom };
}

test('おじぎ: 緑の蝶ネクタイは胸に残り、半分以上見える(頭は下げずに、顔を少しつぶして下を向く)', () => {
  const { c } = make();
  c.lookAt([0, 1.0, 2]);
  run(c, 0.5);
  const rest = { head: c.groups.head.scale.y * c.upper.scale.y, face: c.face.position.y };
  assert.equal(c.play('bow'), true);
  let worst = 1;
  let squash = 1;
  let faceDown = 0;
  run(c, 2.0, (cc) => {
    const bow = boardYRange(cc, 'bowtie');
    const head = boardYRange(cc, 'head');
    // 蝶ネクタイの見える割合 = 頭の下のふちより下にある部分
    const visible = Math.max(0, Math.min(1, (Math.min(bow.top, head.bottom) - bow.bottom) / (bow.top - bow.bottom)));
    worst = Math.min(worst, visible);
    squash = Math.min(squash, (cc.groups.head.scale.y * cc.upper.scale.y) / rest.head);
    faceDown = Math.min(faceDown, cc.face.position.y - rest.face);
  });
  assert.ok(worst >= 0.5, `おじぎの間ずっと、蝶ネクタイが半分以上見える(いちばん隠れた時 ${(worst * 100).toFixed(0)}%)`);
  assert.ok(worst >= 0.8, `ほとんど隠れない (${(worst * 100).toFixed(0)}%)`);
  assert.ok(squash < 0.95, `顔を少しつぶす (${squash.toFixed(3)})`);
  assert.ok(faceDown < -0.01, `顔が下を向く (${faceDown.toFixed(3)})`);
});

test('手を振る: 腕は上腕と前腕の 2 枚で、ひじで曲がって前腕が上を向く。上腕は胴の後ろ(肩の継ぎ目を胴が隠す)', () => {
  const { c } = make();
  const arm = c.groups.arm_r;
  const fore = c.groups.forearm_r;
  assert.equal(fore.parent, arm, '前腕は上腕の子(ひじで上腕に付く)');
  // 止まっている時は曲げない(元の絵の形のまま)
  run(c, 0.5);
  assert.ok(Math.abs(arm.rotation.z) < 0.05 && Math.abs(fore.rotation.z) < 0.05, '止まっている時はまっすぐ');
  // 上腕の板は胴の板より奥、前腕の板は胴より手前
  const order = (g) => g.children[0].renderOrder;
  assert.ok(order(arm) < order(c.groups.body) && order(c.groups.body) < order(fore));
  c.play('wave');
  let upMin = 0;
  let bendMin = 0;
  let pawUp = false;
  let foreBehind = false;
  const bendSeen = new Set();
  run(c, 2.2, (cc) => {
    upMin = Math.min(upMin, arm.rotation.z);
    bendMin = Math.min(bendMin, fore.rotation.z);
    bendSeen.add(Math.round(fore.rotation.z * 10));
    // 大きく曲げた時は、前腕が上腕の後ろ(ひじの丸が前に出て、前腕の線の元を隠す)
    if (fore.rotation.z < -1.5 && order(fore) < order(arm)) foreBehind = true;
    // 手袋(前腕の先)がひじより上にあるか
    cc.object3d.updateWorldMatrix(true, true);
    const elbow = fore.getWorldPosition(new THREE.Vector3());
    const paw = fore.children[0].getWorldPosition(new THREE.Vector3());
    if (paw.y > elbow.y + 0.05) pawUp = true;
  });
  assert.ok(upMin < -1.2, `上腕が肩で上がる (${upMin.toFixed(2)})`);
  assert.ok(bendMin < -1.8, `ひじで曲がる (${bendMin.toFixed(2)})`);
  assert.ok(pawUp, '前腕が上を向く(手袋がひじより上)');
  assert.ok(bendSeen.size > 6, '前腕を振る(角度が行き来する)');
  assert.ok(foreBehind, '大きく曲げた時は、前腕が上腕の後ろに回る');
  // 振り終わったら元に戻る
  run(c, 0.6);
  assert.ok(Math.abs(arm.rotation.z) < 0.05 && Math.abs(fore.rotation.z) < 0.05, '振り終わったら元の形');
  assert.ok(order(c.groups.body) < order(fore), '戻ったら前腕は胴の前(手袋がお腹の前)');
});

test('後ろ姿の板: 向こうを向くと背中の筋が見える(前の板は表だけ・後ろ姿の板は裏向き)', () => {
  const { c } = make();
  assert.ok(c.back, '後ろ姿の板がある');
  const backMesh = c.back.children[0];
  assert.equal(backMesh.name, '2d:back');
  assert.equal(backMesh.material.side, THREE.FrontSide);
  assert.equal(c.groups.head.children[0].material.side, THREE.FrontSide, '前の板は表だけ(後ろから見ると消える)');
  assert.ok(Math.abs(c.back.rotation.y - Math.PI) < 1e-9, '後ろ向き');
  // 後ろ姿の絵: 茶色の背中・クリーム色の筋・黒い線だけ(色を足さない)
  const g = extractGroup(svg, 'back');
  const colors = new Set([...g.matchAll(/fill="(#[0-9A-Fa-f]{3,6})"/g)].map((m) => full(m[1])));
  assert.deepEqual([...colors].sort(), ['#000000', '#50403c', '#f0e9de']);
  // 向こうを向く動き: 途中で後ろ向き、終わると正面
  assert.equal(c.play('turn'), true);
  const seen = [];
  run(c, 3.0, (cc) => seen.push(cc.state2d.facing));
  assert.ok(seen.includes('back'), '後ろ姿が出る');
  assert.equal(seen.at(-1), 'front', '最後は正面に戻る');
  assert.ok(seen.filter((f) => f === 'back').length >= 30, `後ろ姿を 1 秒以上見せる (${seen.filter((f) => f === 'back').length} コマ)`);
  // 向いたままにもできる
  assert.equal(c.setFacing('back'), true);
  run(c, 1.0);
  assert.equal(c.state2d.facing, 'back');
  c.setFacing('front');
  run(c, 1.0);
  assert.equal(c.state2d.facing, 'front');
});

test('考え中のまま話しても、口は考え中の形のまま開く(笑顔の口に替わらない)', () => {
  const { c } = make();
  c.setEmotion('think', 1);
  for (const [level, want] of [[0, 'face.think.mouth_closed'], [0.3, 'face.think.mouth_half'], [0.9, 'face.think.mouth_open']]) {
    c.setMouth(level);
    run(c, 0.6);
    assert.deepEqual(visibleMouth(c), [want], `口 ${level}`);
  }
});
