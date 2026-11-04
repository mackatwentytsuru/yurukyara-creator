// 入口の LED: 視線の橋(UDP の v1)→ サーバー → ページ(?source=bridge)の通り道の試験。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createGazeRelay, sanitizeGaze, sanitizeAim } from '../server/gazeRelay.mjs';
import { BridgeSource, gazeToLocal } from '../src/tracking/sources/bridgeSource.js';

test('v1 の形だけを受け、範囲の外は丸める。形の違う物は捨てる', () => {
  assert.deepEqual(sanitizeGaze({ v: 1, present: true, az: 10, el: -5, dist: 2.5, n: 1, facing: 1, seq: 3 }), {
    present: true, az: 10, el: -5, dist: 2.5, n: 1, facing: 1, seq: 3,
  });
  assert.equal(sanitizeGaze({ v: 2, present: true, az: 1, el: 1 }), null);
  assert.equal(sanitizeGaze({ v: 1, present: true, az: 'x', el: 1 }), null);
  assert.equal(sanitizeGaze({ v: 1, present: true, az: NaN, el: 1 }), null);
  assert.equal(sanitizeGaze([1]), null);
  assert.equal(sanitizeGaze({ v: 1, present: true, az: 500, el: -500 }).az, 90);
  assert.equal(sanitizeGaze({ v: 1, present: false }).present, false);
  // 画素つき(校正の記録用)
  const g = sanitizeGaze({ v: 1, present: true, az: 1, el: 2, u: 960, v_px: 400, ipd_px: 30 });
  assert.deepEqual([g.u, g.v_px, g.ipd_px], [960, 400, 30]);
  assert.equal(sanitizeAim({ az: 1 }), null);
  assert.deepEqual(sanitizeAim({ off: true }), { off: true });
});

test('UDP で受けた向きを返し、受けてからの時間(ageMs)を付ける。画素はページに渡さない', async () => {
  let t = 1000;
  const relay = createGazeRelay({ port: 0, now: () => t });
  const port = await relay.start();
  const sock = createSocket('udp4');
  try {
    const got = new Promise((resolve) => {
      const iv = setInterval(() => {
        if (relay.status().received) {
          clearInterval(iv);
          resolve();
        }
      }, 5);
    });
    sock.send(JSON.stringify({ v: 1, present: true, az: 12.5, el: -3, dist: 2.2, n: 1, facing: 1, seq: 1, u: 1, v_px: 2, ipd_px: 3 }) + '\n', port, '127.0.0.1');
    sock.send('こわれた行', port, '127.0.0.1');
    await got;
    t += 250;
    const now = relay.current();
    assert.equal(now.az, 12.5);
    assert.equal(now.ageMs, 250);
    assert.equal(now.u, undefined);
    assert.equal(now.ipd_px, undefined);
  } finally {
    sock.close();
    relay.stop();
  }
});

test('狙い(手で合わせる向き)が有効な間は、狙いを返す。記録は「狙い + いまの画素」の 1 点になる', () => {
  let t = 0;
  const relay = createGazeRelay({ port: 0, now: () => t });
  assert.equal(relay.mark().ok, false); // 狙いが無い
  relay.setAim({ az: 4, el: 6 });
  assert.equal(relay.mark().ok, false); // 画素が無い
  relay.accept(JSON.stringify({ v: 1, present: true, az: 1, el: 1, u: 900, v_px: 300, ipd_px: 25 }));
  const cur = relay.current();
  assert.equal(cur.aim, true);
  assert.equal(cur.az, 4);
  const m = relay.mark();
  assert.equal(m.ok, true);
  assert.deepEqual(m.point, { u: 900, v: 300, ipd_px: 25, yaw_deg: 4, pitch_deg: 6 });
  t += 5000;
  assert.equal(relay.mark().ok, false); // 古い
  assert.equal(relay.points().length, 1);
  relay.unmark();
  assert.equal(relay.points().length, 0);
  relay.setAim({ off: true });
  assert.equal(relay.current().aim, false);
});

test('向き → キャラの座標: 正面・右・上', () => {
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(close(gazeToLocal({ az: 0, el: 0, dist: 2 }, 1.4), [0, 1.4, 2]));
  assert.ok(close(gazeToLocal({ az: 90, el: 0, dist: 2 }, 1.4), [2, 1.4, 0])); // 客から見て右 = キャラの +x
  assert.ok(close(gazeToLocal({ az: 0, el: 90, dist: 1 }, 1.4), [0, 2.4, 0]));
  assert.ok(close(gazeToLocal({ az: 0, el: 0, dist: null }, 1, 3), [0, 1, 3])); // 距離なし
});

test('ページの入力: 受けた向きを人の位置にし、古い・いないときは空にする', async () => {
  const src = new BridgeSource({ getFrame: () => ({ toWorld: (v) => v.map((x) => x + 10), headY: 1.5 }) });
  await src.start();
  src.receive({ present: true, az: 0, el: 0, dist: 2, ageMs: 0 }, 1000);
  assert.deepEqual(src.getPeople(1000)[0].position, [10, 11.5, 12]);
  assert.equal(src.getPeople(3000).length, 0); // 1.5 秒より古い
  src.receive({ present: true, az: 0, el: 0, dist: 2, ageMs: 2000 }, 5000); // サーバーで既に古い
  assert.equal(src.getPeople(5000).length, 0);
  src.receive({ present: false }, 6000);
  assert.equal(src.getPeople(6000).length, 0);
  src.receive('{こわれ', 7000);
  assert.equal(src.current().present, false);
});
