// いま舞台にいる子を端末が覚える(character/stageMemory.js)の試験。読み込み直しても、同じ子で始めるための部品。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_KEY, forgetStageId, readStageId, stageMemoryWanted, writeStageId } from '../src/character/stageMemory.js';
import { MAIN_CHARACTER } from '../src/character/defaults.js';

const memoryStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) };
};

test('覚えた子を、読み込み直した後に読める', () => {
  const s = memoryStore();
  assert.equal(readStageId(s), '', '何も覚えていない時は ""');
  writeStageId(s, 'yb261108_339426');
  assert.equal(readStageId(s), 'yb261108_339426');
  writeStageId(s, 'mikan');
  assert.equal(readStageId(s), 'mikan', '別の子に替えれば、その子');
});

test('主役(いつもの子)・形の違う id は覚えない(覚えを消す)', () => {
  const s = memoryStore();
  writeStageId(s, 'yb261108_339426');
  writeStageId(s, MAIN_CHARACTER.id);
  assert.equal(s.has(STAGE_KEY), false, 'ノリーに戻したら、覚えを消す');
  writeStageId(s, 'yb261108_339426');
  writeStageId(s, '../etc/passwd');
  assert.equal(s.has(STAGE_KEY), false);
  s.setItem(STAGE_KEY, JSON.stringify({ id: 'Bad Id' }));
  assert.equal(readStageId(s), '', '形の違う値は読まない');
  s.setItem(STAGE_KEY, 'こわれた');
  assert.equal(readStageId(s), '', '壊れた値でも落ちない');
  s.setItem(STAGE_KEY, JSON.stringify({ id: MAIN_CHARACTER.id }));
  assert.equal(readStageId(s), '', '主役の印は読まない');
});

test('読めなかった子の覚えは消せる。保存が使えない時(null・投げる)も、落ちない', () => {
  const s = memoryStore();
  writeStageId(s, 'yb261108_339426');
  forgetStageId(s);
  assert.equal(readStageId(s), '');
  const broken = {
    getItem() {
      throw new Error('使えない');
    },
    setItem() {
      throw new Error('使えない');
    },
    removeItem() {
      throw new Error('使えない');
    },
  };
  assert.doesNotThrow(() => {
    writeStageId(broken, 'mikan');
    forgetStageId(broken);
    writeStageId(null, 'mikan');
  });
  assert.equal(readStageId(broken), '');
  assert.equal(readStageId(null), '');
});

test('覚えた子から始めてよい画面: 入口の LED・自動で始める画面・ヘッドセット・重さを測る時は使わない', () => {
  const p = (q) => new URLSearchParams(q);
  assert.equal(stageMemoryWanted(p('')), true);
  assert.equal(stageMemoryWanted(p('onboard=1')), true);
  assert.equal(stageMemoryWanted(p('led=1')), false);
  assert.equal(stageMemoryWanted(p('autostart=1')), false);
  assert.equal(stageMemoryWanted(p('headset=1')), false);
  assert.equal(stageMemoryWanted(p('perf=1')), false);
  assert.equal(stageMemoryWanted(p(''), { headset: true }), false);
});
