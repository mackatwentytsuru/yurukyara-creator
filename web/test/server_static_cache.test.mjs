// 配るファイルの圧縮(gzip)とキャッシュの指示(CU)。スマホの遅い回線で、入口のボタンが押せるまでの時間を縮める。
// - 文字・形のファイル(json・glb など)は、gzip に対応した端末へ圧縮して返す。対応しない端末へは、そのまま返す
// - 中身が変わっていなければ 304(本文なし)。変わらない物は、毎回取り直さない
// - 画面の部品(dist/assets/ の、名前に印の入った js・css)は 1 年覚えさせる。dist が無い時はその 1 つだけ飛ばす
// - キャラのファイルの外(..)には出られない
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '..');
let proc = null;
let port = 0;

const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });

/** 本文を縮めずにそのまま受け取る(node の fetch は、勝手に解凍して印を隠すので使わない) */
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE']) delete env[k];
  proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get('/api/status')).status === 200) return;
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('サーバーが立ちませんでした');
});

after(() => {
  proc?.kill();
});

const MODEL = '/characters/norrie/model.glb';
const JSON_FILE = '/characters/norrie/character.json';

test('gzip に対応した端末へは、形のファイル(glb)を圧縮して返す。展開すると元と同じ', async () => {
  const r = await get(MODEL, { 'accept-encoding': 'gzip, deflate' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.headers.vary, 'Accept-Encoding');
  const raw = readFileSync(join(REPO, MODEL));
  assert.ok(r.body.length < raw.length, `圧縮した方が小さい(${r.body.length} < ${raw.length})`);
  assert.deepEqual(gunzipSync(r.body), raw);
  assert.equal(Number(r.headers['content-length']), r.body.length);
});

test('gzip に対応しない端末へは、そのまま返す(圧縮の印も付けない)', async () => {
  const r = await get(JSON_FILE, { 'accept-encoding': 'identity' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.deepEqual(r.body, readFileSync(join(REPO, JSON_FILE)));
});

test('文字のファイル(json)も圧縮して返す。展開すると元と同じ', async () => {
  const r = await get(JSON_FILE, { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200);
  const raw = readFileSync(join(REPO, JSON_FILE));
  // 256 バイト以下の小さなファイルは、圧縮しても得がないのでそのまま返す
  if (raw.length > 256) {
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.deepEqual(gunzipSync(r.body), raw);
  } else assert.deepEqual(r.body, raw);
});

test('キャラのファイルは「変わったか聞いてから使う」(no-cache)で、変わっていなければ 304', async () => {
  const first = await get(MODEL, { 'accept-encoding': 'gzip' });
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.ok(first.headers.etag, '印(ETag)が付く');
  assert.ok(first.headers['last-modified'], '更新の時刻が付く');
  const again = await get(MODEL, { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0, '304 は本文なし');
  const byTime = await get(MODEL, { 'accept-encoding': 'gzip', 'if-modified-since': first.headers['last-modified'] });
  assert.equal(byTime.status, 304, '印が無くても、更新の時刻が同じなら 304');
  const other = await get(MODEL, { 'accept-encoding': 'gzip', 'if-none-match': '"other-tag"' });
  assert.equal(other.status, 200, '印が違えば、また全部返す');
});

test('圧縮した物と、していない物は、別の印(同じ印で違う形を返さない)', async () => {
  const zipped = await get(MODEL, { 'accept-encoding': 'gzip' });
  const plain = await get(MODEL, { 'accept-encoding': 'identity' });
  assert.notEqual(zipped.headers.etag, plain.headers.etag);
  const cross = await get(MODEL, { 'accept-encoding': 'identity', 'if-none-match': zipped.headers.etag });
  assert.equal(cross.status, 200, '圧縮した物の印では、圧縮していない物を 304 にしない');
});

test('画面の部品(名前に印の入った js・css)は 1 年覚えさせる(dist がある時だけ)', async (t) => {
  const assets = join(WEB, 'dist', 'assets');
  if (!existsSync(assets)) return t.skip('dist が無い(npm run build の後に確かめる)');
  const name = readdirSync(assets).find((f) => /-[A-Za-z0-9_-]{8}\.js$/.test(f) && statSync(join(assets, f)).size > 1024);
  if (!name) return t.skip('印の入った js が dist に無い');
  const r = await get(`/assets/${name}`, { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200);
  assert.match(r.headers['cache-control'], /max-age=31536000/);
  assert.match(r.headers['cache-control'], /immutable/);
  assert.equal(r.headers['content-encoding'], 'gzip');
  const index = await get('/', { 'accept-encoding': 'gzip' });
  assert.equal(index.headers['cache-control'], 'no-cache', '入口の html は、毎回「変わったか」を聞く(部品の名前が替わったらすぐ届くように)');
});

test('キャラのフォルダの外には出られない', async () => {
  const r = await get('/characters/../package.json', { 'accept-encoding': 'gzip' });
  // 見るのは「package.json の中身を返さない」こと(dist の無い所では、404 の誤りが json の型で返るので、型だけでは見ない。CU3 must 3)
  assert.ok(r.status !== 200 || !String(r.body).includes('"name"'), 'package.json を返さない');
  const r2 = await get('/characters/%2e%2e/web/package.json', { 'accept-encoding': 'gzip' });
  assert.ok(![200].includes(r2.status) || !String(r2.body).includes('"name": "web"'));
});
