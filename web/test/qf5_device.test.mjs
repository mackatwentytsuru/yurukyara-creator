// QA 後の直し(QF5): 舞台から外した子の GPU の物を捨てる・画面のキーボードの間の見せ方・入口の巻き・狭い画面の札。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { CharacterBase } from '../src/character/characterBase.js';
import { fitBand, KB_MAX_BOTTOM_FRACTION, KB_MIN_USABLE, MAX_BOTTOM_FRACTION, MIN_USABLE } from '../src/stage/framing.js';
import { installKeyboardInset } from '../src/ui/keyboardInset.js';

const read = (...p) => readFileSync(join(import.meta.dirname, '..', ...p), 'utf8');

test('releaseGpu: 形・材質・絵を全部捨てる(控えに残る子は、戻せば作り直される)', () => {
  const geo = new THREE.BoxGeometry();
  const tex = new THREE.Texture();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const log = [];
  geo.addEventListener('dispose', () => log.push('geo'));
  tex.addEventListener('dispose', () => log.push('tex'));
  mat.addEventListener('dispose', () => log.push('mat'));
  const c = Object.create(CharacterBase.prototype);
  c.object3d = new THREE.Group();
  c.object3d.add(new THREE.Mesh(geo, mat));
  c.releaseGpu();
  c.releaseGpu(); // 何度でも
  assert.deepEqual([...new Set(log)].sort(), ['geo', 'mat', 'tex']);
  assert.equal(c.object3d.children.length, 1, '中身は残す');
});

test('main.js: 舞台から外した子は releaseGpu・同じ子の古い控えは dispose', () => {
  const js = read('src/main.js');
  assert.match(js, /if \(prev !== next\) prev\.releaseGpu\?\.\(\);/);
  assert.match(js, /stale\.dispose\?\.\(\)/);
});

test('framing: キーボード中は下の帯の上限を広げ、残す高さの下限を下げられる', () => {
  const a = fitBand({ viewH: 800, topPx: 200, bottomPx: 600, needH: 1, aspect: 0.5 });
  const b = fitBand({ viewH: 800, topPx: 200, bottomPx: 600, needH: 1, aspect: 0.5, maxBottomFraction: KB_MAX_BOTTOM_FRACTION, minUsable: KB_MIN_USABLE });
  assert.equal(a.bottom, 800 * MAX_BOTTOM_FRACTION);
  assert.equal(a.usable, MIN_USABLE);
  assert.equal(b.bottom, 600);
  assert.ok(b.usable < MIN_USABLE && b.usable >= KB_MIN_USABLE);
});

test('keyboardInset: 見える高さで kb-tight(640 未満)・kb-short(400 未満)を付け、閉じたら外す', () => {
  const classes = new Set();
  const root = { style: { setProperty() {} }, classList: { toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)) } };
  const listeners = {};
  const vv = { height: 844, offsetTop: 0, addEventListener: (k, f) => (listeners[k] = f), removeEventListener() {} };
  const win = { innerHeight: 844, visualViewport: vv, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const doc = { documentElement: root, addEventListener() {}, removeEventListener() {} };
  const off = installKeyboardInset(doc, win);
  assert.equal(classes.size, 0);
  vv.height = 508;
  listeners.resize();
  assert.ok(classes.has('kb-open') && classes.has('kb-tight') && !classes.has('kb-short'));
  vv.height = 334;
  listeners.resize();
  assert.ok(classes.has('kb-short'));
  vv.height = 844;
  listeners.resize();
  assert.equal(classes.size, 0);
  off();
});

test('style.css: 入口は巻ける・字幕は 1 行(kb-tight)・Quest の箱は行の下・札は半分で切らない', () => {
  const css = read('src/ui/style.css');
  assert.match(css, /\.gate \{[^}]*overflow-y: auto;/);
  assert.match(css, /\.gate-card \{ margin: auto;/);
  assert.match(css, /html\.kb-tight \.caption, html\.kb-tight \.caption\.settled \{[^}]*max-height: calc\(1\.45em \+ 14px\)/);
  assert.match(css, /html\.kb-short \.top[^{]*\{ display: none !important; \}/);
  assert.match(css, /top: calc\(100% \+ 58px\);/);
  assert.match(css, /\.chips \{ flex-wrap: wrap; max-height: 32px; overflow: hidden;/);
  assert.doesNotMatch(css, /\.chips \{ flex-wrap: nowrap; overflow-x: auto/);
});
