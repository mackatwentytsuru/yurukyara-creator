// 画面の「いろ」(src/theme.js・src/ui/themes.css・設定の「いろ」)の試験。
// - 4 つの色は、どれも同じ変数を全部持つ(1 つでも欠けると、その色の時だけ色が抜ける)
// - ボタンや字の色は、字と地の比が WCAG AA(4.5)を満たす(むらさき = これまでの色は、点検の外)
// - style.css・onboarding/styles.js に、手書きの色(むらさきの色・白と黒の透け)を新しく書かない(色は themes.css の変数)
// - 選んだ色の覚え方・読み方(?theme=・覚えた物・壊れた保存場所)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, applyTheme, getTheme, hexCss, normalizeTheme, onThemeChange, parseHex, parseNumber, parseTriple, readStageColors, readVrColors, resolveTheme,
} from '../src/theme.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8');
const css = read('ui', 'themes.css');

/** themes.css の塊 → { paper: {変数: 値}, ... } */
function parseThemes(text) {
  const out = {};
  for (const m of text.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    const id = /data-theme="(\w+)"/.exec(m[1])?.[1];
    if (!id) continue;
    const vars = {};
    for (const v of m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[v[1]] = v[2].trim();
    out[id] = vars;
  }
  return out;
}
const themes = parseThemes(css);

// ---- WCAG の字と地の比 ----
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseHex(hex, 0);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('4 つの色: ひるの紙がはじめの色で、設定に 4 つ並ぶ', () => {
  assert.equal(DEFAULT_THEME, 'paper');
  assert.deepEqual(THEMES.map((t) => t.id), ['paper', 'warm', 'dusk', 'purple']);
  assert.deepEqual(THEMES.map((t) => t.label), ['ひるの紙', 'あたたかい夜', 'ゆうやけの町', 'むらさき']);
  assert.deepEqual(Object.keys(themes).sort(), ['dusk', 'paper', 'purple', 'warm']);
});

test('themes.css: 4 つの塊が、同じ変数を全部持つ', () => {
  const names = Object.keys(themes.paper).sort();
  assert.ok(names.length > 60, `変数が少なすぎる: ${names.length}`);
  for (const id of ['warm', 'dusk', 'purple']) {
    assert.deepEqual(Object.keys(themes[id]).sort(), names, `${id} の変数が、ひるの紙とそろっていない`);
  }
  // 何も data-theme が付いていない時(古い保存・読み込み前)も、ひるの紙になる
  assert.match(css, /:root,\s*\n:root\[data-theme="paper"\]\s*\{/);
});

test('themes.css: 使う変数は、全部どこかで決めてある(CSS の中か、JS が setProperty で入れる)', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  const all = walk(SRC).filter((f) => /\.(css|js)$/.test(f)).map((f) => readFileSync(f, 'utf8'));
  const declared = new Set();
  for (const text of all) {
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
    for (const m of text.matchAll(/['"](--[\w-]+)['"]/g)) declared.add(m[1]); // style.setProperty('--top-h', …)
  }
  for (const f of [['ui', 'style.css'], ['ui', 'onboarding', 'styles.js'], ['ui', 'themes.css'], ['ui', 'memoryPanel.js']]) {
    for (const m of read(...f).matchAll(/var\((--[\w-]+)/g)) assert.ok(declared.has(m[1]), `${f.join('/')}: ${m[1]} がどこでも決まっていない`);
  }
});

test('字と地の比: ひるの紙・あたたかい夜・ゆうやけの町は、おもな字とボタンが 4.5 以上(枠は 3 以上)', () => {
  for (const id of ['paper', 'warm', 'dusk']) {
    const v = themes[id];
    const pairs = [
      ['本文', v['--text'], v['--ink']], ['本文/板', v['--text'], v['--ink-2']], ['本文/吹き出し', v['--text'], v['--ink-3']],
      ['うすい字/板', v['--muted'], v['--ink-2']], ['見出し/板', v['--accent'], v['--ink-2']], ['案内役の名/板', v['--mint'], v['--ink-2']],
      ['おもなボタン(始め)', v['--on-btn'], v['--btn-from']], ['おもなボタン(終わり)', v['--on-btn'], v['--btn-to']],
      ['聞いている間(始め)', v['--on-hear'], v['--hear-from']], ['聞いている間(終わり)', v['--on-hear'], v['--hear-to']],
      ['自分の吹き出し(始め)', v['--on-btn'], v['--bubble-user-from']], ['自分の吹き出し(終わり)', v['--on-btn'], v['--bubble-user-to']],
      ['丸の字/ミント', v['--on-chip'], v['--mint']], ['丸の字/コーラル', v['--on-chip'], v['--coral']], ['丸の字/見出しの色', v['--on-chip'], v['--accent']],
      ['キャラの吹き出し', v['--text'], v['--bubble-char']], ['メモの吹き出し', v['--text'], v['--bubble-note']],
      ['VR の板: 返事', v['--vr-reply'], `#${v['--vr-panel-rgb'].split(' ').map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`],
    ];
    for (const [name, fg, bg] of pairs) {
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `${id}: ${name} の比が ${r.toFixed(2)}(4.5 未満)`);
    }
    for (const [name, fg, bg] of [['ボタンの縁/板', v['--line-strong'], v['--ink-2']], ['ボタンの形/ページ', v['--btn-from'], v['--ink']], ['ピント枠/ページ', v['--focus'], v['--ink']]]) {
      const r = ratio(fg, bg);
      assert.ok(r >= 3, `${id}: ${name} の比が ${r.toFixed(2)}(3 未満)`);
    }
  }
});

test('手書きの色を足さない: style.css と入口の styles.js は、色を themes.css の変数で書く', () => {
  const bad = /#7d62ff|#c15bff|#a35bff|#9b7dff|#ff8f7a|#ff6fa8|rgba\(\s*(12|8|20|23|255|0)\s*,\s*(10|6|18|20|255|0)\s*,\s*(22|18|31|38|255|0)\s*,|rgba\(\s*(183|190|125|123|255)\s*,\s*(168|160|98|224|143|211|90|70|107)\s*,/;
  for (const f of [['ui', 'style.css'], ['ui', 'onboarding', 'styles.js']]) {
    const lines = read(...f).split('\n');
    lines.forEach((raw, i) => {
      const line = raw.replace(/var\(--[\w-]+,\s*rgba?\([^)]*\)\)/g, 'var(--x)').replace(/var\(--[\w-]+,\s*[^()]*\)/g, 'var(--x)'); // var(--変数, 予備の色) の予備(これまでの紫の値)は、変数が読めない時だけなので見ない
      assert.ok(!bad.test(line), `${f.join('/')}:${i + 1} に手書きの色があります。themes.css の変数(例: rgb(var(--tint-rgb) / 0.1)・var(--btn-from))にしてください: ${line.trim().slice(0, 100)}`);
    });
  }
});

test('「送る」の字の強さ・吹き出しの変数・memoryPanel の JS の色(TC2 の注意 3 つ)', () => {
  const style = read('ui', 'style.css');
  assert.match(style, /\.composer \.send \{ color: var\(--on-btn\); \}/, '.composer button の字(--text)より強くして、「送る」の字を --on-btn にする');
  const onboard = read('ui', 'onboarding', 'styles.js');
  for (const v of ['--ink-3-rgb', '--bubble-char-rgb', '--bubble-note-rgb']) assert.ok(onboard.includes(`var(${v}`), `重ねの会話の吹き出しが ${v} を使っていない`);
  const mem = read('ui', 'memoryPanel.js');
  assert.doesNotMatch(mem, /rgba\(8, 6, 18|rgba\(255, 255, 255, 0\.08\)|rgba\(0, 0, 0, 0\.5\)/, '記憶の札の JS に手書きの色が残っている');
  assert.match(mem, /var\(--on-chip/);
});

test('index.html: 描く前に色を入れる台本と themes.css の読み込み(style.css より前)', () => {
  const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
  assert.match(html, /localStorage\.getItem\('yc\.theme'\)/);
  assert.match(html, /\^\(paper\|warm\|dusk\|purple\)\$/);
  assert.ok(html.indexOf('/src/ui/themes.css') > 0 && html.indexOf('/src/ui/themes.css') < html.indexOf('/src/ui/style.css'));
  assert.match(html, /meta name="theme-color" content="#f6efe3"/);
  assert.equal(THEME_STORAGE_KEY, 'yc.theme');
});

test('色の読み方: ひろえない時は、むらさき(これまでの値)', () => {
  assert.equal(parseHex('#fff', 0), 0xffffff);
  assert.equal(parseHex(' #a9708f ', 0), 0xa9708f);
  assert.equal(parseHex('red', 7), 7);
  assert.deepEqual(parseTriple('12 10 22', []), [12, 10, 22]);
  assert.deepEqual(parseTriple('1 2', [9]), [9]);
  assert.equal(parseNumber(' 0.3', 1), 0.3);
  assert.equal(parseNumber('', 1), 1);
  assert.equal(hexCss(0x14121f), '#14121f');
  // DOM が無い試験でも、読めない時の値(むらさき)が返る
  const s = readStageColors(null);
  assert.equal(s.hemiSky, 0xfff1e0);
  assert.equal(s.rim, 0x9fd8ff);
  assert.equal(s.haloA, 0);
  assert.deepEqual(readVrColors(null).sky, ['#191633', '#3b2f63', '#a9708f', '#2a2440', '#14121f']);
});

test('いろの決め方: URL の ?theme= → 覚えた物 → ひるの紙。壊れた保存場所でも止まらない', () => {
  const store = (v) => ({ getItem: (k) => (k === THEME_STORAGE_KEY ? v : null) });
  assert.equal(resolveTheme({ search: '', storage: store(null) }), 'paper');
  assert.equal(resolveTheme({ search: '', storage: store('warm') }), 'warm');
  assert.equal(resolveTheme({ search: '?theme=dusk', storage: store('warm') }), 'dusk');
  assert.equal(resolveTheme({ search: '?theme=nope', storage: store('purple') }), 'purple');
  assert.equal(resolveTheme({ search: '', storage: store('???') }), 'paper');
  assert.equal(resolveTheme({ search: '', storage: { getItem() { throw new Error('blocked'); } } }), 'paper');
  assert.equal(normalizeTheme(undefined), 'paper');
});

test('applyTheme: html に入れる・覚える・知らせる(替わった時だけ)', () => {
  const attrs = {};
  const meta = { content: '', setAttribute(k, v) { this.content = v; } };
  const doc = { documentElement: { setAttribute: (k, v) => (attrs[k] = v) }, querySelector: () => meta };
  const saved = {};
  const storage = { setItem: (k, v) => (saved[k] = v) };
  const seen = [];
  const off = onThemeChange((id) => seen.push(id));
  assert.equal(applyTheme('warm', { doc, storage, remember: true }), 'warm');
  assert.equal(attrs['data-theme'], 'warm');
  assert.equal(saved[THEME_STORAGE_KEY], 'warm');
  assert.equal(getTheme(), 'warm');
  applyTheme('warm', { doc }); // 同じ色では知らせない
  assert.equal(applyTheme('???', { doc }), 'paper'); // 知らない名前は、ひるの紙
  assert.deepEqual(seen, ['warm', 'paper']);
  // 覚えられなくても止まらない
  assert.doesNotThrow(() => applyTheme('dusk', { doc, remember: true, storage: { setItem() { throw new Error('full'); } } }));
  off();
  applyTheme('paper', { doc });
});
