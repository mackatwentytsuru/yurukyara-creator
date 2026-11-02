// フック(PreToolUse): git commit の直前に、これから記録する差分に「鍵・.env・VRM・ログ」が入っていないかを調べる。
// 見つけたら止める(終了コード 2)。公開リポジトリに鍵を出さないための、最後の網。
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let command = '';
try {
  command = JSON.parse(input).tool_input?.command ?? '';
} catch {
  process.exit(0);
}
if (!/\bgit\s+(-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
const names = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
const added = git('diff', '--cached', '-U0')
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'));

const problems = [];

for (const n of names) {
  if (/(^|\/)\.env(?!\.(example|sample)$)(\.[\w-]+)?$/.test(n)) problems.push(`${n}: .env は記録しません(.env.example だけ)`);
  if (/\.(vrm|glb|gltf)$/i.test(n) && !/^characters\/(?!_test)/.test(n) && !/^places\//.test(n)) problems.push(`${n}: モデルのファイルは、キャラ・場所のフォルダ以外には入れません`);
  if (/(^|\/)logs\//.test(n)) problems.push(`${n}: ログは記録しません`);
}

const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic の鍵らしい文字列'],
  [/\bsk_[a-f0-9]{32,}\b/, 'ElevenLabs の鍵らしい文字列'],
  [/(ANTHROPIC|ELEVEN(LABS)?)_?API_?KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{16,}/i, '鍵の代入'],
  [/xi-api-key['"]?\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i, 'xi-api-key に直接書いた値'],
];
for (const line of added) {
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(line)) problems.push(`${label}: ${line.slice(0, 60).replace(/[A-Za-z0-9_-]{12,}/g, '…')}`);
  }
}

if (problems.length) {
  console.error('[鍵の見張り] 記録を止めました。');
  for (const p of problems.slice(0, 10)) console.error(` - ${p}`);
  console.error('直してから、もう一度 git commit してください(鍵は環境変数で読み、.env.example だけを置きます)。');
  process.exit(2);
}
process.exit(0);
