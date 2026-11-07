// UW5(画面の見直し UIR 5・6・9・11・12・14・17・18・20・23、BUX・B5M・BSF の中くらい)の決まりの試験。
// 画面の部品の文(index.html・main.js・style.css・panel.js・micNotice.js)を読んで、来場者の画面の約束を確かめる(ブラウザは使わない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { micFailureText } from '../src/stage/micNotice.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const main = read('../src/main.js');
const css = read('../src/ui/style.css');
const panel = read('../src/ui/panel.js');
const uw5 = main.slice(main.indexOf('/* ---------- UW5(画面の見直し'), main.indexOf('/* ---------- UW5 ここまで'));

test('上の段は 3 つのボタン(はなす・かえる・もっと)。いちばん目立つのは「はなす」', () => {
  const nav = html.match(/<nav class="top-main" id="topMain"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const labels = [...nav.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  assert.deepEqual(labels, ['はなす', 'かえる', 'もっと']);
  assert.match(nav, /id="talkBtn" class="tm-btn tm-talk"/, '紫(tm-talk)は「はなす」');
  assert.match(css, /\.tm-talk \{[^}]*linear-gradient/);
  assert.match(css, /html\.top-simple:not\(\.top-more\) \.top \.chips,\s*html\.top-simple:not\(\.top-more\):not\(\.top-change\) \.top \.top-row \{ display: none; \}/, 'ほかの札とボタンは開いた時だけ');
  assert.match(css, /html\.top-simple \.top \.fr-return \{[^}]*background: var\(--glass\)/, '「ノリーにもどす」は紫にしない');
});

test('開いたらキャラが先に話し、押すだけの例を 2 つ出す(?auto=0 では声をかけない)', () => {
  assert.match(uw5, /UW5_EXAMPLES = Object\.freeze\(\['こんにちは!', 'なにが すき\?'\]\)/);
  assert.match(uw5, /function uw5GreetOnOpen\(\)[\s\S]*?if \(!app\.autoGreet[\s\S]*?talk\(\{ trigger: 'approach', mode: 'text' \}\)/);
  assert.match(uw5, /root\.contains\('gate-up'\) \|\| root\.contains\('fr-open'\)/, '入口と はじめての会話の間は待つ');
  assert.match(uw5, /\$\('choices'\)\?\.classList\.add\('yc-examples'\)/, '例のボタンの見た目');
});

test('声: 来場者の段に残りの字数を出さない(「おうちの人へ」の中)。使い切ったら やさしい 1 行', () => {
  assert.match(html, /<p class="grown-up" id="grownUp" hidden>おうちの人へ/);
  assert.ok(html.indexOf('id="grownUp"') < html.indexOf('id="chips"'), '札は「おうちの人へ」の下');
  assert.match(uw5, /UW5_VOICE_REST = 'こえは おやすみ。もじで はなせるよ'/);
});

test('戻るボタンは、開いている窓を全部閉じる(アプリから出ない)', () => {
  const any = main.slice(main.indexOf('function anyPanelOpen()'), main.indexOf('function closeAllPanels()'));
  for (const k of ["'top-more'", "'top-change'", "$('camAsk')", 'openSheets()', 'shitsukan', 'openPersona()', 'frSheetOpen()', 'tvActive()', "$('memoryDrawer')"]) {
    assert.ok(any.includes(k), `数える: ${k}`);
  }
  const close = main.slice(main.indexOf('function closeAllPanels()'), main.indexOf('function syncPanelHistory()'));
  assert.match(close, /\.yc-sheet-close/);
  assert.match(close, /\.yp-cancel/);
  assert.match(close, /uw5SetTop\(null\)/);
});

test('カメラが使えない時: 英語を出さず、やさしい 1 行で、カメラなしに自動で切り替える', () => {
  const start = main.slice(main.indexOf('async function startSource('), main.indexOf('const wantPose ='));
  assert.doesNotMatch(start, /\$\{err\.message\}/, '英語の err.message を画面に出さない');
  assert.match(start, /startSource\('sim', UW5_CAMERA_FALLBACK\)/);
  assert.match(uw5, /UW5_CAMERA_FALLBACK = 'カメラが つかえなかったよ。カメラなしで はじめるね'/);
});

test('仮の頭脳の知らせは字幕の上の 1 か所(上の札には出さない)', () => {
  const chips = main.slice(main.indexOf('function updateChips()'), main.indexOf('/** VR の中の板に出す'));
  assert.doesNotMatch(chips, /'仮の頭脳'/);
  assert.match(chips, /if \(brain !== 'mock'\) chips\.push/);
  assert.doesNotMatch(chips, /'あいづち'/, '意味の分からない札は出さない');
});

test('ほかの子に替わったら、字幕と「あたまの なか」を空にする', () => {
  const swap = main.slice(main.indexOf('function swapCharacter(next)'), main.indexOf('/* ---------- B5M'));
  assert.match(swap, /characterKey\(prev\) !== characterKey\(next\)\) ui\.clearTalk\?\.\(\)/);
  assert.match(panel, /clearTalk\(\) \{[\s\S]*?setCaption\(null\)/);
});

test('マイク: ボタンは「はなす」、聞いている間は「きいているよ」。断られた時の文は短い', () => {
  assert.match(html, /<span id="micLabel">はなす<\/span>/);
  assert.match(uw5, /UW5_LISTENING = 'きいているよ'/);
  const deny = micFailureText(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  assert.ok(deny.length <= 34, `短い(${deny.length} 字): ${deny}`);
  assert.match(deny, /許可されませんでした/);
  assert.match(css, /html\.top-simple \.mic span#micLabel \{ display: inline; \}/, 'スマホでも字を出す');
});

test('あたまの なか: 来場者には「もっと」の中だけ。赤い点を出さない', () => {
  assert.match(css, /html\.top-simple:not\(\.top-more\) #thought \{ display: none !important; \}/);
  assert.match(css, /html\.top-simple \.thought-head \.dot \{ display: none; \}/);
  assert.match(uw5, /`\$\{name\}の あたまの なか`/);
});

test('窓とパネル: 「とじる」は窓の上にいつも残る。覚えていることの中身もキャラの頭の線に数える。入力欄を 2 つ同時に出さない', () => {
  assert.match(css, /\.yc-sheet-head \{ position: sticky;/);
  assert.match(main, /const TOP_PANELS_UW5 = '#memoryDrawer\[open\] > \.drawer-body'/);
  assert.match(main, /panels: \[\.\.\.rectsOf\(TOP_PANELS\), \.\.\.rectsOf\(TOP_PANELS_UW5\)\]/);
  assert.match(css, /html\.fr-open:has\(\.fr-sheet input\[type="text"\]:not\(\[hidden\]\), \.fr-sheet textarea:not\(\[hidden\]\)\) \.composer \{ display: none; \}/);
});

test('しつかん: 「かえる」の中では、どの幅でも 4 つを並べる(2 回押さない)', () => {
  assert.match(css, /html\.top-simple \.top \.sk-open \{ display: none; \}/);
  assert.match(css, /html\.top-simple \.top \.sk-list \{\s*display: inline-flex;/);
});

test('UW5f: 初めての訪問は はじめての会話の札があいさつし、先に話さない。札が出ない時だけ 2 秒後に自分で話す', () => {
  assert.match(uw5, /if \(firstRunWanted\(\) && !uw5GreetForce\) \{[\s\S]*?setTimeout\([\s\S]*?2000\)[\s\S]*?return;/);
  assert.ok(uw5.indexOf('firstRunWanted()') < uw5.indexOf('uw5Greeted = true'), '話す前に初めての訪問かを見る');
});

test('UW5f: 声の料金は来場者の画面に出さない。あたまの なかは「用件」と秒数を出さない。覚えていることは巻ける影が出る', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/ui/persona/settings.js', import.meta.url), 'utf8').match(/elevenlabs: \{[^}]*\}/)?.[0] ?? '', /料金|鍵が要る/);
  assert.match(css, /html\.top-simple \.thought-foot, html\.top-simple \.thought-body \.row:has\(#tIntent\) \{ display: none; \}/);
  assert.match(css, /#memoryDrawer\[open\] > \.drawer-body \{[^}]*overflow-y: auto;[^}]*radial-gradient/);
});

test('UW5f: カメラが使えない時のやさしい 1 行は、入口の知らせを見える所へ出し、画面の上の知らせにも出す', () => {
  assert.match(main, /status\.textContent = UW5_CAMERA_FALLBACK;[^\n]*\n[^\n]*status\.scrollIntoView\?\.\(\{ block: 'center' \}\);[^\n]*\n[^\n]*ui\.notice\(UW5_CAMERA_FALLBACK\);/);
});

test('UW5(V6): Quest の箱を開いても「もっと」は閉じない。箱を開く間は上の段のほかの物をしまう。Escape は一番上の層だけを閉じて入口へ戻す', () => {
  assert.match(main, /classList\.toggle\('quest-open', open\);\s*reframe\(\);/);
  assert.match(css, /html\.top-simple\.quest-open \.top \.grown-up, html\.top-simple\.quest-open \.top \.chips, html\.top-simple\.quest-open #thought,\s*html\.top-simple\.quest-open #tvBtn \{ display: none !important; \}/);
  assert.match(css, /html\.top-simple\.quest-open \.quest-link-box \{\s*top: calc\(100% \+ 6px\);/);
  assert.match(main, /e\.key !== 'Escape' \|\| e\.defaultPrevented \|\| app\.questLink\?\.isOpen\) return;/);
  assert.match(main, /opener\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(main, /holdOpenFor: \(t\) => Boolean\(t\?\.closest\?\.\('#memoryDrawer'\)\)/);
});
