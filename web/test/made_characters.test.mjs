// 作った子(characters/yb*)の一覧・名前の変更・消す(server/madeCharacters.mjs)の試験。
// - サーバーのフォルダから一覧が出る(新しい順・見本の子は入れない)。作り直した(別のサーバーの入れ直し)後も同じ
// - 名前の変更: character.json と persona.md の見出し。使えない名前・作った子でない id は断る
// - 消す: 捨てずに creator/work/_deleted_characters/ へ移す(一覧から消える)
// - 受け口: GET は誰でも・PATCH と DELETE は、ブラウザから作る設定の時か、この PC の中からだけ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MADE_ID_RE, cleanName, createMadeCharacters, createMadeRoutes } from '../server/madeCharacters.mjs';

/** 作った子 1 人分のフォルダ(to_2d.py が作る形) */
function makeKid(root, id, { name = 'あたらしい子', created = '2026-11-08T14:25:06+09:00', twoD = true } = {}) {
  const dir = join(root, 'characters', id);
  mkdirSync(join(dir, '2d'), { recursive: true });
  writeFileSync(join(dir, 'character.json'), JSON.stringify({ id, name, schema_version: 1, persona: 'persona.md', looks: { '2d': { parts: '2d/parts.json' }, default: '2d' }, role: 'home', origin: { drawn_by: 'claude', created } }, null, 2));
  writeFileSync(join(dir, 'persona.md'), `# ${name}\n\n- 生まれ: Claude が描いた絵で生まれたゆるキャラ。\n`);
  if (twoD) writeFileSync(join(dir, '2d', 'parts.json'), '{}');
  return dir;
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'yc-made-'));
  mkdirSync(join(root, 'characters', 'norrie'), { recursive: true });
  writeFileSync(join(root, 'characters', 'norrie', 'character.json'), JSON.stringify({ id: 'norrie', name: 'ノリー' }));
  mkdirSync(join(root, 'characters', 'mikan'), { recursive: true });
  writeFileSync(join(root, 'characters', 'mikan', 'character.json'), JSON.stringify({ id: 'mikan', name: 'みかんちゃん', origin: { drawn_by: 'claude' } }));
  return root;
}

test('一覧: 作った子だけ・新しい順。主役と見本の子は入れない。名前と時刻と見た目が付く', () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa', { created: '2026-11-08T10:00:00+09:00' });
    makeKid(root, 'yb261108_bbbbbb', { created: '2026-11-08T14:25:06+09:00', name: 'ももちゃん' });
    makeKid(root, 'yb261107_cccccc', { created: '2026-11-07T09:00:00+09:00' });
    const items = createMadeCharacters({ root }).list();
    assert.deepEqual(items.map((i) => i.id), ['yb261108_bbbbbb', 'yb261108_aaaaaa', 'yb261107_cccccc']);
    assert.equal(items[0].name, 'ももちゃん');
    assert.equal(items[0].at, Date.parse('2026-11-08T14:25:06+09:00'));
    assert.equal(items[0].look, '2d');
    assert.ok(items.every((i) => MADE_ID_RE.test(i.id)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('一覧: こわれたフォルダ(character.json が無い・id が違う・壊れている)は飛ばす', () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    mkdirSync(join(root, 'characters', 'yb261108_bbbbbb'), { recursive: true }); // character.json なし
    makeKid(root, 'yb261108_cccccc');
    writeFileSync(join(root, 'characters', 'yb261108_cccccc', 'character.json'), '{こわれた');
    makeKid(root, 'yb261108_dddddd');
    writeFileSync(join(root, 'characters', 'yb261108_dddddd', 'character.json'), JSON.stringify({ id: 'ほかの子', name: 'x' }));
    assert.deepEqual(createMadeCharacters({ root }).list().map((i) => i.id), ['yb261108_aaaaaa']);
    assert.deepEqual(createMadeCharacters({ root: join(root, 'ない') }).list(), [], 'フォルダ自体が無くても空');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('サーバーを入れ直しても(別の係を作り直しても)、作った子は同じに出る(ファイルに残っている)', () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    const before = createMadeCharacters({ root }).list();
    const after = createMadeCharacters({ root }).list();
    assert.deepEqual(after, before);
    assert.equal(after.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('名前の変更: character.json と persona.md の見出しが変わり、残る。ほかの欄は変えない', () => {
  const root = sandbox();
  try {
    const dir = makeKid(root, 'yb261108_aaaaaa');
    const made = createMadeCharacters({ root });
    assert.equal(made.rename('yb261108_aaaaaa', '  タロウ  くん '), 'タロウ くん');
    const json = JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8'));
    assert.equal(json.name, 'タロウ くん');
    assert.equal(json.role, 'home');
    assert.equal(json.origin.drawn_by, 'claude');
    assert.equal(json.looks.default, '2d');
    assert.match(readFileSync(join(dir, 'persona.md'), 'utf8'), /^# タロウ くん\n\n- 生まれ/);
    assert.equal(createMadeCharacters({ root }).list()[0].name, 'タロウ くん', '作り直した係でも新しい名前');
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')), '書きかけのファイルを残さない');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('名前の変更: 空・記号だけ・作った子でない id・無い子は断る。長い名前は 20 字まで。<>"` は外す', () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    const made = createMadeCharacters({ root });
    assert.throws(() => made.rename('yb261108_aaaaaa', '   '), (e) => e.status === 400);
    assert.throws(() => made.rename('yb261108_aaaaaa', '<>"`'), (e) => e.status === 400);
    assert.throws(() => made.rename('mikan', 'ほかの子'), (e) => e.status === 404, '見本の子は変えられない');
    assert.throws(() => made.rename('norrie', 'ほかの子'), (e) => e.status === 404, '主役は変えられない');
    assert.throws(() => made.rename('yb261108_zzzzzz', 'x'), (e) => e.status === 404, '無い子');
    assert.throws(() => made.rename('../mikan', 'x'), (e) => e.status === 404, 'パスは通さない');
    assert.equal(cleanName('あ'.repeat(30)).length, 20);
    assert.equal(cleanName('<b>たろう</b>\n"x"'), 'b たろう /b x');
    assert.equal(JSON.parse(readFileSync(join(root, 'characters', 'mikan', 'character.json'), 'utf8')).name, 'みかんちゃん', '見本の子は変わらない');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('消す: 捨てずに creator/work/_deleted_characters/ へ移す。一覧から消え、見本の子は消せない', () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    makeKid(root, 'yb261108_bbbbbb');
    const made = createMadeCharacters({ root, now: () => Date.parse('2026-11-08T15:30:00Z') });
    const kept = made.remove('yb261108_aaaaaa');
    assert.match(kept, /^yb261108_aaaaaa_20261108153000$/);
    assert.deepEqual(made.list().map((i) => i.id), ['yb261108_bbbbbb']);
    assert.ok(!existsSync(join(root, 'characters', 'yb261108_aaaaaa')));
    assert.ok(existsSync(join(root, 'creator', 'work', '_deleted_characters', kept, 'character.json')), '移した先に残っている(戻せる)');
    assert.throws(() => made.remove('yb261108_aaaaaa'), (e) => e.status === 404, 'もう無い');
    assert.throws(() => made.remove('mikan'), (e) => e.status === 404);
    assert.ok(existsSync(join(root, 'characters', 'mikan', 'character.json')), '見本の子は消えない');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** 受け口を本物の http サーバーに付けて呼ぶ */
async function withRoutes(root, { canEdit = () => true, env = {} } = {}, fn) {
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  };
  const routes = createMadeRoutes({ root, env, readBody, canEdit });
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (!(await routes(req, res, path))) res.writeHead(404).end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const send = (base, method, body) => fetch(`${base}/api/characters`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('受け口: 一覧 → 名前を変える → 消す(ブラウザから作る設定の時)', async () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    await withRoutes(root, {}, async (base) => {
      const list = await (await send(base, 'GET')).json();
      assert.deepEqual(list.items.map((i) => i.id), ['yb261108_aaaaaa']);
      const r = await send(base, 'PATCH', { id: 'yb261108_aaaaaa', name: 'ハナ' });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).name, 'ハナ');
      assert.equal((await (await send(base, 'GET')).json()).items[0].name, 'ハナ');
      assert.equal((await send(base, 'PATCH', { id: 'yb261108_aaaaaa', name: '' })).status, 400);
      assert.equal((await send(base, 'PATCH', { id: 'mikan', name: 'x' })).status, 404);
      assert.equal((await send(base, 'DELETE', { id: 'yb261108_aaaaaa' })).status, 200);
      assert.deepEqual((await (await send(base, 'GET')).json()).items, []);
      assert.equal((await send(base, 'DELETE', { id: 'yb261108_aaaaaa' })).status, 404);
      assert.equal((await send(base, 'POST', {})).status, 405);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('受け口: 名前の変更と消すは、作る設定が切れていて、この PC の外からなら断る(一覧は読める)。YC_CHARACTER_LIST=0 で一覧も止める', async () => {
  const root = sandbox();
  try {
    makeKid(root, 'yb261108_aaaaaa');
    // 試験は 127.0.0.1 からつなぐので、「この PC の中」になる。外からのつなぎは、接続元を偽装して確かめる
    const routes = createMadeRoutes({ root, env: {}, readBody: async () => ({ id: 'yb261108_aaaaaa', name: 'x' }), canEdit: () => false });
    const out = { status: 0, body: '' };
    const res = { writeHead(s) { out.status = s; return this; }, end(b) { out.body = b; return this; } };
    await routes({ method: 'PATCH', socket: { remoteAddress: '203.0.113.9' } }, res, '/api/characters');
    assert.equal(out.status, 403);
    await routes({ method: 'DELETE', socket: { remoteAddress: '203.0.113.9' } }, res, '/api/characters');
    assert.equal(out.status, 403);
    assert.ok(existsSync(join(root, 'characters', 'yb261108_aaaaaa', 'character.json')), '断った時は、何も変えない');
    await routes({ method: 'GET', socket: { remoteAddress: '203.0.113.9' } }, res, '/api/characters');
    assert.equal(out.status, 200);
    await withRoutes(root, { env: { YC_CHARACTER_LIST: '0' } }, async (base) => {
      assert.deepEqual((await (await send(base, 'GET')).json()).items, []);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
