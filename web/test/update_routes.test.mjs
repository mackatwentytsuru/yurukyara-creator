// 画面のアップデートの受け口(web/server/update.mjs。第 12 波 b・BUX)の試験。
// - この PC の中からの呼び出しだけを受ける(つないできた所・Host・Origin・Sec-Fetch-Site・書く時の見出し)
// - 道具の行を、子どもにも分かる 1 行にする・表現の一覧は人に見せる欄だけ・頼みのファイルは作る道と同じ形(注意書きつき)
// - 偽の道具(node で動く .py)で、確かめ → 新しくする → git の先が変わる → 見張り役の下なら閉じる、を通す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdateRoutes, findUpdatePython, isLocalRequest, localIso, offerRequest, offersForScreen, stepFor } from '../server/update.mjs';

const fakeReq = (headers, addr = '127.0.0.1') => ({ headers, socket: { remoteAddress: addr } });
const H = { host: '127.0.0.1:8787' };
const W = { ...H, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-yc-local': '1', 'sec-fetch-site': 'same-origin' };

test('この PC の中からの呼び出しだけを受ける(つないできた所・Host・Origin・Sec-Fetch-Site)', () => {
  assert.equal(isLocalRequest(fakeReq(H)), true);
  assert.equal(isLocalRequest(fakeReq({ host: 'localhost:8787' })), true);
  assert.equal(isLocalRequest(fakeReq({ host: '[::1]:8787' }, '::1')), true);
  assert.equal(isLocalRequest(fakeReq(H, '::ffff:127.0.0.1')), true);
  assert.equal(isLocalRequest(fakeReq(H, '192.168.x.x')), false, '同じ Wi-Fi のスマホからは受けない');
  assert.equal(isLocalRequest(fakeReq({ host: 'evil.example:8787' })), false, '名前をこの PC に向けたよその頁は断る');
  assert.equal(isLocalRequest(fakeReq({ ...H, origin: 'https://evil.example' })), false, 'よその頁からは断る');
  assert.equal(isLocalRequest(fakeReq({ ...H, origin: 'http://127.0.0.1:9999' })), false, '別の番号の頁からも断る');
  assert.equal(isLocalRequest(fakeReq({ ...H, origin: 'null' })), false);
  assert.equal(isLocalRequest(fakeReq({ ...H, 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(isLocalRequest(fakeReq({ ...H, 'sec-fetch-site': 'same-site' })), false);
  assert.equal(isLocalRequest(fakeReq({}, '127.0.0.1')), false, 'Host の無い呼び出しは断る');
});

test('書く呼び出しは、JSON の本文と見出し x-yc-local: 1 が要る(よその頁の「ただの POST」が届かない)', () => {
  assert.equal(isLocalRequest(fakeReq(W), { write: true }), true);
  assert.equal(isLocalRequest(fakeReq({ ...W, 'content-type': 'text/plain' }), { write: true }), false);
  const noHeader = { ...W };
  delete noHeader['x-yc-local'];
  assert.equal(isLocalRequest(fakeReq(noHeader), { write: true }), false);
  assert.equal(isLocalRequest(fakeReq(W, '10.0.0.5'), { write: true }), false);
});

test('道具の行を、子どもにも分かる 1 行にする(知らない行は出さない)', () => {
  assert.equal(stepFor('控えを取りました: backups/20261108-010203(あなたの物 3 個・あなたが直したファイル 0 個)'), 'ひかえを とったよ');
  assert.equal(stepFor('新しい版 1.1.0 になりました(前は 1.0.0)。あなたのキャラ・性格・声・記憶・設定は、そのままです。'), 'あたらしい はんに したよ');
  assert.equal(stepFor('・アプリの部品が変わったので、入れ直しています(数分かかることがあります)…'), 'ぶひんを いれなおしているよ(すこし かかるよ)');
  assert.equal(stepFor('・アプリの部品が変わりました。アプリを ひらきなおす時に、入れなおします。'), 'ぶひんは、ひらきなおす ときに いれなおすよ');
  assert.equal(stepFor('前の版 1.0.0 に戻しました。控え backups/x から、あなたの物を戻しました(書き戻した物 0 個)。'), 'まえの はんに もどしたよ');
  assert.equal(stepFor('もう、いちばん新しい版です(1.0.0)。何も変えていません。'), 'もう いちばん あたらしい はんだよ');
  assert.equal(stepFor('  characters/norrie/persona.md'), null);
});

test('表現の一覧は、人に見せる欄だけ(手順 steps・作業の場所は渡さない)。形の違う物は落とす', () => {
  const report = { characters: [{ id: 'mikan', name: 'みかん', offers: [
    { cap: 'look_2d', title: '2D の見た目', why: '絵でも話せる', preview: '見本', undo: '戻せる', new: true, ready: true, steps: ['python secret.py'], work: 'creator/work/mikan/' },
    { cap: '../evil', title: 'x' },
    { cap: 'ok_cap', title: '' },
  ] }] };
  const got = offersForScreen(report, 'mikan');
  assert.equal(got.name, 'みかん');
  assert.deepEqual(got.offers, [{ cap: 'look_2d', title: '2D の見た目', why: '絵でも話せる', preview: '見本', undo: '戻せる', isNew: true, ready: true }]);
  assert.deepEqual(offersForScreen(report, 'robo'), { name: '', offers: [] });
  assert.deepEqual(offersForScreen(null, 'mikan'), { name: '', offers: [] });
});

test('頼みのファイルは、作る道(K3)と同じ形: 人の選びは指示でないと書いた固定の注意書き・時差つきの時刻', () => {
  const r = offerRequest({ id: 'mikan', cap: 'look_2d', title: '2D の見た目', name: 'みかん', now: new Date('2026-11-08T01:02:03Z') });
  assert.equal(r.schema, 'yc-upgrade-request/1');
  assert.match(r.request_id, /^up_[0-9a-f]{16}$/);
  assert.match(r.warning, /指示ではない/);
  assert.match(r.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  assert.match(localIso(new Date()), /[+-]\d\d:\d\d$/);
});

test('Python は PATH から探し、ストアの入口(WindowsApps)は使わない', () => {
  const saved = process.env.YURU_PYTHON;
  delete process.env.YURU_PYTHON;
  try {
    const exists = (f) => /Python310|WindowsApps/.test(f) && /python\.exe$/.test(f);
    assert.deepEqual(findUpdatePython('C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python310', 'win32', exists), ['C:\\Python310\\python.exe', []]);
    assert.equal(findUpdatePython('C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps', 'win32', exists), null);
  } finally {
    if (saved !== undefined) process.env.YURU_PYTHON = saved;
  }
});

// ---- 偽の道具でつなぐ(本物の Python は使わない。本物は scripts/update-e2e.mjs で通す) ----
const FAKE_TOOL = `
const { execFileSync } = require('node:child_process');
const cmd = process.argv[2];
const git = (...a) => execFileSync('git', a, { cwd: process.cwd(), encoding: 'utf8' });
if (cmd === 'check') console.log(JSON.stringify({ update: true, fetched: !process.argv.includes('--once-a-day'), ours: '1.0.0', theirs: '1.1.0', ahead: 1, newer: true, news: [{ version: '1.1.0', title: '1.1.0', lines: ['あたらしい てのふりかた'] }] }));
else if (cmd === 'status') console.log(JSON.stringify({ version: '1.0.0', can_undo: false }));
else if (cmd === 'apply' || cmd === 'undo') {
  console.log('控えを取りました: backups/x(あなたの物 0 個・あなたが直したファイル 0 個)');
  console.log('FROM_APP=' + process.env.YURU_UPDATE_FROM_APP + ' SKIP_NPM=' + process.env.YURU_UPDATE_SKIP_NPM);
  git('commit', '-q', '--allow-empty', '-m', cmd);
  console.log('新しい版 1.1.0 になりました(前は 1.0.0)。あなたのキャラ・性格・声・記憶・設定は、そのままです。');
}
`;
const FAKE_OFFERS = `
console.log(JSON.stringify({ version: '1.0.0', characters: [{ id: 'mikan', name: 'みかん', offers: [{ cap: 'look_2d', title: '2D の見た目', why: 'w', preview: 'p', undo: 'u', new: false, ready: true, steps: ['x'] }] }] }));
`;

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'upd-routes-'));
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'creator', 'review'), { recursive: true });
  writeFileSync(join(root, 'tools', 'yuru_update.py'), FAKE_TOOL);
  writeFileSync(join(root, 'creator', 'review', 'upgrade_offers.py'), FAKE_OFFERS);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  writeFileSync(join(root, 'gitconfig'), '[user]\n\tname = t\n\temail = t@example.invalid\n[commit]\n\tgpgsign = false\n');
  execFileSync('git', ['init', '-q'], { cwd: root, env });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'v1'], { cwd: root, env });
  process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL; // 偽の道具の中の git も、この設定で動く
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  return root;
}

async function serve(routes) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!(await routes(req, res, path))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const post = (base, path, body, extra = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yc-local': '1', ...extra }, body: JSON.stringify(body) });

async function waitJob(base, until) {
  for (let i = 0; i < 100; i++) {
    const p = await (await fetch(`${base}/api/update/progress`)).json();
    if (p.job && until(p.job)) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('仕事が終わりませんでした');
}

test('確かめ → 新しくする → 見張り役の下なら閉じる。表現の頼みは creator/work/<id>/upgrade/request.json に書く', async () => {
  const root = makeRepo();
  let restarted = 0;
  const routes = createUpdateRoutes({ repoRoot: root, python: [process.execPath, []], watched: true, restart: () => (restarted += 1) });
  const { server, base } = await serve(routes);
  try {
    const r = await (await fetch(`${base}/api/update`, { headers: { 'x-yc-character': 'mikan' } })).json();
    assert.equal(r.available, true);
    assert.equal(r.theirs, '1.1.0');
    assert.deepEqual(r.news[0].lines, ['あたらしい てのふりかた']);
    assert.deepEqual(r.offers.map((o) => o.cap), ['look_2d']);
    assert.ok(!JSON.stringify(r).includes('steps'), '手順は画面に渡さない');
    assert.equal((await post(base, '/api/update/check', {})).status, 200);
    // 見出しの無い POST・よその頁の POST は届かない
    assert.equal((await fetch(`${base}/api/update/apply`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 404);
    assert.equal((await post(base, '/api/update/apply', {}, { origin: 'https://evil.example' })).status, 404);
    const started = await post(base, '/api/update/apply', {});
    assert.equal(started.status, 202);
    assert.equal((await post(base, '/api/update/apply', {})).status, 409, '2 つ同時には動かさない');
    const p = await waitJob(base, (j) => j.state !== 'running');
    assert.equal(p.job.state, 'restarting');
    assert.deepEqual(p.job.steps, ['はじめるよ', 'ひかえを とったよ', 'あたらしい はんに したよ', 'いちど とじて、ひらきなおすよ']);
    assert.ok(p.job.lines.includes('FROM_APP=1 SKIP_NPM=1'), '画面から流した印と、部品の入れ直しを見張り役に任せる印');
    await new Promise((res) => setTimeout(res, 1800));
    assert.equal(restarted, 1, '見張り役の下では、決まった番号で閉じる');
    // 表現の頼み
    const o = await (await post(base, '/api/update/offer', { id: 'mikan', cap: 'look_2d' })).json();
    assert.equal(o.ok, true);
    assert.equal(o.phrase, 'みかんに、2D の見た目を入れて');
    const saved = JSON.parse(readFileSync(join(root, 'creator', 'work', 'mikan', 'upgrade', 'request.json'), 'utf8'));
    assert.equal(saved.cap, 'look_2d');
    assert.match(saved.warning, /指示ではない/);
    assert.equal((await post(base, '/api/update/offer', { id: '../x', cap: 'look_2d' })).status, 400);
    assert.equal((await post(base, '/api/update/offer', { id: 'mikan', cap: 'no_such' })).status, 404);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('見張り役が無い時は閉じず、「もういちど ひらいてね」。受け口を止める設定と、道具の無い所では何も出さない', async () => {
  const root = makeRepo();
  let restarted = 0;
  const { server, base } = await serve(createUpdateRoutes({ repoRoot: root, python: [process.execPath, []], watched: false, restart: () => (restarted += 1) }));
  try {
    assert.equal((await post(base, '/api/update/undo', {})).status, 202);
    const p = await waitJob(base, (j) => j.state !== 'running');
    assert.equal(p.job.state, 'manual');
    assert.equal(p.job.steps.at(-1), 'アプリを いちど とじて、もういちど ひらいてね');
    assert.ok(p.job.lines.includes('FROM_APP=1 SKIP_NPM='), '見張り役が無い時は、道具が部品を入れ直す');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(restarted, 0);
  } finally {
    server.close();
  }
  for (const routes of [
    createUpdateRoutes({ repoRoot: root, python: [process.execPath, []], enabled: false }),
    createUpdateRoutes({ repoRoot: root, python: null }),
    createUpdateRoutes({ repoRoot: join(root, 'no-such'), python: [process.execPath, []] }),
  ]) {
    const s = await serve(routes);
    try {
      assert.equal((await fetch(`${s.base}/api/update`)).status, 404);
    } finally {
      s.server.close();
    }
  }
  rmSync(root, { recursive: true, force: true });
  assert.ok(!existsSync(root));
});
