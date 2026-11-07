// 始める命令 1 つ(第 12 波 b・BUX。本人「使う人はどう入れて、どう進めるの?」への答え)。web のフォルダで:
//   node scripts/yuru.mjs [--lan] [--port 8787] [--make-port 8796] [--no-make]   (npm run yuru の中身)
// - アプリを見張り役(scripts/yuru-run.mjs)の下で起こす(画面の「アップデートする」の後も、自分で起こし直せる)。
// - Python と作る道の部品(creator/review/serve_review.py)があれば、作る道のサーバーも一緒に起こす(言葉か絵からキャラを作る)。
// - 起きたら、開く住所を出す。--lan の時は、同じ Wi-Fi のスマホで開く住所と、segno があれば QR も出す
//   (スマホの声とカメラには https が要る。文字で話す・作るのは http でもできる)。
// - Ctrl+C で、自分で起こした物だけを止めて終わる(名前では止めない)。鍵は環境変数のまま渡すだけで、表示も記録もしない。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWatcher } from './yuru-run.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(WEB, '..');
const MAKE = join(REPO, 'creator', 'review', 'serve_review.py');
const say = (line = '') => process.stdout.write(`${line}\n`);

function argValue(argv, name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}

export function findPython(pathValue = process.env.PATH ?? '', platform = process.platform, exists = existsSync) {
  if (process.env.YURU_PYTHON) return [process.env.YURU_PYTHON, []];
  const names = platform === 'win32' ? ['python.exe', 'py.exe', 'python3.exe'] : ['python3', 'python'];
  const dirs = String(pathValue).split(platform === 'win32' ? ';' : ':').filter((d) => d && !/WindowsApps/i.test(d));
  for (const name of names) for (const dir of dirs) if (exists(join(dir, name))) return [join(dir, name), name === 'py.exe' ? ['-3'] : []];
  return null;
}

// PC の中だけの仮の網(WSL・Hyper-V・Docker・仮の PC)。スマホからは届かないので選ばない(11/8 の試しで WSL の住所を選んだ)
const VIRTUAL_NET = /vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|vboxnet|^br-|^veth|^virbr|Loopback/i;

/** 同じ Wi-Fi のスマホから届く、この PC の住所(家の中の住所を 192.168 → 10 → 172 の順に)。無ければ null */
export function lanAddress(nets = networkInterfaces()) {
  const all = Object.entries(nets)
    .filter(([name]) => !VIRTUAL_NET.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  for (const re of [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./]) {
    const hit = all.find((a) => re.test(a));
    if (hit) return hit;
  }
  return all[0] ?? null;
}

/** 起きた時に出す行(住所と、次にすること)。決まりを試験で見られるように、文の組み立てだけを分ける */
export function addressLines({ port, makePort, makeUp, lan, makeSkipped = false }) {
  const lines = ['', 'ゆるキャラクリエイターが おきました。', `  アプリ: http://127.0.0.1:${port}/  (この PC のブラウザで ひらいてね)`];
  if (makeUp) lines.push(`  作る道: http://127.0.0.1:${makePort}/qr  (この PC で ひらくと、作る画面への リンクと、スマホで よむ QR が でるよ)`);
  else if (makeSkipped) lines.push('  作る道: とめてあります(--no-make)');
  else lines.push('  作る道: うごいていません(Python 3 と、README の「自分の PC で、Claude Code と自分のキャラを作る」の部品が いります)');
  if (lan) lines.push(`  スマホ: http://${lan}:${port}/  (おなじ Wi-Fi で。もじで はなす・作るは このままで できるよ。こえと カメラは https が いるよ)`);
  lines.push('  とめるときは Ctrl+C。アップデートは、アプリの 画面の「あたらしい はんが あります」から できるよ。', '');
  return lines;
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

async function waitApp(port, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(3000) })).ok) return true;
    } catch {
      // まだ
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function showQr(py, url) {
  if (!py) return;
  const r = spawnSync(py[0], [...py[1], '-c', 'import segno,sys; segno.make(sys.argv[1]).terminal(compact=True)', url], { stdio: ['ignore', 'inherit', 'ignore'], timeout: 15000, windowsHide: true });
  if (r.status !== 0) say('  (QR を出すには、python -m pip install segno)');
}

/** 作る道のサーバーを起こす。{child, up:Promise<boolean>} か null */
function startMake(py, { port, makePort, lan }) {
  if (!py || !existsSync(MAKE)) return null;
  const args = [...py[1], MAKE, '--make', '--web', `http://127.0.0.1:${port}`, '--port', String(makePort), ...(lan ? ['--lan'] : [])];
  const child = spawn(py[0], args, { cwd: REPO, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const up = new Promise((done) => {
    let told = false;
    const tell = (v) => {
      if (!told) {
        told = true;
        done(v);
      }
    };
    const onLine = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        if (/^PORT \d+/.test(line)) tell(true);
        else say(`[作る道] ${line}`);
      }
    };
    child.stdout.setEncoding('utf8').on('data', onLine);
    child.stderr.setEncoding('utf8').on('data', onLine);
    child.on('close', () => tell(false));
    child.on('error', () => tell(false));
    setTimeout(() => tell(child.exitCode === null), 20000);
  });
  return { child, up };
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const lanOn = argv.includes('--lan');
  const port = Number(argValue(argv, '--port', process.env.PORT ?? 8787));
  const makePort = Number(argValue(argv, '--make-port', 8796));
  const py = findPython();
  const w = runWatcher({ port, host: lanOn ? '0.0.0.0' : process.env.HOST ?? '127.0.0.1' });
  const make = argv.includes('--no-make') ? null : startMake(py, { port, makePort, lan: lanOn });
  const stop = () => {
    w.stop();
    if (make) killTree(make.child.pid);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  void (async () => {
    const [appUp, makeUp] = await Promise.all([waitApp(port), make ? make.up : Promise.resolve(false)]);
    if (!appUp) return;
    const lan = lanOn ? lanAddress() : null;
    for (const line of addressLines({ port, makePort, makeUp, lan, makeSkipped: argv.includes('--no-make') })) say(line);
    if (lan) showQr(py, `http://${lan}:${port}/`);
  })();
  const code = await w.done;
  if (make) killTree(make.child.pid);
  process.exitCode = code;
}
