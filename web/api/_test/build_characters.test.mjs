// 公開の組み立て(vite build → dist)に、キャラのファイルが入るかの試験。持ち主 S6。
// Vercel は dist だけを配るので、ここに無いキャラは公開のリンクで 404 になる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listPublicCharacterFiles } from '../../vite.config.js';

test('キャラのフォルダの中の決まった種類だけを入れる(試しのキャラ・隠しファイル・VRM・説明の文は入れない)', () => {
  const root = mkdtempSync(join(tmpdir(), 'chars-'));
  try {
    const put = (rel, body = 'x') => {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    };
    put('README.md');
    put('.gitkeep');
    put('a/character.json', '{}');
    put('a/model.glb');
    put('a/motions/idle.glb');
    put('a/2d/body.svg');
    put('a/persona.md');
    put('a/model.vrm');
    put('a/.hidden.json', '{}');
    put('a/notes.txt');
    put('_test/character.json', '{}');
    assert.deepEqual(listPublicCharacterFiles(root), [
      'a/2d/body.svg',
      'a/character.json',
      'a/model.glb',
      'a/motions/idle.glb',
      'a/persona.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('今のリポジトリの作例が入り、試しのキャラと VRM は入らない', () => {
  const files = listPublicCharacterFiles();
  assert.ok(files.includes('yokoso/character.json'), '作例の character.json が無い');
  assert.ok(files.includes('yokoso/model.glb'), '作例の形が無い');
  assert.ok(!files.some((f) => f.startsWith('_test/') || /\.vrma?$/i.test(f)), '入れない物が入っている');
});
