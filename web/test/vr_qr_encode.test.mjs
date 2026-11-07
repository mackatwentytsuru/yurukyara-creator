// 「VR(Quest)で開く」の QR の作り方(web/src/stage/qrCode.js)の答え合わせ。見本は Python の segno で 1 回だけ作った
// web/test/vr_qr_segno.json(作り方は vr_qr_segno_make.py。この試験は Python を使わない)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeQr, qrPath, capacityBytes, formatBits, versionBits, maskPenalty, QR_MAX_BYTES } from '../src/stage/qrCode.js';

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dirname, 'vr_qr_segno.json'), 'utf8'));
const rowsOf = (matrix) => matrix.map((row) => row.join(''));

test('見本: segno で作った QR と、版・マスク・マスの並びが全部同じ(バイトの形・誤りの直し M)', () => {
  assert.match(FIXTURE.made_with, /^segno /);
  assert.equal(FIXTURE.options.error, 'M');
  assert.ok(FIXTURE.cases.length >= 30, `見本は ${FIXTURE.cases.length} 件`);
  for (const c of FIXTURE.cases) {
    const qr = encodeQr(c.text);
    assert.ok(qr, `QR にならない: ${c.text}`);
    assert.equal(qr.version, c.version, `版: ${c.text}`);
    assert.equal(qr.mask, c.mask, `マスク: ${c.text}`);
    assert.equal(qr.size, c.version * 4 + 17);
    assert.deepEqual(rowsOf(qr.matrix), c.rows, `マスの並び: ${c.text}`);
  }
});

test('見本は版 1〜10 とマスク 0〜7 を全部ふくむ(マスクの点の数え方まで確かめている)', () => {
  const versions = new Set(FIXTURE.cases.map((c) => c.version));
  const masks = new Set(FIXTURE.cases.map((c) => c.mask));
  for (let v = 1; v <= 10; v += 1) assert.ok(versions.has(v), `版 ${v}`);
  for (let m = 0; m <= 7; m += 1) assert.ok(masks.has(m), `マスク ${m}`);
  assert.ok(FIXTURE.cases.some((c) => /[^\x00-\x7f]/.test(c.text)), '日本語(UTF-8 のバイト)も入っている');
});

test('入るバイトの数(誤りの直し M): 版 1 = 14 … 版 10 = 213。214 バイトからは QR にしない(null)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacityBytes), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  assert.equal(QR_MAX_BYTES, 213);
  assert.equal(encodeQr('a'.repeat(213)).version, 10);
  assert.equal(encodeQr('a'.repeat(214)), null);
  assert.equal(encodeQr('あ'.repeat(72)), null, '日本語は 1 字 3 バイト(216 バイト)');
});

test('形式の情報と版の情報は、決まりの表の値', () => {
  // 誤りの直し M・マスク 0〜7(ISO/IEC 18004 の表 C.1)
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(formatBits), [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]);
  // 版 7〜10(表 D.1)
  assert.deepEqual([7, 8, 9, 10].map(versionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
});

test('マスクの点: 全部同じ色の 21×21 は、長い並び・2×2・暗いマスの割合の点が付く', () => {
  const dark = Array.from({ length: 21 }, () => new Array(21).fill(1));
  // 長い並び: 行と列それぞれ 21 マス → (21 - 2) × 42 本 / 2×2: 20 × 20 × 3 / 暗い割合 100% → 10 × 10
  assert.equal(maskPenalty(dark), 19 * 42 + 20 * 20 * 3 + 100);
});

test('SVG の path: 暗いマスの横の並びごとに四角 1 つ。縁は 4 マス', () => {
  const { d, view } = qrPath([[1, 1, 0], [0, 1, 0], [1, 0, 1]]);
  assert.equal(view, 11);
  assert.equal(d, 'M4 4h2v1h-2zM5 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z');
  const qr = encodeQr('https://yuru.example/');
  const path = qrPath(qr.matrix);
  assert.equal(path.view, qr.size + 8);
  assert.doesNotMatch(path.d, /[^Mhvz0-9 -]/, 'path に数と M h v z のほかを入れない');
});
