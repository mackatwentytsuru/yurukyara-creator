// 見張り役(第 12 波 b・BUX): アプリ(npm start と同じ「組み立て → 会話サーバー」)を起こし、サーバーが決まった番号
// (RESTART_CODE = 75。画面の「アップデートする」「もとに もどす」の後)で閉じたら、部品を確かめ、組み立て直して起こし直す。
// - 起こし直した新しい版が動かない(組み立てに失敗・すぐ止まる・/api/status が答えない)時は、1 回だけ
//   python tools/yuru_update.py undo で前の版に戻してから起こす(画面には「もとに もどしたよ」と出す: 環境変数 YURU_UPDATE_FELL_BACK=1)。
// - 部品(node_modules)は、package-lock.json の中身が前に入れた時と違えば、サーバーを止めている間に npm ci で入れ直す
//   (Windows では、動いている間に入れ直すと失敗することがある)。印は node_modules/.yuru-lock.sha256。
// - Ctrl+C で、自分で起こしたサーバーだけを止めて終わる(名前では止めない)。
// 使い方(web のフォルダで): node scripts/yuru-run.mjs [--port 8787] [--host 127.0.0.1] [--no-build]
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESTART_CODE = 75;
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '.yuru-lock.sha256';
const READY_MS = 60000; // 起こしてから /api/status が答えるまでの上限
const FAST_FAIL_MS = 30000; // 起こし直した後、この間に止まったら「新しい版が動かない」
const BUILD_MS = 5 * 60 * 1000;
const INSTALL_MS = 15 * 60 * 1000;
const UNDO_MS = 10 * 60 * 1000;

const say = (line) => process.stdout.write(`[見張り役] ${line}\n`);

export function lockHash(web = WEB) {
  try {
    return createHash('sha256').update(readFileSync(join(web, 'package-lock.json'))).digest('hex');
  } catch {
    return '';
  }
}

/** 部品の入れ直しが要るか: node_modules が無い・印が今の lock と違う(印が無い時は、入っている物を今の lock の物とみなす) */
export function needsInstall(web = WEB) {
  if (!existsSync(join(web, 'node_modules'))) return true;
  const mark = join(web, 'node_modules', MARK);
  if (!existsSync(mark)) {
    try {
      writeFileSync(mark, lockHash(web));
    } catch {
      // 印を書けなくても動く
    }
    return false;
  }
  return readFileSync(mark, 'utf8').trim() !== lockHash(web);
}

function markInstalled(web) {
  try {
    writeFileSync(join(web, 'node_modules', MARK), lockHash(web));
  } catch {
    // 印を書けなくても動く
  }
}

/** 決まった命令を時間の上限つきで流す(出力はそのまま見せる)。終わりの番号(時間切れは null) */
function runStep(cmd, args, { cwd, env, timeoutMs, shell = false }) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', windowsHide: true, shell });
    const timer = setTimeout(() => {
      killTree(child.pid);
      done(null);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    else process.kill(pid, 'SIGTERM');
  } catch {
    // もう終わっている
  }
}

function findPython() {
  if (process.env.YURU_PYTHON) return [process.env.YURU_PYTHON, []];
  const win = process.platform === 'win32';
  const names = win ? ['python.exe', 'py.exe', 'python3.exe'] : ['python3', 'python'];
  const dirs = String(process.env.PATH ?? '').split(win ? ';' : ':').filter((d) => d && !/WindowsApps/i.test(d));
  for (const name of names) for (const dir of dirs) if (existsSync(join(dir, name))) return [join(dir, name), name === 'py.exe' ? ['-3'] : []];
  return null;
}

/** ふだんの命令の組(試験では偽の命令に替える) */
export function defaultCommands(web = WEB) {
  const repo = resolve(web, '..');
  const vite = join(web, 'node_modules', 'vite', 'bin', 'vite.js');
  const py = findPython();
  return {
    install: () => runStep(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: web, env: process.env, timeoutMs: INSTALL_MS, shell: process.platform === 'win32' }),
    build: () => (existsSync(vite) ? runStep(process.execPath, [vite, 'build'], { cwd: web, env: process.env, timeoutMs: BUILD_MS }) : Promise.resolve(1)),
    server: (env) => spawn(process.execPath, [join(web, 'server', 'index.mjs')], { cwd: web, env, stdio: 'inherit', windowsHide: true }),
    undo: () => (py && existsSync(join(repo, 'tools', 'yuru_update.py'))
      ? runStep(py[0], [...py[1], join(repo, 'tools', 'yuru_update.py'), 'undo'], { cwd: repo, env: { ...process.env, PYTHONIOENCODING: 'utf-8', YURU_UPDATE_FROM_APP: '1' }, timeoutMs: UNDO_MS })
      : Promise.resolve(null)),
  };
}

async function waitReady(base, child, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * 見張りを始める。戻り値の done はアプリを止めた時の終わりの番号、stop() は Ctrl+C と同じ。
 * @param {object} o
 * @param {number} [o.port] @param {string} [o.host] @param {boolean} [o.build] 組み立てるか(既定 true)
 * @param {ReturnType<typeof defaultCommands>} [o.commands] @param {string} [o.web]
 * @param {(line:string)=>void} [o.log]
 */
export function runWatcher({ port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1', build = true, commands, web = WEB, log = say, fastFailMs = FAST_FAIL_MS, readyMs = READY_MS } = {}) {
  const cmd = commands ?? defaultCommands(web);
  const probe = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}`;
  let child = null;
  let stopping = false;
  let fellBack = false;
  const stop = () => {
    stopping = true;
    if (child) killTree(child.pid);
  };

  async function prepare(afterUpdate) {
    if (needsInstall(web)) {
      log('アプリの部品を入れています(数分かかることがあります)…');
      if ((await cmd.install()) !== 0) return false;
      markInstalled(web);
    }
    if (!build) return true;
    log(afterUpdate ? '新しい版を組み立てています…' : '画面を組み立てています…');
    return (await cmd.build()) === 0;
  }

  /** 1 回起こして、止まるまで待つ。{code, early}(early = 起こしてから fastFailMs の間に止まった・答えなかった) */
  async function serveOnce(watchEarly) {
    const env = { ...process.env, PORT: String(port), HOST: host, YURU_WATCHER: '1', ...(fellBack ? { YURU_UPDATE_FELL_BACK: '1' } : {}) };
    child = cmd.server(env);
    const startedAt = Date.now();
    const closed = new Promise((r) => child.on('close', (code, signal) => r(code ?? (signal ? 1 : 0))));
    if (watchEarly && !(await waitReady(probe, child, readyMs))) {
      killTree(child.pid);
      await closed;
      return { code: 1, early: true };
    }
    const code = await closed;
    return { code, early: watchEarly && Date.now() - startedAt < fastFailMs && code !== RESTART_CODE };
  }

  async function fallBack() {
    log('新しい版が動かなかったので、前の版に戻します…');
    const undone = await cmd.undo();
    if (undone !== 0) {
      log('前の版に戻せませんでした。web のフォルダで npm start をもう一度ためすか、python tools/yuru_update.py status を見てください。');
      return false;
    }
    fellBack = true;
    return prepare(true);
  }

  const done = (async () => {
    let afterUpdate = false;
    if (!(await prepare(false))) {
      log('組み立てられませんでした(上のメッセージを見てください)。');
      return 1;
    }
    for (;;) {
      if (stopping) return 0;
      const { code, early } = await serveOnce(afterUpdate);
      if (stopping) return 0;
      if (code === RESTART_CODE) {
        log('アプリを起こし直します…');
        afterUpdate = true;
        if (!(await prepare(true))) {
          if (fellBack || !(await fallBack())) return 1;
        }
        continue;
      }
      if (afterUpdate && early && !fellBack) {
        if (!(await fallBack())) return 1;
        continue;
      }
      return code;
    }
  })();
  return { done, stop, get child() { return child; } };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const w = runWatcher({
    port: Number(argValue(argv, '--port') ?? process.env.PORT ?? 8787),
    host: argValue(argv, '--host') ?? process.env.HOST ?? '127.0.0.1',
    build: !argv.includes('--no-build'),
  });
  process.on('SIGINT', () => w.stop());
  process.on('SIGTERM', () => w.stop());
  process.exitCode = await w.done;
}
