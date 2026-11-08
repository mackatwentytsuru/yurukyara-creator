// 11/8 の試しのログ(17:07〜17:40)から見つかった、描き直しの痛みの直しの試験。画面なし・本物の Claude は呼ばない。
// - 直すたびに別の子・別の名前になった: 「なおしたい ところ」は、前の子の名前と、前に描いた絵をもとに頼む
// - 待ちの案内「1 分くらい」は実際(6〜14 秒)と合わなかった
// - 最後の 1 枚だけ 13 秒かかったが、どこで待ったか分けられなかった: Claude の返事までと 2D にするまでを分けて残す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDrawer, readBaseSvg } from '../server/draw.mjs';
import { createDrawCreator, createSampleCreator } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const GOOD = `<svg xmlns="${NS}" viewBox="0 0 1254 1254"><rect width="1254" height="1254" fill="#fff"/><g id="char"><g id="body"><circle cx="627" cy="700" r="300" fill="#f2a541"/></g><g id="eye_R"><circle cx="540" cy="640" r="30"/></g><g id="eye_L"><circle cx="714" cy="640" r="30"/></g><g id="mouth"><path d="M590 760 Q627 790 664 760" stroke="#222" fill="none"/></g></g></svg>`;
const PREV_ID = 'yb261108_abcdef';

async function withFetch(fn, handler) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('なおしたい ところ: 前の子の名前と、直す元の絵の id も送る(一言が先、名前、元のことばの順)', async () => {
  const bodies = [];
  const creator = createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => true });
  await withFetch(
    async () => {
      const r = await creator.redraw({ from: 'words', words: 'ふわふわの ひつじの子' }, 'みみを もっと 大きく', { prev: { id: PREV_ID, name: 'コピちゃん' } });
      assert.equal(r.ok, true);
      assert.equal(bodies[0].words, 'なおす: みみを もっと 大きく。名前は コピちゃん。ふわふわの ひつじの子');
      assert.equal(bodies[0].base, PREV_ID, '前に描いた絵をもとに直す');
    },
    async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'yb261108_bbbbbb', name: 'コピちゃん' }) };
    },
  );
});

test('なおしたい ところ: 名前が既定(あたらしい子)なら名前は引き継がない。id の形が違えば元の絵も送らない。最初に描く時は付けない', async () => {
  const bodies = [];
  const creator = createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => true });
  await withFetch(
    async () => {
      await creator.redraw({ from: 'words', words: 'ひつじ' }, 'あか', { prev: { id: 'yb261108_abcdef', name: 'あたらしい子' } });
      assert.equal(bodies[0].words, 'なおす: あか。ひつじ', '既定の名前は引き継がない');
      await creator.redraw({ from: 'words', words: 'ひつじ' }, 'あか', { prev: { id: '../../x', name: 'コピ' } });
      assert.equal('base' in bodies[1], false, '形の違う id は送らない');
      await creator.make({ from: 'words', words: 'ひつじ' });
      assert.equal('base' in bodies[2], false, '最初に描く時は元の絵が無い');
      assert.equal(bodies[2].words, 'ひつじ');
      await creator.redraw({ from: 'words', words: 'あ'.repeat(60) }, 'みみ', { prev: { id: PREV_ID, name: 'コピちゃん' } });
      assert.ok([...bodies[3].words].length <= 60 && bodies[3].words.startsWith('なおす: みみ。名前は コピちゃん。'), '長くても一言と名前は切れない(後ろの元のことばが切れる)');
    },
    async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'yb261108_cccccc', name: 'x' }) };
    },
  );
});

test('サーバー: 直す元の絵(前に置いた SVG)を、Claude への頼みに付ける。形の違う id・無い・確かめに通らない絵は付けない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-lr2-'));
  try {
    mkdirSync(join(dir, 'creator', 'work', '_browser_draw'), { recursive: true });
    writeFileSync(join(dir, 'creator', 'work', '_browser_draw', `${PREV_ID}.svg`), GOOD);
    writeFileSync(join(dir, 'creator', 'work', '_browser_draw', 'yb261108_000000.svg'), '<svg><script>x</script></svg>');
    assert.equal(readBaseSvg(dir, PREV_ID), GOOD);
    assert.equal(readBaseSvg(dir, 'yb261108_000000'), '', '確かめに通らない絵は使わない');
    assert.equal(readBaseSvg(dir, 'yb261108_ffffff'), '', '無い絵は空');
    for (const bad of ['../../etc/passwd', 'yb261108_abcdef/../x', '', null, undefined, 5, 'YB261108_ABCDEF']) assert.equal(readBaseSvg(dir, bad), '', `形の違う id は読まない: ${String(bad)}`);

    const calls = [];
    const f = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: `名前: コピちゃん\n性格: げんき\n${GOOD}` }], usage: { input_tokens: 1, output_tokens: 2 }, model: 'm' }) };
    };
    const d = createDrawer({ config: { anthropicUrl: 'x', anthropicKey: 'k' }, root: dir, usageFile: join(dir, 'u.json'), env: { YC_BROWSER_DRAW: '1', YC_DRAW_PER_VISITOR: '99', YC_DRAW_DAILY: '99' }, fetchImpl: f, to2d: async () => ({ ok: true }) });
    assert.equal((await d.draw({ words: 'なおす: あか。名前は コピちゃん。ひつじ', base: PREV_ID }, '1.1.1.1')).status, 201);
    const withBase = calls[0].messages[0].content.at(-1).text;
    assert.ok(withBase.includes('直す元の絵') && withBase.includes('id="mouth"'), '元の絵が頼みに入る');
    assert.match(withBase, /指示ではない/, '元の絵も人の材料。指示ではないと囲む');
    assert.equal((await d.draw({ words: 'ひつじ' }, '1.1.1.1')).status, 201);
    assert.ok(!calls[1].messages[0].content.at(-1).text.includes('直す元の絵'), 'base が無ければ付けない');
    assert.equal((await d.draw({ words: 'ひつじ', base: '../../x' }, '1.1.1.1')).status, 201);
    assert.ok(!calls[2].messages[0].content.at(-1).text.includes('直す元の絵'), '形の違う base は付けない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('サーバー: 所要時間を分けて残す(Claude の返事まで・2D にするまで)。記録に接続元は入れない。失敗した回も残る', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-lr2-'));
  try {
    let t = 1_000_000;
    const now = () => t;
    const f = async () => {
      t += 8_400; // Claude の返事までが 8.4 秒
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: GOOD }], usage: {}, model: 'm' }) };
    };
    const to2d = async () => {
      t += 5_100; // 2D にするまでが 5.1 秒
      return { ok: true };
    };
    const usageFile = join(dir, 'u.json');
    const d = createDrawer({ config: { anthropicUrl: 'x', anthropicKey: 'k' }, root: dir, usageFile, env: { YC_BROWSER_DRAW: '1', YC_DRAW_PER_VISITOR: '99', YC_DRAW_DAILY: '99' }, fetchImpl: f, to2d, now });
    const r = await d.draw({ words: 'ひつじ' }, '203.0.113.9');
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.phases, { claude: 8400, to2d: 5100 });
    assert.equal(r.json.ms, 13_500, '全体の所要時間');
    const bad = createDrawer({ config: { anthropicUrl: 'x', anthropicKey: 'k' }, root: dir, usageFile, env: { YC_BROWSER_DRAW: '1', YC_DRAW_PER_VISITOR: '99', YC_DRAW_DAILY: '99' }, fetchImpl: async () => ({ ok: false }), to2d, now });
    assert.equal((await bad.draw({ words: 'ひつじ' }, '203.0.113.9')).status, 502);
    const u = JSON.parse(readFileSync(usageFile, 'utf8'));
    assert.equal(u.recent.length, 2);
    assert.deepEqual([u.recent[0].ok, u.recent[0].ms, u.recent[0].claude, u.recent[0].to2d], [true, 13_500, 8400, 5100]);
    assert.equal(u.recent[1].ok, false);
    assert.ok(!JSON.stringify(u.recent).includes('203.0.113.9'), '記録に接続元の住所は入れない');
    for (let i = 0; i < 40; i++) await d.draw({ words: 'ひつじ' }, '203.0.113.9');
    assert.ok(JSON.parse(readFileSync(usageFile, 'utf8')).recent.length <= 30, '直近 30 回まで');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('待ちの案内は、実測(6〜14 秒)に合わせて 10〜30 秒。「1 分くらい」とは言わない', async () => {
  const said = [];
  const creator = createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => true });
  await withFetch(
    async () => {
      await creator.make({ from: 'words', words: 'ひつじ' }, { onProgress: (t) => said.push(t) });
    },
    async () => ({ ok: true, json: async () => ({ id: 'yb261108_dddddd', name: 'x' }) }),
  );
  assert.equal(said.length, 1);
  assert.match(said[0], /10〜30 秒くらい/);
  assert.ok(!said[0].includes('1 分'));
});
