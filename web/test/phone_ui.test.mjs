// 11-08 本人の iPhone の 2 つ: 「文字の窓がちっちゃすぎる」と「拡大縮小をしようとしたらなんか固まった」。
//  - 入力窓: 3 行まで伸びる・Enter で送る・変換中の Enter では送らない・字は 16px 以上・スマホの幅では全幅の 1 行目
//  - 拡大: 拡大している間はキーボードと数えない・つまむ合図を止める・拡大されたまま残ったら 1 倍へ戻す・viewport の meta で拡大を止める
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isZoomed, measureInset } from '../src/ui/keyboardInset.js';
import { LOCKED_VIEWPORT, installNoPinchZoom, isPinchZoomed } from '../src/ui/noPinchZoom.js';
import { MAX_ROWS, fitHeight, installComposerInput, shouldSubmitOnEnter } from '../src/ui/composerInput.js';
import { createCameraUse } from '../src/stage/cameraUse.js';

const WEB = join(import.meta.dirname, '..');
const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const css = readFileSync(join(WEB, 'src', 'ui', 'style.css'), 'utf8');

// ---- 拡大とキーボード ----

test('拡大している間は、visualViewport が縮んでもキーボードと数えない', () => {
  // 2 倍に拡大: 高さが半分になり、キーボードに見える
  assert.deepEqual(measureInset(844, { height: 422, offsetTop: 0, scale: 2 }), { kb: 0, top: 0, height: 844 });
  assert.deepEqual(measureInset(844, { height: 300, offsetTop: 120, scale: 1.5 }), { kb: 0, top: 0, height: 844 });
  assert.equal(isZoomed({ scale: 2 }), true);
  assert.equal(isZoomed({ scale: 1 }), false);
  assert.equal(isZoomed({ scale: 1.01 }), false, '1 倍に近い間は、ふつうに数える');
  assert.equal(isZoomed(undefined), false);
  assert.equal(isZoomed({ scale: NaN }), false);
});

test('拡大率が約 1 の時は、これまでどおりキーボードの高さを出す', () => {
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 0, scale: 1 }), { kb: 336, top: 0, height: 596 });
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 0, scale: 1.01 }), { kb: 336, top: 0, height: 596 });
  assert.deepEqual(measureInset(932, { height: 596, offsetTop: 0 }), { kb: 336, top: 0, height: 596 }, 'scale が無い古い端末');
});

// ---- つまむ合図を止める ----

function fakeDom({ scale = 1 } = {}) {
  const handlers = new Map();
  const vvHandlers = new Map();
  const winHandlers = new Map();
  const meta = { content: 'width=device-width, initial-scale=1, viewport-fit=cover', getAttribute(k) { return k === 'content' ? this.content : null; }, setAttribute(k, v) { if (k === 'content') { this.content = v; this.history.push(v); } }, history: [] };
  const add = (m) => (type, fn, opts) => m.set(type, [...(m.get(type) ?? []), { fn, opts }]);
  const del = (m) => (type, fn) => m.set(type, (m.get(type) ?? []).filter((h) => h.fn !== fn));
  const doc = { querySelector: (q) => (q.includes('viewport') ? meta : null), addEventListener: add(handlers), removeEventListener: del(handlers) };
  const vv = { scale, addEventListener: add(vvHandlers), removeEventListener: del(vvHandlers) };
  const raf = [];
  const win = { visualViewport: vv, addEventListener: add(winHandlers), removeEventListener: del(winHandlers), scrollTo() { win.scrolled = true; }, requestAnimationFrame: (fn) => raf.push(fn), scrolled: false };
  const fire = (m, type, e = {}) => (m.get(type) ?? []).forEach((h) => h.fn(e));
  return { doc, win, vv, meta, raf, handlers, fire: (type, e) => fire(handlers, type, e), fireVv: (type, e) => fire(vvHandlers, type, e) };
}

test('つまむ: gesturestart・gesturechange・2 本指の touchmove を止める(1 本指は止めない)', () => {
  const d = fakeDom();
  installNoPinchZoom(d.doc, d.win);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    let prevented = false;
    d.fire(type, { cancelable: true, preventDefault: () => (prevented = true) });
    assert.equal(prevented, true, type);
    assert.equal(d.handlers.get(type)[0].opts.passive, false, `${type} は passive:false で付ける`);
  }
  let two = false;
  d.fire('touchmove', { touches: [{}, {}], cancelable: true, preventDefault: () => (two = true) });
  assert.equal(two, true);
  let one = false;
  d.fire('touchmove', { touches: [{}], cancelable: true, preventDefault: () => (one = true) });
  assert.equal(one, false, 'なぞる(1 本指)は止めない');
});

test('つまむ: 起動時に viewport の meta を、拡大しない形にそろえる', () => {
  const d = fakeDom();
  installNoPinchZoom(d.doc, d.win);
  assert.equal(d.meta.content, LOCKED_VIEWPORT);
  assert.match(LOCKED_VIEWPORT, /maximum-scale=1/);
  assert.match(LOCKED_VIEWPORT, /width=device-width/);
  assert.match(LOCKED_VIEWPORT, /viewport-fit=cover/);
});

test('つまむ: 拡大されたまま残ったら、少しして meta を書き直して 1 倍へ戻す。1 倍なら何もしない', async () => {
  const d = fakeDom({ scale: 2.4 });
  installNoPinchZoom(d.doc, d.win);
  const before = d.meta.history.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(d.meta.history.length > before, true, 'meta を書き直した');
  d.raf.forEach((f) => f());
  assert.equal(d.meta.content, LOCKED_VIEWPORT, '最後は拡大しない形に閉じ直す');
  assert.equal(d.win.scrolled, true);

  const ok = fakeDom({ scale: 1 });
  installNoPinchZoom(ok.doc, ok.win);
  const n = ok.meta.history.length;
  ok.fire('touchend', {});
  ok.fireVv('resize', {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ok.meta.history.length, n, '拡大していなければ書き直さない');
  assert.equal(isPinchZoomed({ scale: 1 }), false);
  assert.equal(isPinchZoomed({ scale: 3 }), true);
});

test('つまむ: 外すと、合図を止めるのをやめる', () => {
  const d = fakeDom();
  const off = installNoPinchZoom(d.doc, d.win);
  off();
  let prevented = false;
  d.fire('gesturestart', { cancelable: true, preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
});

test('画面の守り: index.html の viewport は拡大しない・スマホでは touch-action でも拡大を止める・ステージは触って動かせるまま', () => {
  const meta = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
  assert.equal(meta, LOCKED_VIEWPORT, 'meta の中身は noPinchZoom.js の LOCKED_VIEWPORT と同じ');
  assert.match(css, /html,\s*body\s*\{\s*touch-action:\s*pan-x pan-y;\s*\}/);
  assert.match(css, /#stage\s*\{[^}]*touch-action:\s*none/, 'キャラの上のなぞりは、これまでどおり');
});

// ---- 入力窓 ----

test('入力窓: index.html は textarea・id は textInput のまま・カメラの後ろ・送る の前', () => {
  assert.match(html, /<textarea id="textInput" rows="1"[^>]*enterkeyhint="send"/);
  assert.equal(html.includes('<input id="textInput"'), false);
  assert.ok(html.indexOf('id="camBtn"') < html.indexOf('id="textInput"') && html.indexOf('id="textInput"') < html.indexOf('class="send"'));
});

test('入力窓: 字は 16px 以上(iPhone が拡大しない)・3 行まで・スマホの幅では全幅の 1 行目・送る は右', () => {
  const base = css.match(/\.composer textarea\s*\{([^}]+)\}/)?.[1] ?? '';
  const size = Number(base.match(/font-size:\s*(\d+)px/)?.[1]);
  assert.equal(size >= 16, true, `font-size ${size}`);
  assert.match(base, /max-height:\s*calc\(3 \* 1\.4em/);
  assert.match(base, /min-height:\s*(4[8-9]|[5-9]\d)px/);
  const phone = css.match(/@media \(max-width: 640px\)\s*\{\s*\.composer \{ flex-wrap: wrap; \}([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(phone, /\.composer textarea \{[^}]*order: -1;[^}]*flex: 1 1 100%/);
  assert.equal(Number(phone.match(/\.composer textarea \{[^}]*font-size:\s*(\d+)px/)?.[1]) >= 16, true);
  assert.match(phone, /\.composer \.send \{[^}]*margin-left: auto/);
  assert.match(phone, /\.composer button \{ min-height: 48px; \}/);
  assert.equal(MAX_ROWS, 3);
});

test('入力窓: 高さは中身に合わせ、上限(3 行)で切る', () => {
  assert.equal(fitHeight(48, 97, 2), 50);
  assert.equal(fitHeight(70, 97, 2), 72);
  assert.equal(fitHeight(200, 97, 2), 97);
  assert.equal(fitHeight(60, Infinity, 0), 60);
  assert.equal(fitHeight(0, 97), 0);
  assert.equal(fitHeight(NaN, 97), 0);
});

test('入力窓: Enter で送る・Shift+Enter は改行・変換中の Enter では送らない', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter' }), true);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter' }, true), false);
  assert.equal(shouldSubmitOnEnter({ key: 'a' }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', ctrlKey: true }), false);
});

function fakeInput({ scrollHeight = 48 } = {}) {
  const h = new Map();
  return {
    scrollHeight,
    offsetHeight: 50,
    clientHeight: 48,
    style: { height: '', removeProperty() { this.height = ''; } },
    addEventListener: (t, fn) => h.set(t, [...(h.get(t) ?? []), fn]),
    removeEventListener: (t, fn) => h.set(t, (h.get(t) ?? []).filter((x) => x !== fn)),
    fire: (t, e = {}) => (h.get(t) ?? []).forEach((fn) => fn(e)),
  };
}

test('入力窓: 入力のたびに高さを合わせ、Enter で form を送る(変換の確定の Enter は送らない)', async () => {
  const input = fakeInput({ scrollHeight: 48 });
  let submitted = 0;
  const form = { requestSubmit: () => submitted++ };
  const win = { getComputedStyle: () => ({ maxHeight: '97px' }), addEventListener() {}, removeEventListener() {} };
  const c = installComposerInput({ input, form }, win);
  assert.equal(input.style.height, '50px');
  input.scrollHeight = 66;
  input.fire('input');
  assert.equal(input.style.height, '68px');
  input.scrollHeight = 400;
  input.fire('input');
  assert.equal(input.style.height, '97px', '3 行で止まる');
  let prevented = false;
  input.fire('keydown', { key: 'Enter', preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(submitted, 1);
  // 変換中: 送らない
  input.fire('compositionstart');
  input.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(submitted, 1);
  input.fire('compositionend');
  input.fire('keydown', { key: 'Enter', preventDefault() {} }); // 確定の直後の Enter も、1 拍の間は送らない
  assert.equal(submitted, 1);
  await new Promise((r) => setTimeout(r, 10));
  input.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(submitted, 2);
  c.off();
  input.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(submitted, 2, '外したら送らない');
});

// ---- カメラを一瞬止める(マイクの取り直しの間) ----

test('カメラ: hold は映像の track を一瞬止め、戻す関数で元の状態に戻す(流れは閉じない)', () => {
  const tracks = [{ enabled: true, stopped: false }, { enabled: false }];
  const app = { mode: 'camera', source: { tracker: { stream: { getVideoTracks: () => tracks } } } };
  const el = { addEventListener() {} };
  const use = createCameraUse({
    app, ui: {}, dialogue: {}, $: () => el, params: new URLSearchParams(), headset: false, touch: true,
    sourceOptions: () => ({}), inXr: () => false, updatePrivacy() {}, isMock: () => false,
  });
  const release = use.hold();
  assert.deepEqual(tracks.map((t) => t.enabled), [false, false]);
  release();
  assert.deepEqual(tracks.map((t) => t.enabled), [true, false], '元から切れていた物は切れたまま');
  // カメラが入っていない時は、何もせず戻す関数を返す
  app.source = null;
  assert.equal(typeof use.hold(), 'function');
});
