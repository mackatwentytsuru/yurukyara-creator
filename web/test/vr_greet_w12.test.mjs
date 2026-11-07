// 第 12 波(本人の VR の試し V1・Q3): 声かけは入った時の 1 回・会話のたびに声かけ済み・聞いている間と最後の会話から 60 秒は出さない・
// トリガーは聞いている間は何も送らない・?place= が無い時と VR は目印と案内文を送らない・声かけの回は前の返事を空にする。
// main.js は画面を作る本体なので、ここでは書き方(約束)を見る。動く所の確かめは、実機(Quest)と tools の vr_w11_check。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(import.meta.dirname, '..');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');
const main = read('src', 'main.js');

test('声かけ: VR は入った時の 1 回だけ。会話のたびに声かけ済み。聞いている間と最後の会話から 60 秒は出さない', () => {
  assert.match(main, /const GREET_QUIET_S = 60;/);
  assert.match(main, /function talk\(turn\) \{[^}]*presence\.greetedAt = t;\n\s+presence\.lastTalkAt = t;/s, 'どの入口の会話でも声かけ済みにする');
  assert.match(main, /const inVr = stage\.renderer\.xr\.isPresenting && modes\?\.mode === 'vr';\n\s+if \(inVr !== wasInVr\) \{\n\s+wasInVr = inVr;\n\s+vrGreetPending = inVr;/, 'VR に入った時に 1 回だけ許す');
  const greet = main.slice(main.indexOf('app.autoGreet &&'), main.indexOf("void talk({ trigger: 'approach'"));
  for (const need of ['nowClock - presence.lastTalkAt > GREET_QUIET_S', '(!inVr || vrGreetPending)', '!listener?.voiceActive', '!listener?.transcribing', '!dialogue.busy', '!speaker.speaking']) {
    assert.ok(greet.includes(need), need);
  }
  assert.match(main, /vrGreetPending = false;\n\s+void talk\(\{ trigger: 'approach'/, '声をかけたら、入り直すまで出さない');
});

test('トリガー: マイクが聞いている間は「こんにちは」を送らない(マイクが使えない時だけ送る。板に「トリガー = こんにちは」)', () => {
  assert.match(main, /function onVrSelect\(\) \{\n\s+speaker\.unlock\(\);\n(?:\s+\/\/[^\n]*\n)+\s+if \(listener\?\.listening\) return;/);
  assert.match(read('src', 'ui', 'vrPanel.js'), /off: \{ label: 'マイクなし\(トリガー = こんにちは\)'/);
});

test('場所: ?place= が無い時(試しの場所)と VR の中では、目印も案内文も送らない', () => {
  assert.match(main, /function placeForPrompt\(\) \{\n\s+const real = app\.place && app\.place\.id !== SAMPLE_PLACE\.id;\n\s+const inVr = modes\?\.mode === 'vr' \|\| stage\.renderer\.xr\.isPresenting;\n\s+if \(!real \|\| inVr\) return undefined;/);
  assert.match(main, /place: placeForPrompt\(\),/);
});

test('返事: 声かけの回は話し始めの前に、前の返事と「あなた:」の行を空にする(板に同じ文が重なって出ない)', () => {
  assert.match(main, /if \(turn\?\.trigger === 'approach'\) ui\.userSaid\(''\);/);
  assert.match(main, /vrPanel\.set\(\{ state: vrState\(\), user: '', reply: '', error: '' \}\);/, '入り直した時も前の中身を残さない');
});

test('入口: .gate button の display が hidden に勝たない(ヘッドセットで「カメラなしで試す」を隠す)', () => {
  assert.match(read('src', 'ui', 'style.css'), /\.gate button\[hidden\] \{ display: none; \}/);
});

test('横: 全身で、遠近で手前に出た羽が画面の横の端で切れる時は、見込みの幅を広げて置き直す', () => {
  const scene = read('src', 'scene.js');
  assert.match(scene, /wScale \*= Math\.min\(1\.6, \(sp\.right - sp\.left \+ 2 \* edge\) \/ viewW\);/);
  assert.match(scene, /\* wScale;/);
});
