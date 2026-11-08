// 配るファイルの見張り(server/staticGuard.mjs)と、本物のサーバーでの抜け道ふさぎ:
// %2F・二重に包んだ %252F・バックスラッシュ・点の名前・symlink(junction)で外へ出る道・よその Host・戻せない形は、
// 400 / 403 / 404 になり、ファイルの中身は決して返らない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedHostNames, checkStaticPath, hostAllowed, hostNameOf, resolveInside } from '../server/staticGuard.mjs';

const WEB = join(import.meta.dirname, '..');
const SECRET = 'SECRET-MARKER-9f3a';

// ---- 試しの置き場: <root>/characters・places(配ってよい)と、その外の秘密 ----
function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'sg-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'sg-out-'));
  mkdirSync(join(root, 'characters', 'a'), { recursive: true });
  mkdirSync(join(root, 'places', 'p'), { recursive: true });
  mkdirSync(join(root, 'web'), { recursive: true });
  mkdirSync(join(root, 'creator'), { recursive: true });
  writeFileSync(join(root, 'characters', 'a', 'persona.md'), '# a\n');
  writeFileSync(join(root, 'characters', 'a', '.env'), SECRET);
  writeFileSync(join(root, 'characters', '.hidden'), SECRET);
  writeFileSync(join(root, 'places', 'p', 'place.json'), '{"id":"p"}');
  writeFileSync(join(root, 'web', '.env'), `KEY=${SECRET}`);
  writeFileSync(join(root, 'secret.txt'), SECRET);
  writeFileSync(join(root, 'creator', 'x.py'), SECRET);
  writeFileSync(join(outside, 'secret.txt'), SECRET);
  let linked = true;
  let peeked = true;
  try {
    symlinkSync(outside, join(root, 'characters', 'escape'), 'junction'); // フォルダの抜け道(管理者の権限が要らない形)
  } catch {
    linked = false;
  }
  try {
    symlinkSync(join(root, 'web', '.env'), join(root, 'characters', 'a', 'peek.md'), 'file'); // ファイルの抜け道(許されない機械では飛ばす)
  } catch {
    peeked = false;
  }
  return { root, outside, linked, peeked };
}

test('checkStaticPath: 区切りを隠した形・二重の包み・バックスラッシュ・NUL・コロン・点の名前を断る', () => {
  assert.equal(checkStaticPath('/characters/a/persona.md').path, '/characters/a/persona.md');
  assert.equal(checkStaticPath('/characters/%E3%81%82/x.json').path, '/characters/あ/x.json');
  for (const bad of ['/characters/..%2fweb%2f.env', '/characters/..%2Fweb', '/characters/a%5c..%5cx', '/characters/..%252fweb', '/characters/a%00.md', '/characters/%2e%2e%252f']) {
    assert.equal(checkStaticPath(bad).status, 400, bad);
  }
  for (const bad of ['/characters/a\\x', '/characters/C:/x', '/characters/a.md::$DATA']) assert.equal(checkStaticPath(bad).status, 400, bad);
  for (const bad of ['/characters/../x', '/characters/.hidden', '/characters/a/.env', '/places/.git/config', '/.env']) assert.equal(checkStaticPath(bad).status, 404, bad);
  assert.equal(checkStaticPath('/characters/%E0%A4%A').status, 400);
  assert.equal(checkStaticPath('characters/a').status, 400);
});

test('resolveInside: 許した頭のフォルダの中のファイルだけ。外の symlink・フォルダ・無いものは null', () => {
  const t = makeTree();
  try {
    const ok = resolveInside(t.root, '/characters/a/persona.md', ['characters', 'places']);
    assert.ok(ok?.endsWith('persona.md'));
    assert.ok(resolveInside(t.root, '/places/p/place.json', ['characters', 'places']));
    assert.equal(resolveInside(t.root, '/secret.txt', ['characters', 'places']), null, '頭のフォルダの外');
    assert.equal(resolveInside(t.root, '/web/.env', ['characters', 'places']), null);
    assert.equal(resolveInside(t.root, '/characters/a', ['characters', 'places']), null, 'フォルダは配らない');
    assert.equal(resolveInside(t.root, '/characters/zzz', ['characters', 'places']), null);
    assert.equal(resolveInside(t.root, '/../' + 'secret.txt', ['characters']), null, 'root の外');
    if (t.linked) assert.equal(resolveInside(t.root, '/characters/escape/secret.txt', ['characters', 'places']), null, 'symlink で外へ出る道');
    if (t.peeked) assert.equal(resolveInside(t.root, '/characters/a/peek.md', ['characters', 'places']), null, 'ファイルの symlink で外へ出る道');
  } finally {
    rmSync(t.root, { recursive: true, force: true });
    rmSync(t.outside, { recursive: true, force: true });
  }
});

test('hostNameOf / allowedHostNames / hostAllowed: 自分の端末を指す名前だけ', () => {
  assert.equal(hostNameOf('[::1]:8787'), '::1');
  assert.equal(hostNameOf('Localhost:8787'), 'localhost');
  assert.equal(hostNameOf('evil.example.:80'), 'evil.example');
  assert.equal(hostNameOf('a b'), '');
  assert.equal(hostNameOf('evil.example/x'), '');
  assert.equal(hostNameOf(undefined), '');
  const nets = { eth0: [{ address: '192.0.2.10' }, { address: 'fe80::1%eth0' }] };
  const lo = allowedHostNames({ bindHost: '127.0.0.1', nets, machine: 'mybox' });
  for (const h of ['localhost:1', '127.0.0.1:8787', '[::1]:8787']) assert.equal(hostAllowed(h, lo), true, h);
  for (const h of ['evil.example', '192.0.2.10:8787', 'mybox', '', undefined, '127.0.0.1.evil.example']) assert.equal(hostAllowed(h, lo), false, String(h));
  const lan = allowedHostNames({ bindHost: '0.0.0.0', nets, machine: 'MyBox' });
  for (const h of ['192.0.2.10:8787', 'mybox:8787', 'mybox.local', '[fe80::1]:8787', 'localhost']) assert.equal(hostAllowed(h, lan), true, h);
  for (const h of ['evil.example', '192.0.2.11', 'mybox.evil.example']) assert.equal(hostAllowed(h, lan), false, h);
  const named = allowedHostNames({ bindHost: 'shop.test', extra: 'Kiosk.Test, other.test', nets: {}, machine: 'x' });
  for (const h of ['shop.test', 'kiosk.test:80', 'other.test']) assert.equal(hostAllowed(h, named), true, h);
  assert.equal(hostAllowed('<端末名>.<tailnet>.ts.net:8443', lo), true, 'tailnet の名前(README の tailscale serve の道)');
  assert.equal(hostAllowed('evilts.net', lo), false);
});

// ---- 本物のサーバー ----
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer(env) {
  const port = await freePort();
  const full = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE', 'YC_ALLOWED_HOSTS']) delete full[k];
  Object.assign(full, { PORT: String(port), HOST: '127.0.0.1' }, env);
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env: full, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  for (let i = 0; i < 150; i++) {
    try {
      const r = await get(port, '/api/status');
      if (r.status === 200) return { proc, port };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** 生のパスと Host を、そのまま送る(fetch は %2F や .. を直してしまうので、node:http で) */
function get(port, path, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('本物のサーバー: 抜け道はどれも 400/403/404 で、中身は返らない。正しい頼みは 200', async () => {
  const t = makeTree();
  const logs = mkdtempSync(join(tmpdir(), 'sg-log-'));
  const { proc, port } = await startServer({ YC_REPO_ROOT: t.root, LOG_DIR: logs, MEMORY_DIR: join(logs, 'm'), FILLER_DIR: join(logs, 'f') });
  try {
    const okPaths = ['/characters/a/persona.md', '/places/p/place.json'];
    for (const p of okPaths) {
      const r = await get(port, p);
      assert.equal(r.status, 200, p);
    }
    assert.equal((await get(port, '/characters/a/persona.md', `localhost:${port}`)).status, 200);
    assert.equal((await get(port, '/characters/a/persona.md', `[::1]:${port}`)).status, 200);

    const attacks = [
      ['/characters/..%2Fweb%2F.env', [400]],
      ['/characters/..%2fweb%2f.env', [400]],
      ['/characters/%2e%2e%2fweb%2f.env', [400]],
      ['/characters/..%252Fweb%252F.env', [400]],
      ['/characters/%252e%252e/web/.env', [400]],
      ['/characters/a%5C..%5C..%5Cweb%5C.env', [400]],
      ['/characters/a/..%5C..%5Cweb%5C.env', [400]],
      ['/characters/a\\..\\..\\web\\.env', [400, 404]],
      ['/characters/a/%00.md', [400]],
      ['/characters/.hidden', [404]],
      ['/characters/a/.env', [404]],
      ['/characters/a/%2eenv', [404]],
      ['/characters/../secret.txt', [200, 404]], // URL の読み方で /secret.txt になる。配るのは dist だけなので、秘密は出ない
      ['/characters/../web/.env', [200, 404]],
      ['/characters/%2e%2e/web/.env', [200, 404]],
      ['/creator/x.py', [200, 404]],
      ['/characters/a/peek.md', [404]],
      ['/characters/escape/secret.txt', [404]],
      ['/characters/a/', [404]],
      ['/characters/%E0%A4%A', [400]],
      ['/%E0%A4%A', [400]],
    ];
    for (const [p, allowed] of attacks) {
      const r = await get(port, p);
      assert.ok(allowed.includes(r.status), `${p} → ${r.status}`);
      assert.equal(r.body.includes(SECRET), false, `${p} の答えに秘密が入っている`);
    }
    // 戻せない形のあとも、サーバーは生きている
    assert.equal((await get(port, '/characters/a/persona.md')).status, 200);

    // よその Host(名前の向け直し)
    for (const h of ['evil.example', `evil.example:${port}`, 'rebind.test', '192.0.2.99', '127.0.0.1.evil.example']) {
      const r = await get(port, '/characters/a/persona.md', h);
      assert.equal(r.status, 403, `Host ${h}`);
      assert.equal(r.body.includes('# a'), false);
    }
    assert.equal((await get(port, '/', 'evil.example')).status, 403, '画面のファイルも、よその名前では配らない');
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const d of [t.root, t.outside, logs]) rmSync(d, { recursive: true, force: true });
  }
});

test('本物のサーバー: YC_ALLOWED_HOSTS に書いた名前は通り、書かない名前は 403', async () => {
  const t = makeTree();
  const logs = mkdtempSync(join(tmpdir(), 'sg-log-'));
  const { proc, port } = await startServer({ YC_REPO_ROOT: t.root, LOG_DIR: logs, MEMORY_DIR: join(logs, 'm'), FILLER_DIR: join(logs, 'f'), YC_ALLOWED_HOSTS: 'shop.test' });
  try {
    assert.equal((await get(port, '/characters/a/persona.md', `shop.test:${port}`)).status, 200);
    assert.equal((await get(port, '/characters/a/persona.md', 'evil.example')).status, 403);
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const d of [t.root, t.outside, logs]) rmSync(d, { recursive: true, force: true });
  }
});
