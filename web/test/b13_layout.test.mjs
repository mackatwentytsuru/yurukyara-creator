// B13L(11-08): スマホのキーボードと横向きの見せ方。
//  - iOS がページごと上へずらしても、キーボードは出ていると数え、舞台を見える範囲の高さに縮める(上の段とキャラの頭が押し出されない)
//  - 見える高さが 260px 未満(横向きの Android のキーボード)は vv-mini を付け、舞台と札の見出しをたたむ
//  - QA8 #2(声の送り先の注意書きが空)・#7(「もっと」で字幕と AI の知らせが消える)・#10(横向きで押せない)
//  - TV3 の should: ホーム画面の手順を「テレビに映す」の箱に毎回・Mac の案内に F11 と書かない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installKeyboardInset } from '../src/ui/keyboardInset.js';
import { fullscreenGuide } from '../src/stage/tvMode.js';
import { homeScreenLine, isMacDesktop, pcFullscreenKeys } from '../src/stage/tvHome.js';

const WEB = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8');
const html = read('index.html');
const css = read('src', 'ui', 'style.css');
const b13 = read('src', 'ui', 'layoutB13.css');
const main = read('src', 'main.js');

function fakeEnv({ inner, vvHeight, offsetTop = 0 }) {
  const classes = new Set();
  const vars = {};
  const root = { style: { setProperty: (k, v) => (vars[k] = v) }, classList: { toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)) } };
  const listeners = {};
  const vv = { height: vvHeight, offsetTop, scale: 1, addEventListener: (k, f) => (listeners[k] = f), removeEventListener() {} };
  const win = { innerHeight: inner, visualViewport: vv, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const doc = { documentElement: root, addEventListener() {}, removeEventListener() {} };
  return { classes, vars, vv, listeners, win, doc };
}

test('iOS がページごと上へずらして、下の差が 0 でも、kb-open と kb-tight が付き、--kbt と --kbh が入る', () => {
  const e = fakeEnv({ inner: 932, vvHeight: 585, offsetTop: 347 });
  installKeyboardInset(e.doc, e.win);
  assert.ok(e.classes.has('kb-open') && e.classes.has('kb-tight'));
  assert.equal(e.vars['--kbt'], '347px');
  assert.equal(e.vars['--kb'], '0px');
  assert.equal(e.vars['--vvh'], '585px');
  assert.equal(e.vars['--kbh'], '347px');
  assert.ok(!e.classes.has('vv-mini'));
});

test('Android の横向き: ページごと縮む(kb-open は付かない)が、見える高さが 260 未満なら vv-mini。戻ると外れる', () => {
  const e = fakeEnv({ inner: 390, vvHeight: 390 });
  installKeyboardInset(e.doc, e.win);
  assert.ok(!e.classes.has('vv-mini'));
  e.win.innerHeight = 190;
  e.vv.height = 190;
  e.listeners.resize();
  assert.ok(e.classes.has('vv-mini'));
  assert.ok(!e.classes.has('kb-open'));
  e.win.innerHeight = 390;
  e.vv.height = 390;
  e.listeners.resize();
  assert.ok(!e.classes.has('vv-mini'));
});

test('layoutB13.css: キーボードの間は舞台を見える範囲に縮める・vv-mini は舞台と見出しをたたむ・横向きの押せない物を出す', () => {
  assert.match(b13, /html\.kb-open:not\(\.fr-stack\) #stage \{[^}]*top: var\(--kbt, 0px\);[^}]*height: var\(--vvh, 100%\);/);
  assert.match(b13, /html\.vv-mini #stage \{ display: none; \}/);
  assert.match(b13, /html\.vv-mini \.fr-sheet\.fr-sheet \.fr-head \{ display: none !important; \}/);
  assert.match(b13, /html \.yp-try \{ position: static;/); // 性格の画面の 3 つのボタンを覆わない
  assert.match(b13, /html \.gate \.primary \{ position: sticky; bottom: 4px;/); // 入口の主ボタン
  assert.match(b13, /html \.gate-card \{ display: flex; flex-direction: column; \}/); // grid の子は貼り付いても動けない
  assert.match(html, /<link rel="stylesheet" href="\/src\/ui\/style\.css" \/>[\s\S]*<link rel="stylesheet" href="\/src\/ui\/layoutB13\.css" \/>/, 'style.css の後に読む');
});

test('main.js: 舞台の縮みに合わせる(キーボードの高さは字幕・帯に足さない・上の段の線は舞台の上端から)', () => {
  assert.match(main, /stage\.state\.bottomInset = h \+ 8 \+ subsHeight\(\) \+ 6;/);
  assert.doesNotMatch(main, /stage\.state\.bottomInset = h \+ kb \+/);
  assert.match(main, /--kbh/);
  assert.match(main, /function stageTopPx\(\)/);
  assert.match(main, /top: r\.top - dy, bottom: r\.bottom - dy/);
});

test('QA8 #2: 声の送り先の注意書きに .mic を付けない(幅 640 以下の「.mic span {display:none}」が文字を消した)', () => {
  assert.doesNotMatch(main, /\$\('privacy'\)\?\.classList\.toggle\('mic'/);
  assert.match(main, /\$\('privacy'\)\?\.classList\.toggle\('listening'/);
  assert.doesNotMatch(css, /:not\(\.mic\)/);
  assert.match(css, /\.privacy:not\(\.listening\) \{ display: none; \}/); // 低い画面でも、聞いている間は残す
});

test('QA8 #7: 「もっと」「かえる」を開いても、字幕の列(字幕と AI の知らせ)をしまわない', () => {
  const block = css.slice(css.indexOf('@media (max-width: 900px) {\n  html.top-simple.top-more:not(.tv-mode)'));
  const hide = block.slice(0, block.indexOf('display: none !important;'));
  assert.doesNotMatch(hide, /\.subs/);
  assert.match(hide, /\.privacy/); // 注意書きと押すだけの例は今までどおりしまう
});

test('TV3: 「テレビに映す」の箱にホーム画面の手順(ホーム画面の頁として開いていない時だけ)', () => {
  const line = homeScreenLine({ installed: false });
  assert.match(line, /共有ボタン/);
  assert.match(line, /ホーム画面に追加/);
  assert.doesNotMatch(line, /https?:/);
  assert.equal(homeScreenLine({ installed: true }), '');
  assert.match(main, /homeScreenLine\(\{ installed: isInstalledApp/);
  assert.match(main, /note\.textContent = home \?/);
});

test('TV3: Mac の全画面の案内に F11 と書かない(control + command + F)。Windows などは F11 のまま。iPad を名乗る Mac は Mac ではない', () => {
  const base = { device: '', canFullscreen: false, installed: false, seen: false };
  const mac = fullscreenGuide({ ...base, mac: true });
  assert.doesNotMatch(mac, /F11/);
  assert.match(mac, /control \+ command \+ F/);
  assert.match(fullscreenGuide(base), /F11/);
  assert.equal(pcFullscreenKeys(true).includes('F11'), false);
  assert.equal(isMacDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }), true);
  assert.equal(isMacDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), false, 'iPadOS は Mac の名乗りで指の点が 2 つ以上');
  assert.equal(isMacDesktop({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 }), false);
  assert.equal(isMacDesktop({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }), false);
  assert.match(main, /mac: isMacDesktop\(navigator\)/);
});
