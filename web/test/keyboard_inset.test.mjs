// 画面のキーボード: 見える範囲(visualViewport)から持ち上げる量を出す計算と、文字を打つ欄の判定(11/7 本人の iPhone)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureInset, isEditable } from '../src/ui/keyboardInset.js';

test('キーボードが出ると、見える範囲の下端までの差を返す', () => {
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 0 }), { open: true, kb: 336, top: 0, height: 596, shrink: 336 });
});
test('iOS がページごとずらした分(offsetTop)を引く', () => {
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 120 }), { open: true, kb: 216, top: 120, height: 596, shrink: 336 });
});
test('アドレスバーの出入りくらいの差は、キーボードとは数えない', () => {
  assert.deepEqual(measureInset(800, { height: 740, offsetTop: 0 }), { open: false, kb: 0, top: 0, height: 740, shrink: 0 });
});
test('visualViewport が無い・PC では何も持ち上げない', () => {
  assert.deepEqual(measureInset(900, undefined), { open: false, kb: 0, top: 0, height: 900, shrink: 0 });
  assert.deepEqual(measureInset(900, { height: 900, offsetTop: 0 }), { open: false, kb: 0, top: 0, height: 900, shrink: 0 });
});
test('iOS がページごと上へずらした時(下の差が 0)も、キーボードは出ていると数える(B13L。上の段とキャラの頭が押し出された)', () => {
  // 画面 932・キーボードと帯で 347 が奪われ、見える範囲はページの下端まで届く(offsetTop 347)
  assert.deepEqual(measureInset(932, { height: 585, offsetTop: 347 }), { open: true, kb: 0, top: 347, height: 585, shrink: 347 });
  // 途中までずれた時
  assert.deepEqual(measureInset(932, { height: 585, offsetTop: 200 }), { open: true, kb: 147, top: 200, height: 585, shrink: 347 });
});
test('Android(キーボードでページごと縮む)は、見える範囲 = ページなので、キーボードとは数えない(見える高さだけ返す)', () => {
  assert.deepEqual(measureInset(190, { height: 190, offsetTop: 0 }), { open: false, kb: 0, top: 0, height: 190, shrink: 0 });
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
