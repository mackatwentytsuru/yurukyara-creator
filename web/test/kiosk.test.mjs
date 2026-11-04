import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatBody, parseEvents, resolveIO, shouldReset, sourceTag, trimHistory } from '../../kiosk/web/core.js';
import { sanitizeChatBody } from '../server/validate.mjs';

test('流れてくる文字(SSE)は、届いた分だけ読む。途中で切れた端は次に回す', () => {
  const a = parseEvents('data: {"type":"say","text":"こんにちは"}\n\ndata: {"type":"th');
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].text, 'こんにちは');
  const b = parseEvents(a.rest + 'ought","handoff":true}\n\n');
  assert.equal(b.events[0].handoff, true);
  assert.deepEqual(parseEvents('data: {壊れた}\n\ndata: {"type":"done"}\n\n').events.map((e) => e.type), ['done']);
});

test('履歴は直近の往復だけ、user から始まる', () => {
  const h = [];
  for (let i = 0; i < 10; i++) h.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
  const t = trimHistory(h, 3);
  assert.equal(t.length, 6);
  assert.equal(t[0].role, 'user');
  assert.deepEqual(trimHistory([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }], 6).map((m) => m.role), ['user']);
});

test('頭脳に渡す本文は、サーバーの検査を通り、店のデータを使う(useShop)', () => {
  const body = buildChatBody({
    text: '営業時間を教えてください',
    history: [{ role: 'user', content: 'こんにちは' }, { role: 'assistant', content: 'こんにちは。' }],
    config: { scene: '画面の前', placeInfo: '入口の案内画面', historyTurns: 6 },
    character: { name: '見本のキャラ', expressions: ['neutral', 'happy'], expression_hints: { happy: 'うれしい' } },
    persona: '案内役',
    venue: 'ショーのある新しい店',
  });
  const clean = sanitizeChatBody(body);
  assert.equal(clean.text, '営業時間を教えてください');
  assert.equal(clean.useShop, true);
  assert.equal(clean.place.name, 'ショーのある新しい店');
  assert.equal(clean.history.length, 2);
});

test('参照の札: 取得日つき。確度が低い・古い物には注意の印', () => {
  assert.deepEqual(sourceTag({ label: '店の記憶: 料金', updatedAt: '11/04', stale: false, confidence: 'high' }), { text: '店の記憶: 料金 11/04', warn: false });
  const low = sourceTag({ label: '店の記憶: 行き方', updatedAt: '11/04', stale: true, confidence: 'low' });
  assert.match(low.text, /確度が低い/);
  assert.equal(low.warn, true);
  assert.match(sourceTag({ label: '空席の様子', updatedAt: '18:10', stale: true }).text, /古い可能性/);
});

test('待ち受けに戻る判定: 触られない時間が設定を超えたとき', () => {
  assert.equal(shouldReset(1_000, 90_999, 90), false);
  assert.equal(shouldReset(1_000, 91_000, 90), true);
});

test('声の差し込み口: 何も無ければ文字だけ。形がそろった物だけ受け取る', () => {
  assert.deepEqual(resolveIO(undefined), { stt: null, tts: null });
  assert.deepEqual(resolveIO({ stt: {}, tts: { speak: 1 } }), { stt: null, tts: null });
  const io = { stt: { start() {} }, tts: { speak() {} } };
  assert.ok(resolveIO(io).stt && resolveIO(io).tts);
});

// 声の入出力(kiosk/web/io.js)が読む部品が、画面の道から渡される形で存在する(読み込めないと声のボタンが無効のままになる)
import { existsSync as _exists, readFileSync as _read } from 'node:fs';
test('声の入出力が読む部品がそろっている', () => {
  const io = _read(new URL('../../kiosk/web/io.js', import.meta.url), 'utf8');
  for (const m of io.matchAll(/from '\/kiosk\/conv\/([\w.]+)'/g)) {
    assert.ok(_exists(new URL(`../src/conversation/${m[1]}`, import.meta.url)), `${m[1]} が無い`);
  }
  const html = _read(new URL('../../kiosk/web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/kiosk/io.js') > 0 && html.indexOf('/kiosk/io.js') < html.indexOf('/kiosk/kiosk.js'), 'io.js は kiosk.js より前に読む');
});
