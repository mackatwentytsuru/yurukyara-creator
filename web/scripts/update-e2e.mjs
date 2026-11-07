// 画面のアップデートの通しの確かめ(第 12 波 b・BUX)。手元に仮の取り先(bare のリポジトリ)と使う人の写しを作り、
// 見張り役(scripts/yuru-run.mjs)でアプリを起こして、画面と同じ呼び出しで次を確かめる(ネットは使わない):
//   1. 開いた時の確かめで「新しい版がある」(1.0.1・できるようになったこと)
//   2. 「アップデートする」1 回: 控え → 新しくする → 部品の入れ直し(lock が変わる版)→ 見張り役が起こし直す → /api/status が戻る → 1.0.1
//   3. 「もとに もどす」1 回: 前の版に戻る → 起こし直す → 1.0.0
//   4. 動かない新しい版(1.0.2。サーバーが起きない)→ 見張り役が前の版に戻して起こす(画面への印 fellBack)
//   --browser: 同じ流れを、GPU の Chrome で画面のボタンを押して確かめ、絵を撮る(GPU の札と鍵を取ってから。CPU の描画なら止める)
// 使い方(web のフォルダで): node scripts/update-e2e.mjs [--out <フォルダ>] [--port 8940] [--browser] [--keep]
//   作る写しはリポジトリの外(--out。既定は一時フォルダ)。使う人の物には触らない。自分で起こしたプロセスだけを番号で止める。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(WEB, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const OUT = resolve(arg('--out', mkdtempSync(join(tmpdir(), 'yc-update-e2e-'))));
const PORT = Number(arg('--port', 8940));
const BROWSER = argv.includes('--browser');
const BASE = `http://127.0.0.1:${PORT}`;
const LOCAL = { 'content-type': 'application/json', 'x-yc-local': '1' };
const t0 = Date.now();
const results = [];
const log = (line) => process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}\n`);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail, at: +((Date.now() - t0) / 1000).toFixed(1) });
  log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  (${detail})` : ''}`);
}

mkdirSync(OUT, { recursive: true });
const gitcfg = join(OUT, 'gitconfig');
writeFileSync(gitcfg, '[user]\n\tname = e2e\n\temail = e2e@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', timeout: 120000 }).trim();

const origin = join(OUT, 'origin.git');
const user = join(OUT, 'user');
const maker = join(OUT, 'maker');
const branch = git(REPO, 'rev-parse', '--abbrev-ref', 'HEAD');

function makeClones() {
  log(`取り先と写しを作ります(元: ${branch}@${git(REPO, 'rev-parse', '--short', 'HEAD')})`);
  git(OUT, 'clone', '-q', '--bare', '--single-branch', '-b', branch, REPO, origin);
  git(OUT, 'clone', '-q', origin, user);
  git(OUT, 'clone', '-q', origin, maker);
  // 顔の追従のモデルは、写しへ写しておく(npm ci のたびにネットから取らない)
  const model = join(WEB, 'public', 'mediapipe', 'face_landmarker.task');
  if (existsSync(model)) {
    mkdirSync(join(user, 'web', 'public', 'mediapipe'), { recursive: true });
    copyFileSync(model, join(user, 'web', 'public', 'mediapipe', 'face_landmarker.task'));
  }
}

/** 作り手の写しで版を 1 つ進めて、取り先へ送る */
function publish(version, news, edit = () => {}) {
  writeFileSync(join(maker, 'VERSION'), `${version}\n`);
  const newsFile = join(maker, 'docs', 'できるようになったこと.md');
  const text = readFileSync(newsFile, 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf('\n## ');
  writeFileSync(newsFile, `${text.slice(0, at + 1)}## ${version}(2026-11-08)\n\n${news.map((l) => `- ${l}`).join('\n')}\n\n${text.slice(at + 1)}`);
  edit(maker);
  git(maker, 'add', '-A');
  git(maker, 'commit', '-q', '-m', `版 ${version}(通しの確かめ)`);
  git(maker, 'push', '-q', 'origin', `HEAD:${branch}`);
  return git(maker, 'rev-parse', 'HEAD');
}

/** 部品の入れ直しが要る版: web/package.json と lock の版の文字だけを変える(npm ci が通る、入れる物は同じ) */
function bumpLock(dir) {
  for (const f of ['package.json', 'package-lock.json']) {
    const p = join(dir, 'web', f);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    j.version = '0.1.1';
    if (f === 'package-lock.json' && j.packages?.['']) j.packages[''].version = '0.1.1';
    writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
  }
}

function npmCi(dir) {
  log('写しの部品を入れます(npm ci)');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: join(dir, 'web'), encoding: 'utf8', timeout: 600000, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`npm ci に失敗しました: ${r.stderr?.slice(-400)}`);
}

let watcher = null;
let watcherLog = '';
function startWatcher() {
  const env = { ...process.env, ...GIT_ENV, PORT: String(PORT), HOST: '127.0.0.1', LOG_DIR: join(OUT, 'logs'), MEMORY_DIR: join(OUT, 'logs', 'memory') };
  delete env.ANTHROPIC_API_KEY; // 本物の頭脳・声は呼ばない
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
  watcher = spawn(process.execPath, [join(user, 'web', 'scripts', 'yuru-run.mjs'), '--port', String(PORT)], { cwd: join(user, 'web'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (d) => {
    watcherLog += d;
    writeFileSync(join(OUT, 'watcher.log'), watcherLog);
  };
  watcher.stdout.setEncoding('utf8').on('data', keep);
  watcher.stderr.setEncoding('utf8').on('data', keep);
}
function stopWatcher() {
  if (!watcher?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(watcher.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  else process.kill(watcher.pid, 'SIGTERM');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(60000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function waitStatus(ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(3000) })).ok) return true;
    } catch {
      // まだ
    }
    await sleep(300);
  }
  return false;
}
async function progressBoot() {
  try {
    return (await getJson('/api/update/progress')).body?.boot ?? '';
  } catch {
    return '';
  }
}

/** 画面と同じ: 仕事を頼み、進み具合を見て、起こし直したら(boot が変わったら)戻る。[秒, 最後の進み具合] */
async function runAndReopen(path, body = {}) {
  const started = Date.now();
  const boot0 = await progressBoot();
  const r = await getJson(path, { method: 'POST', headers: LOCAL, body: JSON.stringify(body) });
  if (r.status !== 202) throw new Error(`${path} が ${r.status}`);
  let last = r.body.job;
  for (;;) {
    await sleep(500);
    let p;
    try {
      p = (await getJson('/api/update/progress')).body;
    } catch {
      p = null; // 閉じた
    }
    if (p?.boot && p.boot !== boot0) break; // もう新しいサーバー
    if (p?.job) last = p.job;
    if (p?.job && !['running', 'restarting'].includes(p.job.state)) return { sec: (Date.now() - started) / 1000, job: last, reopened: false };
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('起こし直しが終わりませんでした');
    if (!p) {
      await waitStatus(15 * 60 * 1000);
    }
  }
  return { sec: (Date.now() - started) / 1000, job: last, reopened: true };
}

async function serverPart() {
  const v0 = git(user, 'rev-parse', 'HEAD');
  const v1 = publish('1.0.1', ['てすと: アップデートの とおしの たしかめが できる'], bumpLock);
  check('取り先を 1.0.1 に進めた(lock も変わる版)', Boolean(v1));
  startWatcher();
  check('見張り役でアプリが起きた', await waitStatus(180000));
  let u = (await getJson('/api/update', { headers: { 'x-yc-character': 'mikan' } })).body;
  check('開いた時の確かめで「新しい版がある」', u?.available === true && u.theirs === '1.0.1' && u.ours === '1.0.0', `ours ${u?.ours} theirs ${u?.theirs}`);
  check('できるようになったことが届く', JSON.stringify(u?.news ?? []).includes('とおしの たしかめ'));
  check('この キャラに いれられる ひょうげん(みかん)', Array.isArray(u?.offers) && u.offers.some((o) => o.cap === 'look_2d'), (u?.offers ?? []).map((o) => o.cap).join(','));
  const a = await runAndReopen('/api/update/apply');
  check('「アップデートする」1 回で、起こし直して開き直せた', a.reopened, `${a.sec.toFixed(1)} 秒・${(a.job?.steps ?? []).join(' / ')}`);
  u = (await getJson('/api/update', { headers: { 'x-yc-character': 'mikan' } })).body;
  check('開き直した後は 1.0.1(新しい版の印は消える・元に戻せる)', u?.ours === '1.0.1' && u.available === false && u.canUndo === true, `ours ${u?.ours} canUndo ${u?.canUndo}`);
  check('写しの git の先が 1.0.1 の記録', git(user, 'rev-parse', 'HEAD') === v1);
  check('部品を入れ直した(lock が変わった版。見張り役が止めている間に)', /部品を入れています/.test(watcherLog));
  check('使う人の物の控えを取った(backups/)', existsSync(join(user, 'backups')));
  const b = await runAndReopen('/api/update/undo');
  check('「もとに もどす」1 回で、起こし直して開き直せた', b.reopened, `${b.sec.toFixed(1)} 秒・${(b.job?.steps ?? []).join(' / ')}`);
  u = (await getJson('/api/update', { headers: { 'x-yc-character': 'mikan' } })).body;
  check('戻した後は 1.0.0(また新しい版の印が出る)', u?.ours === '1.0.0' && u.canUndo === false && u.available === true, `ours ${u?.ours} available ${u?.available}`);
  check('写しの git の先が前の記録', git(user, 'rev-parse', 'HEAD') === v0);
  // 動かない新しい版: サーバーの入口で止まる
  publish('1.0.2', ['てすと: うごかない はん(もとに もどる たしかめ)'], (dir) => {
    const p = join(dir, 'web', 'server', 'index.mjs');
    writeFileSync(p, `throw new Error('通しの確かめのために、わざと動かない版');\n${readFileSync(p, 'utf8')}`);
  });
  await getJson('/api/update/check', { method: 'POST', headers: LOCAL, body: JSON.stringify({}) }); // 「アップデートを かくにん」
  const c = await runAndReopen('/api/update/apply');
  u = (await getJson('/api/update', { headers: { 'x-yc-character': 'mikan' } })).body;
  check('動かない新しい版は、見張り役が前の版に戻して起こした', c.reopened && u?.ours === '1.0.0' && u.fellBack === true, `ours ${u?.ours} fellBack ${u?.fellBack}・${c.sec.toFixed(1)} 秒`);
  check('見張り役の記録に「前の版に戻します」', /前の版に戻します/.test(watcherLog));
  check('写しの git の先が前の記録(動かない版は残らない)', git(user, 'rev-parse', 'HEAD') === v0);
}

async function browserPart() {
  const { chromium } = await import('playwright-core');
  const { GPU_ARGS, stopIfSoftwareRenderer } = await import('../src/stage/gpuGuard.js');
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  const browser = await chromium.launch({ ...opts, headless: true, args: GPU_ARGS });
  const shots = join(OUT, 'shots');
  mkdirSync(shots, { recursive: true });
  try {
    const v1 = publish('1.0.3', ['てすと: がめんから アップデートできる'], (dir) => {
      const p = join(dir, 'web', 'server', 'index.mjs'); // 1.0.2 の「わざと動かない」1 行を外す
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^throw new Error\('通しの確かめのために、わざと動かない版'\);\n/, ''));
    });
    check('取り先を 1.0.3 に進めた(画面の確かめ)', Boolean(v1));
    // 開いた時の確かめは 1 日 1 回なので(今日はもう見た)、「アップデートを かくにん」と同じ呼び出しで、取り先の 1.0.3 を先に取っておく
    const pre = (await getJson('/api/update/check', { method: 'POST', headers: LOCAL, body: JSON.stringify({}) })).body;
    check('「アップデートを かくにん」で 1.0.3 が見える', pre?.theirs === '1.0.3' && pre?.available === true, `theirs ${pre?.theirs}`);
    const sizes = [['pc', 1280, 720], ['phone', 390, 844]];
    for (const [name, width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.addInitScript(() => localStorage.setItem('yc.onboarded.v1', 'done')); // 初めての会話(7 つのステップ)は、この確かめでは出さない
      await page.goto(`${BASE}/?character=mikan`);
      const renderer = await stopIfSoftwareRenderer(page, browser, { exit: false });
      if (name === 'pc') check('描画は GPU(CPU の描画ではない)', Boolean(renderer), renderer);
      await page.click('#startSim');
      await page.waitForSelector('#ycUpdateBadge:not([hidden])', { timeout: 60000 });
      await page.screenshot({ path: join(shots, `${name}_1_badge.png`) });
      await page.click('#ycUpdateBadge');
      await page.waitForSelector('#ycUpdate:not([hidden])');
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(shots, `${name}_2_window.png`) });
      if (name === 'phone') {
        await page.close();
        continue;
      }
      const nav = page.waitForEvent('framenavigated', { timeout: 15 * 60 * 1000 });
      await page.click('#ycUpdateApply');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(shots, `${name}_3_progress.png`) });
      await nav;
      await page.waitForSelector('#ycGateUpdate', { timeout: 120000 });
      await page.screenshot({ path: join(shots, `${name}_4_reopened_gate.png`) });
      const atGate = await page.textContent('#ycGateUpdate');
      check('画面: 押した後に自動で開き直し、入口に「アップデートが おわったよ」', /アップデートが おわったよ.*1\.0\.3/.test(atGate ?? ''), atGate);
      await page.waitForSelector('#startSim:not([disabled])', { timeout: 60000 });
      await page.click('#startSim');
      await page.waitForSelector('#ycUpdateNote:not([hidden])', { timeout: 30000 });
      await page.screenshot({ path: join(shots, `${name}_4b_reopened.png`) });
      await page.click('#ycAudioBtn');
      await page.click('#ycAudioUpdate');
      await page.waitForSelector('#ycUpdateUndo:not([hidden])', { timeout: 30000 });
      await page.screenshot({ path: join(shots, `${name}_5_undo_button.png`) });
      const nav2 = page.waitForEvent('framenavigated', { timeout: 15 * 60 * 1000 });
      await page.click('#ycUpdateUndo');
      await nav2;
      await page.waitForSelector('#ycGateUpdate', { timeout: 120000 });
      const said2 = await page.textContent('#ycGateUpdate');
      check('画面: 「もとに もどす」の後に自動で開き直し「まえの はんに もどったよ」', /まえの はんに もどったよ.*1\.0\.0/.test(said2 ?? ''), said2);
      await page.screenshot({ path: join(shots, `${name}_6_undone_gate.png`) });
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

let failed = false;
try {
  makeClones();
  npmCi(user);
  await serverPart();
  if (BROWSER) await browserPart();
} catch (err) {
  failed = true;
  check('止まらずに最後まで流れた', false, String(err?.message ?? err));
} finally {
  stopWatcher();
  await sleep(500);
  const ok = !failed && results.every((r) => r.ok);
  writeFileSync(join(OUT, 'result.json'), `${JSON.stringify({ ok, sec: +((Date.now() - t0) / 1000).toFixed(1), port: PORT, branch, checks: results }, null, 2)}\n`);
  log(`${ok ? '全部 OK' : 'NG があります'}: ${results.filter((r) => r.ok).length}/${results.length}(${join(OUT, 'result.json')})`);
  if (!argv.includes('--keep')) {
    for (const d of [user, maker, origin]) {
      try {
        rmSync(d, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        log(`片づけられなかった物があります(git の読むだけの印のため): ${d}`);
      }
    }
  }
  process.exitCode = ok ? 0 : 1;
}
