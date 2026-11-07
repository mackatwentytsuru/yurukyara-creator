// UW3(11-08): 話す流れの UI レビューの直し。偽の頭脳(仮の頭脳)だけで確かめる。本物の頭脳・本物の声は呼ばない。
// - UIR 13: 覚えること・覚えないことを子どもの言葉で言う / 名前と年を自然な言い方で覚える / 画面に「新しく覚えた」を知らせる
// - UIR 19: 住所・電話・学校の名前などは「書かないでね」と言い、覚えず、履歴にも残さない
// - UIR 7: AI かと聞かれたら、子どもの言葉で正直に答える
// - UIR 12: 仮の頭脳の返事が決まった 1 文でなく、本物のふりもしない
// - BCV 中: 仮の頭脳の時、カメラの知らせに「Claude に送る」と出ない
// - B3 中: 声のモデルの名前は 1 か所
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn } from '../server/brain.mjs';
import { chatMemory } from '../server/memory/handler.mjs';
import { createKvMemory } from '../server/memory/kv.mjs';
import { createMemoryStore } from '../api/_lib/store.mjs';
import { extractFacts, memoryAddedEvent, summarize } from '../server/memory/reflect.mjs';
import { createMemoryStore as createFileStore } from '../server/memory/store.mjs';
import { isUnsafeOutput, looksPersonal, personalWarn } from '../server/safety.mjs';
import { STANDIN_POOLS, aiAnswer, asksIfAI, asksMemory, hashText, standinReply } from '../server/talk_lines.mjs';
import { buildUserTurn } from '../server/prompt.mjs';
import { CAMERA_NOTICE, CAMERA_NOTICE_MOCK, CAMERA_PRIVACY_BACK_MOCK, CAMERA_PRIVACY_MOCK } from '../src/stage/cameraSwitch.js';
import { DEFAULT_MODEL_ID } from '../src/conversation/elevenDirect.js';
import { MODEL_DEFAULTS } from '../src/conversation/models.js';

const WEB = join(import.meta.dirname, '..');

/** 仮の頭脳で 1 回話す。返り値は届いたイベントの全部 */
async function talk(text, o = {}) {
  const events = [];
  await runTurn({ text, history: o.history ?? [], character: o.character ?? {} }, { onEvent: (e) => events.push(e), brain: 'mock', paceMs: 0, memory: o.memory ?? null, learned: o.learned ?? [] });
  return events;
}
const said = (events) => events.filter((e) => e.type === 'say').map((e) => e.text);

// ---------- UIR 13 ----------

test('名前と年: ふつうの言い方で覚える(使う人の年だけ。ほかの人の年・問いは覚えない)', () => {
  const facts = (t) => extractFacts(t).map((f) => f.text);
  for (const [text, want] of [
    ['ぼくは たろう、7さい', ['名前: たろう', '年: 7さい']],
    ['ぼくはたろう、7さいだよ', ['名前: たろう', '年: 7さい']],
    ['わたしの名前ははなこ。8さいです', ['名前: はなこ', '年: 8さい']],
    ['ぼく たろう 7さい', ['名前: たろう', '年: 7さい']],
    ['わたしは5さいです', ['年: 5さい']],
    ['ぼくは７さい', ['年: 7さい']],
    ['おれの名前はたかし、10歳', ['名前: たかし', '年: 10さい']],
    ['たろうって呼んでね', ['名前: たろう']],
  ]) assert.deepEqual([...facts(text)].sort(), [...want].sort(), text);
  for (const text of ['いもうとは3さいだよ', 'ノリーは何さい?', 'ぼくのいもうとは3さいです', '7さいのときにプールに行った', 'パパは40さい']) {
    assert.ok(!facts(text).some((t) => t.startsWith('年:')), `${text} は使う人の年ではない`);
  }
  assert.deepEqual(summarize([{ kind: 'name', text: '名前: たろう' }, { kind: 'age', text: '年: 7さい' }]), { name: 'たろう', topic: '', age: '7' });
});

test('年は 1 つだけ(言い直すと置き換わる)。新しい種類 age を、手元のサーバーも公開の関数の置き場も受ける', async () => {
  const kv = createKvMemory({ store: createMemoryStore(), pepper: 'p' });
  const { key } = await kv.create();
  await kv.add(key, extractFacts('ぼくは たろう、7さい'));
  await kv.add(key, extractFacts('ぼくは 8さいになったよ'));
  const items = (await kv.list(key)).items;
  assert.deepEqual(items.filter((i) => i.kind === 'age').map((i) => i.text), ['年: 8さい']);
  assert.equal(items.filter((i) => i.kind === 'name').length, 1);
  const file = createFileStore({ backend: (() => { const m = new Map(); return { get: (id) => m.get(id) ?? null, set: (id, rec) => m.set(id, rec), del: (id) => m.delete(id) }; })(), pepper: 'p' });
  const made = file.create();
  file.add(made.key, extractFacts('ぼくは 7さい'));
  file.add(made.key, extractFacts('ぼくは 9さい'));
  assert.deepEqual(file.list(made.key).items.filter((i) => i.kind === 'age').map((i) => i.text), ['年: 9さい']);
});

test('キャラは、覚えたことをことばにして言い、はじめては「覚えないもの」も言う。画面に新しく覚えた印(fresh)を渡す', async () => {
  const store = createMemoryStore();
  const { key } = await createKvMemory({ store, pepper: 'p' }).create();
  const req = new Request('https://example.test/api/chat', { method: 'POST', headers: { 'x-memory-key': key } });
  const r = await chatMemory(req, 'ぼくは たろう、7さい', { store, cfg: { pepper: 'p' }, env: {} });
  assert.equal(r.events[0].type, 'memory');
  assert.equal(r.events[0].fresh, true);
  assert.deepEqual([...r.events[0].kinds].sort(), ['age', 'name']);
  assert.deepEqual(r.events[0].added.map((a) => a.text).sort(), ['名前: たろう', '年: 7さい']);
  const events = await talk('ぼくは たろう、7さい', { memory: r.memory, learned: r.learned });
  const lines = said(events);
  assert.ok(lines.some((t) => t.includes('たろうさん')), lines.join('/'));
  assert.ok(lines.some((t) => t.includes('7さい')), lines.join('/'));
  assert.ok(lines.some((t) => /おうちの場所や電話は、覚えない/.test(t)), 'はじめて覚えた回は、覚えないものも言う');
  // 2 回目以降(もう覚えている事がある)は、くり返さない
  const again = await talk('ぼくは 8さい', { memory: { items: [{ kind: 'name', text: '名前: たろう' }], text: '名前: たろう' }, learned: [{ kind: 'age', text: '年: 8さい' }] });
  assert.ok(!said(again).some((t) => /覚えないから/.test(t)));
  assert.deepEqual(memoryAddedEvent([]).fresh, false);
  assert.equal(memoryAddedEvent([{ id: 'a', kind: 'name', text: '名前: たろう' }], { key: 'k' }).key, 'k');
});

test('何を覚えるの?: 覚えるもの・覚えないもの・消し方を、子どもの言葉で 3 文', async () => {
  for (const q of ['なにをおぼえてるの?', '何を覚えるの', 'ぼくのこと覚えててくれる?', 'わすれちゃうの?', '覚えててね']) {
    assert.equal(asksMemory(q), true, q);
    const lines = said(await talk(q));
    assert.equal(lines.length, 3, q);
    assert.match(lines[0], /名前と年と好きなもの/);
    assert.match(lines[0], /7日/);
    assert.match(lines[1], /おうちの場所や電話、学校の名前は、覚えないよ/);
    assert.match(lines[2], /わすれて/);
  }
  for (const q of ['きょうは あそんだよ', 'おぼえてる曲をうたうよ']) assert.equal(asksMemory(q), false, q);
});

test('本物の頭脳の指示文にも同じ決まり: 覚えるもの・覚えないもの・いま覚えた事', () => {
  const turn = buildUserTurn({ text: 'ぼくは たろう、7さい', scene: '', trigger: null, learned: [{ text: '名前: たろう' }, { text: '年: 7さい' }] });
  assert.match(turn, /【いま覚えた】名前: たろう \/ 年: 7さい/);
  assert.ok(!buildUserTurn({ text: 'やあ', scene: '', trigger: null }).includes('いま覚えた'));
  assert.ok(!buildUserTurn({ text: '', scene: '', trigger: 'approach', learned: [{ text: '名前: たろう' }] }).includes('いま覚えた'));
  const prompt = readFileSync(join(WEB, 'server', 'prompt.mjs'), 'utf8');
  assert.match(prompt, /住所・電話番号・メールのアドレス・学校の名前・本名は、覚えない/);
  assert.match(prompt, /名前と年と好きなものを/);
});

// ---------- UIR 19 ----------

const PERSONAL_CASES = [
  ['わたしの住所は東京都新宿区1-2-3です', 'address', '場所'],
  ['うちは3丁目の5番地だよ', 'address', '場所'],
  ['でんわは090-1234-5678だよ', 'phone', '電話'],
  ['電話番号を教えるね', 'phone', '電話'],
  ['メールは taro@example.com です', 'email', 'メール'],
  ['さくら小学校にかよってるよ', 'school', '学校'],
  ['ひがし中学校の2年生', 'school', '学校'],
  ['ぼくの本名はやまだたろうだよ', 'name', '名前'],
];

test('住所・電話・学校の名前を書いたら、やさしく「書かないでね」。頭脳は呼ばず、覚えず、どちらの頭脳でも同じ', async () => {
  for (const [text, kind, word] of PERSONAL_CASES) {
    assert.equal(personalWarn(text), kind, text);
    assert.equal(looksPersonal(text), true, text);
    assert.deepEqual(extractFacts(`${text}。ぼくはたろうです`), [], `${text} は覚えない`);
    const events = await talk(text);
    const lines = said(events);
    assert.match(lines[0], new RegExp(`${word}.*書かないでね`), `${text} → ${lines[0]}`);
    assert.ok(lines.some((t) => /覚えないから あんしん/.test(t)), 'この話は覚えないと言う');
    assert.ok(lines.some((t) => /ほかのお話/.test(t)), '話は続けられると言う');
    assert.ok(lines.every((t) => !isUnsafeOutput(t)), '出力の確かめに当たらない');
    assert.ok(!lines.join('').includes('1234') && !lines.join('').includes('example'), '書かれた中身をくり返さない');
    const meta = events.find((e) => e.type === 'meta' && e.privacy);
    assert.equal(meta?.privacy, 'personal');
  }
});

test('ふつうの話は止めない(学校の話・街の話・数字)', () => {
  for (const t of ['小学校でサッカーしたよ', 'この小学校ってたのしい?', 'あの中学校は大きいね', '東京に行ってみたいな', '3時にあそぼう', 'ぼくは たろう、7さい', '学校がたのしいよ', 'パパは東京出身だよ']) {
    assert.equal(personalWarn(t), null, t);
  }
});

test('書いた発言は、前の話からも消す(頭脳に渡す履歴に残らない)。本物の頭脳(偽の API)で確かめる', async () => {
  const seen = [];
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const line = '{"type":"say","text":"そうなんだ。","expression":"happy","motion":"nod","gaze":"person","intent":"試し","stage":"chat","handoff":false}';
      res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: line } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const keep = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_API_URL };
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  try {
    const out = [];
    // 本物の頭脳でも、書いた回は頭脳を呼ばずに決まった返事
    await runTurn({ text: 'でんわは090-1234-5678だよ' }, { onEvent: (e) => out.push(e) });
    assert.equal(seen.length, 0, '書いた回は頭脳を呼ばない');
    assert.match(said(out)[0], /電話ばんごう.*書かないでね/);
    // 次のふつうの回: 履歴の中の、書いた発言は消えて渡る
    await runTurn({ text: 'あそぼう', history: [{ role: 'user', content: 'でんわは090-1234-5678だよ' }, { role: 'assistant', content: '電話ばんごうは、ここには書かないでね。' }, { role: 'user', content: 'こんにちは' }] }, { onEvent: () => {} });
    assert.equal(seen.length, 1);
    const sent = JSON.stringify(seen[0].messages);
    assert.ok(!sent.includes('090') && !sent.includes('1234'), '電話ばんごうは頭脳に渡らない');
    assert.ok(sent.includes('消したよ'));
    assert.ok(sent.includes('こんにちは'), 'ふつうの発言は残す');
  } finally {
    server.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', keep.key], ['ANTHROPIC_API_URL', keep.url]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('書いた言葉は、公開の関数の記憶の道(chatMemory)でも覚えない', async () => {
  const store = createMemoryStore();
  const { key } = await createKvMemory({ store, pepper: 'p' }).create();
  const req = new Request('https://example.test/api/chat', { method: 'POST', headers: { 'x-memory-key': key } });
  const r = await chatMemory(req, 'ぼくはたろう。さくら小学校の7さい。でんわは090-1234-5678', { store, cfg: { pepper: 'p' }, env: {} });
  assert.deepEqual(r.learned, []);
  assert.deepEqual(r.events, []);
  assert.deepEqual((await createKvMemory({ store, pepper: 'p' }).list(key)).items, []);
});

// ---------- UIR 7 ----------

test('AI かと聞かれたら、子どもの言葉で正直に答える(言い方がいろいろでも)', async () => {
  for (const q of ['きみは本物のいきもの?それともAI?', 'きみはAIなの?', 'ロボットなの?', '人間なの?', 'にんげん?', 'あなたはAIですか', '人間じゃないの?', '生きてるの?', 'ほんもの?', '中に人いるの', 'AIなんでしょ', 'えーあい?', 'これは人工知能ですか']) {
    assert.equal(asksIfAI(q), true, q);
    const lines = said(await talk(q));
    assert.equal(lines.length, 2, q);
    assert.equal(lines[0], 'AI のキャラクターだよ。人間じゃないんだ。', q);
    assert.ok(!/人間だ(よ|ね)|本物の人間/.test(lines.join('')), q);
    assert.ok(lines.every((t) => !isUnsafeOutput(t)), q);
  }
  for (const q of ['人間の友だちがいるよ', 'ロボットのおもちゃがすき', 'AIのえほんをよんだ', '本物のりんごをたべた']) assert.equal(asksIfAI(q), false, q);
  // 本物の頭脳の指示文の 1 段目にも、同じ決まり(BSF の後も保たれている)
  const { SAFETY_RULES } = await import('../server/safety.mjs');
  assert.ok(SAFETY_RULES.includes('人間かどうか・AI かどうかを聞かれたら、AI のキャラクターだと正直に答える。人間のふりをしない。'));
  // 2 文目は会話が進むと替わる(同じ言い方をくり返さない)
  assert.notEqual(aiAnswer('AI?', 0)[1], aiAnswer('AI?', 1)[1]);
});

// ---------- UIR 12 ----------

test('仮の頭脳の返事は決まった 1 文でない。会話が進むと替わり、本物のふりをしない', async () => {
  const lines = ['きょうは あそんだよ', 'りんごがおいしかった', 'ねむいなあ', 'ともだちとサッカーした', 'あしたは何をしよう', 'すごいでしょ'];
  const pairs = new Set();
  let history = [];
  for (const t of lines) {
    const out = said(await talk(t, { history }));
    assert.equal(out.length, 2, t);
    pairs.add(out.join('/'));
    history = [...history, { role: 'user', content: t }, { role: 'assistant', content: out.join('') }];
  }
  assert.ok(pairs.size >= 5, `6 回で ${pairs.size} とおり: ${[...pairs].join(' | ')}`);
  // 同じ言葉でも、回が進むと替わる
  const repeats = new Set([0, 1, 2, 3, 4].map((turn) => standinReply('たのしいね', turn).lines.join('/')));
  assert.ok(repeats.size >= 4);
  // 聞かれたこと(天気・調べもの)は、知っているふりをせず、正直に言う
  const asked = said(await talk('明日の天気はどう?'));
  assert.ok(STANDIN_POOLS.ASKED_FIRST.includes(asked[0]) && STANDIN_POOLS.ASKED_SECOND.includes(asked[1]), asked.join('/'));
  // どの言い回しも、本物の頭脳のふり(調べた・見た・Claude・本物)をせず、出力の確かめに当たらない
  for (const pool of [STANDIN_POOLS.LISTEN_FIRST, STANDIN_POOLS.LISTEN_SECOND, STANDIN_POOLS.ASKED_FIRST, STANDIN_POOLS.ASKED_SECOND, STANDIN_POOLS.AI_SECOND]) {
    for (const t of pool) {
      assert.ok(!/調べ(た|ました)|Claude|ほんもの|本物の頭脳|検索|見えた|見たよ/.test(t), t);
      assert.ok(!isUnsafeOutput(t), t);
      assert.ok(Array.from(t).length <= 40, t);
    }
  }
  assert.equal(hashText('同じ'), hashText('同じ'));
  // 人格の「あいづち」があれば、その子の言葉が先(今までどおり)
  const persona = '# テスト\n## あいづち\n- うんうん、なるほどデス。\n- もっと聞かせてデス。';
  assert.deepEqual(said(await talk('りんごがおいしかった', { character: { persona } })), ['うんうん、なるほどデス。', 'もっと聞かせてデス。']);
});

// ---------- BCV 中 ----------

test('仮の頭脳のカメラの知らせは、絵を Claude に送ると言わない', () => {
  assert.match(CAMERA_NOTICE, /Claude に おくられます/, '本物の頭脳の時の 1 行は今までどおり');
  for (const t of [CAMERA_NOTICE_MOCK, CAMERA_PRIVACY_MOCK, CAMERA_PRIVACY_BACK_MOCK]) {
    assert.ok(!/Claude/.test(t), t);
    assert.match(t, /おくられません|送りません/, t);
  }
});

test('カメラの知らせの窓: 開くたびに、仮の頭脳の時は Claude に送るとは出さない(頭脳が替わっても合う)', async () => {
  const { mountCameraSwitch } = await import('../src/stage/cameraSwitch.js');
  const mk = () => {
    const els = {};
    const el = (id) => (els[id] ??= { id, hidden: true, textContent: '', disabled: false, setAttribute() {}, classList: { toggle() {} }, focus() {}, querySelector: () => null, addEventListener() {} });
    const ask = { hidden: true, querySelector: (sel) => el(sel.slice(1)), addEventListener() {} };
    return { els, el, ask };
  };
  const m = mk();
  const button = m.el('camBtn');
  button.querySelector = () => ({ textContent: '' });
  let mock = true;
  global.document ??= { documentElement: { classList: { toggle() {} } } };
  const sw = mountCameraSwitch({ button, ask: m.ask, turnOn: async () => {}, turnOff: async () => {}, isMock: () => mock });
  sw.open();
  assert.equal(m.els.camAskText.textContent, CAMERA_NOTICE_MOCK);
  sw.close();
  mock = false;
  sw.open();
  assert.equal(m.els.camAskText.textContent, CAMERA_NOTICE);
});

// ---------- B3 中 ----------

test('声のモデルの名前は 1 か所(models.js)。elevenDirect.js もそこを読み、名前の文字を持たない', () => {
  assert.equal(DEFAULT_MODEL_ID, MODEL_DEFAULTS.voice);
  const src = readFileSync(join(WEB, 'src', 'conversation', 'elevenDirect.js'), 'utf8');
  assert.ok(!/eleven_(?:v\d|flash|multilingual|turbo|monolingual)/.test(src.replace(/\/\/.*$/gm, '')), 'モデル名の文字が無い');
  assert.match(src, /import \{ MODEL_DEFAULTS \} from '\.\/models\.js'/);
});

// ---------- UW3f(点検 UW3r の直し) ----------

test('UW3f 高1: ふつうの学校の話(きのう・たのしい・いつも)は止めない。名前の形だけ止める', async () => {
  for (const t of ['きのう小学校でサッカーした', 'たのしい小学校にかよってるよ', 'あした小学校で運動会', 'いつも幼稚園で', '兄が高校で', '昨日小学校で遊んだ']) {
    assert.equal(personalWarn(t), null, t);
    assert.ok(!said(await talk(t)).some((l) => /書かないでね/.test(l)), t);
  }
  for (const t of ['ことのは第二小学校だよ', '桜山第一小学校です', 'きのうさくら小学校でね']) assert.equal(personalWarn(t), 'school', t);
});

test('UW3f 高2: ノリーの仮の返事は回ごとに替わる(4 つの話で 3 とおり以上)', async () => {
  const persona = readFileSync(join(WEB, '..', 'characters', 'norrie', 'persona.md'), 'utf8');
  const history = [];
  const outs = [];
  for (const t of ['サッカーをしたよ', 'あめがふってたよ', 'ねこをかってるよ', 'きょうはなにしようかな']) {
    const l = said(await talk(t, { history: [...history], character: { name: 'ノリー', persona } }));
    outs.push(l.join('|'));
    history.push({ role: 'user', content: t }, { role: 'assistant', content: l.join('') });
  }
  assert.ok(new Set(outs).size >= 3, outs.join(' / '));
});

test('UW3f 中3: AI の問いは「きみ(キャラ)」についてだけ。ふつうの話は止めない', () => {
  for (const q of ['ロボットがすき?', 'これ本物のりんご?', 'プログラムってなに?', 'ぼくのいぬ、いきてる?', 'ほんもののいぬをみたよ']) assert.equal(asksIfAI(q), false, q);
  for (const q of ['なかにひとがいるの?', 'ノリーは生きてるの?', 'きみはロボットなの', '本当は人間なんでしょ?']) assert.equal(asksIfAI(q, ['ノリー']), true, q);
});

test('UW3f 中4: 「ぼくのこと覚えてる?」は、覚えている名前・年を先に言う', async () => {
  const memory = { items: [{ id: '1', kind: 'name', text: '名前: たろう' }, { id: '2', kind: 'age', text: '年: 7さい' }], text: '' };
  const lines = said(await talk('ぼくのこと覚えてる?', { history: [{ role: 'user', content: 'やあ' }, { role: 'assistant', content: 'やあ' }], memory }));
  assert.match(lines[0], /たろうさん.*7さい.*覚えているよ/);
  assert.ok(lines.length <= 3 && lines.every((l) => !isUnsafeOutput(l)));
});

test('UW3f 中6: ノリーも、はじめて覚えた回に「おうちの場所や電話は覚えない」を、自分の口調で言う', async () => {
  const persona = readFileSync(join(WEB, '..', 'characters', 'norrie', 'persona.md'), 'utf8');
  const learned = [{ id: '1', kind: 'name', text: '名前: タロウ' }];
  const lines = said(await talk('ぼくはタロウ', { character: { name: 'ノリー', persona }, learned, history: [{ role: 'user', content: 'やあ' }, { role: 'assistant', content: 'やあ' }] }));
  assert.ok(lines.some((l) => /おうちの場所や電話は、覚えない/.test(l) && /デス/.test(l)), lines.join('|'));
});
