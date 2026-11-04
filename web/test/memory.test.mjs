import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShop, normalizeFacts, renderMemory, renderShopData, resolveSources, MEMORY_CATEGORIES } from '../server/shop/index.mjs';

const SAMPLE = join(import.meta.dirname, '..', '..', 'kiosk', 'memory', 'sample', 'venue.json');
const raw = () => JSON.parse(readFileSync(SAMPLE, 'utf8'));

test('見本の記憶は、分類ごとにそろう。取得日の無い事実・本文の無い事実は捨てる', () => {
  const m = normalizeFacts(raw());
  assert.ok(m.categories.hours.items.length === 3);
  assert.equal(m.categories.pricing.items[0].confidence, 'high');
  const bad = normalizeFacts({ facts: [{ category: '料金', fact: '入場料は 1 円です。' }, { category: '料金', fact: '', fetchedAt: '2026-11-04' }] });
  assert.equal(bad, null, '取得日が無ければ使わない');
});

test('見つからなかった分類(fact が null)は残り、事実が 1 つでもあれば「見つからなかった」にならない', () => {
  const m = normalizeFacts(raw());
  assert.deepEqual(m.missing, ['rental']);
  const both = normalizeFacts({ facts: [{ category: '料金', fact: null }, { category: '料金', fact: '入場料は 2,000 円です。', fetchedAt: '2026-11-04' }] });
  assert.deepEqual(both.missing, []);
});

test('日本語の分類名・英語のキー・m_ つきのキーのどれでも同じ分類になる。知らない分類は捨てる', () => {
  const f = (category) => ({ category, fact: '事実です。', fetchedAt: '2026-11-04' });
  const m = normalizeFacts({ facts: [f('料金'), f('pricing'), f('m_pricing'), f('天気')] });
  assert.equal(m.categories.pricing.items.length, 3);
  assert.equal(Object.keys(m.categories).length, 1);
});

test('確度・季節の変わり方が決まった値でないときは、いちばん低い確度(low)・変わらない(fixed)に落ちる', () => {
  const m = normalizeFacts({ facts: [{ category: '料金', fact: '入場料は 2,000 円です。', fetchedAt: '2026-11-04', confidence: '確実', volatility: '毎日' }] });
  assert.equal(m.categories.pricing.items[0].confidence, 'low');
  assert.equal(m.categories.pricing.items[0].volatility, 'fixed');
});

test('頭脳に渡す文: 出典・取得日・確度が付き、記憶にない分類はスタッフへと書く。時刻で変わらない(キャッシュが効く)', () => {
  const m = normalizeFacts(raw());
  const a = renderMemory(m);
  assert.match(a, /\[m_hours\] 営業時間・定休日/);
  assert.match(a, /出典 見本の公式サイト \/ 取得 2026-11-04/);
  assert.match(a, /確度 低/);
  assert.match(a, /貸切・イベント利用\(調べたが見つからなかった\)/);
  assert.equal(a, renderMemory(normalizeFacts(raw())));
});

test('今日のデータが無くても、店の記憶だけで動く。何も無ければ null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-'));
  const memFile = join(dir, 'v.json');
  writeFileSync(memFile, JSON.stringify(raw()));
  const none = { load: async () => { throw new Error('取れない'); } };
  const shop = createShop({ source: none, memoryFile: memFile, now: () => Date.parse('2026-11-04T18:00:00+09:00') });
  const snap = await shop.snapshot();
  assert.ok(snap.memory);
  assert.deepEqual(Object.keys(snap.sections), []);
  const text = renderShopData(snap);
  assert.match(text, /データにないもの\n今日のショー/);
  assert.match(text, /# 店の記憶/);
  assert.equal(await createShop({ source: none, memoryFile: '', now: Date.now }).snapshot(), null);
  assert.equal(await createShop({ source: none, memoryFile: join(dir, 'ない.json'), now: Date.now }).snapshot(), null);
});

test('画面に出す参照: m_ の名前は「店の記憶: 分類」と取得日(MM/DD)になり、確度が低い分類は stale', async () => {
  const shop = createShop({ source: { load: async () => ({ sections: {} }) }, memoryFile: SAMPLE, now: () => Date.parse('2026-11-04T18:00:00+09:00') });
  const snap = await shop.snapshot();
  const src = resolveSources(snap, ['m_hours', 'm_access', 'm_nothing', 'shows']);
  assert.deepEqual(src.map((x) => x.key), ['m_hours', 'm_access']);
  assert.equal(src[0].label, '店の記憶: 営業時間・定休日');
  assert.equal(src[0].updatedAt, '11/04');
  assert.equal(src[0].stale, false);
  assert.equal(src[1].stale, true, '行き方には確度が低い事実がある');
  assert.equal(src[1].confidence, 'low');
});

test('分類の一覧は 13 個で、cite の名前(m_ つき)が重ならない', () => {
  assert.equal(MEMORY_CATEGORIES.length, 13);
  assert.equal(new Set(MEMORY_CATEGORIES.map(([k]) => k)).size, 13);
});

test('事実のある分類の中の「見つからなかった」は、その分類に印として残り、頭脳に渡る', () => {
  const m = normalizeFacts({ facts: [
    { category: '行き方', fact: '駅から歩いて 4 分です。', fetchedAt: '2026-11-04' },
    { category: '行き方', fact: null, note: '駐車場の情報は見つからなかった' },
    { category: '貸切・イベント利用', fact: null, note: '貸切の条件は見つからなかった' },
  ] });
  assert.deepEqual(m.gaps, { access: ['駐車場の情報は見つからなかった'] });
  assert.match(renderMemory(m), /【調べたが見つからなかった】駐車場の情報は見つからなかった/);
  assert.match(renderMemory(m), /貸切・イベント利用\(調べたが見つからなかった\)/);
});

test('cite が付かなかった答えに、重なった言葉・数字から根拠を後付けする(2 語に満たなければ付けない・最大 2 つ)', async () => {
  const shop = createShop({ source: { load: async () => ({ sections: {} }) }, memoryFile: SAMPLE, now: () => Date.parse('2026-11-04T18:00:00+09:00') });
  const snap = await shop.snapshot();
  const { inferCite } = await import('../server/shop/index.mjs');
  assert.deepEqual(inferCite(snap, '営業時間は 18 時から 23 時までです。定休日は毎週月曜日ですよ。'), ['m_hours']);
  assert.ok(inferCite(snap, '最寄りは、あおぞら駅の北口です。歩いて約 4 分です。').includes('m_access'));
  assert.deepEqual(inferCite(snap, 'ありがとうございます。またお話ししましょう。'), []);
  assert.deepEqual(inferCite(null, '営業時間は 18 時です'), []);
});
