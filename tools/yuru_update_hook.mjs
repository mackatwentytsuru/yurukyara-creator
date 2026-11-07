// Claude Code を開いた時(SessionStart のフック)に、新しい版があるかを 1 日 1 回だけ見る起動役。
// - 何があっても止めない: 終わりの番号はいつも 0。python の道具は 8 秒で打ち切る(フックの上限 10 秒の中)。
// - 今日もう見た・止めてある(環境変数 YURU_UPDATE_CHECK=0)・git clone でない・Python が無い時は、何もせずに終わる。
// - Windows のストアの「python」の入口(WindowsApps)は呼ばない(Python が無い PC でストアが開くのを防ぐ)。
// - 書くのは、リポジトリの中の .yuru_update.json だけ(python tools/yuru_update.py check --quiet --once-a-day が書く)。
//   使う人のキャラ・記憶・設定には触らない。出すのは、新しい版がある時の 1 行だけ(Claude Code の会話に渡る)。
// フックに足す時の 1 行(.claude/settings.json の "SessionStart"):
//   { "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/yuru_update_hook.mjs\"", "timeout": 10 } ] }
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'yuru_update.py');
const LIMIT_MS = 8000;

function today() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function checkedToday() {
  try {
    const st = JSON.parse(readFileSync(join(ROOT, '.yuru_update.json'), 'utf8'));
    return String(st.last_try ?? '').slice(0, 10) === today();
  } catch {
    return false;
  }
}

/** 本物の Python を PATH から探す。[実行ファイル, 先に付ける引数] か null */
export function findPython(pathValue = process.env.PATH ?? '', platform = process.platform, exists = existsSync) {
  const names = platform === 'win32' ? ['python.exe', 'py.exe', 'python3.exe'] : ['python3', 'python'];
  const dirs = pathValue.split(platform === 'win32' ? ';' : delimiter).filter((d) => d && !/WindowsApps/i.test(d));
  for (const name of names) {
    for (const dir of dirs) {
      const file = join(dir, name);
      if (exists(file)) return [file, name === 'py.exe' ? ['-3'] : []];
    }
  }
  return null;
}

function main() {
  if (process.env.YURU_UPDATE_CHECK === '0') return;
  if (!existsSync(join(ROOT, '.git')) || !existsSync(TOOL) || checkedToday()) return;
  const py = findPython();
  if (!py) return;
  const r = spawnSync(py[0], [...py[1], TOOL, 'check', '--quiet', '--once-a-day'], {
    cwd: ROOT,
    timeout: LIMIT_MS,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const line = (r.stdout ?? '').trim();
  if (r.status === 0 && line) process.stdout.write(`${line}\n`);
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch {
    // 起動のおしらせは、うまくいかなくても黙って終わる
  }
  process.exit(0);
}
