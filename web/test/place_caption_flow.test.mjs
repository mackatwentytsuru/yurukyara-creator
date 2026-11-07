// 字幕と「Claude の考え」の言葉の試験(点検 CRITux 9・12・18・21)。web/src/ui/panel.js の DOM を触らない部品(createCaptionFlow・actWords)と、
// main.js と style.css の形(上の札の言葉・考えの窓を開いた時の置き直し)を見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCaptionFlow, actWords } from '../src/ui/panel.js';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');

/** 会話の側(Dialogue)と同じ順で呼ぶ: 文ごとに say → caption(''=文字送りの始まり)→ 文字送り → 最後に caption(null, 1200) */
function speak(flow, sentences) {
  const views = [];
  for (const s of sentences) {
    flow.say(s);
    views.push(flow.caption(''));
    for (let i = 1; i <= s.length; i += 1) views.push(flow.caption(s.slice(0, i)));
  }
  views.push(flow.caption(null, 1200));
  return views;
}

const HELLO = ['はじめまして! ノリーと申しマス。', 'セスジキノボリカンガルーの、執事見習いデス。', 'ノリー、がんばりマス! なにをお手伝いしまショウ?'];

test('話している間: 前の文を残し、今の文を足していく(文が入れ替わっても前の文が消えない)', () => {
  const flow = createCaptionFlow();
  const views = speak(flow, HELLO);
  const mid = views.find((v) => v.reply && v.current === 'セスジ');
  assert.deepEqual(mid, { reply: true, prev: HELLO[0], current: 'セスジ', settled: false });
  const third = views.find((v) => v.reply && v.current === 'ノリー');
  assert.equal(third.prev, HELLO[0] + HELLO[1]);
  assert.deepEqual(views[0], { reply: true, prev: '', current: '', settled: false }, '1 文目の文字送りの始まりは、まだ何も無い(画面は隠す)');
});

test('話し終わった後: 返事の全部を残し、消す時間を付けない(前は 1.2 秒で消え、最後の 1 文しか読めなかった)', () => {
  const flow = createCaptionFlow();
  const views = speak(flow, HELLO);
  assert.deepEqual(views.at(-1), { reply: true, prev: '', current: HELLO.join(''), settled: true });
  assert.equal(flow.phase, 'settled');
});

test('次の会話(取り消し)・使う人の言葉・聞き返しの知らせは、返事を片づけてから出す', () => {
  const flow = createCaptionFlow();
  speak(flow, HELLO);
  assert.deepEqual(flow.caption('もう一度、言ってくだサイ。', 5000), { text: 'もう一度、言ってくだサイ。', kind: '' }, '聞き返し(返事の続きではない)');
  assert.equal(flow.phase, 'idle');
  speak(flow, ['こんにちは。']);
  assert.deepEqual(flow.caption('タロウです', 4000, 'user'), { text: 'タロウです', kind: 'user' });
  speak(flow, ['こんにちは。']);
  assert.deepEqual(flow.caption(null), { hide: true, afterMs: 0 }, '取り消し(次の会話の始まり)は、すぐ隠す');
  assert.equal(flow.phase, 'idle');
  speak(flow, ['二つ目の会話です。']);
  assert.equal(flow.caption(null, 1200).current, '二つ目の会話です。', '前の会話の文を混ぜない');
});

test('声がある時(文字送りなし)も同じ: 文ごとに全部の文が来る', () => {
  const flow = createCaptionFlow();
  flow.say(HELLO[0]);
  assert.deepEqual(flow.caption(HELLO[0]), { reply: true, prev: '', current: HELLO[0], settled: false });
  flow.say(HELLO[1]);
  assert.deepEqual(flow.caption(HELLO[1]), { reply: true, prev: HELLO[0], current: HELLO[1], settled: false });
  assert.equal(flow.caption(null, 1200).current, HELLO[0] + HELLO[1]);
});

test('話し終わりの後に続きの文が届いても(返事が途中で止まって続いた時)、同じ返事として足す', () => {
  const flow = createCaptionFlow();
  flow.say('ちょっと待ってくだサイ。');
  flow.caption('ちょっと待ってくだサイ。');
  flow.caption(null, 1200);
  flow.say('分かりマシタ。');
  assert.deepEqual(flow.caption('分かり'), { reply: true, prev: 'ちょっと待ってくだサイ。', current: '分かり', settled: false });
});

test('返事の無い時の null と待つ時間は、前と同じく待ってから隠す', () => {
  const flow = createCaptionFlow();
  assert.deepEqual(flow.caption(null, 1200), { hide: true, afterMs: 1200 });
  assert.deepEqual(flow.caption('お知らせ', 3000), { text: 'お知らせ', kind: '' });
});

test('表情と動きの言葉は日本語(happy / bow / person を出さない)。知らない名前も中の名前を出さない', () => {
  assert.equal(actWords({ expression: 'happy', motion: 'bow', gaze: 'person' }), 'うれしい・おじぎ・あなたを見る');
  assert.equal(actWords({ expression: 'happy', motion: 'nod', gaze: 'person' }), 'うれしい・うなずく・あなたを見る');
  assert.equal(actWords({ expression: 'happy', motion: 'wave', gaze: 'person' }), 'うれしい・手をふる・あなたを見る');
  assert.equal(actWords({ expression: 'think', motion: 'tilt', gaze: 'away' }), '考え中・首をかしげる・よそを見る');
  assert.equal(actWords({ expression: 'neutral', motion: 'point', gaze: 'landmark:受付' }), 'ふつう・指さす・受付を見る');
  assert.equal(actWords({ expression: 'blush', motion: 'spin', gaze: 'somewhere' }), 'この子の表情・この子の動き・見る先は同じ');
  assert.equal(actWords({}), 'ふつう・動きなし・あなたを見る');
  // 作例とノリーの character.json と、動きの意図(K2)の名前は、全部日本語になる
  for (const e of ['neutral', 'happy', 'surprised', 'sad', 'angry', 'relaxed', 'think']) {
    for (const m of ['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point', 'jump', 'sad', 'idle', 'talk']) {
      const t = actWords({ expression: e, motion: m, gaze: 'person' });
      assert.doesNotMatch(t, /[A-Za-z]/, `${e}/${m} → ${t}`);
      assert.doesNotMatch(t, /この子の/, `${e}/${m} は知っている名前`);
    }
  }
});

test('panel.js: 字幕は createCaptionFlow を通し、文字は textContent だけで入れる。表情と動きは actWords で', () => {
  const panel = read('ui', 'panel.js');
  assert.match(panel, /const v = flow\.caption\(text, hideAfterMs, kind\);/);
  assert.match(panel, /flow\.say\(ev\.text\);/);
  assert.match(panel, /actParts\.push\(actWords\(ev\)\);/);
  assert.doesNotMatch(panel, /innerHTML/);
  assert.doesNotMatch(panel, /\$\{ev\.expression\} \/ \$\{ev\.motion\}/, '中の名前を並べない');
});

test('main.js の上の札と考えの窓の下の文は、分かる言葉(CRITux 18)', () => {
  const main = read('main.js');
  const chips = main.slice(main.indexOf('function updateChips()'), main.indexOf('/** VR の中の板に出す'));
  assert.match(chips, /'見えている人', `\$\{app\.lastAttention\.tracks\.length\} 人`/, '「人 0」でなく「見えている人 0 人」');
  assert.match(chips, /app\.mode === 'camera' \? \(info\.ok \? 'オン' : '準備中'\)/, 'カメラの道は「GPU 60fps」でなく「オン」');
  assert.match(chips, /noCamera \? 'なし'/, 'カメラなしは「マウスで試し中」でなく「なし」');
  assert.doesNotMatch(chips, /'人', String/);
  const foot = main.slice(main.indexOf('ui.foot('), main.indexOf('app.dialogue = dialogue;'));
  assert.match(foot, /返事が始まるまで \$\{sec\(entry\.totalMs\)\}/);
  assert.match(foot, /目安は 1\.2 秒以内/);
  assert.doesNotMatch(foot, /ms\$\{|ms\(|目標 1200ms|中央値/, 'ms と中央値を出さない');
  assert.match(main, /sim: TOUCH \? 'カメラは使っていません\(画面を指でなぞった向きに/, 'スマホではマウスと言わない');
});

test('考えの窓(CRITux 21): 開いている間は窓の全体を上の段として数え、キャラを窓の下へ置き直す。切り替えは窓より手前', () => {
  const main = read('main.js');
  assert.match(main, /const TOP_GUARD = '\.top \.chip, \.top \.top-row > \*, #thoughtToggle, #thought:not\(\.collapsed\)(, #questLinkBox:not\(\[hidden\]\))?';/);
  assert.match(main, /new ResizeObserver\(reframe\)\.observe\(\$\('thought'\)\);/, '開く・閉じるで置き直す');
  const css = read('ui', 'style.css');
  const z = (sel) => Number(new RegExp(`\\n${sel.replace('.', '\\.')} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
  assert.ok(z('.top') > z('.thought'), `上の段(${z('.top')})が考えの窓(${z('.thought')})より手前`);
  assert.match(css, /\.thought:not\(\.collapsed\) \{\n\s+height: calc\(45vh - [^;]+;\n\s+height: calc\(45dvh - [^;]+;/, 'スマホで開いた窓は、画面の 45% より上で止める(上の段の上限と同じ)');
  assert.match(css, /#stage \{[^}]*touch-action: none;/, '指でなぞる向きを、ブラウザの画面の動かしに取られない');
});

test('記憶の札の押す所は 44px 以上(CRITux 20・S3 の頼み。消す・番号・全部わすれる・番号の欄)', () => {
  const css = read('ui', 'style.css');
  assert.match(css, /\.memory-panel button \{\n[^}]*min-height: 44px;/);
  assert.match(css, /\.memory-panel \.mem-item-forget \{ min-height: 44px; min-width: 44px;/);
  assert.match(css, /\.memory-panel input \{\n[^}]*min-height: 44px;/);
  assert.doesNotMatch(css, /\.memory-panel[^{]*\{[^}]*min-height: (32|40)px/, '前の 32px・40px が残っていない');
});
