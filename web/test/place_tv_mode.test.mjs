// テレビ表示(11/7 本人「iPhone にあるものを AirPlay で、テレビにすぐパンって映せるようにしたい」)の試験。
// 決まり(web/src/stage/tvMode.js・framing.js の tvTopLimit・firstVisit.js)は読んで動かし、画面の形(index.html・style.css・main.js)は文字で見る。
// 本当に描いた形(キャラの大きさ・真ん中・上のすき間・字幕の大きさ)は、GPU の Chrome の確かめ(リポジトリの外の道具)が測る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tvPlan, appleMobile, wantsTv, tvCaptionPx, tvCaptionRows, tvBottomReserve, TV_PORTRAIT_ROWS, castSteps, castLead, castNote,
  TV_CAPTION_FRACTION, TV_CAPTION_MIN_PX, TV_CAPTION_ROWS, TV_CAPTION_LINE, TV_LABEL, TV_SHORT, CAST_LABEL, TV_ENTER_LABEL, TV_EXIT_LABEL, TV_EXIT_NAME, TV_CLASS,
} from '../src/stage/tvMode.js';
import { tvTopLimit, topClearance, TOP_CLEAR_FRACTION } from '../src/stage/framing.js';
import { shouldOpenFirstRun } from '../src/stage/firstVisit.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8').replace(/\r\n/g, '\n');
const P = (q) => new URLSearchParams(q);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const QUEST = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.0 Chrome/140.0 VR Safari/537.36';

test('iPhone・iPad の見分け: iPadOS は Mac の名乗りでも、指で触れる点が 2 つ以上なら iPad', () => {
  assert.equal(appleMobile({ userAgent: IPHONE }), 'iPhone');
  assert.equal(appleMobile({ userAgent: IPHONE_CHROME }), 'iPhone'); // iPhone の中のほかのブラウザも、手順は同じ(コントロールセンター)
  assert.equal(appleMobile({ userAgent: IPAD_OLD }), 'iPad');
  assert.equal(appleMobile({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }), 'iPad');
  assert.equal(appleMobile({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 }), '');
  assert.equal(appleMobile({ userAgent: ANDROID, maxTouchPoints: 5 }), '');
  assert.equal(appleMobile({ userAgent: WIN }), '');
  assert.equal(appleMobile(), '');
});

test('入口の形: iPhone・iPad は「テレビに映す」、ほかは「テレビ表示」。?tv=1 で始める', () => {
  assert.deepEqual(tvPlan({ params: P(''), nav: { userAgent: IPHONE } }), { show: true, kind: 'cast', device: 'iPhone', start: false });
  assert.deepEqual(tvPlan({ params: P('tv=1'), nav: { userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 } }), { show: true, kind: 'cast', device: 'iPad', start: true });
  assert.deepEqual(tvPlan({ params: P('tv=1'), nav: { userAgent: WIN } }), { show: true, kind: 'toggle', device: '', start: true });
  assert.deepEqual(tvPlan({ params: P(''), nav: { userAgent: ANDROID } }), { show: true, kind: 'toggle', device: '', start: false });
  assert.equal(wantsTv(P('tv=1')), true);
  assert.equal(wantsTv(P('tv=0')), false);
  assert.equal(wantsTv(P('')), false);
});

test('ヘッドセットの中・入口の LED・自動で始める画面・重さを測る時は出さず、?tv=1 も読まない', () => {
  for (const [q, headset] of [['tv=1', true], ['tv=1&led=1', false], ['tv=1&autostart=1', false], ['tv=1&perf=1', false]]) {
    const plan = tvPlan({ params: P(q), nav: { userAgent: headset ? QUEST : IPHONE }, headset });
    assert.equal(plan.show, false, q);
    assert.equal(plan.start, false, q);
  }
});

test('画面ミラーリングの 3 つの手順: コントロールセンター → 画面ミラーリング → テレビをえらぶ(子どもにも読める言葉)', () => {
  for (const device of ['iPhone', 'iPad']) {
    const steps = castSteps(device);
    assert.equal(steps.length, 3);
    assert.match(steps[0].main, /コントロールセンター/);
    assert.match(steps[1].main, /画面ミラーリング/); // iPhone の画面に出る言葉のまま
    assert.equal(steps[2].main, 'テレビをえらぶ');
    assert.match(steps[2].sub, new RegExp(device)); // テレビに出た数字(AirPlay のパスコード)を入れる端末
    for (const s of steps) {
      assert.ok(s.main.length <= 16, `手順の見出しは短く: ${s.main}`);
      assert.ok(s.sub.length <= 50, `手順の補いも短く: ${s.sub}`);
    }
  }
  assert.match(castSteps('iPhone')[0].sub, /ホームボタン/); // ホームボタンのある iPhone は、下から上へ
  assert.doesNotMatch(castSteps('iPad')[0].sub, /ホームボタン/);
  assert.match(castLead(), /AirPlay/);
  assert.match(castNote('iPad'), /おなじ Wi-Fi/);
  assert.match(castNote('iPad'), /iPad/);
  assert.match(castNote('iPhone'), /ミラーリングを停止/);
  // テレビ表示では入力の帯を隠すので、声で話すなら先にマイクのボタン(勝手にマイクを入れない)。注意は 1 行ずつ
  assert.match(castNote('iPhone'), /マイクの ボタン/);
  assert.equal(castNote('iPad').split('\n').length, 3);
});

test('画面のコード(tvMode.js)に外の住所が無い(手順の出どころの頁の住所も書かない)', () => {
  const src = read('src/stage/tvMode.js');
  assert.doesNotMatch(src, /\b(?:https?|wss?):\/\//);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
});

test('字幕の字は画面の高さの 6% 以上(3 m 先から読める)。キャラの下に 2 行分を空け、空けすぎない', () => {
  for (const h of [720, 1080, 768, 670]) {
    const cap = tvCaptionPx(h);
    assert.ok(cap >= h * TV_CAPTION_FRACTION, `${h}: ${cap}px`);
    assert.ok(cap <= h * TV_CAPTION_FRACTION + 1, `${h}: ${cap}px`);
    const reserve = tvBottomReserve(h);
    assert.ok(reserve >= TV_CAPTION_ROWS * TV_CAPTION_LINE * cap, `${h}: 2 行が入る`);
    assert.ok(reserve <= h * 0.26, `${h}: キャラの帯を狭めすぎない(${reserve}px)`);
  }
  assert.equal(TV_CAPTION_FRACTION, 0.06);
  assert.equal(tvCaptionPx(390), TV_CAPTION_MIN_PX); // 横向きの iPhone でも 24px
  assert.equal(tvCaptionPx(0), TV_CAPTION_MIN_PX);
  assert.equal(tvCaptionPx(5000), 120);
});

test('テレビ表示の上の線: 上の段が無くても画面の上の端から 6%。隅の「もどる」は横に重なる時だけ', () => {
  const clear = topClearance(1080);
  assert.equal(clear, Math.ceil(1080 * TOP_CLEAR_FRACTION));
  assert.equal(tvTopLimit({ corner: [], left: 700, right: 1200, clear }), clear);
  const exit = { left: 1800, right: 1906, top: 10, bottom: 54, width: 106, height: 44 };
  assert.equal(tvTopLimit({ corner: [exit], left: 700, right: 1200, clear }), clear); // 真ん中のキャラには重ならない
  assert.equal(tvTopLimit({ corner: [exit], left: 1500, right: 1850, clear }), 54 + clear); // 重なる時はその下から
  const hidden = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  assert.equal(tvTopLimit({ corner: [hidden], left: 0, right: 400, clear }), clear);
});

test('?tv=1 では、初めての会話(7 歩)を自分から出さない', () => {
  const storage = { getItem: () => null };
  assert.equal(shouldOpenFirstRun({ params: P(''), storage }), true);
  assert.equal(shouldOpenFirstRun({ params: P('tv=1'), storage }), false);
});

test('index.html: 上の段の入口(44px の印と「テレビ」)・隅の「もどる」・手順の箱・「テレビ表示にする」', () => {
  const html = read('index.html');
  const btn = html.match(/<button[^>]*id="tvBtn"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
  assert.ok(btn, '#tvBtn がある');
  assert.match(btn, /aria-label="テレビ表示"/);
  assert.match(btn, /data-hide-in-ar/);
  assert.match(btn, /\shidden[\s>]/); // main.js が出す(ヘッドセットでは出さない)
  assert.match(btn, new RegExp(`>${TV_SHORT}</span>`));
  assert.match(btn, new RegExp(`<span class="tv-long" id="tvBtnLabel" aria-hidden="true">${TV_LABEL}</span>`)); // 幅 641 からは名前を見せる(main.js が iPhone・iPad で「テレビに映す」に)
  assert.ok(html.indexOf('id="tvBtn"') > html.indexOf('id="questLink"') && html.indexOf('id="tvBtn"') < html.indexOf('id="lookSwitch"'), '上の段の「VR」の右');
  assert.match(html, new RegExp(`<button[^>]*id="tvExit"[^>]*aria-label="${TV_EXIT_NAME}"[^>]*>${TV_EXIT_LABEL}</button>`));
  assert.match(html, /<div id="tvCast"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden>/);
  assert.match(html, new RegExp(`id="tvCastTitle">${CAST_LABEL}<`));
  assert.match(html, new RegExp(`id="tvEnter"[^>]*><span class="btn-main">${TV_ENTER_LABEL}</span>`));
  assert.match(html, /id="tvRotate"/);
  assert.equal(TV_LABEL, 'テレビ表示');
  assert.equal(CAST_LABEL, 'テレビに映す');
});

test('style.css: テレビ表示は小さな窓を隠し、字幕を画面の高さの 6% に。入口はヘッドセット・LED・7 歩の間は出さない', () => {
  const css = read('src/ui/style.css');
  assert.equal(TV_CLASS, 'tv-mode');
  const hide = css.match(/html\.tv-mode \.top, html\.tv-mode #thought, html\.tv-mode #choices, html\.tv-mode #composer[^{]*\{\s*display: none !important;/);
  assert.ok(hide, '上の段・考え・よくある質問・入力を隠す');
  assert.match(css, /html\.tv-mode \.tv-exit \{[^}]*position: fixed;[^}]*min-height: 44px;[^}]*min-width: 44px;/);
  assert.match(css, /html\.tv-mode \.caption, html\.tv-mode \.caption\.settled, html\.tv-mode \.caption\.user \{[^}]*font-size: var\(--tv-cap, clamp\(24px, 6vh, 120px\)\);/);
  assert.match(css, /html\.tv-mode \.caption \.cap-prev \{ display: none; \}/);
  assert.match(css, /html\.fr-open \.tv-btn, html\.is-led \.tv-btn, html\.is-headset \.tv-btn, html\.is-headset \.tv-cast \{ display: none !important; \}/);
  assert.match(css, /\.tv-btn \{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
  assert.match(css, /\.tv-enter \{[^}]*min-height: 64px;/);
  assert.match(css, /@media \(orientation: portrait\) and \(pointer: coarse\) \{\s*html\.tv-mode \.tv-rotate \{/);
  assert.match(css, /html\.tv-mode \.privacy\.off:not\(\.mic\) \{ display: none !important; \}/); // カメラかマイクを使っている間の注意書きは残す
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.tv-btn \.tv-long \{ display: none; \}\s*\.tv-btn \.tv-short \{ display: inline; \}/);
  // 幅 640 まで: 上の段の行に入れず、畳んだ考えの見出しと同じ行(見た目の切り替えの左)に置く(幅 390 で上の段を 1 行増やさない)
  assert.match(css, /\.tv-btn \{ position: fixed; top: calc\(max\(12px, env\(safe-area-inset-top\)\) \+ var\(--top-h, 64px\) \+ 8px\); right: var\(--tv-right, 12px\); \}/);
  assert.match(css, /body:has\(#tvBtn:not\(\[hidden\]\)\) \.thought:not\(\.collapsed\) \.thought-head \{ padding-right: calc\(var\(--tv-right, 12px\) \+ 72px\); \}/);
  assert.match(css, /@media \(max-width: 420px\) \{[^}]*\.look-switch \{ padding-left: 1px; \}\s*body:has\(#tvBtn:not\(\[hidden\]\)\) \.look-switch \.look-label \{ display: none; \}/);
  // 開いた考えの見出しの右の空け方は、見た目の切り替えだけの時の決まりより後ろ(同じ強さなので後ろが勝つ)
  assert.ok(css.indexOf('body:has(#tvBtn:not([hidden])) .thought:not(.collapsed) .thought-head') > css.indexOf('body:has(#lookSwitch:not([hidden])) .thought:not(.collapsed) .thought-head'));
});

test('main.js: テレビ表示の線・下の余白・入口・全画面は押した時だけ', () => {
  const js = read('src/main.js');
  // BCV: テレビ表示の隅のカメラの入・切(#tvCam。出している時だけ)も、キャラの横に重なる時は数える
  assert.match(js, /if \(tvActive\(\)\) return tvTopLimit\(\{ corner: rectsOf\('#tvExit, #tvRotate, #tvCam:not\(\[hidden\]\)'\), left, right, clear: topClearance\(window\.innerHeight, TOP_GAP_PX\) \}\);/);
  assert.match(js, /stage\.state\.bottomInset = Math\.max\(h \+ tvBottomReserve\(window\.innerHeight, window\.innerWidth\), h \+ subsHeight\(\) \+ 10\);/);
  assert.match(js, /--tv-cap', `\$\{tvCaptionPx\(window\.innerHeight, window\.innerWidth\)\}px`/);
  assert.match(js, /--tv-rows', String\(tvCaptionRows\(window\.innerHeight, window\.innerWidth\)\)/);
  assert.match(js, /const TV = tvPlan\(\{ params, nav: navigator, headset: IS_HEADSET \}\);/);
  assert.match(js, /if \(TV\.start\) document\.documentElement\.classList\.add\(TV_CLASS\);/);
  assert.match(js, /setupTvMode\(\);/);
  assert.match(js, /\$\('tvEnter'\)\?\.addEventListener\('click', \(\) => setTvMode\(true, \{ fullscreen: true \}\)\);/);
  // 全画面を頼むのは、押した時の受け口(テレビ表示の入口・入口のボタン)の中だけ
  const calls = [...js.matchAll(/requestTvFullscreen\(\)/g)].length;
  assert.equal(calls, 3, '定義の 1 つ + setTvMode の中 + 入口のボタン(startSource)');
  assert.match(js, /if \(tvActive\(\)\) requestTvFullscreen\(\); \/\/ \?tv=1/);
  assert.match(js, /\$\('privacy'\)\?\.classList\.toggle\('mic', Boolean\(listener\?\.listening\)\);/); // マイクで聞いている間の印
  assert.match(js, /if \(label\) label\.textContent = name;/); // 見せる言葉も名前に(iPhone・iPad は「テレビに映す」)
  // 幅 640 までの置き場所: 見た目の切り替えの幅を測って --tv-right に(切り替えが無ければ 12px)。出る・隠れる時も置き直す
  assert.match(js, /document\.documentElement\.style\.setProperty\('--tv-right', `\$\{12 \+ \(w > 0 \? w \+ 8 : 0\)\}px`\);/);
  assert.match(js, /new ResizeObserver\(placeTvButton\)\.observe\(look\);/);
});

test('縦長の画面(縦持ちのスマホ)のテレビ表示: 字は幅で抑え、行を増やし、キャラの下の余白も行の分だけ(QA 中 12)', () => {
  // 横長は今のまま
  assert.equal(tvCaptionPx(1080, 1920), 65);
  assert.equal(tvCaptionRows(1080, 1920), 3);
  assert.equal(tvBottomReserve(720, 1280), tvBottomReserve(720));
  // 縦長(390×844): 字は画面の幅の 8% = 31px 以下・5 行・余白は 5 行分
  const cap = tvCaptionPx(844, 390);
  assert.ok(cap <= 390 * 0.08 && cap >= 20, `${cap}px`);
  assert.equal(tvCaptionRows(844, 390), TV_PORTRAIT_ROWS);
  assert.ok(tvBottomReserve(844, 390) >= TV_PORTRAIT_ROWS * TV_CAPTION_LINE * cap);
  assert.ok(tvBottomReserve(844, 390) <= 844 * 0.45, 'キャラの帯を狭めすぎない');
  // 1 行の字数 × 行数で、ふつうの返事(約 40 字)が入る: 字幕の幅 = 画面の幅の 92% - 左右の余白
  const lineChars = Math.floor((390 * 0.92 - 2 * Math.max(14, 844 * 0.022)) / cap);
  assert.ok(lineChars * TV_PORTRAIT_ROWS >= 40, `1 行 ${lineChars} 字 × ${TV_PORTRAIT_ROWS} 行`);
  assert.match(read('src/ui/style.css'), /max-height: calc\(var\(--tv-cap, 6vh\) \* 1\.3 \* var\(--tv-rows, 3\)/);
});

test('Esc: 全画面でも、テレビ表示を一緒にやめる(全画面の Escape はページに届かない)。窓を開くと履歴を 1 つ積み、戻るで窓を閉じる(QA 低 14)', () => {
  const js = read('src/main.js');
  assert.match(js, /document\.addEventListener\('fullscreenchange', onFullscreenChange\);/);
  assert.match(js, /if \(tvFull && tvActive\(\) && !document\.fullscreenElement && !document\.webkitFullscreenElement\) setTvMode\(false\);/);
  assert.match(js, /history\.pushState\(\{ \.\.\.\(history\.state \?\? \{\}\), ycPanel: true \}, ''\);/);
  assert.match(js, /window\.addEventListener\('popstate'/);
  assert.match(js, /installPanelHistory\(\);/);
});
