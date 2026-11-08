// 「ことば」の設定(src/conversation/lang.js)の試験。日本語だけ(既定)・多言語の受け方、人格の文の行、優先の順、文の言葉の見分け。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANG_MODE, HEAR_LANGS, HEAR_LANG_LABELS, LANG_MODES, SR_LANG, STT_LANGS, VOICE_LANG_CODE,
  detectLang, langModeFromPersona, langModeOf, normalizeHearLang, normalizeLangMode, spokenLang,
} from '../src/conversation/lang.js';

test('ことばは 2 つ(日本語だけ・多言語)。既定は日本語だけ', () => {
  assert.deepEqual([...LANG_MODES], ['ja', 'multi']);
  assert.equal(DEFAULT_LANG_MODE, 'ja');
});

test('normalizeLangMode: id・画面の言葉・大文字小文字を受ける。分からない値・空・文字でない値は null', () => {
  for (const v of ['ja', 'JA', ' ja ', '日本語だけ', '日本語のみ', '日本語']) assert.equal(normalizeLangMode(v), 'ja', v);
  for (const v of ['multi', 'Multi', '多言語', '多国語', 'multilingual']) assert.equal(normalizeLangMode(v), 'multi', v);
  for (const v of ['', '  ', 'en', 'english', 'auto', null, undefined, 3, {}, []]) assert.equal(normalizeLangMode(v), null, String(v));
});

test('normalizeHearLang: ja・en・zh・ko だけ', () => {
  assert.equal(normalizeHearLang('en'), 'en');
  assert.equal(normalizeHearLang(' KO '), 'ko');
  for (const v of ['', 'fr', 'ja-JP', 'auto', null, 5]) assert.equal(normalizeHearLang(v), null, String(v));
});

test('聞く言葉の表: 4 つそろい、日本語の聞き取りは今までの ja-JP のまま', () => {
  assert.deepEqual([...HEAR_LANGS], ['ja', 'en', 'zh', 'ko']);
  assert.equal(SR_LANG.ja, 'ja-JP');
  assert.deepEqual({ ...SR_LANG }, { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN', ko: 'ko-KR' });
  assert.deepEqual({ ...VOICE_LANG_CODE }, { ja: 'ja', en: 'en', zh: 'zh', ko: 'ko' });
  assert.deepEqual([...STT_LANGS], ['auto', 'ja', 'en', 'zh', 'ko']);
  assert.deepEqual(Object.keys(HEAR_LANG_LABELS), ['ja', 'en', 'zh', 'ko']);
});

test('人格の文の「- ことば: 多言語」の行: 記号の有無・全角のコロン・CRLF・前後の文を受ける。無ければ null', () => {
  assert.equal(langModeFromPersona('# 人格\n- 役目: お店\n- ことば: 多言語\n- 話し方: やさしく'), 'multi');
  assert.equal(langModeFromPersona('ことば:多言語'), 'multi');
  assert.equal(langModeFromPersona('・ことば:日本語だけ'), 'ja');
  assert.equal(langModeFromPersona('- ことば: 多言語\r\n- 話し方: やさしく'), 'multi');
  assert.equal(langModeFromPersona('- ことば:  多言語(英語・中国語・韓国語)'), 'multi');
  assert.equal(langModeFromPersona('- 話し方: ことばをゆっくり'), null);
  assert.equal(langModeFromPersona('- ことば: ふしぎな言葉'), null, '知らない値の行は読まない');
  assert.equal(langModeFromPersona(''), null);
  assert.equal(langModeFromPersona(undefined), null);
});

test('langModeOf の優先: 画面の設定 > 性格の画面の節 > persona.md の行 > 日本語だけ', () => {
  const own = '- ことば: 多言語';
  const settings = '# 性格と話し方(使う人が画面で選んだ設定)\n- ことば: 日本語だけ';
  assert.equal(langModeOf(), 'ja');
  assert.equal(langModeOf({ persona: '話し方: やさしく' }), 'ja');
  assert.equal(langModeOf({ persona: own }), 'multi', 'persona.md の行');
  assert.equal(langModeOf({ persona: `${own}\n\n${settings}` }), 'ja', '性格の画面の節が persona.md の行に勝つ');
  assert.equal(langModeOf({ persona: `${own}\n\n${settings}`, settings: { lang: 'multi' } }), 'multi', '画面の設定がいちばん強い');
  assert.equal(langModeOf({ persona: own, settings: { lang: 'ja' } }), 'ja');
  assert.equal(langModeOf({ persona: own, settings: { lang: 'xx' } }), 'multi', '知らない設定値は無いのと同じ');
  assert.equal(langModeOf({ persona: own, settings: null }), 'multi');
});

test('節の見出しより後ろの行は、その子の文として数えない(画面の節の「ことば」は、persona の行の後ろでも節として読む)', () => {
  const p = '- 話し方: やさしく\n\n# 性格と話し方(使う人が画面で選んだ設定)\n- ことば: 多言語';
  assert.equal(langModeOf({ persona: p }), 'multi');
});

test('detectLang: 4 つの言葉', () => {
  assert.equal(detectLang('こんにちは。お手洗いは右奥です。'), 'ja');
  assert.equal(detectLang('Where is the restroom? Thank you!'), 'en');
  assert.equal(detectLang('洗手间在哪里?谢谢你'), 'zh');
  assert.equal(detectLang('화장실은 어디에 있어요?'), 'ko');
});

test('detectLang: 端 — かなを含む日本語・漢字だけ・英字の名前が混ざる文・数字だけ・空', () => {
  assert.equal(detectLang('ノリーだよ。'), 'ja', 'カタカナだけでも日本語');
  assert.equal(detectLang('はい'), 'ja');
  assert.equal(detectLang('Norrie です'), 'ja', 'かなが 1 字でもあれば日本語');
  assert.equal(detectLang('我是Norrie。'), 'zh', '中国語に英字の名前が混ざる');
  assert.equal(detectLang('Hello 你好'), 'zh', '漢字が 2 字以上で、かなが無ければ中国語');
  assert.equal(detectLang('I am Norrie, 안녕'), 'ko', 'ハングルがあれば韓国語');
  assert.equal(detectLang('出口'), 'zh', '漢字だけの 2 字は中国語に見える(日本語だけの時は使わない)');
  assert.equal(detectLang('口'), 'ja', '漢字 1 字は決められない: 既定の日本語');
  assert.equal(detectLang('119'), 'ja');
  assert.equal(detectLang('119', 'en'), 'en', '決められない時は、渡した既定の言葉');
  assert.equal(detectLang('!?…'), 'ja');
  assert.equal(detectLang(''), 'ja');
  assert.equal(detectLang(null), 'ja');
  assert.equal(detectLang(undefined), 'ja');
  assert.equal(detectLang('12345 abc', 'xx'), 'en', '数字をのぞいた文字が英字なら英語。知らない既定の値は ja');
  assert.equal(detectLang('???', 'xx'), 'ja');
  assert.equal(detectLang('Bonjour, où sont les toilettes ?'), 'en', '4 つ以外のラテン文字の言葉は English に寄せる');
});

test('spokenLang: 日本語だけの時はいつも ja(英語の文でも変えない)。多言語の時だけ見分ける', () => {
  assert.equal(spokenLang('Hello there', 'ja'), 'ja');
  assert.equal(spokenLang('Hello there', undefined), 'ja');
  assert.equal(spokenLang('Hello there', 'multi'), 'en');
  assert.equal(spokenLang('안녕하세요', 'multi'), 'ko');
  assert.equal(spokenLang('こんにちは', 'multi'), 'ja');
});
