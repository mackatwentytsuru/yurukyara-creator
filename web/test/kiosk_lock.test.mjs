// 接客モードの「番号の間違いの数え」の決まり(サーバー側。画面なし)。
// - 数えは端末ごと(署名の合った札ごと)。来場者が違う番号を 5 回押しても、店の人の端末は止まらない
// - サーバー全体の安全の上限は、ふつうの使い方では届かない高さ(届いたら全体を止める)
// - PC の窓で「今の番号」を間違えた分は、店の端末の出る番号の数えに入らない(逆も同じ)
// - 店の PC(この PC の中)の窓から、止まっている分を全部解ける(POST /api/kiosk/unlock。PC 以外は 403)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createKiosk, GLOBAL_LOCK_S, GLOBAL_MAX_WRONG, LOCK_S, MAX_WRONG } from '../server/kiosk.mjs';
import { createKioskRoutes } from '../server/kioskRoutes.mjs';
import { isLocalRequest } from '../server/update.mjs';
import { ValidationError } from '../server/validate.mjs';

const PIN = '2468';

/** 偽の時計つきの kiosk(番号は PIN)。札は時刻が 1 秒ずれるごとに別の物になる */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'yc-kiosk-lock-'));
  const t = { now: 1_800_000_000_000 };
  const kiosk = createKiosk({ file: join(dir, 'kiosk.json'), now: () => t.now });
  assert.equal(kiosk.update({ pin: PIN, pinConfirm: PIN }).ok, true);
  /** 別の端末の札を 1 つ作る */
  const device = () => {
    t.now += 1000;
    return kiosk.issueToken();
  };
  return { dir, t, kiosk, device, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const wrong = (kiosk, token, n) => {
  let last;
  for (let i = 0; i < n; i++) last = kiosk.exit('1111', token);
  return last;
};

test('端末ごとに数える: 1 台が 5 回違って止まっても、別の端末(店の人)は正しい番号で出られる', () => {
  const s = setup();
  try {
    const visitor = s.device();
    const staff = s.device();
    assert.notEqual(visitor, staff);
    assert.equal(wrong(s.kiosk, visitor, MAX_WRONG - 1).remaining, 1);
    const locked = s.kiosk.exit('1111', visitor);
    assert.deepEqual([locked.status, locked.retryAfterS], [429, LOCK_S]);
    // 止まった端末は、正しい番号でも通らない
    assert.equal(s.kiosk.exit(PIN, visitor).status, 429);
    // 店の人の端末は、止まっていない
    assert.equal(s.kiosk.exit('1111', staff).remaining, MAX_WRONG - 1, '店の人の端末の数えは、まだ 1 回目');
    assert.equal(s.kiosk.exit(PIN, staff).ok, true);
    // 札の無い端末・壊れた札の端末も、止まっていない(札の無い端末どうしは 1 つの数え)
    assert.equal(s.kiosk.exit(PIN, '').ok, true);
    // 5 分たてば、止まっていた端末も戻る
    s.t.now += LOCK_S * 1000 + 1;
    assert.equal(s.kiosk.exit(PIN, visitor).ok, true);
  } finally {
    s.done();
  }
});

test('合えばその端末の数えだけが戻る。ほかの端末の数えは変わらない', () => {
  const s = setup();
  try {
    const a = s.device();
    const b = s.device();
    wrong(s.kiosk, a, 3);
    wrong(s.kiosk, b, 2);
    assert.equal(s.kiosk.exit(PIN, a).ok, true);
    assert.equal(s.kiosk.exit('1111', a).remaining, MAX_WRONG - 1, 'a は 1 回目から');
    assert.equal(s.kiosk.exit('1111', b).remaining, MAX_WRONG - 3, 'b は続きの 3 回目');
  } finally {
    s.done();
  }
});

test('札が壊れている・署名が合わない端末は、札の無い端末と同じ 1 つの数え。期限切れでも署名が合えば、その札ごと', () => {
  const s = setup();
  try {
    const good = s.device();
    const forged = `${good.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`;
    wrong(s.kiosk, '', MAX_WRONG - 2);
    assert.equal(s.kiosk.exit('1111', forged).remaining, 1, '偽の札は、札なしと同じ数えに入る');
    assert.equal(s.kiosk.exit('1111', 'xxx.yyy.zzz').status, 429, '壊れた札も同じ(5 回目で止まる)');
    assert.equal(s.kiosk.exit(PIN, good).ok, true, '本物の札の端末は影響を受けない');
    // 期限切れ(12 時間後)でも、署名が合う札は、その札ごとの数え
    const old = s.device();
    s.t.now += 12 * 3600 * 1000 + 5000;
    assert.equal(s.kiosk.verifyToken(old).expired, true);
    s.t.now += LOCK_S * 1000 + 1; // 札なしの止まりは終わっている
    assert.equal(wrong(s.kiosk, old, MAX_WRONG).status, 429);
    assert.equal(s.kiosk.exit(PIN, '').ok, true, '期限切れの札が止まっても、札なしの端末は止まらない');
  } finally {
    s.done();
  }
});

test('サーバー全体の安全の上限: ふつうの使い方では届かない。届いたら全体が止まり、時間がたつと戻る', () => {
  assert.ok(GLOBAL_MAX_WRONG >= 50, '上限は、ふつうの使い方(数回)より十分高い');
  const s = setup();
  try {
    // ふつうの使い方: 店の端末 5 台が、それぞれ 3 回ずつ間違えても、だれも止まらない
    const normal = Array.from({ length: 5 }, () => s.device());
    for (const d of normal) assert.equal(wrong(s.kiosk, d, 3).status, 403);
    assert.equal(s.kiosk.lockInfo().globalLocked, false);
    for (const d of normal) assert.equal(s.kiosk.exit(PIN, d).ok, true);
    // たくさんの端末が、4 回ずつ(端末では止まらない数)間違え続けると、全体の上限に届く
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) {
      const d = s.device();
      for (let k = 0; k < MAX_WRONG - 1 && !hit; k++) {
        const r = s.kiosk.exit('abcd', d); // 数字でない番号は、照合の計算なしで間違いになる(速い)
        if (r.status === 429) hit = r;
      }
    }
    assert.ok(hit, '上限に届いた');
    assert.equal(hit.retryAfterS, GLOBAL_LOCK_S);
    assert.equal(s.kiosk.lockInfo().globalLocked, true);
    // 全体が止まっている間は、新しい端末も、正しい番号で通らない
    assert.equal(s.kiosk.exit(PIN, s.device()).status, 429);
    // 時間がたつと戻る
    s.t.now += GLOBAL_LOCK_S * 1000 + 1;
    assert.equal(s.kiosk.exit(PIN, s.device()).ok, true);
  } finally {
    s.done();
  }
});

test('PC の窓の「今の番号」の間違いは、店の端末の出る番号の数えに入らない(逆も同じ)', () => {
  const s = setup();
  try {
    const shop = s.device();
    // PC の窓で、今の番号を 5 回間違える → PC の窓は止まる
    let last;
    for (let i = 0; i < MAX_WRONG; i++) last = s.kiosk.update({ pin: '1357', pinConfirm: '1357', currentPin: '0000' });
    assert.equal(last.status, 429);
    assert.equal(s.kiosk.update({ pin: '1357', pinConfirm: '1357', currentPin: PIN }).status, 429, 'PC の窓は止まっている間、正しい番号でも通らない');
    // 店の端末は止まっていない。数えも 1 回目から
    assert.equal(s.kiosk.exit('1111', shop).remaining, MAX_WRONG - 1);
    assert.equal(s.kiosk.exit(PIN, shop).ok, true);
    assert.equal(s.kiosk.exit(PIN, '').ok, true, '札の無い端末も止まっていない');
    assert.equal(s.kiosk.lockInfo().lockedDevices, 0);
    // 逆: 店の端末が止まっても、PC の窓は番号を変えられる(5 分待たない)
    s.t.now += LOCK_S * 1000 + 1;
    wrong(s.kiosk, shop, MAX_WRONG);
    assert.equal(s.kiosk.exit(PIN, shop).status, 429);
    const changed = s.kiosk.update({ pin: '1357', pinConfirm: '1357', currentPin: PIN });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    // 番号を変えたら、店の端末の止まりも戻る(新しい番号で出られる)
    assert.equal(s.kiosk.exit('1357', shop).ok, true);
  } finally {
    s.done();
  }
});

test('unlockAll: 止まっている端末と全体の止まりを全部解く。PC の窓の「今の番号」の止まりは触らない', () => {
  const s = setup();
  try {
    const a = s.device();
    const b = s.device();
    wrong(s.kiosk, a, MAX_WRONG);
    wrong(s.kiosk, b, MAX_WRONG);
    for (let i = 0; i < MAX_WRONG; i++) s.kiosk.update({ pin: '1357', pinConfirm: '1357', currentPin: '0000' });
    assert.equal(s.kiosk.lockInfo().lockedDevices, 2);
    const r = s.kiosk.unlockAll();
    assert.deepEqual([r.lockedDevices, r.globalLocked], [0, false]);
    assert.equal(s.kiosk.exit(PIN, a).ok, true);
    assert.equal(s.kiosk.exit(PIN, b).ok, true);
    assert.equal(s.kiosk.update({ pin: '1357', pinConfirm: '1357', currentPin: PIN }).status, 429, 'PC の窓の止まりは、番号なしでは解けない');
  } finally {
    s.done();
  }
});

// ---- 道(PC 自身だけ・札は見出し x-kiosk-token) ----
const json = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
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

async function startRoutes() {
  const s = setup();
  const routes = createKioskRoutes({ config: { kioskOrigin: 'https://shop.example', kioskSecret: '' }, logDir: s.dir, readBody, json, isLocalRequest, kiosk: s.kiosk });
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
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  return { ...s, call, pc: { 'x-yc-local': '1' }, stop: () => new Promise((r) => server.close(() => (s.done(), r()))) };
}

test('道: 札つきの /api/kiosk/exit は端末ごとに数える。札を付けない呼び出しは、札なしの端末', async () => {
  const s = await startRoutes();
  try {
    const visitor = s.device();
    const staff = s.device();
    const exit = (pin, token) => s.call('POST', '/api/kiosk/exit', { body: { pin }, headers: token ? { 'x-kiosk-token': token } : {} });
    for (let i = 1; i < MAX_WRONG; i++) assert.equal((await exit('1111', visitor)).body.remaining, MAX_WRONG - i);
    const fifth = await exit('1111', visitor);
    assert.deepEqual([fifth.status, fifth.body.locked], [429, true]);
    assert.equal((await exit(PIN, visitor)).status, 429);
    assert.equal((await exit(PIN, staff)).status, 200, '店の人の端末は、そのまま出られる');
    assert.equal((await exit(PIN)).status, 200, '札なしの端末も止まっていない');
  } finally {
    await s.stop();
  }
});

test('道: 店の PC の窓だけが止まりを解ける(unlock)。設定の読み出しに止まっている数が出る。PC 以外・見出しなしは 403', async () => {
  const s = await startRoutes();
  try {
    const visitor = s.device();
    const exit = (pin, token) => s.call('POST', '/api/kiosk/exit', { body: { pin }, headers: { 'x-kiosk-token': token } });
    for (let i = 0; i < MAX_WRONG; i++) await exit('1111', visitor);
    const info = await s.call('GET', '/api/kiosk/settings');
    assert.deepEqual([info.status, info.body.lockedDevices, info.body.globalLocked], [200, 1, false]);
    assert.ok(info.body.retryAfterS > 0);
    // 店の端末(PC の外)・よその頁・見出しなしは解けない
    for (const headers of [{ ...s.pc, host: 'shop.example' }, { ...s.pc, origin: 'https://evil.example' }, { ...s.pc, 'sec-fetch-site': 'cross-site' }, {}]) {
      assert.equal((await s.call('POST', '/api/kiosk/unlock', { body: {}, headers })).status, 403, JSON.stringify(headers));
    }
    assert.equal((await exit(PIN, visitor)).status, 429, '解けていない');
    // 店の PC の窓からは解ける
    const un = await s.call('POST', '/api/kiosk/unlock', { body: {}, headers: s.pc });
    assert.deepEqual([un.status, un.body.ok, un.body.lockedDevices, un.body.globalLocked], [200, true, 0, false]);
    assert.equal((await exit(PIN, visitor)).status, 200);
    // 番号は返さない
    assert.ok(!JSON.stringify(un.body).includes(PIN));
    // 設定を保存した時の答えにも、止まっている数が入る(窓の表示が消えない)
    const v2 = s.device();
    for (let i = 0; i < MAX_WRONG; i++) await exit('1111', v2);
    const saved = await s.call('POST', '/api/kiosk/settings', { body: { idleSec: 60 }, headers: s.pc });
    assert.equal(saved.body.lockedDevices, 1);
  } finally {
    await s.stop();
  }
});
