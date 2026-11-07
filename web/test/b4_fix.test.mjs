// B4 直し(12b): 3D の約束が本当と合う・役目の札は折り返す・描く道の知らせは送り先を正しく言う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(import.meta.dirname, '..');
const rd = (p) => readFileSync(join(WEB, p), 'utf8');

test('3D は、まだ作っていないのに「作っているよ・作るよ」と言わない', () => {
  for (const f of ['src/ui/onboarding/script.js', '../creator/review/page/make.js', '../creator/review/yuru_make.py']) {
    const t = rd(f);
    assert.doesNotMatch(t, /パソコンで つくっている|パソコンで つくるよ|パソコンで つくります/, f);
    assert.match(t, /まだ できてい/, f);
  }
});

test('役目の札(5 つ)は、横に巻かず折り返して全部見せる', () => {
  assert.match(rd('src/ui/onboarding/view.js'), /role_auto[^\n]*CARD_ROWS/);
});

test('舞台に出せなかった時は、「舞台に でたよ」と言わない', () => {
  assert.match(rd('src/ui/onboarding/index.js'), /return 'failed'/);
  assert.match(rd('src/ui/onboarding/script.js'), /stay === 'failed'/);
});

test('ブラウザから描く設定の時、ことばも Claude に送ると先に言う', () => {
  assert.match(rd('src/ui/onboarding/script.js'), /canDraw \? 'ことばと 絵は/);
});
