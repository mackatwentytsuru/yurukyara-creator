// 画面の「PC での作り方を見る(README)」と手順の文は、日本語の README の作り方の節を指す
// (画面は日本語だけ。Q-0092 A。英語の README の節を開いていた。CRITux2 低 12)。
// 第 9 波から、日本語の README は README.md(S6。英語は README.en.md。前は README.ja.md)。リンクも README.md の同じ日本語の見出しへ。
// 軽い試験(ファイルを読むだけ・画面なし・通信なし)。S6 が見出しの文字やファイルを変えたら、ここで分かる(script.js の README_SECTION と合わせる)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { README_SECTION, MAKE_STEPS } from '../src/ui/onboarding/script.js';
import { README_JA_ANCHOR, README_JA_FILE, githubSlug, readGuideUrl } from '../src/ui/onboarding/index.js';

const ROOT = join(import.meta.dirname, '..', '..');

test('日本語の README(README.md)に、作り方の節の見出しがある(script.js の README_SECTION と同じ文字)。手順の文もその節を指す', () => {
  assert.equal(README_JA_FILE, 'README.md', '日本語の README は README.md(第 9 波で入れ替えた。英語は README.en.md)');
  const md = readFileSync(join(ROOT, README_JA_FILE), 'utf8');
  const headings = md
    .split(/\r?\n/)
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#+\s+/, '').trim());
  assert.ok(headings.includes(README_SECTION), `${README_JA_FILE} の見出しに「${README_SECTION}」が無い: ${headings.join(' / ')}`);
  assert.ok(MAKE_STEPS.includes(README_JA_FILE) && MAKE_STEPS.includes(`「${README_SECTION}」`), MAKE_STEPS);
  assert.ok(!MAKE_STEPS.includes('README.ja.md'), `手順の文が前の名前(README.ja.md)を指している: ${MAKE_STEPS}`);
});

test('GitHub の節の印の作り方: 英字は小文字・記号(、など)を消す・空白は「-」。日本語の字はそのまま', () => {
  assert.equal(README_JA_ANCHOR, '自分の-pc-でclaude-code-と自分のキャラを作る');
  // 英語の README の節(会話の画面の index.html の link rel="help" の印)と同じ作り方
  assert.equal(githubSlug('Make your own character on your PC with Claude Code'), 'make-your-own-character-on-your-pc-with-claude-code');
});

/** link 要素を探すだけの偽の頁(querySelector の 2 つの探し方だけ) */
const fakeDoc = (links) => ({
  querySelector: (sel) => (sel.includes('hreflang="ja"') ? links.find((l) => l.hreflang === 'ja') : links[0]) ?? null,
});
const jaUrl = (owner, repo) => new URL(`https://github.com/${owner}/${repo}/blob/HEAD/README.md#${README_JA_ANCHOR}`).href;

test('README のリンク: 頁の link rel="help" がリポジトリの入口なら、同じリポジトリの README.md(日本語)の節にする', () => {
  const root = 'https://github.com/someone/some-repo';
  assert.equal(readGuideUrl(fakeDoc([{ href: `${root}#make-your-own-character-on-your-pc-with-claude-code` }])), jaUrl('someone', 'some-repo'));
  assert.equal(readGuideUrl(fakeDoc([{ href: `${root}/` }])), jaUrl('someone', 'some-repo'));
  assert.equal(readGuideUrl(fakeDoc([{ href: `${root}#${README_JA_ANCHOR}` }])), jaUrl('someone', 'some-repo'), '入口に日本語の印が付いていても同じ所');
  assert.equal(new URL(jaUrl('someone', 'some-repo')).hash, `#${encodeURI(README_JA_ANCHOR)}`, '印はそのまま(字は URL の形に直るだけ)');
});

test('README のリンク: 頁に日本語の link(hreflang="ja")があれば、それを使う。リポジトリの入口でなければ、そのまま。https でなければ出さない', () => {
  const ja = 'https://example.org/docs/README.md#jp';
  assert.equal(readGuideUrl(fakeDoc([{ href: 'https://github.com/a/b#x' }, { href: ja, hreflang: 'ja' }])), ja);
  assert.equal(readGuideUrl(fakeDoc([{ href: 'https://example.org/readme#make' }])), 'https://example.org/readme#make');
  assert.equal(readGuideUrl(fakeDoc([{ href: 'https://github.com/a/b/blob/main/README.md#x' }])), 'https://github.com/a/b/blob/main/README.md#x');
  assert.equal(readGuideUrl(fakeDoc([{ href: 'http://github.com/a/b' }])), null);
  assert.equal(readGuideUrl(fakeDoc([{ href: 'javascript:alert(1)' }])), null);
  assert.equal(readGuideUrl(fakeDoc([])), null);
  assert.equal(readGuideUrl(null), null);
});
