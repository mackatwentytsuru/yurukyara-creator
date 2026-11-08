// 通信の途中の失敗の記録(server/abort.mjs の logRequestError)の試験。画面が切った(AbortError)だけは、スタックを出さず短い 1 行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { logRequestError } from '../server/abort.mjs';

function sink() {
  const out = { info: [], error: [] };
  return { out, info: (...a) => out.info.push(a), error: (...a) => out.error.push(a) };
}

test('AbortError は、エラー用の記録に出さず、短い 1 行だけ(スタックを含まない)', () => {
  const s = sink();
  logRequestError(new DOMException('This operation was aborted', 'AbortError'), s);
  assert.equal(s.out.error.length, 0);
  assert.equal(s.out.info.length, 1);
  assert.equal(s.out.info[0].length, 1);
  assert.ok(String(s.out.info[0][0]).length < 60);
  assert.ok(!/\n\s+at /.test(String(s.out.info[0][0])), 'スタックの行が無い');
});

test('fetch が包んだ AbortError(cause)も、短い 1 行', () => {
  const s = sink();
  logRequestError(new TypeError('terminated', { cause: new DOMException('', 'AbortError') }), s);
  assert.equal(s.out.error.length, 0);
  assert.equal(s.out.info.length, 1);
});

test('ほかの失敗は、今までどおりエラー用の記録に(原因をたどれる形で)', () => {
  const s = sink();
  const err = new Error('声のサービスにつながらない');
  logRequestError(err, s);
  assert.equal(s.out.info.length, 0);
  assert.equal(s.out.error.length, 1);
  assert.equal(s.out.error[0][0], err);
});