// 画面の声のおぼえ書き(QF3b): 前もって取った声は、話す時にもう取りに行かない・同じ文は 2 回頼まない・取りかけは待つ・失敗は入れない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../src/conversation/speaker.js';

const pcmBytes = (n) => new Uint8Array(n * 2).fill(5);

function setup(handler) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init?.body ?? '{}').text);
    return handler(calls.length);
  };
  const sp = new Speaker();
  const starts = [];
  const param = { setValueAtTime() {}, linearRampToValueAtTime() {} };
  sp.ctx = {
    currentTime: 1,
    createBuffer: (_c, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({ connect() {}, start: (t) => starts.push(t), stop() {} }),
    createOscillator: () => ({ type: '', frequency: param, connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: param, connect() {} }),
  };
  sp.analyser = {};
  return { sp, calls, starts, restore: () => (globalThis.fetch = realFetch) };
}

const ok = () => new Response(pcmBytes(2400), { status: 200 });

test('前もって取った声: 話す時に声のサービスへ行かず、声で話す', async () => {
  const t = setup(ok);
  try {
    await t.sp.prefetch('はじめまして!');
    assert.equal(t.calls.length, 1);
    let info = null;
    await t.sp.enqueue('はじめまして!', { onStart: (_x, i) => (info = i) });
    assert.equal(t.calls.length, 1, '2 回目は頼まない');
    assert.deepEqual(info, { crawl: false }, '声で話す(文字送りではない)');
    assert.ok(t.starts.length >= 1);
    await t.sp.enqueue('はじめまして!', {});
    assert.equal(t.calls.length, 1, '3 回目も頼まない');
  } finally {
    t.restore();
  }
});

test('取っている最中の文を話す時は、同じ取りを待つ(2 回頼まない)', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const t = setup(() => gate.then(ok));
  try {
    const p = t.sp.prefetch('どんな子を生み出そうか?');
    const done = t.sp.enqueue('どんな子を生み出そうか?', {});
    release();
    await Promise.all([p, done]);
    assert.equal(t.calls.length, 1);
  } finally {
    t.restore();
  }
});

test('失敗した取りはおぼえない(話す時に、もう一度取りに行く)', async () => {
  const t = setup((n) => (n === 1 ? new Response('x', { status: 500 }) : ok()));
  try {
    await t.sp.prefetch('ねえ');
    assert.equal(t.sp.pcmCache.size, 0);
    await t.sp.enqueue('ねえ', {});
    assert.equal(t.calls.length, 2);
  } finally {
    t.restore();
  }
});

test('声が取れない画面(サーバーに声が無い)では、前もっての取りもしない', () => {
  const t = setup(ok);
  try {
    t.sp.serverTtsOff = 'なし';
    assert.equal(t.sp.prefetch('やあ'), undefined);
    assert.equal(t.calls.length, 0);
  } finally {
    t.restore();
  }
});
