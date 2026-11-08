// 「かえる」の中の「つくった子」(ui/madeKids.js)の動き。ブラウザは使わず、小さな偽の DOM と偽のサーバーで確かめる。
// - 作った子が 1 人もいなければ、組ごと出さない。いれば「つくった子」の見出しと、いつもの子(ノリー)の次に並ぶ
// - 選ぶと舞台がその子になる(できなかった時は理由を言う)
// - なまえを かえる: サーバーに送り、一覧と呼び出し側に反映する。空・サーバーの断りは、知らせて変えない
// - けす: 「けす?」と 1 回だけ確かめてから消す(1 回目のボタンでは消えない)。舞台にいる子は、先に主役へ。記憶と性格の設定も消す
// - 読み直し: 別の端末で増えた子も出る。サーバーが一覧を持たない(404)時は空
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.attrs = {};
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
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
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  click() {
    if (this.disabled) return;
    for (const fn of this.listeners.click ?? []) fn({});
  }
  key(k) {
    for (const fn of this.listeners.keydown ?? []) fn({ key: k, preventDefault() {}, stopPropagation() {} });
  }
  all(cls, out = []) {
    if (String(this.className).split(/\s+/).includes(cls)) out.push(this);
    for (const c of this.children) c.all?.(cls, out);
    return out;
  }
  find(cls) {
    return this.all(cls)[0] ?? null;
  }
  text() {
    return `${this.textContent}${this.children.map((c) => c.text?.() ?? '').join('')}`;
  }
}
const fakeDoc = { createElement: (tag) => new FakeEl(tag) };

const KEY = 'K'.repeat(43);
let server; // 偽のサーバーの状態
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method, body, headers: { ...(init.headers ?? {}) } });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url === '/api/characters' && method === 'GET') return server.noList ? json({ error: 'なし' }, 404) : json({ items: [...server.items].sort((a, b) => b.at - a.at) });
  if (url === '/api/characters' && method === 'PATCH') {
    if (server.refuse) return json({ error: 'この設定では、名前を変えたり消したりできません' }, 403);
    const it = server.items.find((x) => x.id === body.id);
    if (!it) return json({ error: 'その子は見つかりません' }, 404);
    it.name = body.name;
    return json({ ok: true, id: body.id, name: body.name });
  }
  if (url === '/api/characters' && method === 'DELETE') {
    if (server.refuse) return json({ error: 'だめ' }, 403);
    const n = server.items.length;
    server.items = server.items.filter((x) => x.id !== body.id);
    return n === server.items.length ? json({ error: 'なし' }, 404) : json({ ok: true, removed: true });
  }
  if (url === '/api/memory' && method === 'DELETE') return json({ ok: true, forgotten: true, scoped: true });
  return json({ error: 'なし' }, 404);
};

const { mountMadeKids, GROUP_LABEL, TEXT, cleanName, formatMade } = await import('../src/ui/madeKids.js');
const { setKey, clearKey } = await import('../src/ui/memoryKey.js');
const { STORE_PREFIX } = await import('../src/ui/persona/settings.js');
const { MAIN_CHARACTER } = await import('../src/character/defaults.js');

const A = { id: 'yb261108_aaaaaa', name: 'あたらしい子', at: Date.parse('2026-11-08T10:00:00+09:00'), look: '2d' };
const B = { id: 'yb261108_bbbbbb', name: 'ももちゃん', at: Date.parse('2026-11-08T14:25:00+09:00'), look: '2d' };

const until = async (ok, ms = 2000) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('待ちきれませんでした');
    await new Promise((r) => setTimeout(r, 5));
  }
};

function setup({ items = [A, B], stage = MAIN_CHARACTER.id, putOk = true } = {}) {
  server = { items: items.map((x) => ({ ...x })), noList: false, refuse: false };
  calls.length = 0;
  clearKey();
  const state = { stage, picked: [], renamed: [], removed: [], put: [] };
  const store = new Map([[`${STORE_PREFIX}${A.id}`, '{"x":1}'], [`${STORE_PREFIX}${B.id}`, '{"x":2}']]);
  const root = new FakeEl('section');
  const kids = mountMadeKids({
    root,
    doc: fakeDoc,
    getStageId: () => state.stage,
    putOnStage: async (id) => {
      state.put.push(id);
      if (putOk) state.stage = id;
      return putOk;
    },
    onPicked: (id) => state.picked.push(id),
    onRenamed: (id, name) => state.renamed.push([id, name]),
    onRemoved: (id) => state.removed.push(id),
    storage: { removeItem: (k) => store.delete(k) },
  });
  const names = () => root.all('mk-kid').map((li) => li.find('mk-name')?.textContent ?? li.find('mk-pick')?.textContent);
  const kid = (id) => root.all('mk-kid').find((li) => li.dataset.id === id);
  return { root, kids, state, store, names, kid };
}

test('作った子が 1 人もいなければ、組は出ない。いれば見出し「つくった子」と、ノリーの次に新しい順で並ぶ', async () => {
  const none = setup({ items: [] });
  await none.kids.refresh();
  assert.equal(none.root.hidden, true);
  const t = setup({ items: [B, A] });
  assert.equal(t.root.hidden, true, '読む前は出ない');
  await t.kids.refresh();
  assert.equal(t.root.hidden, false);
  assert.equal(t.root.find('mk-title').textContent, GROUP_LABEL);
  assert.equal(GROUP_LABEL, 'つくった子');
  assert.deepEqual(t.names(), ['ノリー', 'ももちゃん', 'あたらしい子']);
  assert.match(t.kid(B.id).find('mk-date').textContent, /^11\/8 14:25$/, '同じ名前の子を見分ける作った時刻');
  assert.equal(t.kid(B.id).find('mk-thumb').src, `/characters/${B.id}/2d/body.svg`, '小さな絵');
});

test('いまの子には印が付く(舞台の子が替わったら sync で付け直す)', async () => {
  const t = setup({ stage: B.id });
  await t.kids.refresh();
  assert.equal(t.kid(B.id).dataset.now, '1');
  assert.equal(t.kid(B.id).find('mk-pick').attrs['aria-pressed'], 'true');
  assert.equal(t.kid(A.id).dataset.now, '0');
  assert.equal(t.kid(MAIN_CHARACTER.id).dataset.now, '0');
  t.state.stage = MAIN_CHARACTER.id;
  t.kids.sync();
  assert.equal(t.kid(MAIN_CHARACTER.id).dataset.now, '1');
  assert.equal(t.kid(B.id).dataset.now, '0');
});

test('選ぶ: 舞台をその子にして、段を閉じる。いまの子を押しても、替えずに閉じるだけ。できなかった時は理由', async () => {
  const t = setup();
  await t.kids.refresh();
  t.kid(A.id).find('mk-pick').click();
  await until(() => t.state.picked.length === 1);
  assert.deepEqual(t.state.put, [A.id]);
  assert.deepEqual(t.state.picked, [A.id]);
  assert.equal(t.kid(A.id).dataset.now, '1');
  t.kid(A.id).find('mk-pick').click(); // いまの子
  assert.deepEqual(t.state.put, [A.id], '同じ子には、舞台を替えにいかない');
  t.kid(MAIN_CHARACTER.id).find('mk-pick').click();
  await until(() => t.state.picked.length === 3);
  assert.equal(t.state.stage, MAIN_CHARACTER.id, 'ノリーにも戻れる');
  const fail = setup({ putOk: false });
  await fail.kids.refresh();
  fail.kid(B.id).find('mk-pick').click();
  await until(() => fail.root.find('mk-note').textContent !== '');
  assert.match(fail.root.find('mk-note').textContent, /ももちゃん.*舞台に 出せないよ/);
  assert.deepEqual(fail.state.picked, [], '出せなかった時は、段を閉じない');
});

test('なまえを かえる: その場の入力 → きめる。サーバーと一覧と呼び出し側に反映。ノリーには「なまえ」が無い', async () => {
  const t = setup();
  await t.kids.refresh();
  assert.equal(t.kid(MAIN_CHARACTER.id).find('mk-edit'), null, 'ノリーの名前は変えられない');
  t.kid(A.id).find('mk-edit').click();
  const input = t.kid(A.id).find('mk-input');
  assert.equal(input.value, 'あたらしい子');
  assert.equal(input.maxLength, 20);
  input.value = '  タロウ  ';
  t.kid(A.id).find('mk-ok').click();
  await until(() => t.state.renamed.length === 1);
  assert.deepEqual(t.state.renamed, [[A.id, 'タロウ']]);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { id: A.id, name: 'タロウ' });
  assert.deepEqual(t.names(), ['ノリー', 'ももちゃん', 'タロウ']);
  assert.equal(t.kid(A.id).find('mk-input'), null, '入力は閉じる');
  assert.equal(server.items.find((x) => x.id === A.id).name, 'タロウ', 'サーバーに残る');
  await t.kids.refresh();
  assert.deepEqual(t.names(), ['ノリー', 'ももちゃん', 'タロウ'], '読み直しても同じ');
});

test('なまえを かえる: Enter で決める・Escape でやめる・空は知らせるだけ・サーバーが断ったら理由を出して変えない', async () => {
  const t = setup();
  await t.kids.refresh();
  t.kid(B.id).find('mk-edit').click();
  t.kid(B.id).find('mk-input').value = 'ハナ';
  t.kid(B.id).find('mk-input').key('Enter');
  await until(() => t.state.renamed.length === 1);
  assert.deepEqual(t.state.renamed[0], [B.id, 'ハナ']);
  // Escape
  t.kid(B.id).find('mk-edit').click();
  t.kid(B.id).find('mk-input').key('Escape');
  assert.equal(t.kid(B.id).find('mk-input'), null);
  // 空
  const before = calls.length;
  t.kid(B.id).find('mk-edit').click();
  t.kid(B.id).find('mk-input').value = '   ';
  t.kid(B.id).find('mk-ok').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.root.find('mk-note').textContent, TEXT.nameEmpty);
  assert.equal(calls.length, before, '空の名前は、サーバーに送らない');
  // サーバーが断る
  server.refuse = true;
  t.kid(B.id).find('mk-input').value = 'ミミ';
  t.kid(B.id).find('mk-ok').click();
  await until(() => /変えたり消したり/.test(t.root.find('mk-note').textContent));
  assert.equal(t.state.renamed.length, 1, '断られたら、呼び出し側には知らせない');
  assert.equal(server.items.find((x) => x.id === B.id).name, 'ハナ', '断られたら、名前は変わらない');
});

test('けす: 1 回目のボタンでは消えない。「けす?」と 1 回だけ確かめて、「けす」で消える。やめるで戻る', async () => {
  const t = setup();
  await t.kids.refresh();
  t.kid(A.id).find('mk-del').click();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, '1 回目では、何も消えない');
  assert.match(t.kid(A.id).find('mk-ask').textContent, /あたらしい子を けす\?/);
  t.kid(A.id).find('mk-cancel').click();
  assert.ok(t.kid(A.id).find('mk-pick'), 'やめる: 元に戻る');
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  t.kid(A.id).find('mk-del').click();
  t.kid(A.id).find('mk-sure').click();
  await until(() => t.state.removed.length === 1);
  assert.deepEqual(t.state.removed, [A.id]);
  assert.deepEqual(t.names(), ['ノリー', 'ももちゃん']);
  assert.equal(server.items.some((x) => x.id === A.id), false, 'サーバーから消える');
  assert.equal(t.store.has(`${STORE_PREFIX}${A.id}`), false, 'その子の性格の設定も消える');
  assert.equal(t.store.has(`${STORE_PREFIX}${B.id}`), true, 'ほかの子の設定は残る');
});

test('けす: その子が覚えた記憶も(その子の id を付けて)消す。合鍵が無ければ記憶には触れない', async () => {
  const t = setup();
  setKey(KEY);
  await t.kids.refresh();
  t.kid(B.id).find('mk-del').click();
  t.kid(B.id).find('mk-sure').click();
  await until(() => t.state.removed.length === 1);
  const mem = calls.find((c) => c.url === '/api/memory' && c.method === 'DELETE');
  assert.ok(mem, '記憶を消しにいく');
  assert.equal(mem.headers['x-yc-character'], B.id, 'その子の分だけ');
  assert.equal(mem.headers['x-memory-key'], KEY);
  assert.deepEqual(mem.body, {});
  const noKey = setup();
  await noKey.kids.refresh();
  noKey.kid(B.id).find('mk-del').click();
  noKey.kid(B.id).find('mk-sure').click();
  await until(() => noKey.state.removed.length === 1);
  assert.equal(calls.some((c) => c.url === '/api/memory'), false, '合鍵が無ければ、記憶の通信はしない');
  clearKey();
});

test('けす: 子を先に消し、記憶はその後に消す。子を消すのが断られた時は、記憶に触れない', async () => {
  const t = setup();
  setKey(KEY);
  await t.kids.refresh();
  t.kid(B.id).find('mk-del').click();
  t.kid(B.id).find('mk-sure').click();
  await until(() => t.state.removed.length === 1);
  const order = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
  assert.deepEqual(order, ['/api/characters', '/api/memory'], '子が先、記憶が後');
  const refused = setup();
  server.refuse = true;
  setKey(KEY);
  await refused.kids.refresh();
  refused.kid(B.id).find('mk-del').click();
  refused.kid(B.id).find('mk-sure').click();
  await until(() => refused.root.find('mk-note').textContent !== '');
  assert.equal(calls.some((c) => c.url === '/api/memory' && c.method === 'DELETE'), false, '断られたら、記憶は消さない');
  assert.deepEqual(refused.state.removed, []);
  clearKey();
});
test('けす: 舞台にいる子を消す時は、先に主役に戻す。戻せなければ消さない', async () => {
  const t = setup({ stage: B.id });
  await t.kids.refresh();
  t.kid(B.id).find('mk-del').click();
  t.kid(B.id).find('mk-sure').click();
  await until(() => t.state.removed.length === 1);
  assert.deepEqual(t.state.put, [MAIN_CHARACTER.id], '先にノリーへ');
  assert.equal(t.state.stage, MAIN_CHARACTER.id);
  const stuck = setup({ stage: B.id, putOk: false });
  await stuck.kids.refresh();
  stuck.kid(B.id).find('mk-del').click();
  stuck.kid(B.id).find('mk-sure').click();
  await until(() => stuck.root.find('mk-note').textContent !== '');
  assert.equal(server.items.some((x) => x.id === B.id), true, '主役に戻せなかったら、消さない');
  assert.deepEqual(stuck.state.removed, []);
});

test('読み直し: 別の端末で増えた子が出る。サーバーが一覧を持たない(404)時は空。通信できない時は、いまの表示のまま', async () => {
  const t = setup({ items: [A] });
  await t.kids.refresh();
  assert.deepEqual(t.names(), ['ノリー', 'あたらしい子']);
  server.items.push({ ...B }); // 別の端末で作った
  await t.kids.refresh();
  assert.deepEqual(t.names(), ['ノリー', 'ももちゃん', 'あたらしい子']);
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('つながらない');
  };
  await t.kids.refresh();
  assert.equal(t.names().length, 3, '通信できなくても、消さない');
  globalThis.fetch = real;
  server.noList = true;
  await t.kids.refresh();
  assert.equal(t.root.hidden, true, '一覧を持たないサーバーでは、組を出さない');
});

test('名前を整える決まりは、サーバーと同じ(制御文字・<>"` を外す・20 字まで)。時刻は「月/日 時:分」', () => {
  assert.equal(cleanName('<b>たろう</b>\n"x"'), 'b たろう /b x');
  assert.equal(cleanName('あ'.repeat(30)).length, 20);
  assert.equal(cleanName('   '), '');
  assert.equal(formatMade(0), '');
  assert.equal(formatMade(NaN), '');
  assert.match(formatMade(Date.parse('2026-01-02T03:04:00+09:00')), /^\d{1,2}\/\d{1,2} \d{1,2}:04$/);
});
