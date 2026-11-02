import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoxGlb, elementsFromRoomJson } from '../tools/glbBoxes.mjs';
import { judgeBudget, measureGlb } from '../tools/glbBudget.mjs';

test('measureGlb: 箱 6 つの三角面は 12 × 6、材質は種類の数', async () => {
  const room = JSON.parse(readFileSync(new URL('../testdata/fake_scan/room.json', import.meta.url), 'utf8'));
  const els = elementsFromRoomJson(room);
  const m = await measureGlb(await buildBoxGlb(els));
  assert.equal(m.triangles, els.length * 12);
  assert.equal(m.materials, 5);
  assert.equal(m.maxTexture, 0);
});

test('measureGlb: 実際の部屋 GLB(素材つき)でテクスチャの大きさが取れる', async () => {
  const m = await measureGlb(readFileSync(new URL('../../places/test_room/room.glb', import.meta.url)));
  assert.ok(m.triangles > 0);
  assert.ok(m.bytes > 1000);
});

test('judgeBudget: 目安内は採用、目安超えは警告、却下の線超えは却下。理由が付く', () => {
  const base = { bytes: 1_000_000, triangles: 10_000, maxTexture: 1024 };
  assert.deepEqual(judgeBudget(base), { verdict: '採用', reasons: [] });
  const warn = judgeBudget({ ...base, triangles: 40_000 });
  assert.equal(warn.verdict, '警告');
  assert.match(warn.reasons[0], /三角面数/);
  const reject = judgeBudget({ ...base, bytes: 16 * 1024 * 1024 });
  assert.equal(reject.verdict, '却下');
  assert.equal(judgeBudget({ ...base, maxTexture: 4096 }).verdict, '却下');
});

test('judgeBudget: 警告と却下が混ざれば却下が勝つ', () => {
  const j = judgeBudget({ bytes: 6 * 1024 * 1024, triangles: 60_000, maxTexture: 512 });
  assert.equal(j.verdict, '却下');
  assert.equal(j.reasons.length, 2);
});
