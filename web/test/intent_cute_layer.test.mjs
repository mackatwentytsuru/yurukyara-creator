// かわいい仕草の層(web/src/character/cuteLayer.js。K2 の動きの言葉に足した名前。B5G)の試験。three を読まない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CuteLayer, CUTE_GESTURES, CUTE_STATES, CHANNELS, CUTE_RISE, EMOTION_GESTURE, AUTO_GAP_S, TALK_SCALE, cuteChoices, seededRandom, bump } from '../src/character/cuteLayer.js';

const DT = 1 / 30;
const run = (layer, sec, fn = null, ctx = {}) => {
  const rows = [];
  for (let i = 0; i < Math.round(sec / DT); i++) {
    fn?.(i * DT, layer);
    const o = layer.step(DT, ctx);
    rows.push({ ...o, playing: layer.playing });
  }
  return rows;
};
const peak = (rows, ch) => Math.max(...rows.map((r) => Math.abs(r[ch])));

test('K2 の仕草の名前が全部そろい、知らない名前は false', () => {
  for (const n of ['greet', 'happy', 'cheer', 'shy', 'surprised', 'think', 'nod', 'tilt', 'droop', 'bow', 'wave', 'shake', 'shrug', 'point', 'jump']) {
    assert.ok(CUTE_GESTURES.includes(n), n);
    assert.equal(new CuteLayer({ rng: seededRandom(1) }).trigger(n), true, n);
  }
  assert.deepEqual([...CUTE_STATES], ['idle', 'listening', 'thinking', 'talking']);
  assert.equal(new CuteLayer().trigger('dance'), false);
  assert.equal(new CuteLayer().trigger(''), false);
  assert.equal(new CuteLayer().trigger(null), false);
});

test('同じ仕草を続けて頼んでも、同じ形を 2 回続けない(左右か変形が替わる)', () => {
  for (const n of ['happy', 'greet', 'shy', 'think', 'nod', 'tilt', 'surprised', 'cheer']) {
    const l = new CuteLayer({ rng: seededRandom(3) });
    l.trigger(n);
    const a = l.gestures.at(-1);
    l.trigger(n);
    const b = l.gestures.at(-1);
    assert.ok(a.side !== b.side || a.k !== b.k, `${n}: ${a.side}/${a.k} → ${b.side}/${b.k}`);
  }
});

test('待つ間も止まらず、待つ間の小さな仕草は前と同じ物を続けない', () => {
  const l = new CuteLayer({ rng: seededRandom(5), caps: { ears: true, tail: true } });
  const names = [];
  let prev = null;
  run(l, 120, () => {
    if (l.accent && l.accent.name !== prev) {
      names.push(l.accent.name);
      prev = l.accent.name;
    }
    if (!l.accent) prev = null;
  });
  assert.ok(names.length >= 12, `小さな仕草の数 ${names.length}`);
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], `${i}: ${names[i]}`);
  assert.ok(new Set(names).size >= 5, `種類 ${[...new Set(names)]}`);
  const rows = run(new CuteLayer({ rng: seededRandom(6) }), 10);
  const sd = (ch) => {
    const v = rows.map((r) => r[ch]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  };
  for (const ch of ['spineX', 'spineZ', 'headZ', 'rootY']) assert.ok(sd(ch) > 1e-4, `${ch} が動いていない`);
});

test('数字はいつも有限で、決まった範囲(弾みは CUTE_RISE まで・腕は 0〜1・頭は 0.6 ラジアンまで)', () => {
  const rng = seededRandom(11);
  const l = new CuteLayer({ rng, caps: { ears: true, tail: true } });
  const rows = run(l, 90, (t, layer) => {
    if (Math.floor(t * 30) % 37 === 0) layer.setActivity(CUTE_STATES[Math.floor(rng() * 4)]);
    if (Math.floor(t * 30) % 23 === 0) layer.trigger(CUTE_GESTURES[Math.floor(rng() * CUTE_GESTURES.length)], { intensity: rng() });
    if (Math.floor(t * 30) % 41 === 0) layer.onEmotion(['happy', 'sad', 'think', 'surprised', 'neutral'][Math.floor(rng() * 5)], 0.9);
  });
  for (const r of rows) {
    for (const c of CHANNELS) assert.ok(Number.isFinite(r[c]), c);
    assert.ok(r.rootY <= CUTE_RISE + 1e-9, `rootY ${r.rootY}`);
    assert.ok(r.armRaiseL >= 0 && r.armRaiseL <= 1 && r.armRaiseR >= 0 && r.armRaiseR <= 1);
    for (const c of ['headX', 'headY', 'headZ']) assert.ok(Math.abs(r[c]) < 0.6, `${c} ${r[c]}`);
    assert.ok(r.blink >= 0 && r.blink <= 1);
  }
});

test('話している間は仕草が小さい(TALK_SCALE)', () => {
  const quiet = new CuteLayer({ rng: seededRandom(2) });
  quiet.trigger('happy');
  const a = run(quiet, 1.6);
  const loud = new CuteLayer({ rng: seededRandom(2) });
  loud.setActivity('talking');
  run(loud, 0.8);
  loud.trigger('happy');
  const b = run(loud, 1.6);
  assert.ok(peak(b, 'spineZ') < peak(a, 'spineZ') * 0.8, `${peak(b, 'spineZ')} vs ${peak(a, 'spineZ')}`);
  assert.ok(peak(b, 'rootY') < peak(a, 'rootY') * 0.7, `弾み ${peak(b, 'rootY')} vs ${peak(a, 'rootY')}`);
  assert.ok(TALK_SCALE < 1);
});

test('やわらかい: 仕草の頭は、目標を少し行き過ぎてから戻る(ばね)', () => {
  const l = new CuteLayer({ rng: seededRandom(4) });
  l.trigger('tilt');
  const rows = run(l, 2.2);
  const z = rows.map((r) => r.headZ);
  const max = Math.max(...z.map(Math.abs));
  assert.ok(max > 0.15 && max < 0.3, `かしげ ${max}`);
  // 終わったら 0 へ戻る
  assert.ok(Math.abs(z.at(-1)) < 0.03, `戻り ${z.at(-1)}`);
});

test('まばたきの間は毎回ちがい、1 回は 0.4 秒以内に終わる', () => {
  const l = new CuteLayer({ rng: seededRandom(9) });
  const rows = run(l, 40);
  const starts = [];
  let closedFor = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].blink > 0 && rows[i - 1].blink === 0) starts.push(i * DT);
    closedFor = rows[i].blink > 0 ? closedFor + DT : 0;
    assert.ok(closedFor < 0.4, `閉じている ${closedFor}`);
  }
  assert.ok(starts.length >= 8, `まばたき ${starts.length} 回`);
  const gaps = starts.slice(1).map((s, i) => Math.round((s - starts[i]) * 10));
  assert.ok(new Set(gaps).size >= 5, `間 ${gaps}`);
});

test('腕の無いキャラは、腕の仕草が近い物へ(腕の数字は 0 のまま)', () => {
  const l = new CuteLayer({ rng: seededRandom(1), caps: { arms: false } });
  assert.equal(l.resolve('greet'), 'happy');
  assert.equal(l.resolve('shrug'), 'tilt');
  l.trigger('cheer');
  const rows = run(l, 2);
  assert.equal(peak(rows, 'armRaiseL') + peak(rows, 'armRaiseR'), 0);
  assert.ok(!cuteChoices({ arms: false }).includes('greet'));
  assert.ok(cuteChoices({ arms: false, clipArm: ['wave'] }).includes('wave'));
  assert.ok(cuteChoices({}).includes('greet') && !cuteChoices({}).includes('jump'));
});

test('首の無いキャラは、頭の動きを体に寄せる', () => {
  const l = new CuteLayer({ rng: seededRandom(1), caps: { head: false } });
  l.trigger('tilt');
  const rows = run(l, 1.5);
  assert.equal(peak(rows, 'headZ'), 0);
  assert.ok(peak(rows, 'spineZ') > 0.06, `体 ${peak(rows, 'spineZ')}`);
});

test('表情が変わると、仕草が頼まれていなければ、合う仕草が自動で付く(6 秒に 1 回まで)', () => {
  const l = new CuteLayer({ rng: seededRandom(1) });
  l.onEmotion('happy', 0.9);
  l.step(DT);
  assert.equal(l.busy, EMOTION_GESTURE.happy);
  // 返事が仕草を頼んだ回は、自動の仕草を出さない
  const m = new CuteLayer({ rng: seededRandom(1) });
  m.onEmotion('surprised', 0.9);
  m.trigger('nod');
  m.step(DT);
  assert.equal(m.busy, 'nod');
  // 続けて表情が替わっても、6 秒たつまでは付けない
  run(l, 2);
  l.onEmotion('sad', 0.9);
  l.step(DT);
  assert.equal(l.busy, null);
  run(l, AUTO_GAP_S);
  l.onEmotion('surprised', 0.9);
  l.step(DT);
  assert.equal(l.busy, 'surprised');
  // 弱い表情・neutral・同じ表情では付けない
  const n = new CuteLayer({ rng: seededRandom(1) });
  n.onEmotion('happy', 0.2);
  n.step(DT);
  assert.equal(n.busy, null);
});

test('聞いている間は、相づちのうなずきが出て、話す人の方へ少し向く', () => {
  const l = new CuteLayer({ rng: seededRandom(8) });
  l.setActivity('listening');
  const rows = run(l, 10, null, { gazeYaw: 0.5 });
  let nods = 0;
  for (let i = 1; i < rows.length - 1; i++) if (rows[i].headX > 0.04 && rows[i].headX >= rows[i - 1].headX && rows[i].headX > rows[i + 1].headX) nods += 1;
  assert.ok(nods >= 3 && nods <= 9, `うなずき ${nods}`);
  assert.ok(rows.at(-1).spineY > 0.08, `向き ${rows.at(-1).spineY}`);
});

test('考える時は首をかしげて上を見る。次に考える時は反対へかしげる', () => {
  const l = new CuteLayer({ rng: seededRandom(8) });
  l.setActivity('thinking');
  const a = run(l, 2).at(-1);
  l.setActivity('idle');
  run(l, 2);
  l.setActivity('thinking');
  const b = run(l, 2).at(-1);
  assert.ok(a.gazeY > 0.1 && b.gazeY > 0.1, `上を見る ${a.gazeY} / ${b.gazeY}`);
  assert.ok(Math.abs(a.headZ) > 0.1 && Math.sign(a.headZ) !== Math.sign(b.headZ), `${a.headZ} / ${b.headZ}`);
});

test('bump は 0〜1 の山', () => {
  assert.equal(bump(-0.1), 0);
  assert.equal(bump(0.5), 1);
  assert.equal(bump(1.2), 0);
  assert.ok(bump(0.05) > 0 && bump(0.05) < 1);
});
