// フックの試験: 本物のフックを別の処理で動かし、標準入力に JSON を渡して、終わりの番号と理由を見る。
// 流し方: node --test tools/hooks/test/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(HOOKS, 'stage-gate.mjs');
const SECRETS = join(HOOKS, 'check-secrets.mjs');
const temps = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const put = (root, rel, text) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
};

function run(script, input, env = {}) {
  const clean = { ...process.env };
  for (const k of ['YC_AUTOPILOT', 'YC_CHAR_ID', 'PREPUSH_TERMS', 'YC_HOOK_LOG']) delete clean[k];
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env: { ...clean, ...env }, timeout: 30000 });
  return { code: r.status, err: r.stderr, out: r.stdout };
}

describe('段の関所(stage-gate)', () => {
  const proj = tmp('yc-gate-');
  const log = join(proj, 'blocked.jsonl');
  put(proj, 'creator/work/robo/review/0.json', JSON.stringify({ n: 0, decision: 'ok' }));
  put(proj, 'creator/work/robo/review/1.json', JSON.stringify({ n: 1, decision: 'auto' }));
  put(proj, 'creator/work/robo/review/2.json', JSON.stringify({ n: 2, decision: 'redo' }));
  put(proj, 'creator/work/kumo/review/0.json', JSON.stringify({ n: 0, decision: 'waiting' }));
  const env = (more = {}) => ({ CLAUDE_PROJECT_DIR: proj, YC_HOOK_LOG: log, ...more });
  const skill = (name, args = '', more) => run(GATE, { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: name, args } }, env(more));

  test('前の段が ok か auto なら通す', () => {
    assert.equal(skill('yc-1-look', 'robo').code, 0);
    assert.equal(skill('yc-2-shape', 'robo').code, 0);
  });
  test('前の段が redo なら止め、理由に段と今の状態を出す。何度呼んでも止める', () => {
    for (let i = 0; i < 3; i++) {
      const r = skill('yc-3-material', 'robo');
      assert.equal(r.code, 2, r.err);
      assert.match(r.err, /段 3/);
      assert.match(r.err, /redo/);
    }
  });
  test('前の段の記録が無ければ止める', () => {
    const r = skill('yc-4-texture', 'robo');
    assert.equal(r.code, 2);
    assert.match(r.err, /3\.json/);
  });
  test('引数のキャラで分ける(kumo は段 0 がまだ waiting)', () => {
    const r = skill('yc-1-look', 'kumo');
    assert.equal(r.code, 2);
    assert.match(r.err, /waiting/);
  });
  test('段 0・段でないスキル・ほかの道具は止めない', () => {
    assert.equal(skill('yc-0-draw', 'robo').code, 0);
    assert.equal(skill('make-character', 'robo').code, 0);
    assert.equal(run(GATE, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, env()).code, 0);
  });
  test('人が /yc-3-… と打った時も止める', () => {
    const r = run(GATE, { hook_event_name: 'UserPromptSubmit', prompt: '/yc-3-material robo' }, env());
    assert.equal(r.code, 2);
  });
  test('YC_AUTOPILOT=1(人が決めた無人の通し)なら飛ばす', () => {
    assert.equal(skill('yc-3-material', 'robo', { YC_AUTOPILOT: '1' }).code, 0);
  });
  test('止めた事を 1 行の JSON で残す(K6)', () => {
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.length >= 3);
    assert.ok(lines.every((l) => l.decision === 'block' && l.hook === 'stage-gate'));
  });
  test('作業中のキャラが無ければ止める', () => {
    const empty = tmp('yc-gate-empty-');
    const r = run(GATE, { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'yc-2-shape' } }, { CLAUDE_PROJECT_DIR: empty, YC_HOOK_LOG: join(empty, 'l.jsonl') });
    assert.equal(r.code, 2);
  });
});

describe('鍵の見張り(check-secrets)', () => {
  const proj = tmp('yc-sec-');
  const terms = put(proj, 'terms.local.txt', '# 試験の語\nひみつ村\ncs:SHOPX\n');
  const env = (more = {}) => ({ CLAUDE_PROJECT_DIR: proj, PREPUSH_TERMS: terms, YC_HOOK_LOG: join(proj, 'log.jsonl'), ...more });
  const fakeKey = ['sk', 'ant', 'api03', 'x'.repeat(30)].join('-'); // 試験だけの偽の鍵(形だけ)
  const write = (file_path, content, more) => run(SECRETS, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path, content } }, env(more));

  test('Write: 鍵らしい文字列を止め、理由に値を出さない', () => {
    const r = write('a.md', `key = ${fakeKey}`);
    assert.equal(r.code, 2);
    assert.match(r.err, /Anthropic/);
    assert.ok(!r.err.includes(fakeKey));
  });
  test('Write: きれいな文は通す', () => {
    assert.equal(write('a.md', 'こんにちは。ふつうの文です。').code, 0);
  });
  test('Write: .env には書かせない。.env.example はよい', () => {
    assert.equal(write('web/.env', 'A=1').code, 2);
    assert.equal(write('web/.env.local', 'A=1').code, 2);
    assert.equal(write('web/.env.example', 'A=').code, 0);
  });
  test('Edit・MultiEdit: 入れない語を止める(大文字と小文字は既定で区別しない、cs: は区別する)', () => {
    const edit = (new_string) => run(SECRETS, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'b.md', old_string: 'x', new_string } }, env());
    assert.equal(edit('ここはひみつ村です').code, 2);
    assert.equal(edit('SHOPX の話').code, 2);
    assert.equal(edit('shopx は英語の語として通す').code, 0);
    const multi = run(SECRETS, { hook_event_name: 'PreToolUse', tool_name: 'MultiEdit', tool_input: { file_path: 'c.md', edits: [{ new_string: 'ok' }, { new_string: 'ひみつ村' }] } }, env());
    assert.equal(multi.code, 2);
  });
  test('語の一覧のファイル自身には書ける', () => {
    assert.equal(write('tools/prepush_terms.local.txt', 'ひみつ村').code, 0);
  });
  test('語の一覧が無くても、鍵は止める', () => {
    const r = write('a.md', fakeKey, { PREPUSH_TERMS: join(proj, 'none.txt') });
    assert.equal(r.code, 2);
    assert.match(r.err, /語は見ていません/);
  });
  test('Bash: git commit の直前に、記録する差分の鍵と語を止める。commit 以外は見ない', () => {
    const repo = tmp('yc-sec-git-');
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q');
    put(repo, 'ok.txt', 'hello\n');
    git('add', 'ok.txt');
    const bash = (command) => run(SECRETS, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }, env({ CLAUDE_PROJECT_DIR: repo }));
    assert.equal(bash('git commit -m x').code, 0);
    put(repo, 'bad.txt', `token: ${fakeKey}\n`);
    put(repo, '.env', 'A=1\n');
    git('add', 'bad.txt', '.env');
    const r = bash('git commit -m x');
    assert.equal(r.code, 2);
    assert.match(r.err, /bad\.txt/);
    assert.match(r.err, /\.env/);
    assert.equal(bash('git status').code, 0);
  });
  test('止めた事を記録する', () => {
    assert.ok(existsSync(join(proj, 'log.jsonl')));
  });
});
