// 端末をまたぐ記憶の試験(合鍵・6 桁の番号・一覧・わすれて・7 日)。サーバーを立てずに、記憶の本体だけを試す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, fileBackend, mapBackend, isKey, MAX_FAILS, PAIR_TTL_MS, RETENTION_MS, GLOBAL_FAIL_LIMIT, NOTICE } from '../server/memory/store.mjs';
import { extractFacts, summarize } from '../server/memory/reflect.mjs';
import { canPair, isForgetRequest } from '../server/memory/routes.mjs';

const clock = (t0 = Date.parse('2026-11-06T20:00:00+09:00')) => {
  let t = t0;
  return { now: () => t, add: (ms) => (t += ms) };
};

test('合鍵は 43 字の乱数で、毎回ちがう。形の違う合鍵は断る', () => {
  const s = createMemoryStore({ backend: mapBackend() });
  const a = s.create().key;
  const b = s.create().key;
  assert.ok(isKey(a) && isKey(b));
  assert.notEqual(a, b);
  assert.throws(() => s.list('short'), { status: 401 });
  assert.throws(() => s.list('x'.repeat(43)), { status: 404 });
});

test('サーバーのファイルには合鍵そのものが残らない(名前はハッシュ)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-'));
  const s = createMemoryStore({ backend: fileBackend(dir), pepper: 'p' });
  const { key } = s.create();
  s.add(key, [{ kind: 'name', text: '名前: タロウ' }]);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes(key));
  assert.ok(!readFileSync(join(dir, files[0]), 'utf8').includes(key));
});

test('覚える・一覧・1 つ消す・全部わすれる', () => {
  const s = createMemoryStore({ backend: mapBackend() });
  const { key, notice } = s.create();
  assert.equal(notice, NOTICE);
  assert.match(NOTICE, /7 日/);
  s.add(key, extractFacts('わたしはタロウ。カレーが好き'));
  const items = s.list(key).items;
  assert.deepEqual(items.map((i) => i.text), ['名前: タロウ', '好きなもの: カレー', '前に話したこと: カレーの話']);
  assert.equal(s.forgetItem(key, items[1].id), true);
  assert.equal(s.list(key).items.length, 2);
  assert.equal(s.forgetAll(key), true);
  assert.throws(() => s.list(key), { status: 404 });
  assert.equal(s.recall(key).text, '');
});

test('名前は置き換え、同じ事は重ねない', () => {
  const s = createMemoryStore({ backend: mapBackend() });
  const { key } = s.create();
  s.add(key, [{ kind: 'name', text: '名前: タロウ' }]);
  s.add(key, [{ kind: 'name', text: '名前: ハナコ' }, { kind: 'like', text: '好きなもの: 犬' }, { kind: 'like', text: '好きなもの: 犬' }]);
  assert.deepEqual(s.list(key).items.map((i) => i.text), ['名前: ハナコ', '好きなもの: 犬']);
});

test('7 日: 使わずに 7 日たつと、記録ごと消える。使えば延びる', () => {
  const c = clock();
  const s = createMemoryStore({ backend: mapBackend(), now: c.now });
  const { key } = s.create();
  s.add(key, [{ kind: 'like', text: '好きなもの: 犬' }]);
  c.add(RETENTION_MS - 1000);
  assert.equal(s.list(key).items.length, 1, '7 日の直前はある');
  c.add(RETENTION_MS - 1000);
  assert.equal(s.list(key).items.length, 0, '書いてから 7 日たった事は消える(記録は使ったので残る)');
  c.add(RETENTION_MS + 1);
  assert.throws(() => s.list(key), { status: 404 });
});

test('番号: 6 けた・10 分で切れる・1 回しか使えない', () => {
  const c = clock();
  const s = createMemoryStore({ backend: mapBackend(), now: c.now });
  const { key } = s.create();
  const p = s.pair(key);
  assert.match(p.code, /^[0-9]{6}$/);
  assert.equal(p.ttlSec, 600);
  assert.equal(s.claim(p.code, 'B').key, key);
  assert.throws(() => s.claim(p.code, 'B'), { status: 400 }, '2 回目は使えない');
  const p2 = s.pair(key);
  c.add(PAIR_TTL_MS + 1);
  assert.throws(() => s.claim(p2.code, 'C'), { status: 400 }, '10 分で切れる');
});

test('番号: 新しく出すと前の番号は使えない。わすれると番号も消える', () => {
  const s = createMemoryStore({ backend: mapBackend() });
  const { key } = s.create();
  const a = s.pair(key);
  const b = s.pair(key);
  if (a.code !== b.code) assert.throws(() => s.claim(a.code, 'X'), { status: 400 });
  s.forgetAll(key);
  assert.throws(() => s.claim(b.code, 'Y'), { status: 400 });
  assert.equal(s.activeCodes(), 0);
});

test('番号: 同じ接続元が 5 回間違えたら 10 分止める(正しい番号でも)', () => {
  const c = clock();
  const s = createMemoryStore({ backend: mapBackend(), now: c.now });
  const { key } = s.create();
  const p = s.pair(key);
  const wrong = p.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_FAILS; i++) assert.throws(() => s.claim(wrong, 'evil'), { status: 400 });
  assert.throws(() => s.claim(p.code, 'evil'), { status: 429 });
  assert.equal(s.claim(p.code, 'friend').key, key, 'ほかの接続元は使える');
});

test('番号: 全部の接続元で合わせて間違いが多すぎたら、今ある番号を全部取り消す(総当たりの守り)', () => {
  const s = createMemoryStore({ backend: mapBackend() });
  const { key } = s.create();
  const p = s.pair(key);
  const wrong = p.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < GLOBAL_FAIL_LIMIT; i++) assert.throws(() => s.claim(wrong, `ip${i}`));
  assert.equal(s.activeCodes(), 0);
  assert.throws(() => s.claim(p.code, 'friend'), { status: 400 });
});

test('合言葉: 設定があれば合う時だけ。無ければ、この端末だけで待ち受けている時だけ番号を作る', () => {
  assert.equal(canPair({ host: '127.0.0.1', appPass: '', givenPass: '' }), true);
  assert.equal(canPair({ host: '0.0.0.0', appPass: '', givenPass: '' }), false);
  assert.equal(canPair({ host: '0.0.0.0', appPass: 'abc', givenPass: 'abc' }), true);
  assert.equal(canPair({ host: '127.0.0.1', appPass: 'abc', givenPass: 'abd' }), false);
  assert.equal(canPair({ host: '127.0.0.1', appPass: 'abc', givenPass: undefined }), false);
});

test('覚える言葉の取り出し: 名前・好きなもの。つらい話は覚えない', () => {
  assert.deepEqual(extractFacts('ぼくはカレーが好き'), [{ kind: 'like', text: '好きなもの: カレー' }, { kind: 'topic', text: '前に話したこと: カレーの話' }]);
  assert.deepEqual(extractFacts('タロウって呼んで').map((f) => f.text), ['名前: タロウ']);
  assert.deepEqual(extractFacts('わたしはハナコです').map((f) => f.text), ['名前: ハナコ']);
  assert.deepEqual(extractFacts('もう死にたい。わたしはタロウ'), []);
  assert.deepEqual(extractFacts('こんにちは'), []);
  assert.deepEqual(summarize([{ kind: 'name', text: '名前: タロウ' }, { kind: 'topic', text: '前に話したこと: カレーの話' }]), { name: 'タロウ', topic: 'カレー' });
});

test('「わすれて」だけの言葉を見分ける(ほかの文の中の「忘れて」は消さない)', () => {
  for (const t of ['わすれて', '忘れて', '全部わすれて', 'ぜんぶ忘れてください。']) assert.equal(isForgetRequest(t), true, t);
  for (const t of ['宿題を忘れてた', 'わすれてもいいよ、また話そう', '']) assert.equal(isForgetRequest(t), false, t);
});
