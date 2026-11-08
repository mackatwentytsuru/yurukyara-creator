// お店の端末(ML1)と、本文に足す欄・性格の設定の試験。
// 1) createShopDevice: 切り替えで合鍵を捨てる・「いま覚えていることも消す」は捨てる前の鍵のサーバーの記録も消す
// 2) createIdleClear: 3 分だれも操作しないと空にする(お店の端末の時だけ)
// 3) mlBodyFields: 日本語だけ・ふつうの端末・欄が空の時は、本文に何も足さない
// 4) 本文 memory:'off' は、手元のサーバーでも公開の関数でも、合鍵を作らず・読まず・覚えない
// 5) 性格の設定: lang・facts の既定と、personaBlock が日本語だけで今までと同じ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHOP_DEVICE_STORE, SHOP_FORGET_DONE, SHOP_FORGET_NONE, SHOP_IDLE_CLEAR_MS, createIdleClear, createShopDevice } from '../src/conversation/shopDevice.js';
import { mlBodyFields } from '../src/conversation/mlBody.js';
import { langModeOf } from '../src/conversation/lang.js';
import { defaults, normalize, personaBlock, composePersona, loadSettings, saveSettings } from '../src/ui/persona/settings.js';
import { rememberForChat } from '../api/_lib/memoryChat.mjs';
import { streamChat } from '../src/conversation/brainClient.js';
import { clearKey, getKey, setKey } from '../src/ui/memoryKey.js';

const WEB = join(import.meta.dirname, '..');
const KEY_A = 'A'.repeat(43);

const memStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
function fakeMemoryApi(initialKey = '') {
  const s = { key: initialKey, calls: [] };
  return {
    s,
    getKey: () => s.key,
    setKey: (k) => {
      s.calls.push(`set:${k}`);
      s.key = k;
    },
    clearKey: () => {
      s.calls.push('clear');
      s.key = '';
    },
    forgetAll: async () => {
      s.calls.push(`forget:${s.key}`);
      if (s.failForget) throw new Error('通信できません');
      s.key = '';
    },
  };
}

test('お店の端末: 既定はふつう。切り替えると覚える・合鍵を捨てる・知らせる。戻すと保存が消える', () => {
  const storage = memStorage();
  const api = fakeMemoryApi(KEY_A);
  const seen = [];
  const dev = createShopDevice({ storage, memoryApi: api, onChange: (on) => seen.push(on) });
  assert.equal(dev.isOn(), false);
  assert.equal(dev.set(true), true);
  assert.equal(storage.getItem(SHOP_DEVICE_STORE), 'on');
  assert.equal(api.s.key, '', '合鍵を捨てた');
  assert.deepEqual(seen, [true]);
  dev.set(true);
  assert.deepEqual(seen, [true], '同じ値なら知らせない・合鍵も捨て直さない');
  assert.equal(dev.set(false), false);
  assert.equal(storage.getItem(SHOP_DEVICE_STORE), null);
  assert.deepEqual(seen, [true, false]);
  // 別のページで読み直しても、覚えている
  storage.setItem(SHOP_DEVICE_STORE, 'on');
  assert.equal(createShopDevice({ storage, memoryApi: api }).isOn(), true);
});

test('お店の端末: 保存が使えない端末でも止まらない(この画面の間は切り替えが効く)', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const dev = createShopDevice({ storage: broken, memoryApi: fakeMemoryApi() });
  assert.equal(dev.isOn(), false);
  assert.equal(dev.set(true), true);
  assert.equal(dev.isOn(), true);
  assert.equal(createShopDevice({ storage: null, memoryApi: fakeMemoryApi() }).isOn(), false);
});

test('いま覚えていることも消す: 捨てる前の鍵で、サーバーの記録を消す。消す物が無ければ、その知らせ', async () => {
  const api = fakeMemoryApi(KEY_A);
  const dev = createShopDevice({ storage: memStorage(), memoryApi: api });
  dev.set(true);
  const r = await dev.forgetNow();
  assert.equal(r.forgotten, true);
  assert.equal(r.message, SHOP_FORGET_DONE);
  assert.deepEqual(api.s.calls, ['clear', `set:${KEY_A}`, `forget:${KEY_A}`, 'clear'], '鍵を捨てる → 消す時だけ鍵を戻す → 消す → また捨てる');
  assert.equal(api.s.key, '', 'お店の端末に合鍵は残らない');
  const again = await dev.forgetNow();
  assert.equal(again.forgotten, false);
  assert.equal(again.message, SHOP_FORGET_NONE);
});

test('いま覚えていることも消す: 通信が失敗したら投げ、鍵は端末に残さず、もう一度押せば消せる', async () => {
  const api = fakeMemoryApi(KEY_A);
  const dev = createShopDevice({ storage: memStorage(), memoryApi: api });
  dev.set(true);
  api.s.failForget = true;
  await assert.rejects(dev.forgetNow(), /通信できません/);
  assert.equal(api.s.key, '', '失敗しても、この端末に合鍵を残さない');
  api.s.failForget = false;
  const r = await dev.forgetNow();
  assert.equal(r.forgotten, true, '持っていた鍵で、もう一度消せる');
});

test('だれも操作しない 3 分: お店の端末の時だけ、操作が止まってから 1 回、空にする', () => {
  assert.equal(SHOP_IDLE_CLEAR_MS, 180000);
  let on = true;
  let cleared = 0;
  const timers = [];
  const idle = createIdleClear({
    isOn: () => on,
    onClear: () => (cleared += 1),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: (id) => {
      timers[id - 1] = null;
    },
  });
  idle.touch();
  assert.equal(timers.at(-1).ms, 180000);
  idle.touch(); // 操作のたびに数え直す(前の数えは止める)
  assert.equal(timers.filter(Boolean).length, 1);
  timers.at(-1).fn();
  assert.equal(cleared, 1);
  timers.at(-1).fn();
  assert.equal(cleared, 1, '触られていない空の画面を、何度も空にしない');
  // ふつうの端末では動かない
  on = false;
  const before = timers.length;
  idle.touch();
  assert.equal(timers.length, before, 'ふつうの端末では数えない');
  // 数えている間にふつうの端末に戻したら、空にしない
  on = true;
  idle.touch();
  on = false;
  timers.at(-1).fn();
  assert.equal(cleared, 1);
});

test('mlBodyFields: 日本語だけ・ふつうの端末・欄が空なら、何も足さない(本文は今日と同じ)', () => {
  assert.deepEqual(mlBodyFields(), {});
  assert.deepEqual(mlBodyFields({ lang: 'ja', hearLang: 'en', facts: '   ', shopDevice: false, role: 'shop', persona: '- 役目: お店' }), {});
});

test('mlBodyFields: 多言語・聞く言葉・事実・お店の端末', () => {
  assert.deepEqual(mlBodyFields({ lang: 'multi', hearLang: 'ko' }), { lang: 'multi', hearLang: 'ko' });
  assert.deepEqual(mlBodyFields({ lang: 'multi', hearLang: 'xx' }), { lang: 'multi' });
  assert.deepEqual(mlBodyFields({ role: 'shop', facts: '9 時から' }), { facts: '9 時から' });
  assert.deepEqual(mlBodyFields({ role: 'home', facts: '9 時から' }), {}, 'おうちの役目では事実を送らない');
  assert.deepEqual(mlBodyFields({ shopDevice: true }), { memory: 'off' });
  assert.deepEqual(mlBodyFields({ lang: 'ja', persona: '- ことば: 多言語' }), { lang: 'ja' }, '画面で日本語だけを選んだのに persona.md が多言語: 選んだ方を伝える');
  assert.deepEqual(mlBodyFields({ lang: 'multi', persona: '- ことば: 多言語' }), { lang: 'multi', hearLang: 'ja' }, '聞く言葉の選びの値は、多言語の時だけ付く');
});

test('性格の設定: ことばの既定は日本語だけ。事実は空なら欄ごと無い。知らない値は直す', () => {
  const d = defaults();
  assert.equal(d.lang, 'ja');
  assert.equal(Object.hasOwn(normalize({}), 'facts'), false);
  assert.equal(normalize({ lang: 'multi' }).lang, 'multi');
  assert.equal(normalize({ lang: '多言語' }).lang, 'multi');
  assert.equal(normalize({ lang: 'xx' }).lang, 'ja');
  assert.equal(normalize({ lang: 5 }).lang, 'ja');
  assert.equal(Object.hasOwn(normalize({ facts: '   \n  ' }), 'facts'), false);
  assert.equal(normalize({ facts: '9 時から\n水曜は休み' }).facts, '9 時から\n水曜は休み');
  assert.equal(Array.from(normalize({ facts: 'あ'.repeat(1500) }).facts).length, 1000, '画面の欄は 1000 字まで');
  // 覚えた設定の読み書き(古い保存に lang が無くても読める)
  const store = memStorage();
  assert.equal(loadSettings(store, 'x'), null);
  assert.equal(saveSettings(store, 'x', { ...defaults(), lang: 'multi', facts: '休みは水曜日' }), true);
  const back = loadSettings(store, 'x');
  assert.equal(back.lang, 'multi');
  assert.equal(back.facts, '休みは水曜日');
  store.setItem('yc.persona.v2.old', JSON.stringify({ v: 2, preset: 'genki', tone: 'polite' }));
  assert.equal(loadSettings(store, 'old').lang, 'ja');
});

test('personaBlock: 日本語だけでは今までと同じ(「ことば」の行も事実も足さない)。多言語の時だけ 1 行足す', () => {
  const ja = personaBlock(defaults());
  assert.equal(
    ja,
    [
      '# 性格と話し方(使う人が画面で選んだ設定。上の人格の文と違うときは、こちらを使う)',
      '- 性格: おっとり。のんびり、やわらかく話す。あわてず、ゆっくり考えてから答える。',
      '- 口調: フレンドリー。「〜だよ」「〜だね」と、友だちのように話す。',
      '- 元気さ: 5 段階の 2(ひかえめ)。1 はとても静か、5 はとても元気。',
      '- 返事の長さ: ふつう(2〜3 文)。',
      '- 役目: おうち',
    ].join('\n'),
  );
  assert.equal(personaBlock({ ...defaults(), facts: '9 時から' }), ja, '事実は人格の文に入れない(本文の facts で渡す)');
  const multi = personaBlock({ ...defaults(), lang: 'multi' });
  assert.equal(multi, `${ja}\n- ことば: 多言語(使う人の言葉に合わせて、日本語・English・中文・한국어で話す)`);
  assert.equal(langModeOf({ persona: composePersona('- 話し方: やさしく', { ...defaults(), lang: 'multi' }) }), 'multi');
  // 画面の設定が日本語だけでも、節に「ことば」の行が無いので、persona.md の行が読まれる。打ち消すのは本文の lang: 'ja'(mlBodyFields)
  assert.equal(langModeOf({ persona: composePersona('- ことば: 多言語', { ...defaults(), lang: 'ja' }) }), 'multi');
  assert.equal(langModeOf({ settings: { lang: 'ja' }, persona: composePersona('- ことば: 多言語', { ...defaults(), lang: 'ja' }) }), 'ja', '画面の設定がいちばん強い');
});

test('公開の関数: rememberForChat は、memoryOff の時、置き場も数えも合鍵づくりも使わない(本文が届く所は api/_test/ml.test.mjs)', async () => {
  const store = new Proxy({}, { get() { throw new Error('置き場を使ってはいけない'); } });
  const withKey = new Request('http://x/api/chat', { method: 'POST', headers: { 'x-memory-key': KEY_A } });
  const none = await rememberForChat(withKey, 'ぼくの名前はタロウ', { cfg: {}, store, memoryOff: true });
  assert.deepEqual(none, { handled: false, events: [], memory: null, learned: [] });
  const noKey = new Request('http://x/api/chat', { method: 'POST' });
  assert.deepEqual(await rememberForChat(noKey, 'ぼくの名前はタロウ', { cfg: {}, store, memoryOff: true }), none, '合鍵なしでも、作らない');
  assert.deepEqual(await rememberForChat(noKey, 'わすれて', { cfg: {}, store, memoryOff: true }), none, '「わすれて」も記憶の道に入らない');
});

test('画面の通信: memory:"off" の本文には、合鍵の見出しを付けない。ふつうの本文には付く', async () => {
  const real = globalThis.fetch;
  const heads = [];
  globalThis.fetch = async (_url, init) => {
    heads.push(init.headers);
    return new Response(JSON.stringify({ events: [], ms: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    setKey(KEY_A);
    await streamChat({ text: 'こんにちは' }, () => {}, undefined);
    await streamChat({ text: 'こんにちは', memory: 'off' }, () => {}, undefined);
    assert.equal(heads[0]['x-memory-key'], KEY_A);
    assert.equal(Object.hasOwn(heads[1], 'x-memory-key'), false);
  } finally {
    globalThis.fetch = real;
    clearKey();
    assert.equal(getKey(), '');
  }
});

// ---- 手元のサーバーを実際に起こして確かめる(仮の頭脳。本物の頭脳は呼ばない) ----
const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('手元のサーバー: memory:"off" では、名前を言っても合鍵を作らず・読まず・覚えない。ふつうの本文は今までどおり覚える', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-shopdev-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory'), ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '' };
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const events = (stream) => stream.split('\n\n').map((b) => b.replace(/^data: /, '')).filter(Boolean).map((l) => JSON.parse(l));
  const chat = async (body, key = '') => {
    const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-memory-key': key } : {}) }, body: JSON.stringify(body) });
    return events(await res.text());
  };
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {
        // まだ立っていない
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // 合鍵なし + お店の端末: 合鍵ができない
    const offNoKey = await chat({ text: 'ぼくはタロウ。カレーが好き。', memory: 'off' });
    assert.equal(offNoKey.some((e) => e.type === 'memory'), false, '合鍵を作らない');
    assert.equal(offNoKey.filter((e) => e.type === 'say').some((e) => /タロウ/.test(e.text)), false, '名前をくり返さない');
    // 合鍵あり + お店の端末: 読まない・覚えない
    const made = await (await fetch(`${base}/api/memory/new`, { method: 'POST' })).json();
    const offWithKey = await chat({ text: 'ぼくはタロウ。カレーが好き。', memory: 'off' }, made.key);
    assert.equal(offWithKey.some((e) => e.type === 'memory'), false, '覚えた知らせが出ない');
    const list1 = await (await fetch(`${base}/api/memory`, { headers: { 'x-memory-key': made.key } })).json();
    assert.deepEqual(list1.items, [], '覚えていない');
    // 同じ合鍵・同じ言葉で、お店の端末でない本文: 覚える(今までどおり)
    const normal = await chat({ text: 'ぼくはタロウ。カレーが好き。' }, made.key);
    assert.equal(normal.some((e) => e.type === 'memory' && Array.isArray(e.added) && e.added.length > 0), true, 'ふつうの端末は覚える');
    const list2 = await (await fetch(`${base}/api/memory`, { headers: { 'x-memory-key': made.key } })).json();
    assert.ok(list2.items.length > 0);
    // お店の端末の次の回: 覚えている物を渡さない(名前を呼ばない)
    const offAfter = await chat({ text: 'こんにちは', memory: 'off' }, made.key);
    assert.equal(offAfter.filter((e) => e.type === 'say').some((e) => /タロウ/.test(e.text)), false, '前の人の名前を出さない');
    // 合鍵なし + ふつうの端末: 覚える事が出た回に合鍵ができる(今までどおり)
    const fresh = await chat({ text: 'わたしはハナ。いちごが好き。' });
    assert.equal(fresh.some((e) => e.type === 'memory' && typeof e.key === 'string'), true);
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
