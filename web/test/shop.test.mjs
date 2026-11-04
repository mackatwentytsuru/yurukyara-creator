// 店のデータのつなぎ口: 形の整え・古さ・頭脳への渡し方・画面に出す参照・決まりの読み込み・仮の頭脳。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeShop, renderShopData, renderShopNow, resolveSources, freshness, parseWhen, jstParts,
  createShopSource, createShop, SHOP_KEYS, FRESH_MINUTES,
} from '../server/shop/index.mjs';
import { extractRules, loadRules, FALLBACK_RULES, SKILL_FILE } from '../server/shop/rules.mjs';
import { runTurn, normalizeEvent, mockReply } from '../server/brain.mjs';
import { buildSystemPrompt, buildUserTurn } from '../server/prompt.mjs';
import { sanitizeChatBody } from '../server/validate.mjs';

const sample = JSON.parse(readFileSync(new URL('../server/shop/sample.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-03T18:30:00+09:00');
const snap = normalizeShop(sample, NOW);

test('見本データは、6 つの部が全部そろい、更新時刻が今日の時刻になる', () => {
  assert.deepEqual(Object.keys(snap.sections), SHOP_KEYS);
  assert.equal(snap.date, '2026-11-03');
  assert.equal(snap.sections.shows.updatedHm, '17:40');
  assert.equal(snap.sections.seats.updatedMs, Date.parse('2026-11-03T18:10:00+09:00'));
  assert.equal(snap.source.label, '見本データ');
});

test('日本時間の取り出しと、HH:MM の読み取り', () => {
  assert.deepEqual(jstParts(Date.parse('2026-11-03T18:30:00+09:00')), { date: '2026-11-03', hm: '18:30', minutes: 1110, weekday: '火', jp: '2026 年 11 月 3 日(火曜日)' }); // 2026-11-03 は火曜日(文化の日)
  assert.deepEqual(jstParts(Date.parse('2026-11-03T16:05:00Z')), { date: '2026-11-04', hm: '01:05', minutes: 65, weekday: '水', jp: '2026 年 11 月 4 日(水曜日)' }); // UTC の火曜 16:05 = 日本時間の水曜 01:05(日付と曜日が進む)
  assert.equal(parseWhen('9:05', '2026-11-03'), Date.parse('2026-11-03T09:05:00+09:00'));
  assert.equal(parseWhen('2026-11-03T10:00:00+09:00', 'x'), Date.parse('2026-11-03T10:00:00+09:00'));
  assert.equal(parseWhen('きのう', '2026-11-03'), null);
  assert.equal(parseWhen(5, '2026-11-03'), null);
});

test('形のおかしい部分は捨てる: 更新時刻が無い部・空席が合計より多い・知らない部・配列でない物', () => {
  const raw = structuredClone(sample);
  delete raw.sections.pricing.updatedAt; // 更新時刻の無い情報は使わない
  raw.sections.seats.available = 999; // 合計より多い
  raw.sections.secret = { updatedAt: '10:00', items: ['お客さんの名前'] };
  raw.sections.tips.items = 'これは配列ではない';
  const s = normalizeShop(raw, NOW);
  assert.deepEqual(Object.keys(s.sections), ['shows', 'performers', 'support']);
  assert.equal(normalizeShop({ sections: {} }, NOW), null);
  assert.equal(normalizeShop('x', NOW), null);
  assert.equal(normalizeShop(null, NOW), null);
});

test('長い文字・数の範囲は切る(外からの JSON をそのまま頭脳に入れない)', () => {
  const raw = structuredClone(sample);
  raw.sections.tips.items = Array.from({ length: 50 }, () => 'あ'.repeat(500));
  const s = normalizeShop(raw, NOW);
  assert.equal(s.sections.tips.items.length, 20);
  assert.equal(s.sections.tips.items[0].length, 160);
});

test('古さ: 空席は 30 分、料金は 1 週間。更新から測る', () => {
  assert.equal(freshness(snap.sections.seats, 'seats', NOW).stale, false); // 18:10 → 20 分
  assert.equal(freshness(snap.sections.seats, 'seats', Date.parse('2026-11-03T19:30:00+09:00')).stale, true);
  assert.equal(freshness(snap.sections.pricing, 'pricing', NOW).stale, false);
  assert.equal(FRESH_MINUTES.seats < FRESH_MINUTES.shows, true);
});

test('店のデータの文: 部の名前の印と更新時刻が付き、データに無い部は「無い」と書く', () => {
  const text = renderShopData(snap);
  assert.match(text, /## \[shows\] 今日のショー\(更新 17:40\)/);
  assert.match(text, /19:00〜19:30 オープニングステージ \/ 出演 ハル/);
  assert.match(text, /18:10 の時点で、全 60 席、空き 22 席/);
  assert.match(text, /入場料: 2,000円/);
  assert.doesNotMatch(text, /データにないもの/);
  const partial = normalizeShop({ ...sample, sections: { seats: sample.sections.seats } }, NOW);
  assert.match(renderShopData(partial), /データにないもの\n今日のショー・今日の出演者・料金・応援の仕組み・楽しみ方/);
  assert.match(renderShopData(null), /今は取れていません/);
});

test('「いま」の文: 次のショーと残り分、上演中、古い情報の注意', () => {
  assert.match(renderShopNow(snap, NOW), /現在 .*18:30.*次のショー: 19:00 オープニングステージ\(あと 30 分\)/);
  assert.doesNotMatch(renderShopNow(snap, NOW), /古い可能性/);
  const during = Date.parse('2026-11-03T20:10:00+09:00');
  assert.match(renderShopNow(snap, during), /いま上演中: 20:00〜20:40 ナギとソラのデュオ.*次のショー: 21:15/);
  assert.match(renderShopNow(snap, during), /古い可能性がある情報: 空席の様子\(18:10 更新。120 分前\)/);
  assert.match(renderShopNow(snap, Date.parse('2026-11-03T22:30:00+09:00')), /すべて終わっている/);
  assert.match(renderShopNow(null, NOW), /取れていない/);
});

test('システム指示は時刻で変わらない(キャッシュが効く)。「いま」は発言の側に入る', () => {
  const a = renderShopData(normalizeShop(sample, NOW));
  const b = renderShopData(normalizeShop(sample, NOW + 3_600_000));
  assert.equal(a, b);
  assert.match(buildUserTurn({ text: '次のショーは?', scene: '', trigger: null, shopNow: renderShopNow(snap, NOW) }), /【店のいま】.*【お客さんの言葉】次のショーは\?/s);
});

test('画面に出す参照: 使った部だけを、ラベル・更新時刻・古さつきで。無い部・知らない名前は落とす', () => {
  const late = Date.parse('2026-11-03T19:30:00+09:00');
  assert.deepEqual(resolveSources(snap, ['shows', 'seats', 'shows', 'nothing', 5], late), [
    { key: 'shows', label: '今日のショー', updatedAt: '17:40', stale: false },
    { key: 'seats', label: '空席の様子', updatedAt: '18:10', stale: true },
  ]);
  assert.deepEqual(resolveSources(null, ['shows'], NOW), []);
  assert.deepEqual(resolveSources(snap, undefined, NOW), []);
});

test('現場の決まりは、スキルの節からそのまま読む。印が無ければ最低限の決まり', () => {
  const rules = loadRules();
  assert.match(rules, /推測せず/);
  assert.match(rules, /クレーム/);
  assert.match(rules, /更新時刻/);
  assert.doesNotMatch(rules, /rules:start/);
  assert.equal(extractRules('印が無い文'), null);
  assert.equal(extractRules('a <!-- rules:start --> 中身 <!-- rules:end --> b'), '中身');
  assert.equal(loadRules('D:/存在しない/SKILL.md'), FALLBACK_RULES);
  assert.equal(rules, extractRules(readFileSync(SKILL_FILE, 'utf8')));
});

test('指示文: 店のデータを渡す回だけ、決まり・データ・cite の形が入る', () => {
  const on = buildSystemPrompt({ shop: { rules: loadRules(), data: renderShopData(snap) } });
  assert.match(on, /# 現場の決まり/);
  assert.match(on, /# 店のデータ\(見本データ/);
  assert.match(on, /cite/);
  assert.match(on, /"reason":"payment"/);
  const off = buildSystemPrompt({});
  assert.doesNotMatch(off, /店のデータ|cite|現場の決まり/);
});

test('頭脳の返事: cite と reason を拾う。知らない reason は空にする', () => {
  const ev = (o) => normalizeEvent({ type: 'thought', intent: 'x', stage: 'guide', ...o }, { expressions: ['neutral'] });
  assert.deepEqual(ev({ cite: ['shows', 7], reason: 'payment' }).cite, ['shows']);
  assert.equal(ev({ cite: ['shows'], reason: 'payment' }).reason, 'payment');
  assert.equal(ev({ reason: 'ほげ' }).reason, '');
  assert.deepEqual(ev({}).cite, []);
});

test('サーバー付きの 1 回(仮の頭脳): 参照が更新時刻つきで画面へ届く', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const events = [];
    const shop = createShop({ source: { load: async () => sample }, now: () => NOW });
    await runTurn({ text: '入場料はいくらですか', character: {}, place: {} }, { onEvent: (e) => events.push(e), shop });
    const thought = events.find((e) => e.type === 'thought');
    assert.deepEqual(thought.sources, [{ key: 'pricing', label: '料金', updatedAt: '09:00', stale: false }]);
    assert.equal(thought.shopLabel, '見本データ');
    assert.equal('cite' in thought, false);
    assert.match(events.find((e) => e.type === 'say').text, /2,000円/);

    const off = [];
    await runTurn({ text: '入場料はいくらですか', character: {}, place: {}, useShop: false }, { onEvent: (e) => off.push(e), shop });
    assert.equal(off.find((e) => e.type === 'thought').sources.length, 0);
    assert.match(off.find((e) => e.type === 'say').text, /分からない|スタッフ/);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('仮の頭脳: クレーム・支払い・緊急・年齢は、理由つきでスタッフへ。データに無い話は従来どおり', () => {
  const run = (text) => [...mockReply({ text, trigger: null, landmarks: [], seen: '', snap })];
  const first = (text) => run(text).find((e) => e.type === 'say');
  assert.equal(first('カードで二重に引かれました').reason, 'payment');
  assert.equal(first('入口で人が倒れています').reason, 'emergency');
  assert.equal(first('高校生ですが入れますか').reason, 'age');
  assert.equal(first('店員の態度が悪かった。クレームです').handoff, true);
  assert.equal(first('来月はどんな予定ですか').stage, undefined); // データに当たる言葉が無ければ、従来の「分からない」の道へ（この関数は say を返さないので undefined）
});

test('提供元: url が取れないときは直前の物を 10 分まで、それも無ければ例外(窓口は null を返して止まらない)', async () => {
  let fail = false;
  const fetchImpl = async () => {
    if (fail) throw new Error('つながらない');
    return { ok: true, json: async () => sample };
  };
  const source = createShopSource({ url: 'http://example.invalid/shop', fetchImpl, ttlMs: 0 });
  assert.equal((await source.load()).venue, sample.venue);
  fail = true;
  assert.equal((await source.load()).venue, sample.venue); // 直前の物
  const never = createShopSource({ url: 'http://example.invalid/shop', fetchImpl: async () => { throw new Error('つながらない'); }, ttlMs: 0 });
  await assert.rejects(never.load());
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await createShop({ source: never, now: () => NOW }).snapshot(), null);
  } finally {
    console.warn = warn;
  }
});

test('入口の検査: useShop は false のときだけ false', () => {
  assert.equal(sanitizeChatBody({ text: 'こ' }).useShop, true);
  assert.equal(sanitizeChatBody({ text: 'こ', useShop: false }).useShop, false);
  assert.equal(sanitizeChatBody({ text: 'こ', useShop: 'no' }).useShop, true);
});
