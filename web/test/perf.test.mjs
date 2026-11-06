import test from 'node:test';
import assert from 'node:assert/strict';
import { PERF_SCHEMA, k6Record, quantile, summarizeFrames, summarizeResources, timingSummary } from '../src/stage/perf.js';

test('版の名前がある', () => {
  assert.equal(PERF_SCHEMA, 'perf/1');
});

test('quantile は並べた数の位置の値', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.95), 5);
});

test('フレームの間隔から fps と長いフレームを数える', () => {
  const intervals = [...Array(50).fill(16.7), 40, 50];
  const s = summarizeFrames(intervals, [1, 2, 3]);
  assert.equal(s.frames, 52);
  assert.equal(s.frame_ms_median, 16.7);
  assert.equal(s.fps_median, 59.9);
  assert.equal(s.long_frames_over_33ms, 2);
  assert.equal(s.render_cpu_ms_median, 2);
});

test('読み込んだファイルを種類ごとにまとめる', () => {
  const s = summarizeResources([
    { name: 'http://h/characters/robo/model.glb', transferSize: 1000, decodedBodySize: 1000 },
    { name: 'http://h/characters/robo/face_atlas.png', transferSize: 0, encodedBodySize: 200, decodedBodySize: 200 },
    { name: 'http://h/characters/robo/motions/idle.json', transferSize: 50, decodedBodySize: 300 },
    { name: 'http://h/assets/index-abc.js', transferSize: 400, decodedBodySize: 1200 },
  ]);
  assert.equal(s.model.transfer, 1000);
  assert.equal(s.texture.transfer, 200); // 送った大きさが 0(手元の写し)なら、中身の大きさで数える
  assert.equal(s.motion.count, 1);
  assert.equal(s.script.count, 1);
  assert.equal(s.total.count, 4);
  assert.equal(s.total.transfer, 1650);
  assert.deepEqual(s.files.map((f) => f.path), ['/characters/robo/model.glb', '/characters/robo/face_atlas.png']);
});

test('時間の欄: キャラを置いた時刻・最初のコマの時刻・その間(ms に丸める。分からない値は null)', () => {
  const t = timingSummary({ readyAt: 812.4, firstFrameAt: 903.6, loopStartAt: 820.1, domContentLoadedAt: 120.2, warmS: 2, sampleS: 6 });
  assert.deepEqual(t, { ready_ms: 812, first_frame_ms: 904, ready_to_first_frame_ms: 92, loop_start_ms: 820, dom_content_loaded_ms: 120, warm_s: 2, sample_s: 6 });
  const none = timingSummary({ readyAt: 500 });
  assert.equal(none.first_frame_ms, null);
  assert.equal(none.ready_to_first_frame_ms, null);
  assert.equal(timingSummary().ready_ms, null);
});

test('契約 K6 の平らな 1 行を作る(欄の名前と値)', () => {
  const json = {
    character: 'robo', look: '3d', tier: { name: 'mid' }, renderer: { name: 'ANGLE (Apple, Apple GPU, Metal)' },
    timing: { sample_s: 6, ready_ms: 2400 }, frames: { fps_median: 59.9, frame_ms_median: 16.7, frame_ms_p95: 18.2 },
    gl: { calls: 26, triangles: 51234 }, bytes: { model: { transfer: 1048576 } },
  };
  const k = k6Record(json, { commit: 'abc1234', device: 'mobile' });
  assert.deepEqual(Object.keys(k), ['commit', 'device', 'renderer', 'id', 'look', 'tier', 'seconds', 'fps_median', 'frame_ms_p50', 'frame_ms_p95', 'draw_calls', 'triangles', 'load_ms', 'glb_bytes']);
  assert.equal(k.commit, 'abc1234');
  assert.equal(k.device, 'mobile');
  assert.equal(k.id, 'robo');
  assert.equal(k.tier, 'mid');
  assert.equal(k.frame_ms_p50, 16.7);
  assert.equal(k.draw_calls, 26);
  assert.equal(k.load_ms, 2400);
  assert.equal(k.glb_bytes, 1048576);
  const empty = k6Record({});
  assert.equal(empty.commit, null);
  assert.equal(empty.device, 'desktop');
  assert.equal(empty.glb_bytes, 0); // 2D の板は GLB を読まない
});