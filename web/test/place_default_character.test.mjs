// 何も指定が無い時に出すキャラ(主役ノリー → ようこそくん)の試験。web/src/character/defaults.js(three を読まない)だけを読む。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CHARACTERS, MAIN_CHARACTER, loadFirstOf } from '../src/character/defaults.js';

const CHARACTERS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'characters');
const readCharacter = (id) => JSON.parse(readFileSync(join(CHARACTERS, id, 'character.json'), 'utf8'));
const notFound = (id) => Object.assign(new Error(`character.json を読めません: /characters/${id}/character.json (404)`), { status: 404 });

test('既定の順は、主役ノリー(norrie)が先、最後がようこそくん', () => {
  assert.deepEqual(MAIN_CHARACTER, { id: 'norrie', name: 'ノリー' });
  assert.equal(DEFAULT_CHARACTERS[0], MAIN_CHARACTER.id);
  assert.equal(DEFAULT_CHARACTERS.at(-1), 'yokoso');
  assert.ok(Object.isFrozen(DEFAULT_CHARACTERS) && Object.isFrozen(MAIN_CHARACTER), '書き換えられない');
});

test('主役がまだ無い木では、ようこそくんが出る(読めなかった理由は onSkip に残る)', async () => {
  const tried = [];
  const skipped = [];
  const got = await loadFirstOf(
    DEFAULT_CHARACTERS,
    async (id) => {
      tried.push(id);
      if (id === 'norrie') throw notFound(id);
      return { id, name: 'ようこそくん' };
    },
    (id, err) => skipped.push([id, err.status]),
  );
  assert.equal(got.id, 'yokoso');
  assert.equal(got.character.name, 'ようこそくん');
  assert.deepEqual(tried, ['norrie', 'yokoso']);
  assert.deepEqual(skipped, [['norrie', 404]]);
});

test('主役が入ったら、主役が出る(ようこそくんは読まない)', async () => {
  const tried = [];
  const got = await loadFirstOf(DEFAULT_CHARACTERS, async (id) => {
    tried.push(id);
    return { id };
  });
  assert.equal(got.id, 'norrie');
  assert.deepEqual(tried, ['norrie']);
});

test('主役の形が壊れていても(読みかけで失敗)、ようこそくんに戻る', async () => {
  const got = await loadFirstOf(DEFAULT_CHARACTERS, async (id) => {
    if (id === 'norrie') throw new Error('GLB を読めません');
    return { id };
  });
  assert.equal(got.id, 'yokoso');
});

test('どれも読めなければ、最後の理由を投げる。並びが空なら決まりの文', async () => {
  await assert.rejects(
    loadFirstOf(DEFAULT_CHARACTERS, async (id) => {
      throw notFound(id);
    }),
    /yokoso/,
  );
  await assert.rejects(loadFirstOf([], async () => ({})), /出せるキャラがありません/);
});

test('戻り先のようこそくんは、この木に必ずある(3D の形つき)', () => {
  const json = readCharacter('yokoso');
  assert.equal(json.id, 'yokoso');
  assert.ok(json.model, 'model がある');
  assert.ok(existsSync(join(CHARACTERS, 'yokoso', json.model)), `${json.model} がある`);
});

test('主役の characters/norrie が入ったら、id がそろい、2D か 3D のどちらかで出せる', (t) => {
  if (!existsSync(join(CHARACTERS, MAIN_CHARACTER.id, 'character.json'))) {
    t.diagnostic('characters/norrie はまだ無い(既定はようこそくん)');
    return;
  }
  const json = readCharacter(MAIN_CHARACTER.id);
  assert.equal(json.id, MAIN_CHARACTER.id);
  const has3d = Boolean(json.model) && existsSync(join(CHARACTERS, MAIN_CHARACTER.id, json.model));
  const has2d = Boolean(json.looks?.['2d']);
  assert.ok(has3d || has2d, 'model(と GLB)か looks.2d がある');
});
