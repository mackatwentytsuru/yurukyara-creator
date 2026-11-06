// 声のサーバーの有無を読み上げに渡す(S3 の頼み・CRITux 25 の公開の側): main.js は /api/status を読むたびに
// speaker.setServerVoice(声があるか) を呼ぶ。公開の URL(/api/status も /api/tts も無い)と声の鍵の無いサーバーでは、/api/tts を聞かない。
// main.js は three を読むので node の試験で読み込めない。ここでは形だけを文で確かめる。動き(聞かない・true に戻せば聞く)は voice_server_off.test.mjs(S3)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(import.meta.dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const CALL = 'speaker.setServerVoice(Boolean(app.status?.tts?.available))';

test('main.js: 状態を読むたび(読めなかった時も)、声のサーバーがあるかを読み上げに渡す', () => {
  const body = main.match(/async function refreshStatus\(\) \{\n([\s\S]*?)\n\}\n/)?.[1];
  assert.ok(body, 'refreshStatus がある');
  const call = body.indexOf(CALL);
  assert.ok(call >= 0, `refreshStatus の中に ${CALL}`);
  assert.ok(call > body.lastIndexOf('app.status = null'), '読めなかった時(null → 声なし)の後で渡す');
});

test('main.js: 起動では最初の状態を読んでから入口のボタンを押せるようにする(話す前に声の有無が決まる)', () => {
  const boot = main.indexOf('async function boot()');
  const first = main.indexOf('await refreshStatus();', boot);
  const open = main.indexOf('buttons.forEach((b) => (b.disabled = false));', boot);
  assert.ok(boot > 0 && first > boot && open > first);
});
