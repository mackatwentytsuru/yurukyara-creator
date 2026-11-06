// フック(PreToolUse): 鍵と入れない語の見張り。今の .claude/hooks/check-secrets.mjs(git commit の直前だけ)を広げた版。
// 1) Bash の git commit の直前: これから記録する差分の名前と足した行を見る(前と同じ)+入れない語
// 2) Write・Edit・MultiEdit の直前: 書く先がリポジトリ(CLAUDE_PROJECT_DIR)の中の時だけ、書こうとしている文と
//    書く先のファイルの名前を見る。外(作業の板・メモなど)は記録に入らないので見ない。
// 見つけたら止める(終了コード 2)。登録の形は tools/hooks/README.md。
import { spawnSync } from 'node:child_process';
import { badPath, checkText, insideProject, isTermsFile, loadTerms, textOfEdit } from './lib/secret-core.mjs';
import { block, logBlock, projectRoot, readInput } from './lib/hook-io.mjs';

const input = await readInput();
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};
const root = projectRoot();
const terms = loadTerms(root);
const problems = [];

if (tool === 'Bash') {
  const command = String(ti.command ?? '');
  if (!/\bgit\s+(-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);
  const git = (...args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
  for (const n of git('diff', '--cached', '--name-only').split('\n').filter(Boolean)) {
    const why = badPath(n);
    if (why) problems.push(`${n}: ${why}`);
    if (/(^|\/)logs\//.test(n)) problems.push(`${n}: ログは記録しません`);
  }
  let file = '';
  for (const line of git('diff', '--cached', '-U0').split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && !isTermsFile(file)) for (const p of checkText(line.slice(1), terms)) problems.push(`${file}: ${p}`);
  }
} else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const path = String(ti.file_path ?? ti.notebook_path ?? '');
  if (!insideProject(root, path, input.cwd)) process.exit(0);
  const why = badPath(path);
  if (why) problems.push(`${path}: ${why}`);
  if (!isTermsFile(path)) for (const p of checkText(textOfEdit(tool, ti), terms)) problems.push(p);
} else {
  process.exit(0);
}

if (problems.length) {
  logBlock(root, 'check-secrets', problems[0]);
  block('鍵の見張り', [
    ...problems.slice(0, 10),
    terms ? '直してから、もう一度してください(鍵は環境変数で読み、.env.example だけを置きます)。' : '(入れない語の一覧が無いので、語は見ていません)',
  ]);
}
