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
  const sim = gate.slice(gate.indexOf('id="startSim"'), gate.indexOf('</button>', gate.indexOf('id="startSim"')));
  assert.match(sim, /カメラなしで試す/, 'ほかの流れの確かめの道具が、この言葉で押す(web_talk_check.mjs など)');
  assert.doesNotMatch(gate, /マウス/, '入口の文はマウスと決めつけない(指かマウスかは main.js が決める。CRITux 15)');
  assert.match(gate, /マイクは「声で話す」を押した時だけ使います/);
  assert.match(gate, /id="gateFirst" hidden>はじめてなら、このあと「はじめての会話」\(7 歩\)が始まります/);
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
  assert.match(html, /<link rel="help" href="https:\/\/github\.com\/[^"]+#make-your-own-character-on-your-pc-with-claude-code" \/>/);
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
