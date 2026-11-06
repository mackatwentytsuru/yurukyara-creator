import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, detectTier, applyTier } from '../src/stage/tiers.js';

const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const QUEST = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4 Chrome/142.0.0.0 VR Safari/537.36';

test('PC は今までと同じ見た目(毛はキャラの設定のまま)', () => {
  const t = detectTier({ ua: PC, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11)', cores: 16, deviceMemory: 8 });
  assert.equal(t.name, 'high');
  assert.equal(t.furLayers, null);
  assert.equal(t.pixelRatioMax, 2);
});

test('スマホは mid、メモリが少なければ low', () => {
  assert.equal(detectTier({ ua: IPHONE, cores: 6 }).name, 'mid');
  assert.equal(detectTier({ ua: ANDROID, cores: 8, deviceMemory: 8 }).name, 'mid');
  assert.equal(detectTier({ ua: ANDROID, cores: 8, deviceMemory: 2 }).name, 'low');
});

test('iPad の Safari(Mac と名乗る)は指で触れるかで見分ける', () => {
  assert.equal(detectTier({ ua: IPAD, maxTouchPoints: 5, cores: 8 }).name, 'mid');
  assert.equal(detectTier({ ua: IPAD, maxTouchPoints: 0, cores: 8 }).name, 'high');
});

test('ヘッドセットは xr(毛 4 層。前からの値)', () => {
  const t = detectTier({ ua: QUEST });
  assert.equal(t.name, 'xr');
  assert.equal(t.furLayers, 4);
  assert.equal(detectTier({ ua: PC, headset: true }).name, 'xr');
});

test('CPU の描画は low', () => {
  assert.equal(detectTier({ ua: PC, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }).name, 'low');
});

test('URL の tier が最優先。知らない名前は無視', () => {
  assert.equal(detectTier({ ua: QUEST, forced: 'high' }).name, 'high');
  assert.equal(detectTier({ ua: PC, forced: 'nope', cores: 16 }).name, 'high');
});

test('段を当てると、画素の倍率を抑え、毛の層を返す', () => {
  const calls = [];
  const stage = { renderer: { setPixelRatio: (v) => calls.push(['pr', v]) }, resize: () => calls.push(['resize']) };
  assert.deepEqual(applyTier(stage, { ...TIERS.mid }, 3), { furLayers: 6 });
  assert.deepEqual(calls, [['pr', 1.5], ['resize']]);
  assert.deepEqual(applyTier(stage, { ...TIERS.high }, 1), {});
});
