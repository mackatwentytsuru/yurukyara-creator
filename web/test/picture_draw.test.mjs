// 絵から描く道(11/8 b13 picdraw)の試験。絵は自分たちで作った小さな絵だけ(よその会社の絵は使わない・置かない)。
// 本物の Claude は呼ばない。中継の「絵の段を通す」形は、偽の中継(HTTP)で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FirstRun, RIGHTS_ASK, RIGHTS_LABELS, drawFailedAsk } from '../src/ui/onboarding/script.js';
import { createDrawCreator, createSampleCreator, originalWords, pictureFailure, SAMPLE_CHARACTERS } from '../src/ui/onboarding/creators.js';
import { createDrawer } from '../server/draw.mjs';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';

// 自分たちで作った 1x1 の PNG(中身に意味は無い)
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const GOOD = `<svg xmlns="${NS}" viewBox="0 0 1254 1254"><rect width="1254" height="1254" fill="#fff"/><g id="char"><g id="body"><circle cx="627" cy="700" r="300" fill="#f2a541"/></g><g id="eye_R"><circle cx="540" cy="640" r="30"/></g><g id="eye_L"><circle cx="714" cy="640" r="30"/></g><g id="mouth"><path d="M590 760 Q627 790 664 760" stroke="#222" fill="none"/></g></g></svg>`;
const SAMPLE_NAMES = SAMPLE_CHARACTERS.map((s) => s.name);
const fakeFile = () => {
  const bytes = Buffer.from(PNG_1PX, 'base64');
  return { type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

function harness({ creator }) {
  const said = [];
  const shown = [];
  let offered = [];
  const stored = new Map();
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(7)) },
    talk: async () => ({ lines: [{ text: 'こんにちは。' }], brain: 'mock' }),
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
    present: async (lines) => { said.push(...lines); },
    offer: (a) => { offered = a; },
    showCharacter: async (c) => { shown.push(c?.id); return true; },
  });
  return {
    fr, said, shown,
    get offered() { return offered.map((a) => a.id); },
    texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text),
  };
}

/** /api/draw の返事を偽にして、送られた本文を残す。reply は (本文) => ({ status, json }) */
function withFetch(reply, fn) {
  const real = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/draw');
    const b = JSON.parse(init.body);
    bodies.push(b);
    const r = reply(b);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return fn(bodies).finally(() => { globalThis.fetch = real; });
}
const OK = () => ({ status: 201, json: { id: 'yb261108_abcdef', name: 'あたらしい子' } });
const drawing = () => createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => true });

async function toRights(h) {
  await h.fr.start();
  await h.fr.act('role_home');
  await h.fr.act('pick', { url: 'blob:own', name: 'own.png', file: fakeFile() });
}

test('絵を選ぶと、描く前に「使っていい絵か」を 1 回だけ聞く(まだ送らない)。はい → その絵から描く', async () => {
  await withFetch(OK, async (bodies) => {
    const h = harness({ creator: drawing() });
    await toRights(h);
    assert.equal(h.texts('guide').filter((t) => t === RIGHTS_ASK).length, 1);
    assert.equal(RIGHTS_ASK, 'この絵のキャラを使っていい人ですか?(自分のキャラ・使ってよいと言われたキャラ)');
    assert.deepEqual(h.offered, ['rights_yes', 'rights_unsure', 'rights_no', 'rights_person']);
    assert.equal(bodies.length, 0, '答えが来るまで、絵をどこにも送らない');
    await h.fr.act('rights_yes');
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0].picture, { type: 'image/png', data: PNG_1PX }, '絵がそのまま(縮めない小さな絵は元のまま)届く');
    assert.equal(bodies[0].words, undefined);
    assert.equal(h.fr.character.id, 'yb261108_abcdef');
    assert.equal(h.fr.character.drawn, true);
    assert.ok(h.texts('note').some((t) => t.includes('Claude(Anthropic)に 送って')), 'どこへ送るかを言う');
    assert.equal(h.texts('guide').filter((t) => t === RIGHTS_ASK).length, 1, 'もう一度は聞かない');
  });
});

test('わからない・いいえ・人の写真: 絵は送らず、色と形だけ聞いて、新しいオリジナルの子を描く(そっくりにしない)', async () => {
  for (const [id, person] of [['rights_unsure', false], ['rights_no', false], ['rights_person', true]]) {
    await withFetch(OK, async (bodies) => {
      const h = harness({ creator: drawing() });
      await toRights(h);
      await h.fr.act(id);
      assert.equal(bodies.length, 0, `${id}: まだ送らない`);
      assert.deepEqual(h.offered, ['orig_yes', 'other']);
      assert.ok(h.texts().some((t) => t.includes('どこにも 送らないよ')), `${id}: 送らないと言う`);
      assert.ok(h.texts('note').some((t) => t.includes('オリジナル')), `${id}: オリジナルの子を提案する`);
      assert.ok(person ? h.texts('guide').some((t) => t.startsWith('人の絵なんだね')) : h.texts('guide').some((t) => t.includes('そのままは 使わない')), id);
      assert.ok(h.shown.length === 0, `${id}: 見本の子を出さない`);
      await h.fr.act('orig_yes');
      assert.ok(h.offered.every((x) => x.startsWith('col_')), '色を聞く');
      await h.fr.act('col_blue');
      await h.fr.act('shp_round');
      assert.equal(bodies.length, 1, id);
      assert.equal(bodies[0].picture, undefined, `${id}: 絵の中身は送らない`);
      assert.match(bodies[0].words, /あお/);
      assert.match(bodies[0].words, /オリジナル/);
      assert.ok([...bodies[0].words].length <= 60, 'サーバーの上限 60 字の中');
      assert.equal(h.fr.character.drawn, true, id);
    });
  }
});

test('描けなかった時は、見本の子を黙って出さない。ノリーの言葉で正直に言い、もういちど・ことばで・見本から、を出す', async () => {
  const names = ['status 502', 'つながらない'];
  const replies = [() => ({ status: 502, json: { error: '描けなかったよ。見本の子で ためしてね' } }), () => new Error('network')];
  for (const [i, reply] of replies.entries()) {
    await withFetch(reply, async (bodies) => {
      const h = harness({ creator: drawing() });
      await toRights(h);
      await h.fr.act('rights_yes');
      assert.equal(bodies.length, 1, names[i]);
      assert.deepEqual(h.shown, [], `${names[i]}: 舞台に子を出さない`);
      assert.equal(h.fr.character, null, `${names[i]}: 見本の子を選ばない`);
      assert.ok(h.texts('guide').includes(drawFailedAsk('絵', true)), 'ノリーの口調(〜マス)で正直に言う');
      assert.match(drawFailedAsk('絵', true), /デ?マ(セン|ス)/);
      assert.ok(!h.texts().some((t) => SAMPLE_NAMES.some((n) => t.includes(n)) || t.includes('にた 見本の子')), '見本の名前も「にた 見本の子を出すね」も出ない');
      assert.deepEqual(h.offered, ['draw_retry', 'draw_words', 'choose_sample']);
    });
  }
});

test('描けなかった後: もういちど(もう一度は聞かない)・ことばで・見本から(自分で選ぶ)の 3 つが動く', async () => {
  let n = 0;
  await withFetch(() => (++n === 1 ? { status: 502, json: {} } : OK()), async (bodies) => {
    const h = harness({ creator: drawing() });
    await toRights(h);
    await h.fr.act('rights_yes');
    await h.fr.act('draw_retry');
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1].picture, { type: 'image/png', data: PNG_1PX }, 'やり直しも同じ絵');
    assert.equal(h.fr.character.drawn, true);
    assert.equal(h.texts('guide').filter((t) => t === RIGHTS_ASK).length, 1, '「使っていい絵か」はくり返さない');
  });
  await withFetch(() => ({ status: 502, json: {} }), async (bodies) => {
    const h = harness({ creator: drawing() });
    await toRights(h);
    await h.fr.act('rights_yes');
    await h.fr.act('draw_words');
    assert.deepEqual(h.offered, ['words', 'again']);
    await h.fr.act('words', { text: '赤い ちょうちんの子' });
    assert.equal(bodies.at(-1).words, '赤い ちょうちんの子', 'ことばの道は、ことばで描く');
    const h2 = harness({ creator: drawing() });
    await toRights(h2);
    await h2.fr.act('rights_yes');
    await h2.fr.act('choose_sample');
    assert.ok(h2.offered.some((x) => x.startsWith('s_')), '見本は、使う人が自分で選ぶ');
    assert.deepEqual(h2.shown, [], '選ぶまで舞台に出さない');
  });
});

test('今日の枚数を使い切った時は、「もういちど」を出さない(ことばと見本は出す)。理由も言う', async () => {
  await withFetch(() => ({ status: 429, json: { error: 'x', reason: 'daily' } }), async () => {
    const h = harness({ creator: drawing() });
    await toRights(h);
    await h.fr.act('rights_yes');
    assert.deepEqual(h.offered, ['draw_words', 'choose_sample']);
    assert.ok(h.texts('note').some((t) => t.includes('これ以上は 描けない')));
  });
  assert.deepEqual(pictureFailure(400, undefined).reason, 'unusable');
  assert.equal(pictureFailure(0, null).reason, 'failed');
});

test('描く道が切ってある時は、絵を送らないので、「使っていい絵か」も聞かない(色と形の道のまま)', async () => {
  const creator = createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => false });
  const h = harness({ creator });
  await toRights(h);
  assert.ok(!h.texts().includes(RIGHTS_ASK));
  assert.ok(h.offered.every((x) => x.startsWith('col_')));
});

test('ことばの道は、今までどおり(描けなかったら「にた 見本の子を 出すね」と言って見本を出す)', async () => {
  await withFetch(() => ({ status: 502, json: { error: '描けなかったよ' } }), async () => {
    const h = harness({ creator: drawing() });
    await h.fr.start();
    await h.fr.act('role_home');
    await h.fr.act('words', { text: '赤い 提灯の子' });
    assert.ok(h.texts('note').some((t) => t.includes('にた 見本の子を 出すね')));
    assert.equal(h.fr.character.id, 'd_lantern');
  });
  assert.equal(RIGHTS_LABELS.person, '人の写真です');
  assert.equal(originalWords({ colors: ['black', 'gray'], shape: 'tall' }), 'くろ・はいいろの 色で たてに ながい かたちの あたらしい オリジナルの ゆるキャラ');
  assert.equal(originalWords({ colors: [], shape: 'any' }), 'あたらしい オリジナルの ゆるキャラ');
});

test('中継(偽): サーバーの描く道が、絵を image の段で送り、中継が返した絵(SVG)から 201 まで進む', async () => {
  const seen = [];
  const relay = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      seen.push({ key: req.headers['x-api-key'], blocks: b.messages[0].content.map((c) => c.type), media: b.messages[0].content[0].source?.media_type, data: b.messages[0].content[0].source?.data });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: GOOD }], usage: { input_tokens: 0, output_tokens: 0 }, model: b.model }));
    });
  });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'yc-pic-'));
  try {
    const url = `http://127.0.0.1:${relay.address().port}/v1/messages`;
    const d = createDrawer({ config: { anthropicUrl: url, anthropicKey: 'test-key' }, root: dir, usageFile: join(dir, 'u.json'), env: { YC_BROWSER_DRAW: '1' }, to2d: async () => ({ ok: true }) });
    const r = await d.draw({ picture: { type: 'image/png', data: PNG_1PX } }, '1.2.3.4');
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(seen[0].blocks, ['image', 'text'], '絵の段のあとに文の段');
    assert.equal(seen[0].media, 'image/png');
    assert.equal(seen[0].data, PNG_1PX);
  } finally {
    relay.closeAllConnections?.();
    await new Promise((r) => relay.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
