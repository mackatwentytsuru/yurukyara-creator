// キャラを、上の段(札・ボタン・考えの見出し)と下の帯(字幕・入力)の間に収める計算の試験。web/src/stage/framing.js(three を読まない)だけを読む。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBand, guardBottom, MAX_TOP_FRACTION, MAX_BOTTOM_FRACTION, MIN_USABLE } from '../src/stage/framing.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が違う`);

test('上下の段が無ければ、見せたい高さのまま・真ん中', () => {
  const r = fitBand({ viewH: 800, needH: 1.18, aspect: 1280 / 800 });
  close(r.neededH, 1.18);
  close(r.usable, 1);
  close(r.shift, 0);
});

test('下の帯だけ: 帯の上に収める(前の決まりと同じ。キャラは画面の上の側へ)', () => {
  const viewH = 844;
  const r = fitBand({ viewH, bottomPx: 200, needH: 1.18, aspect: 390 / 844 });
  close(r.usable, 1 - 200 / viewH);
  close(r.neededH, 1.18 / (1 - 200 / viewH));
  close(r.shift, -100 / viewH); // 負 = 帯の真ん中は画面の真ん中より上
});

test('上の段と下の帯の両方: 間の帯に収め、帯の真ん中に置く(上の段が高いとキャラは下へ)', () => {
  const viewH = 844;
  const r = fitBand({ viewH, topPx: 240, bottomPx: 190, needH: 1.18, aspect: 390 / 844 });
  const usable = 1 - (240 + 190) / viewH;
  close(r.usable, usable);
  close(r.neededH, 1.18 / usable);
  close(r.shift, (240 - 190) / 2 / viewH);
  // 帯の上の端(画面の上から px)に、見せたい高さの上の端が来る: 真ん中 + shift から、見せたい高さの半分だけ上
  const pxPerUnit = viewH / r.neededH;
  const bandCenterPx = viewH / 2 + r.shift * viewH;
  close(bandCenterPx - (1.18 / 2) * pxPerUnit, 240, 1e-6);
  close(bandCenterPx + (1.18 / 2) * pxPerUnit, viewH - 190, 1e-6);
});

test('幅が足りない時は、幅で決める(しっぽや腕が画面の外に出ない)', () => {
  const aspect = 390 / 844;
  const r = fitBand({ viewH: 844, topPx: 100, bottomPx: 100, needH: 1.18, needW: 1.2, aspect });
  close(r.neededH, 1.2 / aspect);
  assert.ok(r.neededH > 1.18 / r.usable, '幅で決まった時は、帯に余りが出る(真ん中に置く)');
});

test('上下の段が高すぎても、キャラの帯は画面の 3 割は残す(横向きのスマホなど)', () => {
  const r = fitBand({ viewH: 390, topPx: 300, bottomPx: 300, needH: 1, aspect: 844 / 390 });
  close(r.top, 390 * MAX_TOP_FRACTION);
  close(r.bottom, 390 * MAX_BOTTOM_FRACTION);
  close(r.usable, MIN_USABLE);
  const bad = fitBand({ viewH: 0, topPx: Number.NaN, bottomPx: -5, needH: 1, aspect: 1 });
  assert.ok(Number.isFinite(bad.neededH) && Number.isFinite(bad.shift), '壊れた値でも数が出る');
});

test('上の段の下の端: キャラの横の範囲に重なる物だけ数え、隠れている物(0 の四角)は数えない', () => {
  const rects = [
    { left: 12, right: 330, top: 12, bottom: 40, width: 318, height: 28 }, // 札(左)
    { left: 12, right: 290, top: 48, bottom: 92, width: 278, height: 44 }, // ボタンの行
    { left: 928, right: 1268, top: 52, bottom: 96, width: 340, height: 44 }, // 右の考えの見出し(PC)
    { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }, // 隠れている物
  ];
  assert.equal(guardBottom(rects, 500, 800, 8), 0, 'PC の真ん中のキャラには、どれも重ならない');
  assert.equal(guardBottom(rects, 200, 700, 8), 92 + 8, '左の段に重なる');
  assert.equal(guardBottom(rects, 900, 1000), 96, '右の見出しに重なる');
  assert.equal(guardBottom(rects, 330, 900), 0, 'ふちが触れるだけは重ならない');
  assert.equal(guardBottom([], 0, 390, 8), 0);
});
