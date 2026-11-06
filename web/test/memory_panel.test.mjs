// 記憶の札の一覧の 1 行(画面なし。DOM は使わない)。S4 の頼み: 「名前 名前: タロウ」のように種類の名前を 2 回出さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemLine } from '../src/ui/memoryPanel.js';

test('覚えた文に見出しがあれば、そのまま出す(種類の名前を 2 回出さない)', () => {
  assert.equal(itemLine({ kind: 'name', text: '名前: タロウ' }), '名前: タロウ');
  assert.equal(itemLine({ kind: 'like', text: '好きなもの: カレー' }), '好きなもの: カレー');
  assert.equal(itemLine({ kind: 'topic', text: '前に話したこと: カレーの話' }), '前に話したこと: カレーの話');
  assert.equal(itemLine({ kind: 'name', text: '名前：タロウ' }), '名前：タロウ'); // 全角のコロンでも見出しと見る
});

test('見出しの無い文だけ、種類の名前を前に付ける', () => {
  assert.equal(itemLine({ kind: 'note', text: '金曜は早く帰る' }), 'メモ: 金曜は早く帰る');
  assert.equal(itemLine({ kind: 'like', text: 'カレー' }), '好きなもの: カレー');
  assert.equal(itemLine({ kind: 'note', text: '12:30 に会う' }), 'メモ: 12:30 に会う'); // 時刻のコロンは見出しではない
});

test('知らない種類・空の文でも壊れない', () => {
  assert.equal(itemLine({ kind: 'other', text: 'なにか' }), 'なにか');
  assert.equal(itemLine({ kind: 'name' }), '');
  assert.equal(itemLine({ kind: 'name', text: '  ' }), '');
  assert.equal(itemLine(null), '');
});
