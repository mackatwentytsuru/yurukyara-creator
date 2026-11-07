// VR・AR に入る時の「許可する」待ち(実機の Quest 3、11/7): ボタンを押すと、ブラウザの下に「…没入体験を開くことを許可しますか?」の帯が出て、
// 答えるまで requestSession が返らない。もう一度押すと InvalidStateError(already an active, immersive XRSession)。
// 直した形: 頼んでいる間は 2 回目を頼まない(modes.js)・ボタンを押せなくし、画面の真ん中に「ブラウザの下の『許可する』を押してください」
// (modeButtons.js と main.js)・入るか断られたら消す。ヘッドセットでは「VR で見る」の案内をマイクの答えを待たずに出す(main.js)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createPresentation } from '../src/stage/modes.js';
import { mountModeButtons, XR_WAIT_TEXT, asksBrowser, xrErrorText } from '../src/stage/modeButtons.js';

const WEB = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 答えるまで返らない requestSession(実機のブラウザの「許可する」の帯のまね)。allow() で入る・deny() で断る */
function fakeXr({ vr = true, ar = true } = {}) {
  const calls = [];
  let answer = null;
  const xr = {
    calls,
    isSessionSupported: async (mode) => (mode === 'immersive-vr' ? vr : mode === 'immersive-ar' ? ar : false),
    requestSession(mode, opts) {
      calls.push({ mode, opts });
      if (calls.length > 1 && answer) return Promise.reject(Object.assign(new Error('There is already an active, immersive XRSession.'), { name: 'InvalidStateError' }));
      return new Promise((resolve, reject) => {
        answer = {
          allow: () => {
            const listeners = new Set();
            resolve({
              enabledFeatures: ['local-floor'],
              addEventListener: (type, fn) => type === 'end' && listeners.add(fn),
              end: async () => {
                for (const fn of listeners) fn();
              },
            });
            answer = null;
          },
          deny: () => {
            reject(Object.assign(new Error('The user denied permission.'), { name: 'NotAllowedError' }));
            answer = null;
          },
        };
      });
    },
    get answer() {
      return answer;
    },
  };
  return xr;
}

const fakeRenderer = () => ({ xr: { setReferenceSpaceType() {}, async setSession() {} }, setClearAlpha() {} });

async function presentation(xr) {
  return createPresentation({ renderer: fakeRenderer(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), nav: { xr }, win: {} });
}

test('modes.enter: 頼んでいる間(許可を待つ間)は 2 回目を頼まない。VR と AR を続けて押しても requestSession は 1 回', async () => {
  const xr = fakeXr();
  const modes = await presentation(xr);
  assert.equal(modes.pending, null);
  const first = modes.enter('vr');
  await tick();
  assert.equal(modes.pending, 'vr');
  const again = modes.enter('vr');
  const other = modes.enter('ar');
  assert.equal(again, first, '2 回目は同じ約束を返す');
  assert.equal(other, first, 'AR を押しても、頼んでいる VR を待つ');
  await tick();
  assert.equal(xr.calls.length, 1, '2 回目を頼んでいない(InvalidStateError にならない)');
  xr.answer.allow();
  await Promise.all([first, again, other]);
  assert.equal(modes.mode, 'vr');
  assert.equal(modes.pending, null);
  await modes.exit();
  assert.equal(modes.mode, 'screen');
});

test('modes.enter: 断られたら(許可しない)例外で知らせ、画面のまま。もう一度押すと、もう一度頼める', async () => {
  const xr = fakeXr();
  const modes = await presentation(xr);
  const p = modes.enter('vr');
  await tick();
  xr.answer.deny();
  await assert.rejects(p, { name: 'NotAllowedError' });
  assert.equal(modes.mode, 'screen');
  assert.equal(modes.pending, null);
  const retry = modes.enter('ar');
  await tick();
  assert.equal(xr.calls.length, 2);
  assert.equal(xr.calls[1].mode, 'immersive-ar');
  xr.answer.allow();
  await retry;
  assert.equal(modes.mode, 'ar');
});

/** ボタンの試験用の小さな DOM(createElement・属性・click だけ) */
class FakeButton {
  constructor() {
    this.attrs = {};
    this.dataset = {};
    this.listeners = [];
    this.hidden = false;
    this.disabled = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    if (type === 'click') this.listeners.push(fn);
  }
  click() {
    if (this.disabled) return; // 押せないボタンは、ブラウザと同じく click が来ない
    for (const fn of this.listeners) fn({});
  }
}
const fakeDoc = { createElement: () => new FakeButton() };
const fakeContainer = () => ({ children: [], appendChild(c) {
  this.children.push(c);
  return c;
} });

async function mountWithModes(xr) {
  const modes = await presentation(xr);
  const waits = [];
  const errors = [];
  const ui = mountModeButtons({ modes, container: fakeContainer(), doc: fakeDoc, onError: (e) => errors.push(e.message), onWait: (m) => waits.push(m) });
  return { modes, ui, waits, errors };
}

test('ボタン: VR を押すと、入るまで真ん中の知らせ(onWait)・どのボタンも押せない。入ったら知らせを消し、ボタンを戻す', async () => {
  const xr = fakeXr();
  const { modes, ui, waits, errors } = await mountWithModes(xr);
  const { vr, ar, screen } = ui.buttons;
  assert.ok(vr && ar && screen);
  vr.click();
  await tick();
  assert.deepEqual(waits, ['vr'], '押してすぐに知らせを出す');
  assert.ok(vr.disabled && ar.disabled && screen.disabled, '頼んでいる間は全部押せない');
  assert.equal(vr.getAttribute('aria-busy'), 'true');
  vr.click();
  ar.click();
  await ui.choose('ar'); // 押せないボタンの外から呼んでも頼まない
  await tick();
  assert.equal(xr.calls.length, 1, '2 回目を頼まない');
  xr.answer.allow();
  await tick();
  await tick();
  assert.equal(modes.mode, 'vr');
  assert.deepEqual(waits, ['vr', null], '入ったら知らせを消す');
  assert.ok(!vr.disabled && !ar.disabled && !screen.disabled);
  assert.equal(vr.getAttribute('aria-busy'), null);
  assert.ok(vr.hidden && !screen.hidden, '入った後は「画面に戻る」');
  assert.deepEqual(errors, []);
  assert.equal(XR_WAIT_TEXT, 'ブラウザの下の『許可する』を押してください');
});

test('ボタン: 断られたら知らせを消し、日本語の理由を出し、もう一度押せる', async () => {
  const xr = fakeXr();
  const { modes, ui, waits, errors } = await mountWithModes(xr);
  ui.buttons.ar.click();
  await tick();
  assert.deepEqual(waits, ['ar']);
  xr.answer.deny();
  await tick();
  await tick();
  assert.equal(modes.mode, 'screen');
  assert.deepEqual(waits, ['ar', null]);
  assert.deepEqual(errors, ['AR に入れませんでした(ブラウザで許可されませんでした)']);
  assert.ok(!ui.buttons.ar.disabled && !ui.buttons.vr.disabled);
  ui.buttons.vr.click();
  await tick();
  assert.equal(xr.calls.length, 2, '断られた後は、もう一度頼める');
});

test('ブラウザにたずねる入り方だけ知らせを出す(iPhone の殻の AR は出さない)。理由の言葉', () => {
  assert.equal(asksBrowser({ available: { ar_kind: 'webxr' } }, 'vr'), true);
  assert.equal(asksBrowser({ available: { ar_kind: 'webxr' } }, 'ar'), true);
  assert.equal(asksBrowser({ available: { ar_kind: 'native' } }, 'ar'), false);
  assert.equal(asksBrowser({ available: { ar_kind: 'webxr' } }, 'screen'), false);
  assert.equal(xrErrorText(Object.assign(new Error('x'), { name: 'SecurityError' }), 'vr'), 'VR に入れませんでした(ブラウザで許可されませんでした)');
  assert.equal(xrErrorText(new Error('この端末では vr を使えない'), 'vr'), 'VR に入れませんでした(この端末では vr を使えない)');
  assert.equal(xrErrorText(null, 'screen'), '画面に戻れませんでした(理由は分かりません)');
});

test('main.js: 真ん中の知らせをつなぐ・ヘッドセットの「VR で見る」の案内はマイクの答えを待たずに出す', () => {
  const main = read('src', 'main.js');
  assert.match(main, /onWait: \(mode\) => \{\n\s+if \(mode\) ui\.align\(null\);[^\n]*\n\s+ui\.xrWait\(mode \? XR_WAIT_TEXT : null\);/);
  const head = main.slice(main.indexOf('if (IS_HEADSET) {', main.indexOf('async function startSource')));
  const guide = head.indexOf('if (guide) ui.align(VR_GUIDE);');
  const mic = head.indexOf('await toggleMic();');
  assert.ok(guide > 0 && mic > guide, '案内を出してからマイクを待つ(前はマイクを待ってから案内を出していた)');
  assert.match(head, /if \(guide && !listener\?\.listening && !align\.hidden && align\.textContent === VR_GUIDE && modes\?\.mode === 'screen' && !modes\.pending\) ui\.align\(VR_GUIDE_NO_MIC\);/, 'マイクが使えなかった時だけ、まだ案内が出ていれば文を替える');
  assert.match(main, /const VR_GUIDE = '左上の「VR で見る」を押してください';/);
  assert.match(main, /let text = texts\[app\.mode\] \?\? \(IS_HEADSET \? texts\.pose : texts\.sim\);/, 'ヘッドセットの入口の前に「マウス」と言わない');
  const html = read('index.html');
  assert.match(html, /<p id="xrWait" class="xr-wait" role="status" aria-live="assertive" hidden><\/p>/);
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /\.xr-wait \{\n\s+position: fixed; left: 50%; top: 50%; transform: translate\(-50%, -50%\);/, '画面の真ん中');
  assert.match(css, /html\.is-headset \.align \{\n\s+left: 12px; transform: none;[^}]*top: calc\(max\(12px, env\(safe-area-inset-top\)\) \+ var\(--top-h, 96px\) \+ 8px\);/, 'ヘッドセットの案内は上の段の下の左(キャラの顔に重ねない)');
  assert.match(css, /\.place-mode-button:disabled \{ opacity: 0\.55;/, '頼んでいる間は押せないと分かる見た目');
  assert.match(main, /const denied = err\?\.name === 'NotAllowedError' \|\| err\?\.name === 'SecurityError';\n\s+ui\.error\(denied \? 'マイクを使えませんでした\(ブラウザで許可されませんでした\)。文字で話しかけられます' : err\.message\);/, 'マイクを断った時は日本語で');
});
