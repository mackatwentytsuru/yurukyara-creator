// 記憶の札の QR と、QR で開いた端末の確かめ(本人の案 11/7 18:0x)。ブラウザは使わず、小さな偽の DOM と偽の通信で確かめる。
// - この部品を読んだ時に、アドレスの # の番号を読み、すぐに history.replaceState で消す(札を付ける前)
// - 札を付けると「パソコンの つづきを はじめる?」の窓を 1 回だけ出す。「はじめる」は、番号を打った時と同じ受け取り(/api/memory/claim)
// - 切れた・違う番号(400)・間違いの続き(429)・形の違う # は、やさしい言葉と「とじる」だけ。合言葉が要る時(403)は欄を出す
// - PC: 番号を出すと、番号の横に QR。中身は origin + pathname + '#pair=' + 番号だけで、絵は S5 の encodeQr のマスそのまま。切れたら消える
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
    this.hidden = false;
    this.style = {};
    this.parent = null;
    if (this.tagName === 'CANVAS') {
      const ops = [];
      this.ops = ops;
      this.getContext = (kind) =>
        kind === '2d'
          ? {
              fillStyle: '#000',
              fillRect(x, y, w, h) {
                ops.push({ fill: this.fillStyle, x, y, w, h });
              },
            }
          : null;
    }
    if (this.tagName === 'DIALOG') {
      this.open = false;
      this.showModal = () => {
        this.open = true;
        this.modal = true;
      };
      this.close = () => {
        this.open = false;
        for (const fn of this.listeners.close ?? []) fn();
      };
    }
  }
  append(...nodes) {
    for (const n of nodes.filter((x) => x && typeof x === 'object')) {
      n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  click() {
    if (this.disabled) return;
    for (const fn of this.listeners.click ?? []) fn();
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  scrollIntoView() {
    this.scrolled = (this.scrolled ?? 0) + 1;
  }
  find(cls) {
    if (String(this.className).split(/\s+/).includes(cls)) return this;
    for (const c of this.children) {
      const hit = c.find?.(cls);
      if (hit) return hit;
    }
    return null;
  }
  text() {
    return [this.textContent, ...this.children.map((c) => c.text?.() ?? '')].join('');
  }
}

// 偽の窓: QR で開いたアドレス(# に番号)。replaceState で本当に # が消えるまでまねる
const replaced = [];
globalThis.location = { origin: 'https://yuru.test', pathname: '/app/', search: '?look=2d', hash: '#pair=246810', hostname: 'yuru.test' };
globalThis.history = {
  state: null,
  replaceState(state, title, url) {
    replaced.push(url);
    const u = new URL(url, 'https://yuru.test/');
    Object.assign(globalThis.location, { pathname: u.pathname, search: u.search, hash: u.hash });
  },
};
const body = new FakeEl('body');
globalThis.document = { createElement: (tag) => new FakeEl(tag), body, activeElement: null };

const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);
const calls = [];
let claimReply = () => ({ status: 200, data: { key: KEY_B, items: [{ id: '1', kind: 'name', text: '名前: タロウ' }], notice: '7 日で消えます' } });
let pairExpiresMs = 600_000;
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  calls.push({ url: String(url), method, headers: { ...(init.headers ?? {}) }, body: init.body ?? null });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url === '/api/memory' && method === 'GET') return json({ items: [{ id: '1', kind: 'name', text: '名前: タロウ' }], notice: '7 日で消えます' });
  if (url === '/api/memory' && method === 'DELETE') return json({ ok: true, forgotten: true });
  if (url === '/api/memory/claim') {
    const r = claimReply(init);
    return json(r.data, r.status);
  }
  if (url === '/api/memory/pair') return json({ code: '123456', ttlSec: 600, expiresAt: new Date(Date.now() + pairExpiresMs).toISOString() });
  return json({ error: 'なし' }, 404);
};

// 読んだ時(札を付ける前)に、# が消えている
const { mountMemoryPanel, takeLinkedPair } = await import('../src/ui/memoryPanel.js');
const { adoptKey, clearKey, getKey } = await import('../src/ui/memoryKey.js');
const { getDemoPass, setDemoPass } = await import('../src/conversation/demoPass.js');
const { PAIR_TEXT } = await import('../src/conversation/pairLink.js');
const { encodeQr } = await import('../src/stage/qrCode.js');

const until = async (ok, ms = 4000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('待ちきれませんでした');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const reset = () => {
  calls.length = 0;
  clearKey();
  setDemoPass('');
  body.children = [];
};
const dialogs = () => body.children.filter((c) => c.tagName === 'DIALOG');
const claims = () => calls.filter((c) => c.url === '/api/memory/claim');

test('読み込んだすぐ後に、アドレスの # の番号を消す(札を付ける前・? はそのまま・1 回だけ)', () => {
  assert.deepEqual(replaced, ['/app/?look=2d']);
  assert.equal(globalThis.location.hash, '');
  assert.equal(globalThis.location.search, '?look=2d');
  assert.equal(calls.length, 0, '読んだだけでは通信しない');
});

test('札を付けると「パソコンの つづきを はじめる?」を 1 回だけ出す。「はじめる」は番号を打った時と同じ受け取り', async () => {
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent);
  await panel.ready;
  const dlg = panel.ask;
  assert.ok(dlg, '窓が出る');
  assert.deepEqual(dialogs(), [dlg], 'document.body に 1 つ');
  assert.equal(dlg.modal, true, 'showModal(ほかの物の上に出る)');
  assert.equal(dlg.find('mem-pair-title').textContent, 'パソコンの つづきを はじめる?');
  assert.equal(dlg.find('mem-pair-yes').textContent, 'はじめる');
  assert.equal(dlg.find('mem-pair-no').textContent, 'やめる');
  assert.equal(dlg.find('mem-pair-yes').style.minHeight, '64px', '大きなボタン');
  assert.equal(dlg.find('mem-pair-no').style.minHeight, '64px');
  assert.equal(document.activeElement, dlg.find('mem-pair-yes'));
  assert.ok(!JSON.stringify(dlg.dataset).includes('246810') && !dlg.text().includes('246810'), '番号は窓に書かない');
  assert.equal(claims().length, 0, '押すまで受け取らない');
  // 2 つ目の札(付け直し)では、もう聞かない
  assert.equal(takeLinkedPair(), null);
  assert.equal(mountMemoryPanel(new FakeEl('div')).ask, null);

  dlg.find('mem-pair-yes').click();
  await until(() => dlg.dataset.state === 'done');
  assert.equal(claims().length, 1);
  assert.deepEqual(JSON.parse(claims()[0].body), { code: '246810' }, '打った時と同じ本文');
  assert.equal(getKey(), KEY_B, '合鍵を受け取った');
  assert.equal(parent.find('mem-status').textContent, '受け取りました。前の端末の続きから話せます', '札の知らせも、打った時と同じ');
  assert.match(parent.find('mem-list').text(), /名前: タロウ/);
  assert.equal(dlg.find('mem-pair-msg').textContent, PAIR_TEXT.done);
  assert.equal(dlg.find('mem-pair-yes').hidden, true, '済んだら「はじめる」は隠す');
  assert.equal(dlg.find('mem-pair-no').textContent, 'とじる');
  dlg.find('mem-pair-no').click();
  assert.deepEqual(dialogs(), [], '「とじる」で窓を外す');
});

test('切れた・違う・使った番号(400): やさしい言葉と「とじる」だけ(もう一度は受け取りに行かない)', async () => {
  reset();
  claimReply = () => ({ status: 400, data: { error: '番号が違うか、切れています', reason: 'bad_code' } });
  const panel = mountMemoryPanel(new FakeEl('div'), { linked: { code: '111111' } });
  panel.ask.find('mem-pair-yes').click();
  await until(() => panel.ask.dataset.state === 'gone');
  const msg = panel.ask.find('mem-pair-msg').textContent;
  assert.equal(msg, PAIR_TEXT.gone);
  assert.match(msg, /じかんぎれ/);
  assert.equal(panel.ask.find('mem-pair-yes').hidden, true);
  assert.equal(panel.ask.find('mem-pair-no').textContent, 'とじる');
  assert.equal(getKey(), '', '合鍵は無いまま');
  assert.equal(claims().length, 1);
});

test('# の番号の形が違う時: 通信せずに、切れた時と同じ言葉と「とじる」', async () => {
  reset();
  const panel = mountMemoryPanel(new FakeEl('div'), { linked: { code: '', bad: true } });
  await panel.ready;
  assert.equal(panel.ask.dataset.state, 'gone');
  assert.equal(panel.ask.find('mem-pair-msg').textContent, PAIR_TEXT.gone);
  assert.equal(panel.ask.find('mem-pair-yes').hidden, true);
  assert.equal(claims().length, 0);
});

test('間違いが続いた(429): 「すこし まってから」と「とじる」', async () => {
  reset();
  claimReply = () => ({ status: 429, data: { error: '止めています', reason: 'locked' } });
  const panel = mountMemoryPanel(new FakeEl('div'), { linked: { code: '222222' } });
  panel.ask.find('mem-pair-yes').click();
  await until(() => panel.ask.dataset.state === 'gone');
  assert.equal(panel.ask.find('mem-pair-msg').textContent, PAIR_TEXT.wait);
});

test('公開の URL で合言葉が要る(403): 窓に合言葉の欄を出し、入れて「はじめる」で受け取る(合った合言葉は会話にも使う)', async () => {
  reset();
  claimReply = (init) => (init.headers?.['x-demo-pass'] === 'aikotoba' ? { status: 200, data: { key: KEY_B, items: [], notice: '7 日で消えます' } } : { status: 403, data: { error: '合言葉が違うので、番号は受け取れません', reason: 'no_pass' } });
  const panel = mountMemoryPanel(new FakeEl('div'), { linked: { code: '333333' } });
  const dlg = panel.ask;
  assert.equal(dlg.find('mem-pair-pass').hidden, true, '初めは欄を出さない');
  dlg.find('mem-pair-yes').click();
  await until(() => dlg.dataset.state === 'pass');
  assert.equal(dlg.find('mem-pair-msg').textContent, PAIR_TEXT.pass);
  assert.equal(dlg.find('mem-pair-pass').hidden, false);
  assert.equal(dlg.find('mem-pair-yes').hidden, false, 'もう一度押せる');
  assert.equal(document.activeElement, dlg.find('mem-pair-pass'));
  dlg.find('mem-pair-pass').value = ' aikotoba ';
  dlg.find('mem-pair-yes').click();
  await until(() => dlg.dataset.state === 'done');
  assert.equal(claims().at(-1).headers['x-demo-pass'], 'aikotoba');
  assert.deepEqual(JSON.parse(claims().at(-1).body), { code: '333333' });
  assert.equal(getDemoPass(), 'aikotoba', '会話の合言葉にも入れた');
  assert.equal(getKey(), KEY_B);
});

test('つながらない(503): もう一度押せる。「やめる」で受け取らずに閉じる', async () => {
  reset();
  claimReply = () => ({ status: 503, data: { error: '置き場につながりません', reason: 'store' } });
  const panel = mountMemoryPanel(new FakeEl('div'), { linked: { code: '444444' } });
  panel.ask.find('mem-pair-yes').click();
  await until(() => panel.ask.dataset.state === 'retry');
  assert.equal(panel.ask.find('mem-pair-msg').textContent, PAIR_TEXT.fail);
  assert.equal(panel.ask.find('mem-pair-yes').hidden, false);
  const n = claims().length;
  panel.ask.find('mem-pair-no').click();
  assert.deepEqual(dialogs(), []);
  assert.equal(claims().length, n, '「やめる」は受け取らない');
  // 「やめる」だけの窓
  const other = mountMemoryPanel(new FakeEl('div'), { linked: { code: '555555' } });
  other.ask.find('mem-pair-no').click();
  assert.deepEqual(dialogs(), []);
  assert.equal(claims().length, n);
});

/** canvas に描いた暗いマスを、マスの並びに戻す */
function drawnMatrix(canvas) {
  const margin = Number(canvas.dataset.margin);
  const size = Number(canvas.dataset.modules);
  const px = canvas.width / (size + margin * 2);
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  for (const op of canvas.ops.filter((o) => o.fill === '#000')) m[op.y / px - margin][op.x / px - margin] = 1;
  return { m, px, white: canvas.ops[0] };
}

test('PC: 番号の横に QR。中身は origin + pathname + #pair= + 番号だけで、絵は encodeQr のマスそのまま', async () => {
  reset();
  Object.assign(globalThis.location, { origin: 'https://yuru.test', pathname: '/app/', search: '?askpass=1&memory=1', hash: '', hostname: 'yuru.test' });
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { linked: null });
  await panel.ready;
  assert.equal(panel.ask, null, 'QR で開いていない時は聞かない');
  const box = parent.find('mem-qr');
  assert.equal(box.hidden, true, '番号を出す前は QR も無い');
  adoptKey(KEY_A);
  parent.find('mem-pair').click();
  await until(() => box.hidden === false);
  assert.equal(parent.find('mem-code').textContent, '123456');
  const want = 'https://yuru.test/app/#pair=123456';
  assert.equal(box.dataset.qrText, want, 'origin + pathname + #pair= + 番号(? の合言葉の指定などは入れない)');
  const pic = box.find('mem-qr-pic');
  assert.ok(pic, 'canvas の絵');
  assert.equal(pic.ariaLabel, PAIR_TEXT.qrLabel);
  const { m, px, white } = drawnMatrix(pic);
  assert.deepEqual(m, encodeQr(want).matrix, '描いたマスが S5 の encodeQr と同じ');
  assert.deepEqual([white.fill, white.x, white.y, white.w], ['#fff', 0, 0, pic.width], '白い地と縁');
  assert.equal(pic.style.width, `${(encodeQr(want).size + 8) * 4}px`);
  assert.ok(px >= 4);
  assert.equal(box.find('mem-qr-local'), null, '公開の場所では、この PC の中の知らせを出さない');
  await until(() => /QR を読み取ってね/.test(parent.find('mem-status').textContent)); // QR が出たら、すぐに知らせも替わる
  assert.match(parent.find('mem-status').textContent, /1 回だけ/);
  assert.ok(box.scrolled >= 1, '引き出しの中で QR が見える所まで送る');
  // 全部わすれると、番号と一緒に QR も消える
  parent.find('mem-forget').click();
  await until(() => box.hidden === true);
  assert.equal(box.dataset.qrText, undefined);
  assert.equal(box.children.length, 0);
  assert.equal(parent.find('mem-code').textContent, '');
});

test('PC: 番号の時間が切れたら QR も消える。この PC の中のアドレスでは、スマホで開けない知らせを足す', async () => {
  reset();
  Object.assign(globalThis.location, { origin: 'http://127.0.0.1:8787', pathname: '/', search: '', hash: '', hostname: '127.0.0.1' });
  pairExpiresMs = 1200;
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { linked: null });
  await panel.ready;
  adoptKey(KEY_A);
  parent.find('mem-pair').click();
  const box = parent.find('mem-qr');
  await until(() => box.hidden === false);
  assert.equal(box.dataset.qrText, 'http://127.0.0.1:8787/#pair=123456');
  assert.equal(box.find('mem-qr-local').textContent, PAIR_TEXT.qrLoopback);
  await until(() => box.hidden === true, 4000);
  assert.equal(parent.find('mem-code').textContent, '');
  assert.equal(parent.find('mem-status').textContent, '番号の時間が切れました。もう一度出してね');
  pairExpiresMs = 600_000;
});

test('PC: QR の部品を読めない・描けない時は、番号だけ(今までどおり)', async () => {
  reset();
  Object.assign(globalThis.location, { origin: 'https://yuru.test', pathname: '/', search: '', hash: '', hostname: 'yuru.test' });
  const parent = new FakeEl('div');
  const panel = mountMemoryPanel(parent, { linked: null, loadQr: () => Promise.reject(new Error('読めない')) });
  await panel.ready;
  adoptKey(KEY_A);
  parent.find('mem-pair').click();
  await until(() => parent.find('mem-code').textContent === '123456');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(parent.find('mem-qr').hidden, true);
  assert.match(parent.find('mem-status').textContent, /この番号を入れてね/);
  assert.doesNotMatch(parent.find('mem-status').textContent, /QR/);
  parent.find('mem-forget').click(); // のこり時間の数え(10 分)を止める
  await until(() => parent.find('mem-code').textContent === '');
});
