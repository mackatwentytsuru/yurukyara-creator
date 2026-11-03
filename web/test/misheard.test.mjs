import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MisheardTracker, SHOP_CHOICES } from '../src/conversation/misheard.js';

test('聞き取れなかった: 1 回目は聞き返し、2 回続けたら選択式', () => {
  const t = new MisheardTracker();
  assert.equal(t.miss(), 'retry');
  assert.equal(t.miss(), 'choices');
  assert.equal(t.miss(), 'choices'); // 選択式のあいだは、そのまま
});

test('聞き取れたら数え直す(離れた 2 回は「続けて」ではない)', () => {
  const t = new MisheardTracker();
  t.miss();
  t.heard();
  assert.equal(t.miss(), 'retry');
});

test('選択肢は、スタッフにつなぐ道を含む', () => {
  assert.ok(SHOP_CHOICES.some((c) => c.includes('スタッフ')));
  assert.ok(SHOP_CHOICES.length <= 6);
});
