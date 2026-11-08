// テレビに映す時の「完全な全画面」(11/8 本人「テレビには表示できるが、URL まで出ちゃったり、完全な全画面にもなってない」)の試験。
// iPhone のブラウザの頁は、頁の中から全画面にできない。「ホーム画面に追加」から開くと、帯の無い全画面で開く(manifest と apple- の印)。
// ① manifest(JSON・必要な項目・色が画面と同じ・画像の大きさ) ② index.html の印(manifest・apple-・viewport-fit=cover)
// ③ 案内の決まり(全画面にできない時だけ・1 回だけ・端末ごとの文) ④ テレビ表示でも「AI のキャラクターと話しています」は隠さない ⑤ 公開の頁が manifest と画像を配る
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canRequestFullscreen, isInstalledApp, fullscreenGuide, tvPlan, TV_GUIDE_KEY, TV_GUIDE_AUTO_HIDE_MS, TV_GUIDE_CLOSE_NAME,
} from '../src/stage/tvMode.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8').replace(/\r\n/g, '\n');
const P = (q) => new URLSearchParams(q);

const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');
const css = read('src/ui/style.css');

/** PNG の頭(IHDR)から幅と高さを読む */
function pngSize(file) {
  const b = readFileSync(join(WEB, file));
  assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG', `${file} は PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('manifest: 名前・始まりの頁・全画面(だめなら standalone)・色が画面と同じ', () => {
  assert.equal(manifest.name, 'ゆるキャラクリエイター');
  assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'ホーム画面の名前は短く');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'fullscreen');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']); // 全画面が出せない端末は standalone
  assert.equal(manifest.lang, 'ja');
  // 色は今の画面と同じ(index.html の theme-color と style.css の --ink)
  const theme = html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1];
  const ink = css.match(/--ink:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(theme && ink);
  assert.equal(manifest.theme_color.toLowerCase(), theme.toLowerCase());
  assert.equal(manifest.background_color.toLowerCase(), ink.toLowerCase());
});

test('manifest の画像: 192 と 512 がある・本当にその大きさの PNG・maskable もある・外の住所は無い', () => {
  const bySize = (s) => manifest.icons.filter((i) => i.sizes === s);
  assert.ok(bySize('192x192').length >= 1 && bySize('512x512').length >= 2, '192 と 512(any と maskable)');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'any'));
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/icons\/[\w-]+\.png$/, '同じ場所の画像(外の住所は書かない)');
    assert.equal(icon.type, 'image/png');
    const file = `public${icon.src}`;
    assert.ok(existsSync(join(WEB, file)), `${file} がある`);
    const { w, h } = pngSize(file);
    assert.equal(`${w}x${h}`, icon.sizes, `${file} の大きさ`);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /\b(?:https?|wss?):\/\//);
  const touch = pngSize('public/icons/apple-touch-icon.png');
  assert.deepEqual(touch, { w: 180, h: 180 });
});

test('index.html: manifest・apple- の印・apple-touch-icon。セーフエリア(viewport-fit=cover)はそのまま', () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*" \/>/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.ok(existsSync(join(WEB, 'public/icons/apple-touch-icon.png')));
});

test('頁から全画面にできるか: 口があり、頁が許している時だけ(iPhone のブラウザは口が無い)', () => {
  const api = { requestFullscreen() {} };
  assert.equal(canRequestFullscreen({ doc: { fullscreenEnabled: true }, el: api }), true);
  assert.equal(canRequestFullscreen({ doc: {}, el: api }), true); // 許しの値が無いブラウザは、口があれば試す
  assert.equal(canRequestFullscreen({ doc: { webkitFullscreenEnabled: true }, el: { webkitRequestFullscreen() {} } }), true); // iPad の古い名前
  assert.equal(canRequestFullscreen({ doc: { fullscreenEnabled: false }, el: api }), false); // 別の頁の中など
  assert.equal(canRequestFullscreen({ doc: { fullscreenEnabled: false }, el: {} }), false); // iPhone
  assert.equal(canRequestFullscreen({ doc: {}, el: {} }), false);
  assert.equal(canRequestFullscreen(), false);
});

test('ホーム画面の頁として開いているか: iPhone・iPad は navigator.standalone、ほかは display-mode', () => {
  const mm = (on) => (q) => ({ matches: on.includes(q) });
  assert.equal(isInstalledApp({ nav: { standalone: true } }), true);
  assert.equal(isInstalledApp({ nav: { standalone: false }, matchMedia: mm([]) }), false);
  assert.equal(isInstalledApp({ nav: {}, matchMedia: mm(['(display-mode: standalone)']) }), true);
  assert.equal(isInstalledApp({ nav: {}, matchMedia: mm(['(display-mode: fullscreen)']) }), true);
  assert.equal(isInstalledApp({ nav: {}, matchMedia: mm(['(display-mode: minimal-ui)']) }), true);
  assert.equal(isInstalledApp({ nav: {}, matchMedia: mm(['(display-mode: browser)']) }), false);
  assert.equal(isInstalledApp({ nav: {}, matchMedia: () => { throw new Error('x'); } }), false);
  assert.equal(isInstalledApp(), false);
});

test('案内: 全画面にできない・ホーム画面の頁でもない・まだ出していない時だけ。端末ごとの文', () => {
  const base = { device: 'iPhone', canFullscreen: false, installed: false, seen: false };
  const phone = fullscreenGuide(base);
  assert.match(phone, /共有/);
  assert.match(phone, /ホーム画面に追加/);
  assert.ok(phone.length <= 60, '短い 1 行(長くても 2 行)');
  assert.match(fullscreenGuide({ ...base, device: 'iPad' }), /ホーム画面に追加/);
  const pc = fullscreenGuide({ ...base, device: '' });
  assert.match(pc, /F11/);
  assert.match(pc, /全画面/);
  assert.doesNotMatch(pc, /ホーム画面/);
  // 出さない時は空
  assert.equal(fullscreenGuide({ ...base, canFullscreen: true }), '');
  assert.equal(fullscreenGuide({ ...base, installed: true }), '');
  assert.equal(fullscreenGuide({ ...base, seen: true }), '');
  assert.equal(fullscreenGuide({ ...base, device: '', canFullscreen: true }), '');
  // 文に外の住所を書かない・閉じる名前と自動で消える時間がある
  assert.doesNotMatch(phone + pc, /https?:/);
  assert.ok(TV_GUIDE_CLOSE_NAME.length > 0);
  assert.ok(TV_GUIDE_AUTO_HIDE_MS >= 8000 && TV_GUIDE_AUTO_HIDE_MS <= 30000);
  assert.match(TV_GUIDE_KEY, /^yc\.[\w.]+$/);
});

test('案内の出し口: 全画面を頼む 1 か所だけ(できない時)。1 回だけ・閉じるボタン・テレビ表示をやめたら消える', () => {
  const js = read('src/main.js');
  assert.match(js, /if \(typeof req !== 'function' \|\| !canRequestFullscreen\(\{ doc: document, el \}\)\) \{\s*showTvGuide\(\);[^\n]*\n\s*return;\s*\}/);
  assert.equal([...js.matchAll(/showTvGuide\(\)/g)].length, 2, '定義 + 全画面を頼む所の 1 か所');
  assert.match(js, /installed: isInstalledApp\(\{ nav: navigator, matchMedia: window\.matchMedia\?\.bind\(window\) \}\)/);
  assert.match(js, /localStorage\.getItem\(TV_GUIDE_KEY\) === '1'/);
  assert.match(js, /localStorage\.setItem\(TV_GUIDE_KEY, '1'\)/);
  assert.match(js, /\$\('tvGuideClose'\)\?\.addEventListener\('click', hideTvGuide\);/);
  assert.match(js, /if \(!on\) \{\s*hideTvGuide\(\);/);
  // 閉じるボタン(44px)・読み上げの名前・文は textContent で入れる
  assert.match(html, new RegExp(`<button type="button" id="tvGuideClose"[^>]*aria-label="${TV_GUIDE_CLOSE_NAME}"`));
  assert.match(html, /<div id="tvGuide" class="tv-guide" role="status" hidden>/);
  assert.match(js, /text\.textContent = line;/);
  assert.match(css, /\.tv-guide-close \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.match(css, /\.tv-guide\[hidden\] \{ display: none; \}/);
});

test('iPhone の入口は「テレビに映す」のまま(案内は全画面を頼んだ時に出る)。ヘッドセット・LED などは出さない', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1';
  const plan = tvPlan({ params: P(''), nav: { userAgent: IPHONE } });
  assert.deepEqual([plan.kind, plan.device], ['cast', 'iPhone']);
  // main.js の案内の端末名は plan.device(iPhone・iPad・'')
  assert.match(read('src/main.js'), /fullscreenGuide\(\{ device: TV\.device,/);
  assert.equal(tvPlan({ params: P('led=1'), nav: { userAgent: IPHONE } }).show, false);
});

/** style.css の中の、selector と本文(入れ子の @media の中も含めて { } の対を読む) */
function cssRules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text.replace(/\/\*[\s\S]*?\*\//g, '')))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

test('テレビ表示でも「AI のキャラクターと話しています」を隠さない(安全の決まり)。上の段・下の入力・窓は隠す', () => {
  const rules = cssRules(css);
  const hidden = rules.filter((r) => /\bhtml\.tv-mode\b/.test(r.selector) && /display:\s*none/.test(r.body)).map((r) => r.selector).join(',');
  // 隠すもの: 上の段・考え・よくある質問・入力の帯・案内・カメラかマイクを使っていない時の注意書き
  for (const sel of ['.top', '#thought', '#choices', '#composer', '#align']) assert.ok(hidden.includes(`html.tv-mode ${sel}`), `${sel} は隠す`);
  // 隠さないもの: AI の 1 行・字幕の列・字幕
  for (const sel of ['.ai-notice', '#aiNotice', '.subs', '#caption', '.caption:not', '.ai-notice-top']) {
    const bad = rules.filter((r) => /\bhtml\.tv-mode\b/.test(r.selector) && r.selector.includes(sel.replace(':not', '')) && /display:\s*none/.test(r.body) && !/\.cap-(prev|next)/.test(r.selector));
    assert.deepEqual(bad.map((r) => r.selector), [], `${sel} を tv-mode で隠していない`);
  }
  // 「AI のキャラクターと話しています」は字幕の列の中にあり、テレビ表示では 12px 以上の字で見せる
  const subs = html.match(/<div class="subs">[\s\S]*?<\/div>\s*<p class="ai-notice ai-notice-top"/)?.[0] ?? '';
  assert.match(subs, /<p class="ai-notice" id="aiNotice" role="note">AI のキャラクターと話しています<\/p>/);
  assert.match(css, /html\.tv-mode \.ai-notice \{ font-size: max\(12px, 1\.6vh\); opacity: 0\.85; \}/);
  // 「もどる」は隅にずっと見える(押す所 44px 以上。Esc でも戻る)
  assert.match(css, /html\.tv-mode \.tv-exit \{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
  assert.match(css, /html\.tv-mode \.tv-exit \{ opacity: 1; \}/);
  assert.match(read('src/main.js'), /if \(e\.key !== 'Escape'\) return;/);
  // 字幕は遠くから読める(画面の高さの 6%)
  assert.match(css, /html\.tv-mode \.caption, html\.tv-mode \.caption\.settled, html\.tv-mode \.caption\.user \{[^}]*font-size: var\(--tv-cap, clamp\(24px, 6vh, 120px\)\);/);
});

test('公開の頁(Vercel)と手元のサーバーが manifest と画像を配る', () => {
  const v = JSON.parse(read('vercel.json'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /manifest-src 'self'/);
  assert.match(csp, /img-src 'self'/);
  const mh = v.headers.find((h) => h.source === '/manifest.webmanifest');
  assert.ok(mh, 'manifest の見出し(型)がある');
  assert.equal(mh.headers.find((h) => h.key === 'Content-Type').value.split(';')[0], 'application/manifest+json');
  // 書き換え(rewrites)で manifest・画像を別の所へ回していない
  for (const r of v.rewrites ?? []) assert.doesNotMatch(r.source, /manifest|icons/);
  // public/ は組み立てで dist の根に写る(Vite の決まり)ので、パスは dist の根からの /manifest.webmanifest・/icons/*
  assert.ok(existsSync(join(WEB, 'public/manifest.webmanifest')));
  assert.match(read('server/index.mjs'), /'\.webmanifest': 'application\/manifest\+json; charset=utf-8'/);
});
