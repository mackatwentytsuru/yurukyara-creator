import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLimiter } from '../server/limits.mjs';

function setup(opts) {
  const dir = mkdtempSync(join(tmpdir(), 'limits-'));
  let t = new Date('2026-11-02T12:00:00').getTime();
  const limiter = createLimiter({ file: join(dir, 'u.json'), now: () => t, ...opts });
  return { limiter, dir, advance: (ms) => (t += ms), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('1 日の上限を超えたら断る。日付が替わると戻る', () => {
  const s = setup({ dailyCap: 3, perMinute: 100 });
  for (let i = 0; i < 3; i++) assert.equal(s.limiter.take('a').ok, true);
  const r = s.limiter.take('a');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'daily');
  assert.equal(s.limiter.status().remainingToday, 0);
  s.advance(24 * 3600 * 1000);
  assert.equal(s.limiter.take('a').ok, true);
  s.cleanup();
});

test('1 分あたりの上限は、接続元ごとに数える', () => {
  const s = setup({ dailyCap: 100, perMinute: 2 });
  assert.equal(s.limiter.take('a').ok, true);
  assert.equal(s.limiter.take('a').ok, true);
  const r = s.limiter.take('a');
  assert.equal(r.reason, 'rate');
  assert.equal(s.limiter.take('b').ok, true); // 別の接続元は、まだ使える
  s.advance(61_000);
  assert.equal(s.limiter.take('a').ok, true);
  s.cleanup();
});

test('呼べなかった回は返す(上限を減らさない)', () => {
  const s = setup({ dailyCap: 2, perMinute: 100 });
  s.limiter.take('a');
  s.limiter.refund('a');
  assert.equal(s.limiter.status().usedToday, 0);
  s.cleanup();
});

test('断られた回は、1 日の回数に数えない', () => {
  const s = setup({ dailyCap: 100, perMinute: 1 });
  s.limiter.take('a');
  s.limiter.take('a'); // 断られる
  assert.equal(s.limiter.status().usedToday, 1);
  s.cleanup();
});
