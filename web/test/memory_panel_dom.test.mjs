// 記憶の札の動き(CRITux 19・CRITsec F8・F9 の画面の側。11-07)。ブラウザは使わず、小さな偽の DOM と偽の通信で確かめる。
// - 札は合鍵を作らない(F8): 開いただけ・全部わすれた後・会話の「わすれて」の後も /api/memory/new を呼ばない。合鍵は会話のイベント(key)か番号で受け取る
// - 会話の「わすれて」(サーバーの印 via: 'chat')と「全部わすれる」のあとに、「受け取りました」や古い番号・のこり時間を残さない
// - 「全部わすれる」: 知らせ(全部わすれました)と同じ時に一覧を空にする。遅れて届いた古い読み直しで、一覧を戻さない(S4w8a の順の揺れ)
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
const TARO = [
  { id: '1', kind: 'name', text: '名前: タロウ' },
  { id: '2', kind: 'like', text: '好きなもの: カレー' },
];
const calls = [];
let items = [];
let gone = false; // true の間、一覧の読み出しは 404(別の端末で消した・7 日たった合鍵)
let slowMs = 0; // 一覧の読み出しと合鍵づくりの返事を遅らせる(公開の URL の 100ms 以上の通信のまね)
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  calls.push({ url: String(url), method, headers: { ...(init.headers ?? {}) } });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const slow = () => (slowMs ? new Promise((r) => setTimeout(r, slowMs)) : null);
  if (url === '/api/memory/new') return (await slow(), json({ key: KEY_A, items: [], notice: '7 日で消えます' }));
  if (url === '/api/memory' && method === 'GET') {
    const shown = [...items]; // 問い合わせた時の一覧(遅れて返る時も、その時の中身)
    await slow();
    return gone ? json({ error: '無い' }, 404) : json({ items: shown, notice: '7 日で消えます' });
  }
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
const { clearKey, getKey, NOTHING_TO_PAIR } = await import('../src/ui/memoryKey.js');
const { MEMORY_NOTICE } = await import('../src/conversation/memoryNotice.js');
const { setDemoPass } = await import('../src/conversation/demoPass.js');

const until = async (ok, ms = 3000) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('待ちきれませんでした');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** 毎回、合鍵なし・偽の通信の初めの状態から札を付ける */
function mount() {
  clearKey();
  items = [];
  gone = false;
  slowMs = 0;
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { askPass: false });
  const q = (cls) => panel.root.find(cls);
  const shown = () => q('mem-list').children.filter((li) => li.className === 'mem-item').length;
  return { panel, q, shown };
}

/** 会話の返事のイベントで合鍵を受け取ったことにする(覚える事が出た最初の回) */
async function adopt(panel, shown, list = TARO) {
  items = [...list];
  panel.onChatEvent({ type: 'memory', key: KEY_A, added: list });
  await until(() => shown() === list.length);
}

test('開いただけでは合鍵を作らない(通信もしない)。空の一覧と「7 日で消えます」を出す', async () => {
  const before = calls.length;
  const { panel, q, shown } = mount();
  await panel.ready;
  assert.equal(panel.root.dataset.ready, '1');
  assert.deepEqual(calls.slice(before), [], '合鍵が無ければ、一覧も読みに行かない');
  assert.equal(getKey(), '');
  assert.equal(shown(), 0);
  assert.equal(q('mem-list').children[0]?.textContent, 'まだ何も覚えていません');
  assert.equal(q('mem-notice').textContent, MEMORY_NOTICE);
  assert.match(MEMORY_NOTICE, /7 日で消えます/);
});

test('会話のイベントで届いた合鍵(覚える事が出た最初の回)を持ち、その合鍵で一覧を読む。形の違う値は持たない', async () => {
  const { panel, shown } = mount();
  await panel.ready;
  panel.onChatEvent({ type: 'memory', key: 'short', added: [] });
  await settle();
  assert.equal(getKey(), '', '形の違う合鍵は持たない');
  await adopt(panel, shown);
  assert.equal(getKey(), KEY_A);
  const read = calls.findLast((c) => c.url === '/api/memory' && c.method === 'GET');
  assert.equal(read.headers['x-memory-key'], KEY_A);
  assert.ok(!calls.some((c) => c.url === '/api/memory/new'), '札は /api/memory/new を呼ばない');
});

test('会話のイベントの合鍵は、もう持っている合鍵(番号で受け取った物)を上書きしない', async () => {
  const { panel, q } = mount();
  await panel.ready;
  q('mem-code-in').value = '123456';
  q('mem-claim').click();
  await until(() => q('mem-status').textContent.startsWith('受け取りました'));
  assert.equal(getKey(), KEY_B);
  // 受け取る前に送った回の返事が、後から届いた(その回は合鍵なしで送ったので、サーバーが新しい合鍵を作った)
  panel.onChatEvent({ type: 'memory', key: KEY_A, added: [{ id: '9', kind: 'like', text: '好きなもの: カレー' }] });
  await settle();
  assert.equal(getKey(), KEY_B, '受け取った合鍵のまま');
});

test('番号を出す: まだ合鍵が無ければ、通信せずに「先に話しかけてね」と知らせる(合鍵は作らない)', async () => {
  const { panel, q } = mount();
  await panel.ready;
  const before = calls.length;
  q('mem-pair').click();
  await until(() => q('mem-status').textContent === NOTHING_TO_PAIR);
  assert.deepEqual(calls.slice(before), []);
  assert.equal(q('mem-code').textContent, '');
});

test('番号で受け取る: 札の合言葉の欄(main.js が会話の合言葉を入れる)を、見出し x-demo-pass で送る', async () => {
  const { panel, q } = mount();
  await panel.ready;
  const claims = () => calls.filter((c) => c.url === '/api/memory/claim').length;
  const before = claims(); // 前の試験の受け取りも calls に残っているので、この試験の分だけ数える
  q('mem-pass').value = ' pass-from-field ';
  q('mem-code-in').value = '123456';
  q('mem-claim').click();
  await until(() => q('mem-status').textContent.startsWith('受け取りました'));
  const claim = calls.findLast((c) => c.url === '/api/memory/claim');
  assert.equal(claim.headers['x-demo-pass'], 'pass-from-field', '前後の空白は外す');
  assert.equal(claim.headers['x-memory-key'], undefined, '受け取りに今の合鍵は送らない');
  assert.equal(getKey(), KEY_B, '受け取った合鍵を持つ');
  // 欄が空なら、会話の合言葉(このタブの中だけの物)を使う
  q('mem-pass').value = '';
  setDemoPass('pass-from-gate');
  q('mem-code-in').value = '654321';
  q('mem-claim').click();
  await until(() => claims() === before + 2);
  assert.equal(calls.findLast((c) => c.url === '/api/memory/claim').headers['x-demo-pass'], 'pass-from-gate');
  setDemoPass('');
});

test('会話の「わすれて」(印 via: chat)の後に「受け取りました」を残さない。引き出しを開いた時の読み直し(印なし)では消さない', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  q('mem-code-in').value = '123456';
  q('mem-claim').click();
  await until(() => q('mem-status').textContent.startsWith('受け取りました'));
  // main.js の resyncMemory と同じ形(引き出しを開いた時)。知らせはそのまま
  panel.onChatEvent({ type: 'memory', forgotten: true });
  await settle();
  assert.match(q('mem-status').textContent, /^受け取りました/);
  assert.equal(shown(), 1);
  // 会話で「わすれて」(サーバーの forgetReplyEvents が付ける印)
  items = [];
  const before = calls.length;
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(q('mem-status').textContent, '全部わすれました');
  assert.equal(shown(), 0, '知らせと同じ時に一覧も空');
  await settle();
  assert.equal(q('mem-status').textContent, '全部わすれました', '読み直しの後も古い知らせに戻らない');
  assert.deepEqual(calls.slice(before), [], '消えた合鍵を確かめに行かず(404 を出さず)、新しい合鍵も作らない');
  assert.equal(getKey(), '');
  // 何も覚えていなかった時は、知らせを消すだけ
  panel.onChatEvent({ type: 'memory', forgotten: false, via: 'chat' });
  assert.equal(q('mem-status').textContent, '');
});

test('番号を出している間に「全部わすれる」: 番号とのこり時間を消し、時計も止める(1 秒たっても古い知らせが戻らない)', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  assert.match(q('mem-status').textContent, /のこり/);
  q('mem-forget').click();
  q('mem-forget-yes').click(); // 1 回目は聞くだけ。「はい」で消す
  await until(() => q('mem-status').textContent === '全部わすれました');
  assert.equal(q('mem-code').textContent, '');
  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(q('mem-status').textContent, '全部わすれました', 'のこり時間の知らせに戻らない');
  // 会話の「わすれて」でも、出していた番号を消す(覚え直して、番号を出し直してから)
  await adopt(panel, shown);
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(q('mem-code').textContent, '');
  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(q('mem-status').textContent, '全部わすれました');
});

test('「全部わすれる」: 遅い通信でも、知らせが出た時には一覧がもう空。新しい合鍵は作らない', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  slowMs = 80; // 公開の URL のまね(前は、知らせの後の新しい合鍵の通信を待つ間、古い一覧が見えていた)
  const before = calls.length;
  const seen = [];
  q('mem-forget').click();
  q('mem-forget-yes').click(); // 1 回目は聞くだけ。「はい」で消す
  await until(() => {
    if (q('mem-status').textContent === '全部わすれました') seen.push(shown());
    return seen.length > 0;
  });
  assert.deepEqual(seen, [0], '知らせが出た時、一覧は 0 件');
  await settle(slowMs + 50);
  assert.equal(shown(), 0);
  assert.deepEqual(calls.slice(before).map((c) => `${c.method} ${c.url}`), ['DELETE /api/memory'], '消すだけ。合鍵を作り直さない');
  assert.equal(getKey(), '');
});

test('消す前に始めた読み直しが遅れて届いても、消した後の一覧に古い記憶を戻さない', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  slowMs = 80;
  panel.onChatEvent({ type: 'memory', added: [{ id: '3', kind: 'topic', text: '前に話したこと: カレーの話' }] }); // 遅い読み直しが始まる(消す前の 2 件を返す)
  await settle(10);
  panel.onChatEvent({ type: 'memory', forgotten: true, via: 'chat' });
  assert.equal(shown(), 0);
  await settle(slowMs + 50);
  assert.equal(shown(), 0, '遅れて届いた古い一覧で描き直さない');
  assert.equal(q('mem-status').textContent, '全部わすれました');
});

test('引き出しを開いた時の読み直しで、消えていた合鍵(404)は捨てて空の一覧にする(作り直さない)', async () => {
  const { panel, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  gone = true;
  const before = calls.length;
  panel.resync();
  await until(() => shown() === 0);
  assert.equal(getKey(), '');
  assert.deepEqual(calls.slice(before).map((c) => `${c.method} ${c.url}`), ['GET /api/memory']);
});

test('引き出しを開いた時の読み直し用に resync() もある(番号と知らせはそのまま)', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  q('mem-pair').click();
  await until(() => q('mem-code').textContent === '123456');
  const before = calls.length;
  panel.resync();
  await settle();
  assert.ok(calls.length > before, '一覧を読み直す');
  assert.equal(q('mem-code').textContent, '123456');
  q('mem-forget').click();
  q('mem-forget-yes').click(); // 1 回目は聞くだけ。「はい」で消す // 時計を止めて終わる
  await until(() => q('mem-code').textContent === '');
});

test('全部わすれた後に新しく覚えたら、「全部わすれました」を消す(覚えているのに残らない。QA2)。何も覚えていない間は残る', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  q('mem-forget').click();
  q('mem-forget-yes').click(); // 1 回目は聞くだけ。「はい」で消す
  await until(() => q('mem-status').textContent === '全部わすれました');
  await settle();
  assert.equal(q('mem-status').textContent, '全部わすれました', '空の間は、そのまま');
  await adopt(panel, shown, [{ id: '9', kind: 'name', text: '名前: じろう' }]);
  assert.equal(q('mem-status').textContent, '', '覚え直したら消える');
});

test('「全部わすれる」は 1 回押しただけでは消さない。確かめ(はい・やめる)が出て、「やめる」で何も起きない・「はい」で消える(QA8 #8)', async () => {
  const { panel, q, shown } = mount();
  await panel.ready;
  await adopt(panel, shown);
  const before = calls.length;
  q('mem-forget').click();
  const ask = q('mem-forget-ask');
  assert.equal(ask.hidden, false, '確かめが出る');
  assert.equal(q('mem-forget').hidden, true, '元のボタンは確かめの間は隠れる');
  assert.match(q('mem-forget-ask-text').textContent, /ほんとうに ぜんぶ わすれる/);
  assert.match(q('mem-forget-ask-text').textContent, /もどせない/, '戻せないことを言う');
  await settle();
  assert.equal(shown(), 2, '押しただけでは消えない');
  assert.ok(!calls.slice(before).some((c) => c.method === 'DELETE'), '消す通信もしない');
  q('mem-forget-no').click();
  assert.equal(ask.hidden, true);
  assert.equal(q('mem-forget').hidden, false, '「やめる」で元に戻る');
  await settle();
  assert.equal(shown(), 2, 'やめたら、そのまま');
  q('mem-forget').click();
  q('mem-forget-yes').click();
  await until(() => q('mem-status').textContent === '全部わすれました');
  assert.equal(shown(), 0);
  assert.equal(ask.hidden, true, '「はい」の後は確かめを閉じる');
});

test('結果の文(status)は、ボタンの下ではなく上(一覧の前)に置く。出すたびに見える所へ巻く(下に隠れて、何も起きないように見えない。QA8 #8)', async () => {
  const { panel, q } = mount();
  await panel.ready;
  const order = panel.root.children.map((c) => String(c.className));
  assert.ok(order.indexOf('mem-status') > -1 && order.indexOf('mem-status') < order.indexOf('mem-list'), `status は一覧より前: ${order}`);
  let scrolled = 0;
  q('mem-status').scrollIntoView = () => (scrolled += 1);
  q('mem-forget').click();
  q('mem-forget-yes').click();
  await until(() => q('mem-status').textContent === '全部わすれました');
  assert.ok(scrolled >= 1, '文を出したら、見える所へ巻く');
});
