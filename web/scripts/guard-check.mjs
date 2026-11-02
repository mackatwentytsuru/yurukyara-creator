// 鍵の見張り(.claude/hooks/check-secrets.mjs)と push 前の検査(tools/prepush_check.py)の「検査の検査」。
//   node scripts/guard-check.mjs
// 使い捨ての git リポジトリに、わざと不良を 1 つずつ入れて、止まるべき物が止まるか見る。
// 偽の鍵はここで組み立てる(このファイル自身に鍵らしい文字列を残さないため)。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO, '.claude', 'hooks', 'check-secrets.mjs');
const PREPUSH = join(REPO, 'tools', 'prepush_check.py');

const rand = (n) => 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(3).slice(0, n);
const fake = {
  anthropic: ['sk', 'ant', 'api03', rand(40)].join('-'),
  eleven: ['sk', rand(32).replace(/[^a-f0-9]/g, 'a')].join('_'),
  github: ['ghp', rand(30)].join('_'),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
};
const word = String.fromCodePoint(0x7acb, 0x98db); // 入れてはいけない名前(このファイル自身に書かないよう、文字コードから作る)

// [名前, ファイル名, 中身, フック(commit 前)が止めるべきか, push 前の検査が止めるべきか]
const CASES = [
  ['きれいなファイル', 'src/a.js', 'export const a = 1;\n', false, false],
  ['Anthropic の鍵', 'src/k1.js', `const k = '${fake.anthropic}';\n`, true, true],
  ['ElevenLabs の鍵', 'src/k2.js', `const k = '${fake.eleven}';\n`, true, true],
  ['鍵の代入(環境変数の名前で)', 'src/k3.js', `ANTHROPIC_API_KEY=${rand(30)}\n`, true, false],
  ['xi-api-key に直書き', 'src/k4.js', `h = { "xi-api-key": "${rand(30)}" }\n`, true, false],
  ['GitHub の鍵', 'src/k5.js', `const t = '${fake.github}';\n`, false, true],
  ['AWS の鍵', 'src/k6.js', `const t = '${fake.aws}';\n`, false, true],
  ['.env', '.env', 'X=1\n', true, true],
  ['.env.local', '.env.local', 'X=1\n', true, true],
  ['.env.production(別名の .env)', '.env.production', 'X=1\n', true, true],
  ['web/.env', 'web/.env', 'X=1\n', true, true],
  ['.env.example(見本は上げてよい)', 'web/.env.example', 'X=\n', false, false],
  ['VRM(キャラの外)', 'web/public/x.vrm', 'dummy', true, true],
  ['VRM(キャラのフォルダ)', 'characters/f_led/model.vrm', 'dummy', false, true],
  ['ログ', 'web/logs/a.log', 'x\n', true, false],
  ['入れてはいけない名前', 'docs/memo.md', `${word}の件\n`, false, true],
  ['秘密鍵(.pem)', 'certs/a.pem', 'x\n', false, true],
];

function repoWith(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const sh = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  sh('init', '-q');
  sh('config', 'user.email', 't@example.com');
  sh('config', 'user.name', 't');
  mkdirSync(join(dir, name, '..'), { recursive: true });
  writeFileSync(join(dir, name), content);
  sh('add', '-f', name);
  return dir;
}

let wrong = 0;
const rows = [];
for (const [label, file, content, hookShould, prepushShould] of CASES) {
  const dir = repoWith(file, content);
  try {
    const hook = spawnSync(process.execPath, [HOOK], { cwd: dir, input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }), encoding: 'utf8' });
    const pre = spawnSync('python', ['-I', PREPUSH], { cwd: dir, encoding: 'utf8' });
    const hookStopped = hook.status === 2;
    const preStopped = pre.status === 1;
    const okHook = hookStopped === hookShould;
    const okPre = preStopped === prepushShould;
    if (!okHook || !okPre) wrong += 1;
    rows.push(`${okHook && okPre ? '○' : '×'} ${label.padEnd(26)} フック ${hookStopped ? '止めた' : '通した'}(期待 ${hookShould ? '止める' : '通す'}) / push 前 ${preStopped ? '止めた' : '通した'}(期待 ${prepushShould ? '止める' : '通す'})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(rows.join('\n'));
console.log(`\n${CASES.length} 件中、期待と違う物 ${wrong} 件`);
process.exit(wrong ? 1 : 0);
