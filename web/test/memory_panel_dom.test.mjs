// 記憶の札の動き(CRITux 19・CRITsec F9 の画面の側。11-07)。ブラウザは使わず、小さな偽の DOM と偽の通信で確かめる。
// - 会話の「わすれて」(サーバーの印 via: 'chat')と「全部わすれる」のあとに、「受け取りました」や古い番号・のこり時間を残さない
// - 引き出しを開いた時の読み直し(main.js の {type:'memory', forgotten:true}。印なし)では、番号と知らせを消さない
// - 番号で受け取る時も、合言葉を見出し x-demo-pass で送る(札の欄の値か、会話の合言葉)
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

const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);
const calls = [];
let items = [];
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  calls.push({ url: String(url), method, headers: { ...(init.headers ?? {}) } });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url === '/api/memory/new') return json({ key: KEY_A, items: [], notice: '7 日で消えます' });
  if (url === '/api/memory' && method === 'GET') return json({ items, notice: '7 日で消えます' });
  if (url === '/api/memory' && method === 'DELETE') {
    items = [];
    return json({ ok: true, forgotten: true });
  }
  if (url === '/api/memory/claim') {
    items = [{ id: '1', kind: 'name', text: '名前: タロウ' }];
    return json({ key: KEY_B, items, notice: '7 日で消えます' });
  }
  if (url === '/api/memory/pair') return json({ code: '123456', ttlSec: 600, expiresAt: new Date(Date.now() + 600_000).toISOString() });
  return json({ error: 'なし' }, 404);
};

const { mountMemoryPanel } = await import('../src/ui/memoryPanel.js');
const { setDemoPass } = await import('../src/conversation/demoPass.js');

const until = async (ok, ms = 3000) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('待ちきれませんでした');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 30));

function mount() {
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { askPass: false });
  const q = (cls) => panel.root.find(cls);
  return { panel, q };
}

test('番号で受け取る: 札の合言葉の欄(main.js が会話の合言葉を入れる)を、見出し x-demo-pass で送る', async () => {
  const { panel, q } = mount();
  await panel.ready;
  q('mem-pass').value = ' pass-from-field ';
  q('mem-code-in').value = '123456';
  q('mem-claim').click();
  await until(() => q('mem-status').textContent.startsWith('受け取りました'));
  const claim = calls.findLast((c) => c.url === '/api/memory/claim');
  assert.equal(claim.headers['x-demo-pass'], 'pass-from-field', '前後の空白は外す');
  assert.equal(claim.headers['x-memory-key'], undefined, '受け取りに今の合鍵は送らない');
  // 欄が空なら、会話の合言葉(このタブの中だけの物)を使う
  q('mem-pass').value = '';
  setDemoPass('pass-from-gate');
  q('mem-code-in').value = '654321';
  q('mem-claim').click();
  await until(() => calls.filter((c) => c.url === '/api/memory/claim').length === 2);
  assert.equal(calls.findLast((c) => c.url === '/api/memory/claim').headers['x-demo-pass'], 'pass-from-gate');
  setDemoPass('');
});

test('会話の「わすれて」(印 via: chat)の後に「受け取りました」を残さない。引き出しを開いた時の読み直し(印なし)では消さない', async () => {
  const { panel, q } = mount();
  await panel.ready;
  q('mem-code-in').value = '123456';
  q('mem-claim').click();
  await until(() => q('mem-status').textContent.startsWith('受け取りました'));
  // main.js の resyncMemory と同じ形(引き出しを開いた時)。知らせはそのまま
  panel.onChatEvent({ type: 'memory', forgotten: true });
  await settle();
  assert.match(q('mem-status').textContent, /^受け取りました/);
  // 会話で「わすれて」(サーバーの forgetReplyEvents が付ける印)
  items = [];
  const before = calls.length;
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(q('mem-status').textContent, '全部わすれました');
  await settle();
  assert.equal(q('mem-status').textContent, '全部わすれました', '読み直しの後も古い知らせに戻らない');
  assert.deepEqual(
    calls.slice(before).map((c) => `${c.method} ${c.url}`),
    ['POST /api/memory/new'],
    '消えた合鍵を確かめに行かず(404 を出さず)、新しい合鍵を作る',
  );
  // 何も覚えていなかった時は、知らせを消すだけ
  panel.onChatEvent({ type: 'memory', forgotten: false, via: 'chat' });
  assert.equal(q('mem-status').textContent, '');
});

test('番号を出している間に「全部わすれる」: 番号とのこり時間を消し、時計も止める(1 秒たっても古い知らせが戻らない)', async () => {
  const { panel, q } = mount();
  await panel.ready;
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  assert.match(q('mem-status').textContent, /のこり/);
  q('mem-forget').click();
  await until(() => q('mem-status').textContent === '全部わすれました');
  assert.equal(q('mem-code').textContent, '');
  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(q('mem-status').textContent, '全部わすれました', 'のこり時間の知らせに戻らない');
  // 会話の「わすれて」でも、出していた番号を消す
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(q('mem-code').textContent, '');
  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(q('mem-status').textContent, '全部わすれました');
});

test('引き出しを開いた時の読み直し用に resync() もある(番号と知らせはそのまま)', async () => {
  const { panel, q } = mount();
  await panel.ready;
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  const before = calls.length;
  panel.resync();
  await settle();
  assert.ok(calls.length > before, '一覧を読み直す');
  assert.equal(q('mem-code').textContent, '123456');
  q('mem-forget').click(); // 時計を止めて終わる
  await until(() => q('mem-code').textContent === '');
});
