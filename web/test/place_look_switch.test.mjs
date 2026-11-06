// 見た目(3D と 2D)の選び方と、このタブだけで覚える決まりの試験。web/src/character/looks.js(three を読まない)と、画面の形だけを読む。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOKS, normalizeLook, pickLook, partsPath, twoDHint, rememberKey, readRemembered, writeRemembered } from '../src/character/looks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHARACTERS = join(HERE, '..', '..', 'characters');
const readCharacter = (id) => JSON.parse(readFileSync(join(CHARACTERS, id, 'character.json'), 'utf8'));

/** sessionStorage のまね(throws で、使えないブラウザのまね) */
function fakeStorage({ throws = false } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => {
      if (throws) throw new Error('使えない');
      return data.has(k) ? data.get(k) : null;
    },
    setItem: (k, v) => {
      if (throws) throw new Error('いっぱい');
      data.set(k, String(v));
    },
  };
}

const BOTH = { id: 'x', model: 'model.glb', looks: { default: '3d', '3d': { at: 'top' }, '2d': { parts: '2d/parts.json' } } };
const ONLY3D = { id: 'y', model: 'model.glb' };
const ONLY2D = { id: 'z', looks: { '2d': { parts: '2d/parts.json' } } };

test('見た目の言葉は 3d と 2d だけ(大文字・空白は直す。ほかは空)', () => {
  assert.deepEqual(LOOKS, ['3d', '2d']);
  assert.equal(normalizeLook(' 2D '), '2d');
  assert.equal(normalizeLook('3d'), '3d');
  for (const bad of ['', null, undefined, 'vr', '2', 'three']) assert.equal(normalizeLook(bad), '');
});

test('選ぶ順: URL の ?look= → このタブで選んだ物 → looks.default → 3d', () => {
  assert.equal(pickLook(BOTH), '3d');
  assert.equal(pickLook(BOTH, '', '2d'), '2d', 'このタブで 2D を選んでいれば 2D');
  assert.equal(pickLook(BOTH, '3d', '2d'), '3d', 'URL が先');
  assert.equal(pickLook(BOTH, 'xx', '2d'), '2d', 'URL の知らない値は無いのと同じ');
  assert.equal(pickLook({ ...BOTH, looks: { ...BOTH.looks, default: '2d' } }), '2d', 'looks.default');
});

test('出せない方は選ばない: 3D の形が無ければ 2D、2D しか無ければ選んだ物が 3D でも 2D', () => {
  assert.equal(pickLook(ONLY2D, '3d'), '2d');
  assert.equal(pickLook(ONLY2D, '', '3d'), '2d');
  assert.equal(pickLook(ONLY3D, '', '3d'), '3d');
});

test('2D の部品の表の場所: looks.2d.parts が文字ならそれ、無ければ決まりの場所', () => {
  assert.equal(partsPath(BOTH), '2d/parts.json');
  assert.equal(partsPath({ looks: { '2d': { parts: 'board/p.json' } } }), 'board/p.json');
  assert.equal(partsPath({ looks: { '2d': { parts: ['head', 'body'] } } }), '2d/parts.json');
  assert.equal(partsPath({}), '2d/parts.json');
});

test('2D を出せそうか: S2 の形は yes・looks だけは見に行く・前の形と名前の並びだけは no(404 を出さない)', () => {
  assert.equal(twoDHint(BOTH), 'yes');
  assert.equal(twoDHint({ model: 'm.glb', looks: { default: '3d', '3d': { at: 'top' } } }), 'probe');
  assert.equal(twoDHint({ model: 'm.glb', looks: { '2d': { svg: 'a.svg', parts: ['head'] } } }), 'no');
  assert.equal(twoDHint(ONLY3D), 'no');
  assert.equal(twoDHint(null), 'no');
});

test('今の木のキャラ: ようこそくんは 2D が書いてある・ノリーは 2D を出せる(looks.2d があれば yes・無ければ決まりの場所を見る)・みかんと前の形は切り替えを出さない', () => {
  assert.equal(twoDHint(readCharacter('yokoso')), 'yes');
  // 今の木を決め打ちしない: 読んだ character.json に looks.2d があれば 'yes'、無ければ決まりの場所を見る 'probe'
  const norrie = readCharacter('norrie');
  const norrieHint = norrie.looks?.['2d'] ? 'yes' : 'probe';
  assert.equal(twoDHint(norrie), norrieHint, norrieHint === 'yes' ? 'ノリーは looks.2d に部品の表の場所が書いてある' : 'ノリーは looks.2d が無いが、2d/parts.json がある');
  assert.equal(partsPath(norrie), '2d/parts.json');
  readFileSync(join(CHARACTERS, 'norrie', '2d', 'parts.json')); // 決まりの場所に部品の表がある
  assert.equal(twoDHint(readCharacter('mikan')), 'no', 'みかんの 2d は部品の名前の並びだけ(板の部品の表が無い)');
  for (const id of ['robo', 'f_led', 'd_lantern']) assert.equal(twoDHint(readCharacter(id)), 'no', id);
});

test('このタブで選んだ見た目は、キャラごとに覚えて読める', () => {
  const s = fakeStorage();
  assert.equal(readRemembered(s, 'norrie'), '');
  assert.equal(writeRemembered(s, 'norrie', '2D'), true);
  assert.equal(s.data.get(rememberKey('norrie')), '2d');
  assert.equal(readRemembered(s, 'norrie'), '2d');
  assert.equal(readRemembered(s, 'yokoso'), '', 'ほかのキャラには移らない');
  assert.equal(writeRemembered(s, 'norrie', 'vr'), false, '知らない値は覚えない');
  assert.equal(readRemembered(s, 'norrie'), '2d');
  s.data.set(rememberKey('norrie'), 'こわれた値');
  assert.equal(readRemembered(s, 'norrie'), '', '中身が違えば無いのと同じ');
});

test('覚えられないブラウザ(使えない・いっぱい・無い)でも止まらない', () => {
  const s = fakeStorage({ throws: true });
  assert.equal(readRemembered(s, 'norrie'), '');
  assert.equal(writeRemembered(s, 'norrie', '2d'), false);
  assert.equal(readRemembered(null, 'norrie'), '');
  assert.equal(writeRemembered(null, 'norrie', '2d'), false);
});

test('画面: 見た目の切り替えは 1 つ。日本語の見出し・3D と 2D のボタン・最初は隠す・AR では隠す', () => {
  const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  const box = html.match(/<div class="look-switch" id="lookSwitch"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(box, '#lookSwitch がある');
  assert.equal((html.match(/id="lookSwitch"/g) ?? []).length, 1, '切り替えは 1 つだけ');
  assert.match(box[0], /role="group"/);
  assert.match(box[0], /aria-label="見た目の切り替え/);
  assert.match(box[0], / hidden[ >]/, '両方の見た目があるキャラの時だけ main.js が出す');
  assert.match(box[0], /data-hide-in-ar/);
  assert.match(box[1], /見た目/, '見える日本語の見出し');
  assert.match(box[1], /data-look="3d"[^>]*aria-label="3D\(立体\)で見る"/);
  assert.match(box[1], /data-look="2d"[^>]*aria-label="2D\(絵\)で見る"/);
});

test('画面: 切り替えのボタンは 44px 以上・上の段の押す所も 44px・考えの窓は上の段の下(--top-h)', () => {
  const css = readFileSync(join(HERE, '..', 'src', 'ui', 'style.css'), 'utf8');
  const rule = (sel) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.look-switch button'), /min-width:\s*44px/);
  assert.match(rule('.look-switch button'), /min-height:\s*44px/);
  assert.match(rule('.top .place-mode-button, .top .drawer > summary'), /min-height:\s*44px/);
  assert.match(rule('.thought-head'), /min-height:\s*44px/);
  const narrow = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(narrow, /\.thought \{ top: calc\(max\(12px, env\(safe-area-inset-top\)\) \+ var\(--top-h, 64px\) \+ 8px\)/, 'スマホの幅の考えの窓は、上の段の高さの下');
  assert.doesNotMatch(css, /\+ 76px\)/, '決め打ちの 76px は使わない');
});
