// B13C(11/8 本人「描いてる最中とか作業中に、何かくるくる回るとか、そういうアクションがないと、固まってるように思われちゃう」)の試験。画面なし。
//  1. はたらいている動き(ui/work.js): 1.5 秒の待ち・描く間はすぐ・歩みの文・上限・ことば別の文・きらきらの数と軽さ・動きを止める設定
//  2. QA8 #4: 描いた子の「なおしたい ところ」の一言を捨てない(もう 1 回描く。枠が無い時は正直に言う)
//  3. QA8 #5: 絵からの描画が失敗しても、1 日・1 人の枠を減らさない(数えるのは描けた後)
//  4. CU3_2 should 1・2・5・6、待つ表示と起動中の表示のことば別の文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WORK_DELAY_MS, WORK_KINDS, WORK_TEXT, configureWork, createWorkTracker, currentWorkNote, currentWorkText, workNote, workText } from '../src/ui/work.js';
import { SPARKLES_DESKTOP, SPARKLES_PHONE, WORK_CSS, sparkleSpecs } from '../src/ui/workFx.js';
import { WAIT_DELAY_MS, createWaitBubble, thinkingText, wakeHint, wakeLine, wakeLoading } from '../src/ui/waitBubble.js';
import { FirstRun, OMAKASE_CHIP, OMAKASE_NO } from '../src/ui/onboarding/script.js';
import { AUTO_PLACE } from '../src/ui/onboarding/roles.js';
import { CREATE_TITLE } from '../src/ui/onboarding/view.js';
import { START_LABEL } from '../src/ui/onboarding/index.js';
import { createDrawCreator, createSampleCreator } from '../src/ui/onboarding/creators.js';
import { createDrawer } from '../server/draw.mjs';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

/** 進められるタイマー */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    set(f, ms) {
      const id = next++;
      jobs.set(id, { at: now + ms, f });
      return id;
    },
    clear(id) {
      jobs.delete(id);
    },
    get pending() {
      return jobs.size;
    },
    advance(ms) {
      const to = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        jobs.delete(due[0]);
        now = due[1].at;
        due[1].f();
      }
      now = to;
    },
  };
}

function tracker() {
  const timers = fakeTimers();
  const t = createWorkTracker({ timers });
  const seen = [];
  t.subscribe((s) => seen.push(s));
  return { t, timers, seen };
}

/* ---------- 1. はたらいている動き ---------- */

test('1.5 秒より長い待ちだけ出す。すぐ終われば、ちらつかせない', () => {
  assert.equal(WORK_DELAY_MS, 1500);
  const { t, timers } = tracker();
  const end = t.begin('wait');
  timers.advance(WORK_DELAY_MS - 1);
  assert.equal(t.state.visible, false);
  timers.advance(2);
  assert.equal(t.state.visible, true);
  assert.equal(t.state.kind, 'wait');
  end();
  assert.equal(t.state.visible, false);
  const quick = t.begin('stage');
  timers.advance(500);
  quick();
  timers.advance(5000);
  assert.equal(t.state.visible, false, '短い待ちは出さない');
  assert.equal(timers.pending, 0, '時計も残さない');
});

test('描く(1 分ほど)・3D を待つ間は、すぐ出す。終わりの関数は何度呼んでもよい', () => {
  const { t } = tracker();
  assert.equal(WORK_KINDS.draw.immediate && WORK_KINDS.build.immediate, true);
  const end = t.begin('draw');
  assert.deepEqual([t.state.visible, t.state.kind, t.state.pill], [true, 'draw', true]);
  end();
  end();
  assert.equal(t.state.visible, false);
});

test('歩みの文を差し替えられる(update)。無ければ、種類ごとの文。上限で必ず消える', () => {
  const { t, timers } = tracker();
  const end = t.begin('build');
  assert.equal(t.state.text, null);
  end.update('形を つくっているよ');
  assert.equal(t.state.text, '形を つくっているよ');
  assert.equal(currentWorkText(t.state), '形を つくっているよ');
  end.update('');
  assert.equal(t.state.text, null, '空にすると、種類ごとの文へ戻る');
  timers.advance(WORK_KINDS.build.maxMs + 1);
  assert.equal(t.state.visible, false, '終わりの知らせが来なくても、上限で消える');
  end.update('消えた後は何も起きない');
  assert.equal(t.state.visible, false);
});

test('文を別の所が出している待ち(pill: false)は、きらきらだけ。重なった時は、文を出す物の文を使う', () => {
  const { t } = tracker();
  const spark = t.begin('think', { pill: false, immediate: true });
  assert.deepEqual([t.state.visible, t.state.pill], [true, false], 'きらきらだけ');
  const draw = t.begin('draw');
  assert.deepEqual([t.state.kind, t.state.pill, t.state.count], ['draw', true, 2]);
  draw();
  assert.equal(t.state.pill, false);
  spark();
  assert.equal(t.state.visible, false);
});

test('知らない種類は wait として扱う。subscribe は、足した時にいまの様子を渡し、外せる', () => {
  const { t } = tracker();
  const got = [];
  const off = t.subscribe((s) => got.push(s.visible));
  assert.deepEqual(got, [false]);
  t.begin('???', { immediate: true });
  assert.equal(t.state.kind, 'wait');
  off();
  t.clear();
  assert.deepEqual(got, [false, true], '外した後は知らせない');
  assert.equal(t.state.visible, false);
});

test('文は ja・en・zh・ko の 4 つで、どの種類にもある。名前つきの考え中は名前を切って入れる。日本語はひらがな多め', () => {
  for (const lang of ['ja', 'en', 'zh', 'ko']) {
    for (const kind of Object.keys(WORK_KINDS)) assert.ok(WORK_TEXT[lang][kind], `${lang}.${kind}`);
  }
  assert.equal(workText('draw'), 'えを かいているよ');
  assert.equal(workText('draw', { lang: 'en' }), 'Drawing a picture');
  assert.equal(workText('think', { lang: 'ja', name: 'ノリー' }), 'ノリーが かんがえているよ');
  assert.equal(workText('think', { lang: 'en', name: 'Mika' }), 'Mika is thinking');
  assert.equal(workText('think', { lang: 'xx', name: '' }), 'かんがえているよ', '知らないことばは日本語、名前が無ければ名前なし');
  assert.equal(workText('think', { name: 'あ'.repeat(30) }).startsWith('あ'.repeat(16) + '…'), true, '長い名前は切る');
  assert.equal(workNote('draw'), '1 分くらい かかるよ');
  assert.equal(workNote('stage'), '', '短い物には一言を付けない');
  // 画面の側が教えたことばと名前で、いまの文が決まる
  configureWork({ lang: () => 'ko', name: () => 'Mika' });
  assert.equal(currentWorkText({ visible: true, kind: 'think', text: null }), 'Mika 생각 중이에요');
  assert.equal(currentWorkNote({ visible: true, kind: 'draw' }), '1분쯤 걸려요');
  assert.equal(currentWorkText({ visible: true, kind: 'draw', text: null }, 'ja'), 'えを かいているよ', 'ことばを渡せば、そちらを使う(作る札はいつも日本語)');
  configureWork({ lang: () => 'ja', name: () => '' });
  // 開発の言葉は出さない
  for (const t of Object.values(WORK_TEXT.ja)) assert.doesNotMatch(t, /サーバー|API|読み込み|ロード|エラー|Claude/);
});

test('きらきら: スマホは 9 個・PC は 16 個。置き方は決まっていて(乱数なし)、キャラのまわりの輪に収まり、始めの位置がばらける', () => {
  assert.deepEqual([SPARKLES_PHONE, SPARKLES_DESKTOP], [9, 16]);
  for (const n of [SPARKLES_PHONE, SPARKLES_DESKTOP]) {
    const a = sparkleSpecs(n);
    assert.equal(a.length, n);
    assert.deepEqual(a, sparkleSpecs(n), '毎回同じ');
    for (const s of a) {
      assert.ok(s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100, `層の中に収まる ${s.x},${s.y}`);
      assert.ok(s.s >= 5 && s.s <= 10, '小さな粒');
      assert.ok(Number(s.d) <= 0, '負の遅れ(全部が同時に始まらない)');
    }
    assert.ok(new Set(a.map((s) => s.d)).size > 3, '始めの位置がばらける');
    assert.ok(new Set(a.map((s) => s.c)).size >= 4, '色がまざる');
  }
});

test('見た目は軽く・止まる: 動かすのは transform と opacity だけ。動きを止める設定では粒も輪も止め、押せる物を邪魔しない', () => {
  const keyframes = [...WORK_CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  assert.ok(keyframes.length >= 4, '動きは 4 つ(粒・輪・星・流れる線)');
  for (const [, name, body] of keyframes) {
    const props = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    for (const p of props) assert.ok(['transform', 'opacity'].includes(p), `${name} が ${p} を動かしている(重くなる)`);
  }
  assert.match(WORK_CSS, /\.wk-fx \{[^}]*pointer-events: none/, 'きらきらは押せる物の邪魔をしない');
  assert.match(WORK_CSS, /\.wk-pill \{[^}]*pointer-events: none/);
  assert.match(WORK_CSS, /\.wk-fx \{[^}]*position: fixed/, '場所が動かない(ページの高さを変えない)');
  assert.match(WORK_CSS, /\.wk-fx\[hidden\] \{ display: none; \}/, '出ていない間は計算しない');
  const reduced = WORK_CSS.slice(WORK_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.wk-sp \{ animation: none/);
  assert.match(reduced, /\.wk-ring \{ animation: none/);
  assert.match(reduced, /\.wk-star \{ animation: none/);
  assert.match(reduced, /\.wk-bar i \{ animation: none/);
  // 作る札・入口・テレビ・LED・ヘッドセットでは、舞台の小さな印ときらきらを出さない(札の中の 1 行・入口の一言が出す)
  assert.match(WORK_CSS, /html\.fr-open \.wk-pill/);
  assert.match(WORK_CSS, /html\.gate-up \.wk-fx/);
  assert.match(WORK_CSS, /html\.is-headset \.wk-fx/);
  assert.match(WORK_CSS, /\.wk-note:empty::before/, '一言が空でも高さを取る(文が替わっても場所が跳ねない)');
});

/* ---------- 台本の入れ物 ---------- */

const MOCK = { lines: [{ text: 'こんにちは。' }], brain: 'mock' };

function harness({ creator = createSampleCreator({ main: MAIN }), work = null } = {}) {
  const said = [];
  const stored = new Map();
  const shown = [];
  let offered = [];
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(7)) },
    talk: async () => MOCK,
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: true }) },
    present: async (lines) => {
      said.push(...lines);
    },
    offer: (a) => {
      offered = a;
    },
    showCharacter: async (c) => {
      shown.push(c?.id);
      return true;
    },
    ...(work ? { work } : {}),
    onDone: () => {},
  });
  return {
    fr, said, shown,
    get offered() { return offered.map((a) => a.id); },
    get offeredAll() { return offered; },
    texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text),
  };
}

test('台本は、描く・舞台に出す・絵を見る間に動きを出し、終わったら必ず外す(失敗でも)', async () => {
  const log = [];
  const work = (kind, opt) => {
    log.push(`begin:${kind}`);
    return () => log.push(`end:${kind}`);
  };
  const base = createSampleCreator({ main: MAIN });
  const h = harness({ work, creator: { ...base, make: async (input, o) => base.make(input, o) } });
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('what_auto'); // おまかせで描く(見本の道)→ 舞台に出す
  assert.ok(log.includes('begin:draw') && log.includes('end:draw'), log.join());
  assert.ok(log.includes('begin:stage') && log.includes('end:stage'), log.join());
  const failing = [];
  const h2 = harness({ work: (kind) => (failing.push(`b:${kind}`), () => failing.push(`e:${kind}`)), creator: { ...base, make: async () => { throw new Error('通信が切れた'); } } });
  await h2.fr.start();
  await h2.fr.act('role_home');
  await h2.fr.act('what_auto').catch(() => null);
  const opened = failing.filter((x) => x.startsWith('b:')).length;
  const closed = failing.filter((x) => x.startsWith('e:')).length;
  assert.equal(opened, closed, `失敗でも外す: ${failing.join()}`);
  assert.equal(h.fr._longWork, 0);
});

test('手元の PC が描く間: 「渡した」から「描けた」まで描く動き、歩みの知らせは文を替え、閉じたら外す', async () => {
  const events = [];
  const ends = [];
  const work = (kind) => {
    const end = () => ends.push(kind);
    end.update = (text) => events.push(['update', kind, text]);
    events.push(['begin', kind]);
    return end;
  };
  const local = { mode: 'local', frameUrl: 'x', note: '', check: async () => null, make: async () => null, list: () => [], main: () => MAIN, surprise: () => MAIN };
  const h = harness({ work, creator: local });
  await h.fr.makeEvent({ ev: 'sent', from: 'words', words: 'ひつじ' });
  assert.deepEqual(events.at(-1), ['begin', 'draw']);
  await h.fr.makeEvent({ ev: 'progress', text: '形を つくっているよ' });
  assert.deepEqual(events.at(-2), ['begin', 'build'], '歩みの知らせは 3D を待つ動きにする');
  assert.deepEqual(events.at(-1), ['update', 'build', '形を つくっているよ']);
  assert.deepEqual(ends, ['draw'], '前の動きは外れる');
  await h.fr.makeEvent({ ev: 'drawn', id: 'k1', name: 'ひつじ', round: 1 });
  assert.deepEqual(ends, ['draw', 'build'], '描けたら外す');
  await h.fr.makeEvent({ ev: 'decided', decision: 'keep', id: 'k1', name: 'ひつじ' });
  assert.deepEqual(events.at(-1), ['begin', 'stage'], '2D を組む間');
  h.fr.stopWork();
  assert.deepEqual(ends, ['draw', 'build', 'stage'], '札を閉じたら全部外す');
});

/* ---------- 2. QA8 #4: 描いた子の「なおしたい ところ」 ---------- */

function drawnSetup(fetchImpl) {
  const sample = createSampleCreator({ main: MAIN });
  const creator = createDrawCreator({ sample, enabled: () => true });
  const h = harness({ creator });
  h.fr.character = { id: 'yb261108_aaaaaa', name: 'あたらしい子', sample: false, drawn: true, twod: true, note: 'Claude が描いた子' };
  h.fr.input = { from: 'words', words: 'ふわふわの ひつじの子' };
  h.fr.actions = [{ id: 'fix', label: 'なおしたい ところ', kind: 'text' }]; // 「この子で いい?」の札が出ている状態
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return { h, restore: () => (globalThis.fetch = real) };
}

test('描いた子に「みみ」を送ると、一言は吹き出しに残り、一言を足したことばでもう 1 回描く(見本の子の文にならない)', async () => {
  const bodies = [];
  const { h, restore } = drawnSetup(async (url, init) => {
    assert.equal(url, '/api/draw');
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: 'yb261108_bbbbbb', name: 'あたらしい子' }) };
  });
  try {
    assert.equal(await h.fr.act('fix', { text: 'みみ' }), true);
    assert.deepEqual(h.texts('user'), ['みみ'], '一言は右の吹き出しに出る(捨てない)');
    assert.equal(bodies.length, 1);
    assert.match(bodies[0].words, /^なおす: みみ。/, '一言を先に入れる(長い時に切れない)');
    assert.match(bodies[0].words, /ひつじの子/, '元のことばも渡す');
    assert.ok([...bodies[0].words].length <= 60, 'サーバーの上限(60 字)に収める');
    assert.ok(!h.texts().some((t) => /見本の子の 形や色は/.test(t)), '見本の子の文は出さない');
    assert.equal(h.fr.character.id, 'yb261108_bbbbbb', '描き直した子に替わる');
    assert.ok(h.shown.includes('yb261108_bbbbbb'), '舞台にも出す');
    assert.ok(h.offered.includes('fix') && h.offered.includes('keep'), 'もう一度なおしたい時も、この子にする時も選べる');
  } finally {
    restore();
  }
});

test('長い一言と長いことばでも、一言は切れない(先に入れる)。絵から描いた子は、絵もそのまま付けて描き直す', async () => {
  const bodies = [];
  const { h, restore } = drawnSetup(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: 'yb261108_cccccc', name: 'あたらしい子' }) };
  });
  try {
    h.fr.input = { from: 'words', words: 'あ'.repeat(60) };
    const note = '耳を もっと 大きく して、赤い リボンを つけて';
    await h.fr.act('fix', { text: note });
    assert.ok(bodies[0].words.includes(note), '一言(40 字まで)は全部残る');
  } finally {
    restore();
  }
  // 絵から描いた子
  const pictureCalls = [];
  const setup = drawnSetup(async (url, init) => {
    pictureCalls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: 'yb261108_dddddd', name: 'あたらしい子' }) };
  });
  try {
    const file = { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    setup.h.fr.input = { from: 'picture', kind: 'drawing', url: 'blob:x', file };
    await setup.h.fr.act('fix', { text: 'みどりに' });
    assert.equal(pictureCalls[0].picture.type, 'image/png', '絵も一緒に送る');
    assert.match(pictureCalls[0].words, /なおす: みどりに/);
  } finally {
    setup.restore();
  }
});

test('枠が無い(今日の分・1 人の分を使いきった)時は、一言を残したまま「きょうは もう かけないよ」と言い、いまの子で続けられる', async () => {
  for (const reason of ['daily', 'visitor']) {
    const { h, restore } = drawnSetup(async () => ({ ok: false, json: async () => ({ error: 'つかいきったよ', reason }) }));
    try {
      await h.fr.act('fix', { text: 'みみ' });
      assert.deepEqual(h.texts('user'), ['みみ']);
      assert.ok(h.texts('guide').some((t) => /きょうは もう かけないよ。せいかくと はなしかたは かえられるよ/.test(t)), h.texts('guide').join());
      assert.equal(h.fr.character.id, 'yb261108_aaaaaa', 'いまの子のまま(見本の子に替えない)');
      assert.deepEqual(h.offered, ['keep', 'again'], '行き止まりにしない');
    } finally {
      restore();
    }
  }
  const { h, restore } = drawnSetup(async () => {
    throw new Error('offline');
  });
  try {
    await h.fr.act('fix', { text: 'みみ' });
    assert.ok(h.texts('guide').some((t) => /うまく 描けなかったよ/.test(t)));
    assert.deepEqual(h.offered, ['keep', 'again']);
  } finally {
    restore();
  }
});

test('一言が空なら、そのまま「この子で いい?」へ戻る。見本の子のときは、一言を残して「なおせない」と言う', async () => {
  const { h, restore } = drawnSetup(async () => assert.fail('空のときは描かない'));
  try {
    await h.fr.act('fix', { text: '   ' });
    assert.ok(h.offered.includes('fix'));
    assert.deepEqual(h.texts('user'), []);
  } finally {
    restore();
  }
  const s = harness();
  s.fr.character = { id: 'd_lantern', name: 'ちょうちん', sample: true, note: '' };
  s.fr.actions = [{ id: 'fix', label: 'なおしたい ところ', kind: 'text' }];
  await s.fr.act('fix', { text: 'もっと あかく' });
  assert.deepEqual(s.texts('user'), ['もっと あかく'], '見本の子でも、書いた一言は捨てない');
  assert.ok(s.texts('guide').some((t) => /見本の子の 形や色は、ここでは なおせない/.test(t)));
});

/* ---------- 3. QA8 #5: 絵からの描画が失敗しても枠を減らさない ---------- */

const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const GOOD = `<svg xmlns="${NS}" viewBox="0 0 1254 1254"><rect width="1254" height="1254" fill="#fff"/><g id="char"><g id="body"><circle cx="627" cy="700" r="300" fill="#f2a541"/></g><g id="eye_R"><circle cx="540" cy="640" r="30"/></g><g id="eye_L"><circle cx="714" cy="640" r="30"/></g><g id="mouth"><path d="M590 760 Q627 790 664 760" stroke="#222" fill="none"/></g></g></svg>`;
const PIC = { type: 'image/png', data: Buffer.from([1, 2, 3, 4]).toString('base64') };

function drawerWith(env, fetchImpl, to2d = async () => ({ ok: true })) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-b13-'));
  const d = createDrawer({ config: { anthropicUrl: 'x', anthropicKey: 'test-key' }, root: dir, usageFile: join(dir, 'u.json'), env, fetchImpl, to2d });
  return { d, dir };
}

test('絵から描く道が失敗(上流の拒否・決まりに合わない絵・2D にできない)しても、1 日・1 人の枠は減らない。描けた後だけ数える', async () => {
  let mode = 'upstream400';
  const f = async () => {
    if (mode === 'upstream400') return { ok: false, status: 400, json: async () => ({}) };
    if (mode === 'badsvg') return { ok: true, json: async () => ({ content: [{ type: 'text', text: '<svg><script>x</script></svg>' }], usage: {} }) };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: GOOD }], usage: { input_tokens: 1, output_tokens: 1 } }) };
  };
  let to2dOk = true;
  const { d, dir } = drawerWith({ YC_BROWSER_DRAW: '1', YC_DRAW_DAILY: '3', YC_DRAW_PER_VISITOR: '1' }, f, async () => {
    if (!to2dOk) throw new Error('2D にできませんでした');
    return { ok: true };
  });
  try {
    const left0 = d.status().left;
    assert.equal((await d.draw({ picture: PIC }, '1.1.1.1')).status, 502, '上流が断った');
    mode = 'badsvg';
    assert.equal((await d.draw({ picture: PIC }, '1.1.1.1')).status, 422, '決まりに合わない');
    assert.equal(d.status().left, left0, '失敗では、1 日の枠は減らない');
    assert.equal(d.status().used, 0);
    mode = 'ok';
    const ok = await d.draw({ picture: PIC }, '1.1.1.1');
    assert.equal(ok.status, 201, '1 人 1 枚の枠が残っているので、やり直せる(直前の失敗で使いきっていない)');
    assert.equal(d.status().used, 1, '描けた分だけ数える');
    const again = await d.draw({ picture: PIC }, '1.1.1.1');
    assert.deepEqual([again.status, again.json.reason], [429, 'visitor'], '描けた 1 枚で、1 人の枠は使いきる');
    // 2D にできなかった時も、別の人の枠を減らさない
    to2dOk = false;
    await assert.rejects(d.draw({ picture: PIC }, '9.9.9.9'), /2D/);
    assert.equal(d.status().used, 1);
    to2dOk = true;
    assert.equal((await d.draw({ picture: PIC }, '9.9.9.9')).status, 201, '2D にできなかった人も、やり直せる');
    assert.equal(d.status().used, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('失敗は枚数には数えないが、別に数えて、1 人が 1 日に失敗できる回数には上限を置く(お金を使いきらない)', async () => {
  let calls = 0;
  const f = async () => {
    calls += 1;
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const { d, dir } = drawerWith({ YC_BROWSER_DRAW: '1', YC_DRAW_PER_VISITOR: '1' }, f);
  try {
    for (let i = 0; i < 3; i++) assert.equal((await d.draw({ words: 'ひつじ' }, '2.2.2.2')).status, 502);
    const stop = await d.draw({ words: 'ひつじ' }, '2.2.2.2');
    assert.deepEqual([stop.status, stop.json.reason], [429, 'fails'], '3 回失敗したら、その人は今日は止める');
    assert.equal(calls, 3, '止めた回は上流を呼ばない');
    assert.equal(d.status().left, 20, '枠(枚数)は減っていない');
    assert.equal((await d.draw({ words: 'ひつじ' }, '3.3.3.3')).status, 502, '別の人は、まだ試せる');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('描いている間(busy)は、重ねて描かない。止めた回は枠も失敗の数も動かさない', async () => {
  let release;
  const hold = new Promise((r) => (release = r));
  const f = async () => {
    await hold;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: GOOD }], usage: {} }) };
  };
  const { d, dir } = drawerWith({ YC_BROWSER_DRAW: '1' }, f);
  try {
    const first = d.draw({ words: 'a' }, '4.4.4.4');
    const second = await d.draw({ words: 'b' }, '5.5.5.5');
    assert.deepEqual([second.status, second.json.reason], [429, 'busy']);
    release();
    assert.equal((await first).status, 201);
    assert.equal(d.status().used, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- 4. CU3_2 should 1・2・5・6 ---------- */

const RESUME = { v: 1, step: 3, from: 'words', words: 'ロボ', check: null, character: { id: 'robo', name: 'ロボくん', sample: true, note: '' }, skipped: [], role: 'station', place: { name: 'みどり駅', about: '' }, reload: true };

test('CU3_2 should 1: 続きから「はじめから」を押すと、舞台も案内役へ戻る(舞台がロボのまま、札でノリーが名乗らない)', async () => {
  const h = harness();
  await h.fr.resume(RESUME);
  h.shown.length = 0;
  assert.equal(await h.fr.act('fresh'), true);
  assert.deepEqual(h.shown, [MAIN.id], '案内役を舞台に出し直す');
  assert.equal(h.fr.step, 1);
  assert.ok(h.offered.includes('role_station'));
  // 舞台の入れ替えが読み込み直しになる(false)時は、記録して止まる(続きは resume)
  const r = harness();
  await r.fr.resume(RESUME);
  let saved = 0;
  r.fr.d.showCharacter = async () => false;
  r.fr.d.save = () => (saved += 1);
  await r.fr.act('fresh');
  assert.equal(saved, 1);
});

test('CU3_2 should 2: 「ぜんぶ おまかせ? はい・やめる」の確かめには「はじめから」を足さない(3 つ並ばない)。やめた後の元の選びには残る', async () => {
  const h = harness();
  await h.fr.resume(RESUME);
  assert.ok(h.offered.includes('fresh'));
  const before = h.offeredAll.map((a) => a.id);
  await h.fr.omakaseAsk();
  assert.deepEqual(h.offered, ['omakase_yes', 'omakase_no'], '確かめは 2 つだけ');
  assert.equal(await h.fr.act('omakase_no'), true);
  assert.deepEqual(h.offeredAll.map((a) => a.id), before, 'やめたら、元の選びに戻る(はじめから つき)');
  assert.ok(h.offeredAll.find((a) => a.id === 'fresh').aria, '読み上げでは、何をするかが分かる');
  assert.equal(OMAKASE_NO.length > 0, true);
});

test('CU3_2 should 5: 駅・お店の名前の問いに、問いごとの「おまかせ」(かりの なまえ)がある。全体のおまかせとは別で、あとから変えられると言う', async () => {
  for (const [role, name] of [['station', 'みどり駅'], ['shop', 'ひだまり パン']]) {
    const h = harness();
    await h.fr.start();
    await h.fr.act(`role_${role}`);
    const chip = h.offeredAll.find((a) => a.id === 'place_auto');
    assert.ok(chip, '名前の問いに おまかせ');
    assert.equal(chip.label, OMAKASE_CHIP);
    assert.equal(AUTO_PLACE[role], name);
    assert.ok(chip.aria.includes(name), '読み上げで、入る名前が分かる');
    assert.ok(!chip.noAuto, '全体の「のこりを ぜんぶ おまかせ」も、この問いに残る(別の札。「どんな ことを」の問いと同じ並び)');
    assert.ok(h.offered.includes('place_skip') && h.offered.includes('place_name'), '今までの 2 つも残る');
    await h.fr.act('place_auto');
    assert.equal(h.fr.place.name, name, 'かりの なまえが入る');
    assert.equal(h.fr.role, role, '役目は替わらない(全部おまかせにならない)');
    assert.ok(h.texts('note').some((t) => t.includes(name) && /あとから かえられる/.test(t)), '本当の名前でないこと・あとで変えられることを言う');
    assert.equal(h.texts('user').filter((t) => t === name).length, 0, '名前を、使う人の言葉として二重に出さない');
    assert.ok(h.offered.includes('what_auto') || h.offered.length > 0, '次の問いへ進む');
  }
});

test('CU3_2 should 6: 作る画面の見出しは、入口のボタンと同じ「あたらしい子を つくる」', () => {
  assert.equal(CREATE_TITLE, START_LABEL);
  assert.equal(START_LABEL, 'あたらしい子を つくる');
});

/* ---------- 待つ表示と起動中の表示を、選んだことばで ---------- */

test('入口の一言と、返事を待つ一言は、ja・en・zh・ko で出る。日本語は今までと同じ。知らないことばは日本語', () => {
  assert.equal(wakeLoading('ノリー'), 'ノリーが おきているよ…');
  assert.equal(thinkingText('ノリー'), 'ノリーが かんがえているよ');
  assert.equal(wakeLoading('Mika', 'en'), 'Mika is waking up…');
  assert.equal(thinkingText('Mika', 'en'), 'Mika is thinking');
  assert.equal(thinkingText('米卡', 'zh'), '米卡正在想');
  assert.equal(thinkingText('미카', 'ko'), '미카 생각 중이에요');
  assert.equal(wakeLine('ready', { lang: 'en' }), 'Ready! Tap to start');
  assert.equal(wakeLine('busy', { lang: 'zh' }), '正在准备…');
  assert.match(wakeLine('failed', { lang: 'ko' }), /다시/);
  assert.equal(wakeLine('loading', { name: 'ノリー', lang: 'xx' }), 'ノリーが おきているよ…');
  assert.equal(wakeLine('ready'), 'じゅんび できたよ! おしてね');
  assert.equal(wakeHint('en'), 'Tap when the button glows');
  assert.equal(wakeHint(), 'ボタンが ひかったら、おしてね');
  // 名前が無い時は、そのことばの既定の名前
  assert.equal(wakeLoading('', 'en'), 'Norrie is waking up…');
  assert.equal(thinkingText('', 'zh'), '诺里正在想');
});

test('待つ吹き出しは、選んだことばで出る。きらきらの動き(track)は待ちの間だけ、文は吹き出しに任せる(pill: false)', () => {
  const timers = fakeTimers();
  const calls = [];
  const tracked = [];
  let lang = 'en';
  const bubble = createWaitBubble({
    render: (v, t) => calls.push([v, t]),
    nameOf: () => 'Mika',
    langOf: () => lang,
    timers,
    track: (kind, opt) => {
      tracked.push(['begin', kind, opt]);
      return () => tracked.push(['end', kind]);
    },
  });
  bubble.begin();
  assert.deepEqual(tracked, [['begin', 'think', { pill: false }]], 'きらきらは文なし');
  timers.advance(WAIT_DELAY_MS + 1);
  assert.deepEqual(calls, [[true, 'Mika is thinking']]);
  bubble.begin(); // 出ている間の呼び直しで、きらきらを重ねない
  assert.equal(tracked.length, 1);
  bubble.end();
  assert.deepEqual(tracked.at(-1), ['end', 'think']);
  lang = 'ko';
  bubble.begin({ immediate: true });
  assert.deepEqual(calls.at(-1), [true, 'Mika 생각 중이에요']);
  bubble.end();
  assert.equal(tracked.filter((x) => x[0] === 'begin').length, 2);
  assert.equal(tracked.filter((x) => x[0] === 'end').length, 2, '終われば必ず外す');
});
