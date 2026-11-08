// 「AI キャラクターの〈名前〉と話しています」の知らせ(ui/aiNotice.js)の試験。
// - 日本語: AI キャラクターの〈名前〉と話しています。名前が無い間は名前なしの文
// - 多言語: 英語・中国語・韓国語の文(英語は "You're talking with 〈名前〉, an AI character")
// - 画面の 2 か所(#aiNotice と #aiNoticeTop)に、いつも同じ文を入れる。文字だけで入れる(名前は HTML として扱わない)
// - main.js が、子が読み込まれた時・替わった時・ことばが替わった時に呼ぶ。index.html の最初の文は名前なしの日本語
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_NOTICE_NAME_MAX, AI_NOTICE_NO_NAME, aiNoticeText, clipName, setAiNotice } from '../src/ui/aiNotice.js';

const WEB = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8');

test('日本語: AI キャラクターの〈名前〉と話しています', () => {
  assert.equal(aiNoticeText('ノリー', 'ja'), 'AI キャラクターのノリーと話しています');
  assert.equal(aiNoticeText('ノリー'), 'AI キャラクターのノリーと話しています', 'ことばを渡さなければ日本語');
  assert.equal(aiNoticeText('ノリー', 'xx'), 'AI キャラクターのノリーと話しています', '知らないことばは日本語');
});

test('多言語: 英語・中国語・韓国語に訳す', () => {
  assert.equal(aiNoticeText('Norrie', 'en'), "You're talking with Norrie, an AI character");
  assert.equal(aiNoticeText('诺里', 'zh'), '你正在和 AI 角色诺里交谈');
  assert.equal(aiNoticeText('노리', 'ko'), 'AI 캐릭터 노리와 대화하고 있어요');
  assert.equal(aiNoticeText('별', 'ko'), 'AI 캐릭터 별과 대화하고 있어요', '終わりの子音がある名前は 과 ではなく 과/와 を合わせる');
  assert.equal(aiNoticeText('Norrie', 'ko'), 'AI 캐릭터 Norrie와(과) 대화하고 있어요', 'ハングルでない名前は 와(과)');
});

test('名前が無い・空白だけの間は、名前なしの文(どのことばでも)', () => {
  for (const lang of Object.keys(AI_NOTICE_NO_NAME)) {
    for (const name of [undefined, null, '', '   ']) assert.equal(aiNoticeText(name, lang), AI_NOTICE_NO_NAME[lang]);
  }
  assert.equal(AI_NOTICE_NO_NAME.ja, 'AI キャラクターと話しています');
  assert.ok(AI_NOTICE_NO_NAME.en.includes('AI character'));
});

test('長い名前は切る(1 行の知らせが画面からはみ出さない)・空白は 1 つにする', () => {
  const long = 'あ'.repeat(40);
  assert.equal(clipName(long), `${'あ'.repeat(AI_NOTICE_NAME_MAX)}…`);
  assert.equal(clipName('  ノリー   くん '), 'ノリー くん');
  assert.equal(clipName('😀'.repeat(20)).length > 0, true);
  assert.equal([...clipName('😀'.repeat(20))].length, AI_NOTICE_NAME_MAX + 1, '絵文字も 1 字として数える');
});

/** 最小の偽の画面(要素 2 つ) */
function fakeDoc() {
  const mk = () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const els = { aiNotice: mk(), aiNoticeTop: mk() };
  return { els, getElementById: (id) => els[id] ?? null };
}

test('画面の 2 か所(#aiNotice と #aiNoticeTop)に、同じ文と lang を入れる', () => {
  const doc = fakeDoc();
  const text = setAiNotice({ name: 'Norrie', lang: 'en', doc });
  assert.equal(text, "You're talking with Norrie, an AI character");
  for (const el of Object.values(doc.els)) {
    assert.equal(el.textContent, text);
    assert.equal(el.attrs.lang, 'en');
  }
  setAiNotice({ name: '诺里', lang: 'zh', doc });
  assert.equal(doc.els.aiNotice.attrs.lang, 'zh-Hans');
  setAiNotice({ name: 'ノリー', lang: 'ja', doc });
  assert.equal(doc.els.aiNoticeTop.textContent, 'AI キャラクターのノリーと話しています');
  assert.equal(doc.els.aiNoticeTop.attrs.lang, 'ja');
});

test('名前は文字として入れる(HTML として扱わない)・片方の要素が無くても落ちない・画面が無くても文を返す', () => {
  const doc = fakeDoc();
  setAiNotice({ name: '<img src=x onerror=alert(1)>', doc });
  assert.equal(doc.els.aiNotice.textContent.includes('<img'), true, '文字のまま入る(innerHTML は使わない)');
  assert.equal(Object.hasOwn(doc.els.aiNotice, 'innerHTML'), false);
  assert.doesNotThrow(() => setAiNotice({ name: 'a', doc: { getElementById: (id) => (id === 'aiNotice' ? doc.els.aiNotice : null) } }));
  assert.equal(setAiNotice({ name: 'ノリー', doc: null }), 'AI キャラクターのノリーと話しています');
  assert.equal(/innerHTML/.test(read('src/ui/aiNotice.js').replace(/\/\/.*$/gm, '')), false, 'aiNotice.js は innerHTML を使わない');
});

test('index.html: 2 か所とも最初は名前なしの日本語の文。いつも見せる決まりのまま(隠す属性は付けない)', () => {
  const html = read('index.html');
  assert.match(html, /<p class="ai-notice" id="aiNotice" role="note">AI キャラクターと話しています<\/p>/);
  assert.match(html, /<p class="ai-notice ai-notice-top" id="aiNoticeTop" aria-hidden="true">AI キャラクターと話しています<\/p>/);
  assert.equal(/AI のキャラクターと話しています/.test(html), false, '前の文は残さない');
});

test('main.js: 子が読み込まれた時・替わった時・ことばが替わった時に、名前とことばで書き替える', () => {
  const main = read('src/main.js');
  assert.match(main, /import \{ setAiNotice \} from '\.\/ui\/aiNotice\.js';/);
  assert.match(main, /function updateAiNotice\(\) \{\n  setAiNotice\(\{ name: app\.character\?\.name, lang: effectiveHearLang\(currentLangMode\(\)\) \}\);\n\}/);
  // ことば(聞く言葉・persona の行)が替わる所
  assert.match(main, /function applyHearLang\(\) \{\n  updateAiNotice\(\);/);
  // 子が替わる所(swapCharacter)と、最初の子が読み込まれた所
  assert.match(main, /app\.character = next;\n  dialogue\.character = next;\n  updateAiNotice\(\);/);
  assert.match(main, /fillGuide\(\);[^\n]*\n    updateAiNotice\(\);/);
});

test('どこにも、前の文「AI のキャラクターと話しています」を出していない(入口の説明文 gate-ai は別の文)', () => {
  for (const f of ['index.html', 'src/main.js', 'src/ui/aiNotice.js']) assert.equal(read(f).includes('AI のキャラクターと話しています'), false, f);
});
