// 初めての会話の 1〜3 歩を「本当の作る道」につないだ形の試験(画面なし・通信なし・Claude を呼ばない)。
// 入力と絵は PC が配る作る画面(creator/review/page/make.*、枠)の中だけで扱い、この画面のコードは枠からの知らせだけを受ける。
// ここでは: 作る道のサーバーの場所の確かめ、# の合言葉の扱い、枠の住所と知らせの選り分け、知らせで 7 歩の 1〜4 が進むこと。
// 本物のサーバー・本物の作る画面・PC の側(yuru_make.py)を通す試験は onboarding_make_browser.test.mjs(YC_BROWSER_TESTS=1)と
// creator/review/tests/test_make.py。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { cleanMakeEvent, createLocalCreator, isLocalBase, isLoopbackHost, pageIsLocal, plainWords } from '../src/ui/onboarding/creators.js';
import { readLocalMake, MAKE_KEY } from '../src/ui/onboarding/index.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER } from '../src/character/defaults.js';

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };

// 家の中の住所の見本は、その場で組み立てる(公開の前の履歴の書き換えが、書いたままの 192.168.… と 100.64〜127.… を伏せ字にし、試験が落ちるため。S6 の頼み)
const ip = (...parts) => parts.join('.');
// Tailscale の名前の見本も、作り物の部品だけで組み立てる(本物の機械の名前を書かない。公開前の語の点検)
const tsName = (...parts) => [...parts, 'ts', 'net'].join('.');

test('作る道のサーバーの場所は、この PC の中(127.0.0.1・localhost)だけ。家の中の住所・*.ts.net・*.local は数えない(CRITsec F4)', () => {
  for (const ok of ['http://127.0.0.1:8796', 'http://localhost:8796', 'http://[::1]:8796', 'https://127.0.0.1:8445']) {
    assert.equal(isLocalBase(ok), true, ok);
  }
  for (const bad of [
    `http://${ip(192, 168, 1, 20)}:8796`, 'http://10.0.0.5:8796', `http://${ip(100, 101, 1, 2)}:8796`,
    'https://pc.example-tail.ts.net:8445', 'https://<端末名>.<tailnet>.ts.net', 'http://printer.local',
    'https://evil.example', 'http://8.8.8.8:8796', 'http://127.0.0.1:8796/x', 'http://u:p@127.0.0.1:8796', 'javascript:alert(1)', 'http://127.0.0.1.evil.example', '', null,
  ]) {
    assert.equal(isLocalBase(bad), false, String(bad));
  }
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost(tsName('home-pc', 'example-tail')), false);
  assert.equal(pageIsLocal({ hostname: '127.0.0.1' }), true);
  assert.equal(pageIsLocal({ hostname: 'yurukyara.example.app' }), false, '公開の URL');
  assert.equal(pageIsLocal({ hostname: 'pc.example-tail.ts.net' }), false, 'Tailscale の名前');
  assert.throws(() => createLocalCreator({ base: 'https://evil.example', key: 'k', win: {} }), /この PC の中/);
  assert.throws(() => createLocalCreator({ base: 'https://pc.example-tail.ts.net:8445', key: 'k', win: {} }), /この PC の中/);
  assert.throws(() => createLocalCreator({ base: 'http://127.0.0.1:8796', key: '', win: {} }), /合言葉/);
});

test('# の合言葉は読んだらアドレスの欄から消し、このタブの中だけに覚える。よその場所は使わない', () => {
  const store = new Map();
  const session = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const replaced = [];
  const history = { state: null, replaceState: (_s, _t, url) => replaced.push(url) };
  const loc = { hostname: 'localhost', hash: '#yc-make=http://127.0.0.1:8796&yc-key=abc123', pathname: '/', search: '?onboard=1' };
  assert.deepEqual(readLocalMake({ loc, session, history }), { base: 'http://127.0.0.1:8796', key: 'abc123' });
  assert.deepEqual(replaced, ['/?onboard=1'], '合言葉を履歴に残さない');
  assert.ok(store.get(MAKE_KEY));
  assert.deepEqual(readLocalMake({ loc: { hostname: 'localhost', hash: '', pathname: '/', search: '' }, session, history }), { base: 'http://127.0.0.1:8796', key: 'abc123' }, '読み込み直しても続けられる');
  const s2 = new Map();
  const session2 = { getItem: (k) => s2.get(k) ?? null, setItem: (k, v) => s2.set(k, v) };
  const evil = { hostname: '127.0.0.1', hash: '#yc-make=https://evil.example&yc-key=abc', pathname: '/', search: '' };
  assert.equal(readLocalMake({ loc: evil, session: session2, history }), null);
  assert.equal(s2.size, 0);
});

test('公開の URL・*.ts.net で開いた画面は、# の作る道を読まない(細工したリンクで、よその作る画面を出させない。CRITsec F4)', () => {
  for (const hostname of ['yurukyara.example.app', '<端末名>.<tailnet>.ts.net']) {
    const store = new Map();
    const session = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const replaced = [];
    const history = { state: null, replaceState: (_s, _t, url) => replaced.push(url) };
    // 相手が自分の機械を 127.0.0.1 と書いても、画面が公開の場所なら使わない(作る道は、この PC で開いた画面だけ)
    for (const hash of ['#yc-make=https://evil-node.example-tailnet.ts.net&yc-key=x', '#yc-make=http://127.0.0.1:8796&yc-key=abc']) {
      assert.equal(readLocalMake({ loc: { hostname, hash, pathname: '/', search: '?onboard=1' }, session, history }), null, `${hostname} ${hash}`);
    }
    assert.equal(store.size, 0, '覚えない');
    assert.deepEqual(replaced, ['/?onboard=1', '/?onboard=1'], '# はアドレスの欄から消す');
    store.set(MAKE_KEY, JSON.stringify({ base: 'http://127.0.0.1:8796', key: 'old' }));
    assert.equal(readLocalMake({ loc: { hostname, hash: '', pathname: '/', search: '' }, session, history }), null, '前に覚えた物も、公開の画面では使わない');
  }
});

/** 枠の代わり: message の受け手を覚え、作る画面の元から知らせを送る */
function fakeWindow() {
  const handlers = new Set();
  return {
    addEventListener: (type, f) => type === 'message' && handlers.add(f),
    removeEventListener: (type, f) => handlers.delete(f),
    post: (origin, data) => handlers.forEach((f) => f({ origin, data })),
    get count() {
      return handlers.size;
    },
  };
}

test('枠の住所に合言葉は # の後ろだけ。知らせは作る画面の元から来た、決めた形の物だけを受ける', () => {
  const win = fakeWindow();
  const c = createLocalCreator({ base: 'http://127.0.0.1:8796', key: 'k e y/1', parentOrigin: 'http://localhost:5173', win });
  assert.equal(c.mode, 'local');
  assert.equal(c.frameUrl, 'http://127.0.0.1:8796/m/#k=k%20e%20y%2F1&p=http%3A%2F%2Flocalhost%3A5173');
  const got = [];
  const stop = c.listen((e) => got.push(e));
  win.post('http://evil.example', { src: 'yc-make', ev: 'drawn', id: 'x1', name: 'x', round: 1 });
  win.post('http://127.0.0.1:8796', { src: 'other', ev: 'drawn' });
  win.post('http://127.0.0.1:8796', { src: 'yc-make', ev: 'run-command', cmd: 'rm' });
  win.post('http://127.0.0.1:8796', { src: 'yc-make', ev: 'drawn', id: '../bad', name: 'x', round: 1 });
  win.post('http://127.0.0.1:8796', { src: 'yc-make', ev: 'drawn', id: 'yc1106_2201_ab12', name: 'あ'.repeat(80), round: 2, picture: 'data:image/png;base64,xx' });
  assert.equal(got.length, 1, 'よその元・知らない知らせ・形の違う id は捨てる');
  assert.deepEqual(got[0], { ev: 'drawn', id: 'yc1106_2201_ab12', name: 'あ'.repeat(40), round: 2 }, '絵などの決めていない欄は落とす');
  stop();
  c.close();
  assert.equal(win.count, 0);
  assert.deepEqual(cleanMakeEvent({ src: 'yc-make', ev: 'decided', decision: 'redo', note: 'い'.repeat(60), round: 1 }), { ev: 'decided', decision: 'redo', note: 'い'.repeat(40), round: 1 });
  assert.equal(cleanMakeEvent({ src: 'yc-make', ev: 'checked', class: 'robot' }), null);
});

function harness({ frameWaitMs } = {}) {
  const said = [];
  const stored = new Map();
  let offered = [];
  const win = fakeWindow();
  const creator = createLocalCreator({ base: 'http://127.0.0.1:8796', key: 'test-key', parentOrigin: 'http://localhost:5173', win });
  const pins = [];
  const fr = new FirstRun({
    guide: MAIN_CHARACTER,
    creator,
    pin: (p) => pins.push(p),
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(3)) },
    talk: async () => MOCK,
    voice: { realVoice: () => null, canTakeKey: () => false, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: async () => true,
    ...(frameWaitMs ? { frameWaitMs } : {}),
  });
  creator.listen((e) => fr.makeEvent(e));
  const send = async (data) => {
    win.post('http://127.0.0.1:8796', { src: 'yc-make', ...data });
    await fr.makeQueue;
  };
  return { fr, said, send, stored, pins, get offeredAll() { return offered; }, get offered() { return offered.map((a) => a.id); }, texts: (who) => said.filter((l) => l.who === who).map((l) => l.text) };
}

test('言葉 → PC の絵 → 直したい(一言)= G1 → 2 回目 → この子にする → 性格へ(枠からの知らせで進む)', async () => {
  const h = harness();
  await h.fr.start();
  assert.ok(h.texts('guide')[0].includes('ノリ、がんばりマス'), '案内役はノリー');
  assert.ok(h.texts('note').some((t) => t.includes('Anthropic に送られます')), '言葉と絵がどこへ行くかを先に言う');
  assert.deepEqual(h.offered, ['frame'], '1〜3 歩の入力は PC の作る画面(枠)');
  assert.equal(h.offeredAll[0].url, 'http://127.0.0.1:8796/m/#k=test-key&p=http%3A%2F%2Flocalhost%3A5173');
  await h.send({ ev: 'sent', from: 'words', words: '赤い提灯の子' });
  assert.equal(h.fr.step, 3);
  assert.deepEqual(h.texts('user'), ['赤い提灯の子']);
  assert.ok(h.texts('guide').some((t) => t.includes('/yuru-next')), 'PC で /yuru-next と打つと言う');
  await h.send({ ev: 'progress', text: '絵を描いています(1 回目。数分かかります)' });
  await h.send({ ev: 'progress', text: '絵を描いています(1 回目。数分かかります)' });
  assert.equal(h.texts('note').filter((t) => t.startsWith('絵を描いています')).length, 1, '同じ様子は 1 回だけ出す');
  // 古い PC の側が内部の言葉(段 0・C0)を送っても、画面にはふつうの言葉で出す(D7)
  await h.send({ ev: 'progress', text: 'C0 絵の 1 回目を出しました。画面で見てください' });
  assert.ok(h.texts('note').includes('絵の 1 回目を出しました。画面で見てください'));
  await h.send({ ev: 'drawn', id: 'yc1106_2201_ab12', name: 'ちょうちんちゃん', round: 1 });
  assert.deepEqual([h.fr.character.id, h.fr.character.local, h.fr.character.sample], ['yc1106_2201_ab12', true, false]);
  assert.ok(h.texts('guide').includes('こんな子ができたよ。どうかな?'));
  await h.send({ ev: 'decided', decision: 'redo', note: '帽子を青にして', round: 1 });
  assert.ok(h.texts('user').includes('帽子を青にして'));
  assert.ok(h.texts('guide').includes('PC の Claude Code に伝えたよ。直ったら、また見せるね。'));
  await h.send({ ev: 'drawn', id: 'yc1106_2201_ab12', name: 'ちょうちんちゃん', round: 2 });
  assert.equal(h.fr.character.round, 2);
  assert.ok(h.texts('guide').includes('直してみたよ。どうかな?'));
  assert.deepEqual(h.offered, ['frame'], '決めるまでは枠のまま');
  await h.send({ ev: 'decided', decision: 'ok', id: 'yc1106_2201_ab12', name: 'ちょうちんちゃん', round: 2 });
  assert.equal(h.fr.step, 4);
  assert.ok(h.texts('guide').includes('ちょうちんちゃんにけってい! OK を PC に伝えたよ。'));
  const told = h.texts('note').find((t) => t.includes('3D ができるまでは'));
  assert.ok(told, 'できていない所(3D)を正直に言う');
  assert.match(told, /ノリーがかわりに舞台に立って、ちょうちんちゃんの言葉を話します/, '主役が代わりに立つと言う(D5)');
  assert.ok(!/段 \d|C0/.test(told), '内部の言葉(段 1〜6・C0)を出さない(D7)');
  assert.equal(h.pins.at(-1)?.frame, 'http://127.0.0.1:8796/m/#k=test-key&p=http%3A%2F%2Flocalhost%3A5173&view=pic', '描いた絵だけの枠を、札の上に出したままにする(D5)');
  assert.match(h.pins.at(-1)?.caption ?? '', /ちょうちんちゃん/);
  assert.deepEqual(h.offered, ['persona_ok', 'persona_edit', 'persona_roll']);
  assert.ok(h.stored.get('yc1106_2201_ab12'), '性格はできた子の id で覚える');
  await h.send({ ev: 'drawn', id: 'yc1106_2201_ab12', name: 'x', round: 3 });
  assert.equal(h.fr.step, 4, '4 歩目より後は、枠の知らせで戻らない');
});

test('絵 → PC のチェック(人の絵)→ ゆるキャラにしてみる → 絵 → 別の子にする → 1 歩目', async () => {
  const h = harness();
  await h.fr.start();
  await h.send({ ev: 'sent', from: 'picture' });
  assert.equal(h.fr.step, 2);
  assert.deepEqual(h.texts('user'), ['(絵を渡した)'], '絵そのものは、この画面に来ない');
  await h.send({ ev: 'checked', class: 'human', message: 'これはちょっとリアルな人の絵みたい', by: 'pixels' });
  assert.ok(h.texts('guide').includes('これはちょっとリアルな写真みたい。ゆるキャラにしてみる?'));
  assert.ok(h.texts('note').some((t) => t.includes('絵の数字で決めました')), '判定役が割れた時は正直に言う');
  await h.send({ ev: 'chose', choice: 'yurufy' });
  assert.ok(h.texts('user').includes('ゆるキャラにしてみる'));
  await h.send({ ev: 'drawn', id: 'yc1106_2202_cd34', name: '新しい子', round: 1 });
  assert.equal(h.fr.step, 3);
  await h.send({ ev: 'restart' });
  assert.equal(h.fr.step, 1);
  assert.equal(h.fr.character, null);
  assert.equal(h.pins.at(-1), null, 'やり直すと、絵の欄を消す');
  assert.ok(h.texts('guide').includes('じゃあ、もう一度。どんな子を生み出そうか?'));
});

test('作る画面から「開いた」の知らせが来なければ、黙らずに言う(来れば言わない)', async () => {
  const quiet = harness({ frameWaitMs: 40 });
  await quiet.fr.start();
  await quiet.send({ ev: 'ready' });
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!quiet.texts('note').some((t) => t.includes('作る画面が開けません')));
  const lost = harness({ frameWaitMs: 40 });
  await lost.fr.start();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(lost.texts('note').some((t) => t.includes('serve_review.py --make --web')), 'PC のサーバーと許す元を確かめるよう言う');
});

test('内部の言葉(段 0・C0 など)を、作る画面からの文でふつうの言葉にする(D7)', () => {
  assert.equal(plainWords('段 0(絵)の 1 回目を描いています(数分)'), '絵の 1 回目を描いています(数分)');
  assert.equal(plainWords('段 2(shape)を作っています'), '形を作っています');
  assert.equal(plainWords('C0 絵の 1 回目を出しました'), '絵の 1 回目を出しました');
  assert.equal(plainWords('C2 のやり直し'), '形の確認のやり直し');
  assert.equal(plainWords('ABC0 はそのまま'), 'ABC0 はそのまま');
  assert.deepEqual(cleanMakeEvent({ src: 'yc-make', ev: 'progress', text: 'C0 絵の 2 回目を出しました' }), { ev: 'progress', text: '絵の 2 回目を出しました' });
});
