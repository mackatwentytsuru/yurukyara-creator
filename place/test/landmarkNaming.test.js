import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, extractJson, applyNaming } from '../tools/landmarkNaming.mjs';

const place = {
  id: 'p', name: '試しの店', model: 'room.glb', scale_m: 1, floor_y: 0,
  spawn: { position: [0, 0, 0], yaw_deg: 0 },
  landmarks: [
    { name: 'ドア', position: [1.5, 1, 2.5], note: 'ドア。幅 0.9 m、高さ 2 m' },
    { name: 'テーブル', position: [-0.8, 0.38, -1], note: 'テーブル。幅 1.2 m' },
  ],
};
const good = { landmarks: [{ index: 0, name: '入口', note: '外へ出るドアです' }, { index: 1, name: '打ち合わせ机', note: '壁ぞいの机です' }] };

test('buildPrompt: 番号つきの一覧と、位置を変えないルールを含む。hint が入る', () => {
  const p = buildPrompt(place, 'カフェ');
  assert.match(p, /0: 名前=ドア 位置\(x=1.5, y=1, z=2.5\)/);
  assert.match(p, /1: 名前=テーブル/);
  assert.match(p, /位置は変えません/);
  assert.match(p, /カフェ/);
});

test('extractJson: ```json で囲まれていても取り出せる。JSON が無ければ失敗', () => {
  assert.deepEqual(extractJson('はい\n```json\n{"landmarks":[]}\n```'), { landmarks: [] });
  assert.throws(() => extractJson('だめでした'), /JSON が無い/);
});

test('applyNaming: 名前と一言だけ変わり、位置は元のまま。元の place は変わらない', () => {
  const before = JSON.stringify(place);
  const out = applyNaming(place, good);
  assert.equal(out.landmarks[0].name, '入口');
  assert.deepEqual(out.landmarks[0].position, [1.5, 1, 2.5]);
  assert.equal(out.landmarks[1].note, '壁ぞいの机です');
  assert.equal(JSON.stringify(place), before);
  assert.notEqual(out.landmarks[0].position, place.landmarks[0].position);
});

test('applyNaming: 返答が決まりに合わないと、理由つきで失敗(位置の書きかえは受けつけない)', () => {
  const tryApply = (landmarks) => applyNaming(place, { landmarks });
  assert.throws(() => tryApply([{ index: 0, name: 'a', note: '' }]), /index 1 の返答が無い/);
  assert.throws(() => tryApply([{ index: 0, name: 'a', note: '' }, { index: 0, name: 'b', note: '' }]), /重なって/);
  assert.throws(() => tryApply([{ index: 0, name: 'a', note: '' }, { index: 5, name: 'b', note: '' }]), /範囲外/);
  assert.throws(() => tryApply([{ index: 0, name: 'a', note: '' }, { index: 1, name: 'a', note: '' }]), /かぶって/);
  assert.throws(() => tryApply([{ index: 0, name: '', note: '' }, { index: 1, name: 'b', note: '' }]), /name が空/);
  assert.throws(() => tryApply([{ index: 0, name: 'あ'.repeat(13), note: '' }, { index: 1, name: 'b', note: '' }]), /12 文字/);
  assert.throws(() => tryApply([{ index: 0, name: 'a', note: 'あ'.repeat(61) }, { index: 1, name: 'b', note: '' }]), /60 文字/);
  const withPos = applyNaming(place, { landmarks: [{ index: 0, name: 'a', note: '', position: [9, 9, 9] }, { index: 1, name: 'b', note: '' }] });
  assert.deepEqual(withPos.landmarks[0].position, [1.5, 1, 2.5]);
});
