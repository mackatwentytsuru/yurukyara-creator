// フック(PostToolUse): web/ の画面・サーバー・試験を直したら、試験を回して、壊れていればすぐ知らせる。
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let file = '';
try {
  file = JSON.parse(input).tool_input?.file_path ?? '';
} catch {
  process.exit(0);
}
const webRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web'));
const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();
const inside = norm(file).startsWith(norm(webRoot) + '/');
if (!file || !inside || !/\/(src|server|test)\//.test(norm(file)) || !/\.(m?js|css|html)$/.test(file)) process.exit(0);

const r = spawnSync(process.execPath, ['--test'], { cwd: webRoot, encoding: 'utf8', timeout: 60000 });
if (r.status === 0) process.exit(0);
const failed = (r.stdout ?? '').split('\n').filter((l) => /^\s*not ok|error:|expected|actual/.test(l)).slice(0, 12);
console.error('[web の試験] 失敗があります:');
for (const l of failed) console.error('  ' + l.trim());
console.error('(全部: cd web && npm test)');
process.exit(2);
