// 画面のキーボード: 見える範囲(visualViewport)から持ち上げる量を出す計算と、文字を打つ欄の判定(11/7 本人の iPhone)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureInset, isEditable } from '../src/ui/keyboardInset.js';

test('キーボードが出ると、見える範囲の下端までの差を返す', () => {
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 0 }), { kb: 336, top: 0, height: 596 });
});
test('iOS がページごとずらした分(offsetTop)を引く', () => {
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 120 }), { kb: 216, top: 120, height: 596 });
});
test('アドレスバーの出入りくらいの差は、キーボードとは数えない', () => {
  assert.deepEqual(measureInset(800, { height: 740, offsetTop: 0 }), { kb: 0, top: 0, height: 740 });
});
test('visualViewport が無い・PC では何も持ち上げない', () => {
  assert.deepEqual(measureInset(900, undefined), { kb: 0, top: 0, height: 900 });
  assert.deepEqual(measureInset(900, { height: 900, offsetTop: 0 }), { kb: 0, top: 0, height: 900 });
});
test('文字を打つ欄だけを数える', () => {
  const el = (tagName, type) => ({ nodeType: 1, tagName, type, isContentEditable: false });
  assert.equal(isEditable(el('INPUT', 'text')), true);
  assert.equal(isEditable(el('INPUT', 'password')), true);
  assert.equal(isEditable(el('TEXTAREA')), true);
  assert.equal(isEditable(el('INPUT', 'checkbox')), false);
  assert.equal(isEditable(el('BUTTON')), false);
  assert.equal(isEditable(null), false);
});
