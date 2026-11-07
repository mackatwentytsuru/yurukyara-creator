// 第 12 波 b(B3): 字幕を描く所(panel.js の createUi)を、小さな偽の DOM で通しで動かす。
// 届いた文は話す前から薄く(cap-next)、話し始めると今の文(cap-now)に。テレビ表示では、まだ話していない文だけの時に空の箱を出さない。
// (iOS のシミュレーターで、createUi の中の同じ名前の変数が関数を隠して字幕が出なくなったのを見つけた。純粋な関数の試験では見えなかった)
import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.textContent = '';
    this.hidden = true;
    this.className = '';
    this.dataset = {};
    this.style = { setProperty() {} };
    this.scrollTop = 0;
    this.scrollHeight = 100;
    this.offsetTop = 0;
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  }
  addEventListener() {}
  setAttribute() {}
  getAttribute() {
    return null;
  }
  append(...c) {
    this.children.push(...c);
  }
  replaceChildren(...c) {
    this.children = c;
  }
  querySelector(sel) {
    const want = sel.replace('.', '');
    const walk = (n) => {
      for (const ch of n.children ?? []) {
        if (ch.className === want) return ch;
        const r = walk(ch);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}
const els = new Map();
globalThis.document = {
  documentElement: new El('html'),
  getElementById: (id) => {
    if (!els.has(id)) els.set(id, new El(id));
    return els.get(id);
  },
  createElement: () => new El(),
  createTextNode: (t) => ({ textContent: t }),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {} };
const { createUi } = await import('../src/ui/panel.js');

const view = (cap) => cap.children.map((c) => [c.className, c.textContent, (c.children ?? []).map((d) => [d.className, d.textContent])]);

test('字幕(本物の createUi): 届いた文は薄く先に、話し始めると今の文。テレビ表示では、まだ話していない文だけなら箱を隠す', () => {
  const ui = createUi();
  const cap = document.getElementById('caption');
  ui.userSaid('すきなたべものは?');
  assert.equal(cap.className, 'caption user');
  ui.sayAhead({ text: '葉っぱデス!' });
  assert.equal(cap.hidden, false);
  assert.deepEqual(view(cap), [['cap-now', '', [['cap-next', '葉っぱデス!']]]], '1 文目は話す前から薄く出る');
  assert.match(cap.className, /\bahead\b/, '先に見せた返事は、話し終わりと同じ大きさの段落(字幕の箱が高くならない)');
  ui.sayAhead({ text: 'くだものも。' });
  assert.deepEqual(view(cap), [['cap-now', '', [['cap-next', '葉っぱデス!くだものも。']]]], '届いた文は全部、先に読める');
  ui.say({ text: '葉っぱデス!', expression: 'happy', motion: 'none', gaze: 'person' });
  ui.caption('葉っぱデス!');
  assert.deepEqual(view(cap), [['cap-now', '葉っぱデス!', [['cap-next', 'くだものも。']]]], '話し始めた文は濃く、残りは薄く');
  ui.say({ text: 'くだものも。', expression: 'happy', motion: 'none', gaze: 'person' });
  ui.caption('くだものも。');
  assert.deepEqual(view(cap), [['cap-prev', '葉っぱデス!', []], ['cap-now', 'くだものも。', []]]);
  ui.caption(null, 1200);
  assert.match(cap.className, /settled/);
  assert.doesNotMatch(cap.className, /\bahead\b/);
  // テレビ表示
  document.documentElement.classList.add('tv-mode');
  ui.caption(null);
  ui.userSaid('テレビ');
  ui.sayAhead({ text: 'テレビの文。' });
  assert.equal(cap.hidden, true, 'まだ話していない文だけ: 空の箱を出さない');
  ui.say({ text: 'テレビの文。', expression: 'happy', motion: 'none', gaze: 'person' });
  ui.caption('テレビの文。');
  assert.equal(cap.hidden, false);
  assert.deepEqual(view(cap), [['cap-now', 'テレビの文。', []]], 'テレビ表示は今の文だけ');
  assert.doesNotMatch(cap.className, /\bahead\b/, 'テレビ表示は前の大きさのまま(3 m 先から読める字)');
  document.documentElement.classList.remove('tv-mode');
});
