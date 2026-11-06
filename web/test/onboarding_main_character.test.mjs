// 主役の決まり(MAIN_CHARACTER)は web/src/character/defaults.js(S5)の 1 か所だけ。初めての会話の部品(S4)は写さずに読む。
// 軽い試験(ファイルを読むだけ・画面なし)。編集ごとの試験に入る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_CHARACTER } from '../src/character/defaults.js';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';

const DIR = join(import.meta.dirname, '..', 'src', 'ui', 'onboarding');
const quoted = (s) => new RegExp(`['"\`]${s}['"\`]`);

test('初めての会話の部品は、主役の id と名前を自分で書かない(defaults.js から読む)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.includes('index.js') && files.includes('script.js'));
  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    assert.ok(!quoted(MAIN_CHARACTER.id).test(src), `${f} に主役の id の写しがある`);
    assert.ok(!quoted(MAIN_CHARACTER.name).test(src), `${f} に主役の名前の写しがある`);
    assert.ok(!/(const|let|var)\s+MAIN_CHARACTER\b/.test(src), `${f} が MAIN_CHARACTER を作り直している`);
  }
  for (const f of ['index.js', 'script.js']) {
    const src = readFileSync(join(DIR, f), 'utf8');
    assert.match(src, /import\s*\{\s*MAIN_CHARACTER\s*\}\s*from\s*'\.\.\/\.\.\/character\/defaults\.js'/, `${f} が defaults.js から読んでいない`);
  }
});

function said(guide) {
  const lines = [];
  const fr = new FirstRun({
    ...(guide === undefined ? {} : { guide }),
    creator: createSampleCreator({ main: MAIN_CHARACTER, exists: async () => true }),
    persona: { get: () => null, set: () => {}, random: () => ({}) },
    talk: async () => ({ lines: [], brain: 'mock' }),
    voice: {},
    present: async (l) => {
      lines.push(...l);
    },
    offer: () => {},
  });
  return { fr, lines };
}

test('案内役を渡さない時は主役になり、主役の口調で名乗る', async () => {
  const { fr, lines } = said(undefined);
  assert.equal(fr.guide, MAIN_CHARACTER);
  assert.equal(fr.guideName, MAIN_CHARACTER.name);
  await fr.start();
  assert.ok(lines[0].text.includes(MAIN_CHARACTER.name) && lines[0].text.includes('ノリ、がんばりマス'), lines[0].text);
});

test('ほかの子を案内役に渡すと、その子の名前でふつうに名乗る(主役の口調にしない)', async () => {
  const { fr, lines } = said({ id: 'yokoso', name: 'ようこそくん' });
  assert.equal(fr.guideName, 'ようこそくん');
  await fr.start();
  assert.ok(lines[0].text.includes('ようこそくん') && !lines[0].text.includes('ノリ、'), lines[0].text);
});
