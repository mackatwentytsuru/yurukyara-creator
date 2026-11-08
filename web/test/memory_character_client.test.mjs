// 記憶は話している子ごと(画面の側)。会話と記憶の通信に、いまの子の id(見出し x-yc-character)を付ける。
// - 子が決まっていなければ付けない(前と同じ)。形の違う id は付けない
// - 札の「全部わすれる」と会話の「わすれて」は、子が決まっていれば、その子の分だけ(合鍵は捨てない)
// - 前からある「全部消して合鍵も捨てる」(お店の端末の切り替えなど)は、子の id を付けずに、全部消す
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.className = '';
  }
  append(...nodes) {
    this.children.push(...nodes.filter((n) => n && typeof n === 'object'));
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click ?? []) fn();
  }
  find(cls) {
    if (String(this.className).split(/\s+/).includes(cls)) return this;
    for (const c of this.children) {
      const hit = c.find?.(cls);
      if (hit) return hit;
    }
    return null;
  }
}
globalThis.document = { createElement: (tag) => new FakeEl(tag) };

const KEY = 'Q'.repeat(43);
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', headers: { ...(init.headers ?? {}) }, body: init.body });
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  if (url === '/api/chat') return json({ brain: 'mock', events: [{ type: 'say', text: 'やあ' }], ms: 1 });
  if (url === '/api/memory' && (init.method ?? 'GET') === 'GET') return json({ items: [], notice: 'x' });
  if (url === '/api/memory' && init.method === 'DELETE') return json({ ok: true, forgotten: true, scoped: true });
  return json({ error: 'なし' }, 404);
};

const mk = await import('../src/ui/memoryKey.js');
const { streamChat } = await import('../src/conversation/brainClient.js');
const { mountMemoryPanel } = await import('../src/ui/memoryPanel.js');

const reset = () => {
  mk.clearKey();
  mk.setMemoryCharacter('');
  calls.length = 0;
};
const last = (url, method) => [...calls].reverse().find((c) => c.url === url && c.method === method);

test('子が決まっていなければ見出しを付けない。決めれば付く。形の違う id は付けない。合鍵だけの時は合鍵だけ', () => {
  reset();
  assert.deepEqual(mk.memoryHeaders(), {});
  mk.setMemoryCharacter('yb261108_aaaaaa');
  assert.deepEqual(mk.memoryHeaders(), { 'x-yc-character': 'yb261108_aaaaaa' }, '合鍵が無くても、子の id は付く(最初に覚える回を、その子の分にするため)');
  mk.setKey(KEY);
  assert.deepEqual(mk.memoryHeaders(), { 'x-memory-key': KEY, 'x-yc-character': 'yb261108_aaaaaa' });
  mk.setMemoryCharacter('../../etc');
  assert.deepEqual(mk.memoryHeaders(), { 'x-memory-key': KEY });
  assert.equal(mk.getMemoryCharacter(), '');
  mk.setMemoryCharacter(undefined);
  assert.equal(mk.getMemoryCharacter(), '');
  reset();
});

test('会話(/api/chat)にも、いまの子の id を付けて送る(お店の端末 memory:"off" は付けない)', async () => {
  reset();
  mk.setKey(KEY);
  mk.setMemoryCharacter('yb261108_bbbbbb');
  await streamChat({ text: 'こんにちは', history: [], character: { name: 'ハナ' } }, () => {}, new AbortController().signal);
  assert.equal(last('/api/chat', 'POST').headers['x-yc-character'], 'yb261108_bbbbbb');
  assert.equal(last('/api/chat', 'POST').headers['x-memory-key'], KEY);
  await streamChat({ text: 'こんにちは', history: [], memory: 'off' }, () => {}, new AbortController().signal);
  const shop = last('/api/chat', 'POST');
  assert.equal(shop.headers['x-yc-character'], undefined);
  assert.equal(shop.headers['x-memory-key'], undefined);
  reset();
});

test('一覧の読み出しにも、いまの子の id が付く(札はその子の分だけ見せる)', async () => {
  reset();
  mk.setKey(KEY);
  mk.setMemoryCharacter('yb261108_aaaaaa');
  await mk.loadMemory();
  assert.equal(last('/api/memory', 'GET').headers['x-yc-character'], 'yb261108_aaaaaa');
  mk.setMemoryCharacter('mikan');
  await mk.loadMemory();
  assert.equal(last('/api/memory', 'GET').headers['x-yc-character'], 'mikan', '子が替われば、その子の分');
  reset();
});

test('forgetAll(お店の端末の切り替えなど)は、子の id を付けず全部消し、合鍵も捨てる。forgetMemoryOf は指した子だけ', async () => {
  reset();
  mk.setKey(KEY);
  mk.setMemoryCharacter('yb261108_aaaaaa');
  await mk.forgetAll();
  assert.equal(last('/api/memory', 'DELETE').headers['x-yc-character'], undefined, '全部消す時は子を指さない');
  assert.equal(mk.getKey(), '');
  mk.setKey(KEY);
  await mk.forgetMemoryOf('yb261108_cccccc');
  const of = last('/api/memory', 'DELETE');
  assert.equal(of.headers['x-yc-character'], 'yb261108_cccccc');
  assert.equal(of.headers['x-memory-key'], KEY);
  assert.equal(mk.getKey(), KEY, '合鍵は残る');
  calls.length = 0;
  await mk.forgetMemoryOf('../x');
  assert.equal(calls.length, 0, '形の違う id では通信しない');
  mk.clearKey();
  await mk.forgetMemoryOf('yb261108_cccccc');
  assert.equal(calls.length, 0, '合鍵が無ければ通信しない');
  reset();
});

test('札: 「全部わすれる」は、子が決まっていても、どの子の分も全部消して合鍵も捨てる(確かめの後)。子ごとに消すのは子を消す時だけ', async () => {
  reset();
  mk.setKey(KEY);
  mk.setMemoryCharacter('yb261108_aaaaaa');
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { askPass: false });
  await panel.ready;
  panel.root.find('mem-forget').click();
  calls.length = 0;
  panel.root.find('mem-forget-no').click(); // 「やめる」では何も消さない
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(last('/api/memory', 'DELETE'), undefined, '「やめる」では消さない');
  assert.equal(mk.getKey(), KEY);
  panel.root.find('mem-forget').click();
  panel.root.find('mem-forget-yes').click(); // 1 回目は聞くだけ。「はい」で消す
  await new Promise((r) => setTimeout(r, 60));
  const del = last('/api/memory', 'DELETE');
  assert.ok(del, '消す通信が出る');
  assert.equal(del.headers['x-yc-character'], undefined, '子を指さない = 全部');
  assert.equal(mk.getKey(), '', '札の「全部わすれる」で、この端末の合鍵も捨てる');
  reset();
});

test('会話の「わすれて」の印(scoped なし)で、合鍵を捨てる', () => {
  reset();
  mk.setKey(KEY);
  const panel = mountMemoryPanel(new FakeEl('div'), { askPass: false });
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(mk.getKey(), '');
  reset();
});
