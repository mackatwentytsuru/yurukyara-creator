// キャラを、上の段(札・ボタン・考えの見出し)と下の帯(字幕・入力)の間に収める計算の試験。web/src/stage/framing.js(three を読まない)だけを読む。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBand, guardBottom, topLimit, topClearance, fullSpan, topPad, TOP_CLEAR_FRACTION, FULL_PAD, GUARDED_TOP_PAD, MOTION_MARGIN, MOTION_TOLERANCE, MAX_TOP_FRACTION, MAX_BOTTOM_FRACTION, MIN_USABLE } from '../src/stage/framing.js';

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

test('上の段とキャラのいちばん上のすき間は、画面の高さの 6%(小さい画面でも 8px は空ける)', () => {
  assert.equal(TOP_CLEAR_FRACTION, 0.06);
  assert.equal(topClearance(720), Math.ceil(720 * 0.06)); // 44px(1280×720)
  assert.equal(topClearance(670), Math.ceil(670 * 0.06)); // 41px
  assert.equal(topClearance(844), Math.ceil(844 * 0.06)); // 51px(iPhone の 390×844)
  assert.equal(topClearance(1080), Math.ceil(1080 * 0.06)); // 65px
  assert.equal(topClearance(100), 8, '小さすぎる画面でも 8px');
  assert.equal(topClearance(Number.NaN), 8);
});

test('全身の見える高さ: ふだんは足元の下と頭の上に FULL_PAD(1.18 倍・真ん中は高さの半分)。頭の上だけ替えられる', () => {
  close(fullSpan().visible, 1.18);
  close(fullSpan().center, 0.5);
  const g = fullSpan(0.42);
  close(g.visible, 1 + 0.42 + FULL_PAD);
  // 帯の上の端(真ん中 + 見える高さの半分)は頭の上 0.42、下の端は足元の下 FULL_PAD
  close(g.center + g.visible / 2, 1 + 0.42);
  close(g.center - g.visible / 2, -FULL_PAD);
  close(fullSpan(Number.NaN).visible, 1.18, 1e-9);
});

test('頭の上の余白(11/7): 動きの出っ張り + 余り。上の段で置き直す時は動かない子を大きく、跳ねる子は跳ねる分を空ける', () => {
  assert.equal(topPad(null, true), FULL_PAD, '測れない(VRM・2D の板)は前のまま');
  assert.equal(topPad(undefined, false), FULL_PAD);
  close(topPad(0, true), Math.max(GUARDED_TOP_PAD, MOTION_MARGIN), 1e-12); // 動かない子(ノリーの 3D は 0 に近い)
  close(topPad(0.01, true), Math.max(GUARDED_TOP_PAD, 0.01 + MOTION_MARGIN), 1e-12);
  close(topPad(0.38, true), 0.38 + MOTION_MARGIN, 1e-12); // 跳ねる子(パネルくんの jump など)
  assert.equal(topPad(0, false), FULL_PAD, '置き直さない時は前より小さくしない');
  close(topPad(0.38, false), 0.38 + MOTION_MARGIN, 1e-12);
  assert.ok(GUARDED_TOP_PAD > 0 && GUARDED_TOP_PAD < FULL_PAD && MOTION_MARGIN > 0);
  assert.ok(MOTION_TOLERANCE > 0 && MOTION_TOLERANCE < MOTION_MARGIN, '遠近の確かめの見込み違いの分は、帯の余りより小さい');
});

test('頭を置いてよい線(11/7 頭が切れる): 上の段は横の位置にかかわらず数える。PC の真ん中のキャラも、上の段の下 + 6% の下に置く', () => {
  const bar = [
    { left: 12, right: 330, top: 12, bottom: 40, width: 318, height: 28 }, // 札(左)
    { left: 12, right: 290, top: 48, bottom: 92, width: 278, height: 44 }, // ボタンの行(左)
    { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }, // 隠れている物
  ];
  const side = [{ left: 928, right: 1268, top: 52, bottom: 96, width: 340, height: 44 }]; // 右の考えの見出し(PC)
  const clear = topClearance(720);
  // 前は、キャラ(500〜800px)にどれも重ならないので 0 = 画面の上の端まで出てよかった(耳が切れた)
  assert.equal(topLimit({ bar, side, left: 500, right: 800, clear, panelGap: 8 }), 92 + clear, '上の段の下 + 6%');
  assert.equal(topLimit({ bar, side, left: 900, right: 1000, clear, panelGap: 8 }), 96 + clear, '重なる見出しも同じすき間');
  assert.equal(topLimit({ bar: [], side, left: 500, right: 800, clear }), 0, '何も無ければ 0');
  // 開いた窓(スマホの考えの窓・QR の箱)は重なる時だけ、すき間は小さく(上の段の線より下なら、そちらで決まる)
  const panels = [{ left: 12, right: 378, top: 120, bottom: 360, width: 366, height: 240 }];
  assert.equal(topLimit({ bar, panels, left: 60, right: 330, clear: topClearance(844), panelGap: 8 }), 368, '開いた窓の下 + 8px');
  assert.equal(topLimit({ bar, panels, left: 400, right: 800, clear, panelGap: 8 }), 92 + clear, '重ならない窓は数えない');
});
