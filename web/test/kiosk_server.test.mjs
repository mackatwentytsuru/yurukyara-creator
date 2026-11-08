// 接客モードのサーバー側(server/kiosk.mjs と kioskRoutes.mjs)の試験。
// - PC 以外(別の機械・よその頁の名前・Origin 違い)からの設定と QR は 403
// - 保存のファイルに番号の平文が無い。店の端末へ見せる設定(config)に番号が出ない
// - 抜ける番号: 違うと 403、5 回違うと 429(5 分止める)。止めている間は、正しい番号でも 429。5 分後に戻る。サーバーが数える
// - 本物のサーバー(server/index.mjs)につながっている
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKiosk, LOCK_S, MAX_WRONG } from '../server/kiosk.mjs';
import { createKioskRoutes } from '../server/kioskRoutes.mjs';
import { isLocalRequest } from '../server/update.mjs';
import { ValidationError } from '../server/validate.mjs';

const WEB = join(import.meta.dirname, '..');
const ORIGIN = 'https://shop.example';

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new ValidationError('本文が大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('本文が JSON ではありません');
  }
}
const json = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));

/** 道だけを持つ小さなサーバー(時計は偽物)。接続は 127.0.0.1(= つないできた所は PC 自身)。Host 見出しで、PC の中か外かを作り分ける */
async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'yc-kiosk-srv-'));
  const t = { now: 1_800_000_000_000 };
  const kiosk = createKiosk({ file: join(dir, 'kiosk.json'), now: () => t.now });
  const routes = createKioskRoutes({ config: { kioskOrigin: ORIGIN, kioskSecret: '' }, logDir: dir, readBody, json, isLocalRequest, kiosk });
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!(await routes(req, res, url.pathname, url))) json(res, 404, { error: 'no' });
    } catch (err) {
      json(res, err instanceof ValidationError ? err.status : 500, { error: err.message });
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  /** headers で Host などを替えて呼ぶ */
  const call = (method, path, { body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  const pc = { 'x-yc-local': '1' }; // この PC の書く呼び出しの見出し
  return { kiosk, t, dir, call, pc, port, stop: () => new Promise((r) => server.close(() => (rmSync(dir, { recursive: true, force: true }), r()))) };
}

test('設定と QR は、この PC の中からだけ。別の機械の名前(Host)・よその頁(Origin)・別の頁(Sec-Fetch-Site)は 403', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('GET', '/api/kiosk/settings')).status, 200);
    const evilHost = { host: 'evil.example' };
    const evilOrigin = { origin: 'https://evil.example' };
    const cross = { 'sec-fetch-site': 'cross-site' };
    for (const h of [evilHost, evilOrigin, cross]) {
      assert.equal((await s.call('GET', '/api/kiosk/settings', { headers: h })).status, 403, JSON.stringify(h));
      assert.equal((await s.call('GET', '/api/kiosk/qr', { headers: h })).status, 403, JSON.stringify(h));
      const w = await s.call('POST', '/api/kiosk/settings', { body: { pin: '2468', pinConfirm: '2468' }, headers: { ...s.pc, ...h } });
      assert.equal(w.status, 403, JSON.stringify(h));
    }
    assert.equal(s.kiosk.publicSettings().hasPin, false, '断った呼び出しは、何も書かない');
    // 書く呼び出しは、見出し x-yc-local がないと断る(よその頁の「ただの POST」)
    assert.equal((await s.call('POST', '/api/kiosk/settings', { body: { pin: '2468', pinConfirm: '2468' } })).status, 403);
    assert.equal(s.kiosk.publicSettings().hasPin, false);
    // 店の端末の使う道(config・exit)は、どこからでも
    assert.equal((await s.call('GET', '/api/kiosk/config', { headers: evilHost })).status, 200);
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '0000' }, headers: evilHost })).status, 409, '番号が決まっていない間は、出られない(0000 などの最初の番号は無い)');
    assert.equal((await s.call('GET', '/api/kiosk/unknown')).status, 404);
  } finally {
    await s.stop();
  }
});

test('番号を決める → 保存のファイルに平文が無い → QR(番号のない札つき URL)→ config に番号が出ない', async () => {
  const s = await start();
  try {
    const before = await s.call('GET', '/api/kiosk/qr');
    assert.equal(before.status, 409, '番号を決めるまで QR は出ない');
    assert.equal(before.body.reason, 'pin-unset');
    const bad = await s.call('POST', '/api/kiosk/settings', { body: { pin: '123', pinConfirm: '123' }, headers: s.pc });
    assert.equal(bad.status, 400);
    const set = await s.call('POST', '/api/kiosk/settings', { body: { pin: '246813', pinConfirm: '246813', lang: 'multi', facts: '9 時から 17 時', idleSec: 120 }, headers: s.pc });
    assert.equal(set.status, 200);
    assert.deepEqual([set.body.hasPin, set.body.pinLength, set.body.lang, set.body.idleSec, set.body.originSet, set.body.secure], [true, 6, 'multi', 120, true, true]);
    assert.ok(!JSON.stringify(set.body).includes('246813'), '返事に番号が無い');
    // 保存のファイル(平文なし・鍵のファイル権限は呼ぶ側の OS)
    const saved = readFileSync(join(s.dir, 'kiosk.json'), 'utf8');
    assert.ok(!saved.includes('246813'), '保存のファイルに番号の平文が無い');
    assert.match(saved, /"salt":"[A-Za-z0-9_-]{20,}"/, '塩つき');
    assert.match(saved, /"hash":"[A-Za-z0-9_-]{40,}"/, 'ハッシュだけ');
    // QR
    const qr = await s.call('GET', '/api/kiosk/qr?character=norrie');
    assert.equal(qr.status, 200);
    assert.ok(qr.body.url.startsWith(`${ORIGIN}/?kiosk=`));
    assert.ok(qr.body.bytes <= 213);
    assert.ok(!qr.body.url.includes('246813'), '札に番号が入らない');
    const token = new URL(qr.body.url).searchParams.get('kiosk');
    // config: 見出しでも ?t= でも。見せてよい設定だけ
    const cfg = await s.call('GET', '/api/kiosk/config', { headers: { 'x-kiosk-token': token } });
    assert.equal(cfg.status, 200);
    assert.deepEqual([cfg.body.valid, cfg.body.lang, cfg.body.facts, cfg.body.idleSec, cfg.body.characterId], [true, 'multi', '9 時から 17 時', 120, 'norrie']);
    assert.ok(!JSON.stringify(cfg.body).includes('246813') && !('pin' in cfg.body) && !('hash' in cfg.body) && !('salt' in cfg.body), 'config に番号が出ない');
    assert.equal((await s.call('GET', `/api/kiosk/config?t=${encodeURIComponent(token)}`)).body.valid, true);
    // 合わない札・無い札: 接客のまま(kiosk: true)・既定の設定・番号なし
    for (const t of ['', 'broken', `${token}x`]) {
      const c = await s.call('GET', '/api/kiosk/config', { headers: { 'x-kiosk-token': t } });
      assert.deepEqual([c.body.kiosk, c.body.valid, c.body.lang, c.body.idleSec], [true, false, 'ja', 90], JSON.stringify(t));
    }
    // 12 時間後: 古い札
    s.t.now += 12 * 3600 * 1000 + 1000;
    const old = await s.call('GET', '/api/kiosk/config', { headers: { 'x-kiosk-token': token } });
    assert.deepEqual([old.body.kiosk, old.body.valid, old.body.expired], [true, false, true]);
    // 番号を変えるには、いまの番号が要る
    const noCur = await s.call('POST', '/api/kiosk/settings', { body: { pin: '1357', pinConfirm: '1357' }, headers: s.pc });
    assert.equal(noCur.status, 403);
    const withCur = await s.call('POST', '/api/kiosk/settings', { body: { pin: '1357', pinConfirm: '1357', currentPin: '246813' }, headers: s.pc });
    assert.equal(withCur.status, 200);
    assert.equal(withCur.body.pinLength, 4);
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '246813' } })).status, 403, '古い番号では出られない');
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '1357' } })).status, 200);
  } finally {
    await s.stop();
  }
});

test('抜ける番号: 違うと 403(あと何回)、5 回違うと 429(5 分止める)。止めている間は正しい番号でも 429。5 分たてば戻る。数えるのはサーバー', async () => {
  const s = await start();
  try {
    await s.call('POST', '/api/kiosk/settings', { body: { pin: '2468', pinConfirm: '2468' }, headers: s.pc });
    assert.equal(MAX_WRONG, 5);
    assert.equal(LOCK_S, 300);
    for (let i = 1; i <= 4; i++) {
      const r = await s.call('POST', '/api/kiosk/exit', { body: { pin: '1111' } });
      assert.equal(r.status, 403);
      assert.equal(r.body.remaining, MAX_WRONG - i);
    }
    const fifth = await s.call('POST', '/api/kiosk/exit', { body: { pin: '1111' } });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.retryAfterS, 300);
    assert.equal(fifth.headers['retry-after'], '300');
    // 止めている間は、正しい番号でも通らない
    s.t.now += 60_000;
    const during = await s.call('POST', '/api/kiosk/exit', { body: { pin: '2468' } });
    assert.equal(during.status, 429);
    assert.ok(during.body.retryAfterS <= 240 && during.body.retryAfterS > 0);
    // 5 分たったら、正しい番号で出られる
    s.t.now += 241_000;
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '2468' } })).status, 200);
    // 合えば、数えは戻る(4 回違っても、5 回目の正解で出られ、次の間違いは 1 回目)
    for (let i = 0; i < 4; i++) await s.call('POST', '/api/kiosk/exit', { body: { pin: '9999' } });
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '2468' } })).status, 200);
    assert.equal((await s.call('POST', '/api/kiosk/exit', { body: { pin: '9999' } })).body.remaining, 4);
    // 形の違う本文・数字でない番号は、間違い扱い(通らない)
    for (const body of [{}, { pin: 2468 }, { pin: ['2468'] }, { pin: '24 68' }, { pin: '2468 ' }]) {
      const r = await s.call('POST', '/api/kiosk/exit', { body });
      assert.ok([403, 429].includes(r.status), JSON.stringify(body));
    }
    // 読み込み直し(同じ札・別の接続)でも数えは続く: サーバーの 1 か所だけが数える
    assert.equal(s.kiosk.exit('2468').ok, false, '5 回違った後なので、止まっている(または間違いが続いている)');
  } finally {
    await s.stop();
  }
});

test('保存のファイルを読み直しても、番号と設定が残る(サーバーを起こし直しても同じ番号で出られる)', async () => {
  const s = await start();
  try {
    await s.call('POST', '/api/kiosk/settings', { body: { pin: '2468', pinConfirm: '2468', lang: 'multi' }, headers: s.pc });
    const token = s.kiosk.issueToken('norrie');
    const again = createKiosk({ file: join(s.dir, 'kiosk.json'), now: () => s.t.now });
    assert.equal(again.publicSettings().lang, 'multi');
    assert.equal(again.verifyToken(token).ok, true, '鍵も残るので、前の札が通る');
    assert.equal(again.exit('2468').ok, true);
    assert.equal(again.exit('0000').ok, false);
  } finally {
    await s.stop();
  }
});

// ---- 本物のサーバー(server/index.mjs)につながっている ----
const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('本物のサーバー: 設定 → QR → 店の端末の設定 → 抜ける、が通る。logs に番号の平文が残らない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-kiosk-real-'));
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_DIR: join(dir, 'logs'), MEMORY_DIR: join(dir, 'memory'), FILLER_DIR: join(dir, 'fillers'), ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '', APP_PASSPHRASE: '', KIOSK_ORIGIN: 'https://shop.example', KIOSK_SECRET: '', YURU_UPDATE_UI: '0' };
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yc-local': '1' }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {
        // まだ立っていない
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await fetch(`${base}/api/kiosk/settings`)).status, 200);
    assert.equal((await post('/api/kiosk/settings', { pin: '864209', pinConfirm: '864209', lang: 'multi' })).status, 200);
    const qr = await (await fetch(`${base}/api/kiosk/qr`)).json();
    assert.equal(qr.ok, true);
    const token = new URL(qr.url).searchParams.get('kiosk');
    const cfg = await (await fetch(`${base}/api/kiosk/config`, { headers: { 'x-kiosk-token': token } })).json();
    assert.deepEqual([cfg.valid, cfg.lang], [true, 'multi']);
    assert.equal((await post('/api/kiosk/exit', { pin: '000000' })).status, 403);
    assert.equal((await post('/api/kiosk/exit', { pin: '864209' })).status, 200);
    assert.ok(!readFileSync(join(dir, 'logs', 'kiosk.json'), 'utf8').includes('864209'), 'logs に番号の平文が無い');
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
