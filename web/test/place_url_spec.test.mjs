// ?character= と ?place= に書ける物の試験(点検 CRITsec F5)。公開の URL では id だけを読み、外の URL・パスは読まずに知らせる。
// web/src/character/urlSpec.js(three も DOM も読まない)と、main.js がそれを両方の値に使っているか(形だけ)を見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_ID_RE, isSpecId, isLoopbackPage, pickSpec, SPEC_NOTICE } from '../src/character/urlSpec.js';

const SRC = join(import.meta.dirname, '..', 'src');

// 家の中の住所と Tailscale の名前の見本は、その場で組み立てる(公開の前の履歴の書き換えの規則が、書いたままの 192.168.… ・100.64〜127.… ・
// <名前>.tail<16 進>.ts.net を伏せ字に言い換え、試験の中身が変わって落ちるため。S6 の頼み 11/7)
const ip = (...parts) => parts.join('.');
const tsName = (...parts) => [...parts, 'ts', 'net'].join('.');

test('id の形は 英小文字・数字・_ の 1〜32 字だけ', () => {
  assert.equal(String(SPEC_ID_RE), String(/^[a-z0-9_]{1,32}$/));
  for (const ok of ['norrie', 'yokoso', 'd_lantern', 'f_led', '_test', 'a', 'x'.repeat(32), 'test_room']) assert.equal(isSpecId(ok), true, ok);
  for (const bad of ['', 'x'.repeat(33), 'Norrie', 'd-lantern', 'ノリー', 'norrie/', '../x', 'a.json', 'https://example.com/c/character.json', '/characters/norrie/character.json', ' norrie', 'norrie\n', null, undefined, 42]) {
    assert.equal(isSpecId(bad), false, String(bad));
  }
});

test('公開の URL(この PC の外): id は読む・外の URL とパスは読まずに rejected', () => {
  assert.deepEqual(pickSpec('norrie'), { spec: 'norrie', rejected: false });
  assert.deepEqual(pickSpec('  yokoso  '), { spec: 'yokoso', rejected: false }, '前後の空白は外す');
  for (const bad of ['https://evil.example/c/character.json', '//evil.example/c.json', '/characters/norrie/character.json', 'model.vrm', 'javascript:alert(1)', 'Norrie', 'x'.repeat(33)]) {
    assert.deepEqual(pickSpec(bad), { spec: null, rejected: true }, bad);
  }
  assert.deepEqual(pickSpec(''), { spec: null, rejected: false }, '書いていない時は知らせない');
  assert.deepEqual(pickSpec(null), { spec: null, rejected: false });
});

test('この PC の中(localhost・127.0.0.1・[::1])で開いた時だけ、パスと URL も読む(開発の確かめ。前と同じ)', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1', 'app.localhost', 'LOCALHOST']) assert.equal(isLoopbackPage({ hostname }), true, hostname);
  for (const hostname of ['yurukyara.example.app', 'judge.test', ip(192, 168, 1, 20), tsName('anyone', 'tail0000'), 'localhost.evil.example', '127.0.0.1.evil.example', '']) {
    assert.equal(isLoopbackPage({ hostname }), false, hostname);
  }
  assert.deepEqual(pickSpec('/characters/_test/model.vrm', { allowPath: true }), { spec: '/characters/_test/model.vrm', rejected: false });
  assert.deepEqual(pickSpec('norrie', { allowPath: true }), { spec: 'norrie', rejected: false });
});

test('知らせの文は日本語で、書かれた値を写さない', () => {
  for (const t of [SPEC_NOTICE.character, SPEC_NOTICE.place]) {
    assert.match(t, /id\(英小文字・数字・_ の 32 字まで\)だけ/);
    assert.doesNotMatch(t, /https?:/);
  }
  assert.match(SPEC_NOTICE.character, /いつものキャラ/);
  assert.match(SPEC_NOTICE.place, /試しの場所/);
});

test('main.js: ?character=(?char=)と ?place= の両方を pickSpec に通し、この PC の中かを isLoopbackPage で決め、知らせを入口に出す', () => {
  const main = readFileSync(join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /const allowPath = isLoopbackPage\(location\);/);
  assert.match(main, /pickSpec\(params\.get\('character'\) \?\? params\.get\('char'\), \{ allowPath \}\)/);
  assert.match(main, /pickSpec\(params\.get\('place'\), \{ allowPath \}\)/);
  assert.match(main, /loadPlaceData\(placePick\.spec\)/, '場所は選んだ指定だけを読む');
  assert.match(main, /loadFirstCharacter\(charPick\.spec,/, 'キャラは選んだ指定だけを読む');
  assert.doesNotMatch(main, /loadPlaceData\(params\.get\('place'\)\)/, 'URL の値をそのまま読まない');
  assert.doesNotMatch(main, /loadFirstCharacter\(params\.get\('character'\)/, 'URL の値をそのまま読まない');
  assert.match(main, /status\.textContent = app\.urlNotices\.join\(' '\)/, '読まなかった時は入口に知らせる');
});
