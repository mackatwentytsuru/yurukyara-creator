import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPlaces, writePlaceIndex } from '../tools/placeIndex.mjs';

function put(dir, id, name, mtimeSec) {
  mkdirSync(join(dir, id), { recursive: true });
  const f = join(dir, id, 'place.json');
  writeFileSync(f, JSON.stringify({ name }));
  utimesSync(f, mtimeSec, mtimeSec);
}

test('場所の一覧: 新しい順、_ で始まる試し用は入らない、place.json の無いフォルダも入らない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'places-'));
  try {
    put(dir, 'test_room', '試しの部屋', 1000);
    put(dir, 'my_room', 'うちの部屋', 2000);
    put(dir, '_fake_scan', '偽', 3000);
    mkdirSync(join(dir, 'empty'));
    assert.deepEqual(listPlaces(dir), [
      { id: 'my_room', name: 'うちの部屋' },
      { id: 'test_room', name: '試しの部屋' },
    ]);
    writePlaceIndex(dir);
    assert.equal(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).places.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
