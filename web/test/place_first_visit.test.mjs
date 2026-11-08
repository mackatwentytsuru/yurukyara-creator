// 入口の試験(点検 CRITux 2・10・15・24): 製品の名前と主役ノリーを出す・入口の間は上の段を隠す・初めての訪問なら入口の後に 7 歩を出す・
// 声は鍵がある時だけと書く・カメラのボタンはマイクを言わない・スマホではマウスと言わない。
// 決まりは web/src/stage/firstVisit.js(three も DOM も読まない)で試し、画面の形(index.html・style.css・main.js)は文で確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldOpenFirstRun, FIRST_RUN_DONE_KEY } from '../src/stage/firstVisit.js';
import { DONE_KEY } from '../src/ui/onboarding/index.js';
import { MAIN_CHARACTER } from '../src/character/defaults.js';

const WEB = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');
// 日本語の README(README.md)の作る道の見出し(S6 が文字を変えない約束。S4 の README_SECTION と同じ文字)
const README_HEADING_JA = '自分の PC で、Claude Code と自分のキャラを作る';
/** GitHub の見出しの印: 英字は小文字・記号(句読点や「、」)を消す・空白は「-」。日本語の字はそのまま(この試験の中で作る) */
const githubSlug = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\p{C}\p{S}\p{Z}\p{P}]/gu, (c) => (c === ' ' || c === '-' || /\p{Pc}/u.test(c) ? c : ''))
    .replace(/ /g, '-');
const store = (data = {}) => ({ getItem: (k) => (k in data ? data[k] : null) });
const q = (s = '') => new URLSearchParams(s);

test('印の名前は、初めての会話(S4)が書く印と同じ', () => {
  assert.equal(FIRST_RUN_DONE_KEY, DONE_KEY);
});

test('初めての訪問(このブラウザに印が無い)なら出す。終えた・「あとで」を押した後は出さない', () => {
  assert.equal(shouldOpenFirstRun({ params: q(), storage: store() }), true);
  assert.equal(shouldOpenFirstRun({ params: q('character=norrie'), storage: store() }), true, '?character= で開いても初めてなら出す');
  assert.equal(shouldOpenFirstRun({ params: q(), storage: store({ [DONE_KEY]: 'done' }) }), false);
  assert.equal(shouldOpenFirstRun({ params: q(), storage: store({ [DONE_KEY]: 'later' }) }), false);
});

test('覚える所が使えないブラウザは、何も覚えていないので初めてとみなす(読む時に投げても止まらない)', () => {
  assert.equal(shouldOpenFirstRun({ params: q(), storage: null }), true);
  const throwing = { getItem: () => { throw new Error('使えない'); } };
  assert.equal(shouldOpenFirstRun({ params: q(), storage: throwing }), true);
});

test('出さない場面: ?onboard=0・?onboard=1(もう出ている)・?auto=0(確かめの道具)・LED・自動で始める・ヘッドセット・重さを測る時', () => {
  for (const s of ['onboard=0', 'onboard=1', 'auto=0', 'led=1', 'autostart=1', 'headset=1', 'perf=1', 'character=norrie&auto=0']) {
    assert.equal(shouldOpenFirstRun({ params: q(s), storage: store() }), false, s);
  }
  assert.equal(shouldOpenFirstRun({ params: q(), storage: store(), headset: true }), false, 'Quest のブラウザ');
  assert.equal(shouldOpenFirstRun({ params: q('auto=1'), storage: store() }), true, '?auto=1 は出す');
});

test('index.html の入口: 製品の名前・主役ノリー・声は鍵がある時だけ・カメラのボタンはマイクを言わない・マウスと言わない', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="ja" class="gate-up">/, '開いた時から入口の間の印を付ける(JS の前でも上の段を隠す)');
  assert.match(html, /<title>ゆるキャラクリエイター<\/title>/);
  const gate = html.slice(html.indexOf('<div id="gate"'), html.indexOf('<script'));
  assert.match(gate, /<h1 id="gateTitle">ゆるキャラクリエイター<\/h1>/);
  assert.match(gate, new RegExp(`<b>${MAIN_CHARACTER.name}</b>`), '案内役の主役ノリーを出す');
  assert.match(gate, /セスジキノボリカンガルーの執事見習い/);
  assert.match(gate, /文字で答えます。声は、声の鍵があるときだけ出ます。/, '鍵なしでも本当の約束(CRITux 10)');
  assert.doesNotMatch(gate, /声で答えます/, '声だけを約束しない');
  const cam = gate.slice(gate.indexOf('id="startCam"'), gate.indexOf('</button>', gate.indexOf('id="startCam"')));
  assert.doesNotMatch(cam, /マイク/, 'カメラのボタンはマイクを言わない(マイクは「声で話す」の時だけ。CRITux 24)');
  assert.match(gate, /<p class="gate-what" id="gateWhat">ノリーや 見本の子と 話そう。ことばや 絵から、にた子を えらべるよ。話したことを 覚えるよ。<\/p>/, '何をする物かの 1 行。この版で本当にできることだけ(CRITux3・UIR 3)');
  assert.doesNotMatch(gate, /作れます/, '入口は、この版でできない「作れます」を約束しない(UIR 3)');
  assert.doesNotMatch(gate, /7 歩/, '使う人に見える言葉は「7 つのステップ」');
  assert.match(gate, /id="startSim" class="primary" type="button" disabled>/, '主役の「はじめる」。読み込みが終わるまで押せない(main.js が戻す)');
  assert.match(gate, /id="startCam" class="ghost" type="button" disabled hidden>/);
  assert.ok(gate.indexOf('id="startSim"') < gate.indexOf('id="startCam"'), 'カメラの札は 2 つ目');
  assert.match(gate, /id="camSub">読み込んでいます…</);
  const sim = gate.slice(gate.indexOf('id="startSim"'), gate.indexOf('</button>', gate.indexOf('id="startSim"')));
  assert.match(sim, /はじめる/, '11-08 本人: カメラを外している間の入口は 1 つ(確かめの道具は #startSim で押す)');
  assert.doesNotMatch(gate, /マウス/, '入口の文はマウスと決めつけない(指かマウスかは main.js が決める。CRITux 15)');
  assert.match(gate, /マイクは「声で話す」を押した時だけ使います/);
  assert.match(gate, /id="gateFirst" hidden>はじめてなら、このあと「あたらしい子を つくる」が始まります/);
});

test('初めての会話(S4)への入口: 舞台のキャラを読み込み直しなしで替える・人格の文を読む・README の作る道の節へのリンク(S4 の頼み。D1・D2・D4)', () => {
  const main = read('src', 'main.js');
  assert.match(main, /\napp\.swapCharacter = swapCharacter;\n/);
  assert.match(main, /\napp\.readPersona = readPersona;\n/);
  const rp = main.slice(main.indexOf('async function readPersona(character)'), main.indexOf('app.swapCharacter = swapCharacter;'));
  assert.match(rp, /fetch\(character\.personaUrl\)/, '宛先はキャラの persona.md だけ(privacy の試験の変数の宛先)');
  assert.match(rp, /!\/html\|json\/i\.test/, '404 の頁や JSON を人格にしない(boot と同じ確かめ)');
  assert.match(main, /if \(character\.personaUrl\) app\.persona = await readPersona\(character\);/, 'boot も同じ関数で読む');
  const html = read('index.html');
  // 画面は日本語だけ(Q-0092 A)。README は日本語が主(README.md。第 9 波)なので、日本語の README の作る道の見出しの節を指す
  const links = html.match(/<link rel="help"[^>]*>/g) ?? [];
  assert.equal(links.length, 1, 'README のリンクは 1 つ(初めての会話はこれを開く)');
  const m = links[0].match(/^<link rel="help" hreflang="ja" href="https:\/\/github\.com\/[^/"]+\/[^/"]+\/blob\/HEAD\/README\.md#([^"]+)" \/>$/);
  assert.ok(m, `日本語の README(README.md)の節へのリンク: ${links[0]}`);
  assert.equal(m[1], githubSlug(README_HEADING_JA), `節の印は見出し「${README_HEADING_JA}」の GitHub の印`);
  assert.equal(m[1], '自分の-pc-でclaude-code-と自分のキャラを作る');
});

test('入口の案内役の 1 行: キャラを読んだすぐ後に書いてから見せる(遅い端末で、?character= の子の前に「主役のノリー」を見せない。M8b 4)', () => {
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /\nhtml:not\(\.guide-ready\) \.gate-guide \{ visibility: hidden; \}\n/, '書くまでは隠す(場所は空けたまま)');
  const main = read('src', 'main.js');
  const guide = main.slice(main.indexOf('function fillGuide()'), main.indexOf('function fillGate()'));
  assert.match(guide, /guide\.textContent = `案内するのは「\$\{c\.name \?\? app\.characterId \?\? 'この子'\}」です。`/, '主役でない子なら、その子の名前(textContent だけ)');
  assert.match(guide, /document\.documentElement\.classList\.add\('guide-ready'\);/, '書いたら見せる');
  assert.ok(guide.indexOf("textContent = `") < guide.indexOf("add('guide-ready')"), '見せるのは書いた後');
  // 読み込んだ子を app に入れたのと同じ流れ(await を挟まない)で書く。状態(/api/status)を読むのを待たない
  assert.match(main, /\n    app\.character = character;\n    app\.characterId = id;\n    bootLookId = characterKey\(character\);\n    fillGuide\(\);/);
  const fill = main.slice(main.indexOf('function fillGate()'), main.indexOf('function gateClosed()'));
  assert.doesNotMatch(fill, /gateGuide/, '案内役の 1 行は fillGate では書き直さない');
  assert.equal((main.match(/\bfillGuide\(\);/g) ?? []).length, 1, '書くのは読んだ後の 1 回だけ');
});

test('style.css: 入口の間は上の段と考えの窓を隠す(初めての会話が出ている間は出す)', () => {
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /html\.gate-up:not\(\.fr-open\) \.top,\nhtml\.gate-up:not\(\.fr-open\) #thought \{ visibility: hidden; \}/);
});

test('main.js: 入口を閉じたら gate-up を外し、初めての訪問の時だけ 7 歩を出す。入口の文は状態を読んだ後に決める', () => {
  const main = read('src', 'main.js');
  const closed = main.slice(main.indexOf('function gateClosed()'), main.indexOf('/* ---------- 合言葉'));
  assert.match(closed, /\$\('gate'\)\.classList\.add\('hidden'\);/);
  assert.match(closed, /document\.documentElement\.classList\.remove\('gate-up'\);/);
  assert.match(closed, /if \(!firstRunWanted\(\)\) return;/);
  assert.match(closed, /api\.start\(\)/);
  assert.match(main, /gateClosed\(\); \/\/ 上の段を出す/, '入口を閉じる所は gateClosed だけ');
  assert.doesNotMatch(main.replace(closed, ''), /\$\('gate'\)\.classList\.add\('hidden'\)/, 'ほかの所で入口を閉じない');
  assert.match(main, /shouldOpenFirstRun\(\{ params, storage: siteMemory, doneKey: firstRunDoneKey, headset: IS_HEADSET \}\)/);
  assert.match(main, /if \(typeof m\.DONE_KEY === 'string' && m\.DONE_KEY\) firstRunDoneKey = m\.DONE_KEY;/, '印の名前は S4 の物を使う');
  const fill = main.slice(main.indexOf('function fillGate()'), main.indexOf('function gateClosed()'));
  assert.match(fill, /app\.status\?\.tts\?\.available/, '声の約束は、声が本当に使える時だけ');
  assert.match(fill, /TOUCH \? '画面を指でなぞると、その向きを見ます' : 'マウスを動かすと、その向きを見ます'/);
  assert.match(main, /fillGate\(\); \/\/ 入口の文/);
});
