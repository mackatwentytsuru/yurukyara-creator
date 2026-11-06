// わざと壊す試験: フックの写しを 1 か所ずつ壊し、試験が落ちる(= 試験が本当に見張っている)ことを確かめる。
// 流し方: node tools/hooks/test/mutation.mjs(終わりの番号 0 = 全部の壊し方で試験が落ちた)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
  ['前の段の OK を見ない', 'lib/gate-core.mjs', (s) => s.replace('if (PASS.has(rec?.decision)) return', 'if (true) return')],
  ['redo も OK にする', 'lib/gate-core.mjs', (s) => s.replace("new Set(['ok', 'auto'])", "new Set(['ok', 'auto', 'redo'])")],
  ['記録が無ければ通す', 'lib/gate-core.mjs', (s) => s.replace("return { gated: true, ok: false, id, stage: n, why: `前の段の記録", "return { gated: true, ok: true, id, stage: n, why: `前の段の記録")],
  ['止める時の番号を 1 にする', 'lib/hook-io.mjs', (s) => s.replace('process.exitCode = 2;', 'process.exitCode = 1;')],
  ['おまかせの印を見ない', 'lib/hook-io.mjs', (s) => s.replace("process.env.YC_AUTOPILOT === '1'", 'false')],
  ['人が打った時を見ない', 'stage-gate.mjs', (s) => s.replace("input.hook_event_name === 'UserPromptSubmit'", 'false')],
  ['Anthropic の鍵の形を消す', 'lib/secret-core.mjs', (s) => s.replace("[/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic の鍵らしい文字列'],", '')],
  ['鍵の値を理由に出す', 'lib/secret-core.mjs', (s) => s.replace('`${label}: ${mask(m[0])}`', '`${label}: ${m[0]}`')],
  ['語の一覧を使わない', 'lib/secret-core.mjs', (s) => s.replace('for (const re of [terms?.loose, terms?.strict])', 'for (const re of [])')],
  ['cs: も区別しない', 'lib/secret-core.mjs', (s) => s.replace("new RegExp(strict.map(esc).join('|'))", "new RegExp(strict.map(esc).join('|'), 'i')")],
  ['.env を通す', 'lib/secret-core.mjs', (s) => s.replace("return '.env は記録しません(.env.example だけ)';", "return '';")],
  ['Edit を見ない', 'lib/secret-core.mjs', (s) => s.replace("if (toolName === 'Edit') return String(ti.new_string ?? '');", '')],
  ['commit の差分を見ない', 'check-secrets.mjs', (s) => s.replace("else if (line.startsWith('+') && !isTermsFile(file))", 'else if (false)')],
];

let survived = 0;
for (const [name, file, fn] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-mut-'));
  cpSync(SRC, dir, { recursive: true });
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.log(`?? ${name}: 置き換えが当たらない(壊せていない)`);
    survived += 1;
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(p, after);
  const r = spawnSync(process.execPath, ['--test', join(dir, 'test', 'hooks.test.mjs')], { encoding: 'utf8', timeout: 300000 });
  const failed = r.status !== 0;
  console.log(`${failed ? 'ok' : 'NG'} ${name}: ${failed ? '試験が落ちた' : '試験が通ってしまった'}`);
  if (!failed) survived += 1;
  rmSync(dir, { recursive: true, force: true });
}
console.log(`壊し方 ${MUTANTS.length} 個のうち、見逃し ${survived} 個`);
process.exitCode = survived ? 1 : 0;
