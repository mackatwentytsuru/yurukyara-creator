// `npm run start:keys`(scripts/start-with-keys.mjs)の試験。鍵は全部、見え見えの偽物。
// - 鍵は画面に出さない(出すのは「入れました」「入れていません」だけ)・形の違う物は入れない
// - 鍵は子の環境変数にだけ渡す。元の環境・この試験の環境は替えない
// - ファイルを書かない: 一時のフォルダの中で本物の手順を流し、前後で何も増えていないことを見る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { KEY_QUESTIONS, childEnv, cleanKey, collectKeys, main } from '../scripts/start-with-keys.mjs';

const WEB = join(import.meta.dirname, '..');
const SCRIPT = join(WEB, 'scripts', 'start-with-keys.mjs');
const FAKE_CLAUDE = 'fake-claude-key-for-test-only-0001';
const FAKE_VOICE = 'fake-voice-key-for-test-only-0002';
const [CLAUDE_ENV, VOICE_ENV] = KEY_QUESTIONS.map((q) => q.env);

/** 出力を溜めるだけの書き込み先 */
function sink() {
  const s = new PassThrough();
  let text = '';
  s.on('data', (c) => (text += c));
  return { stream: s, text: () => text };
}

test('鍵の形: 見える ASCII の 8 字以上だけ。空・空白入り・日本語・短い物は入れない', () => {
  assert.equal(cleanKey(` ${FAKE_CLAUDE} `), FAKE_CLAUDE, '前後の空白は取る');
  for (const bad of ['', '   ', 'short', 'has space in the middle of it', '全角のかぎ全角のかぎ', 'tab\tinside-the-key-0001', undefined, null]) assert.equal(cleanKey(bad), null, String(bad));
});

test('聞く鍵は 2 つ(Claude と声)で、環境変数の名前は README の通り', () => {
  assert.deepEqual(KEY_QUESTIONS.map((q) => q.env), ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY']);
});

test('collectKeys(行で読む): 入れた鍵だけ返し、画面には「入れました」「入れていません」だけ出す', async () => {
  const stdin = new PassThrough();
  const out = sink();
  stdin.end(`${FAKE_CLAUDE}\n\n`); // 2 つ目は Enter だけ = 入れない
  const keys = await collectKeys({ stdin, stdout: out.stream });
  assert.deepEqual(keys, { [CLAUDE_ENV]: FAKE_CLAUDE });
  assert.match(out.text(), /Claude の鍵[^\n]*入れました/);
  assert.match(out.text(), /声の鍵[^\n]*入れていません/);
  assert.equal(out.text().includes(FAKE_CLAUDE), false, '鍵は画面に出さない');
});

test('collectKeys: 形の違う物は入れず、その旨だけ出す(貼った文字は出さない)', async () => {
  const stdin = new PassThrough();
  const out = sink();
  stdin.end('bad key with spaces\nxyz\n');
  const keys = await collectKeys({ stdin, stdout: out.stream });
  assert.deepEqual(keys, {});
  assert.match(out.text(), /形が違うので入れませんでした/);
  assert.equal(/bad key|xyz/.test(out.text()), false);
});

test('collectKeys: 入力が先に閉じても落ちない(どちらも入れていません)', async () => {
  const stdin = new PassThrough();
  stdin.end();
  const out = sink();
  assert.deepEqual(await collectKeys({ stdin, stdout: out.stream }), {});
});

test('collectKeys(端末): 打った文字を画面に出さない。BackSpace で消せて、Enter で確かめる', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const out = sink();
  const done = collectKeys({ stdin, stdout: out.stream });
  stdin.write(`${FAKE_CLAUDE}Z\x7f\r`); // Z を打って消す
  await new Promise((r) => setTimeout(r, 30));
  stdin.write('\r'); // 声の鍵は Enter だけ
  const keys = await done;
  assert.deepEqual(keys, { [CLAUDE_ENV]: FAKE_CLAUDE });
  assert.equal(out.text().includes(FAKE_CLAUDE), false);
  assert.equal(/fake-claude/.test(out.text()), false, '1 文字も画面に返さない');
});

test('childEnv: 元の環境に鍵を足した新しい物。元の環境は替えない', () => {
  const base = Object.freeze({ PATH: '/bin', KEEP: '1' });
  const env = childEnv(base, { [CLAUDE_ENV]: FAKE_CLAUDE });
  assert.equal(env[CLAUDE_ENV], FAKE_CLAUDE);
  assert.equal(env.KEEP, '1');
  assert.equal(CLAUDE_ENV in base, false);
  assert.deepEqual(childEnv(base, {}), { ...base }, '鍵が無ければそのまま(元の環境の鍵も消さない)');
});

/** 子が受け取った環境を JSON で出すだけの偽の「見張り役」 */
const FAKE_RUNNER = `
const e = process.env;
process.stdout.write(JSON.stringify({ claudeOk: e.${CLAUDE_ENV} === e.EXPECT_CLAUDE, voiceOk: e.${VOICE_ENV} === e.EXPECT_VOICE, args: process.argv.slice(2) }));
`;

function capture(proc) {
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  return new Promise((resolve) => proc.on('close', (code) => resolve({ code, out })));
}

test('main(): 鍵は子の環境にだけ渡る。渡した元の環境・この試験の環境は替わらない。画面に鍵は出ない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sk-main-'));
  try {
    const runner = join(dir, 'runner.mjs');
    writeFileSync(runner, FAKE_RUNNER);
    const stdin = new PassThrough();
    stdin.end(`${FAKE_CLAUDE}\n${FAKE_VOICE}\n`);
    const out = sink();
    const env = { PATH: process.env.PATH, KEEP: '1', EXPECT_CLAUDE: FAKE_CLAUDE, EXPECT_VOICE: FAKE_VOICE };
    const captured = [];
    const spawnFn = (cmd, args, opts) => {
      const proc = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
      captured.push(capture(proc));
      return proc;
    };
    const before = { claude: process.env[CLAUDE_ENV], voice: process.env[VOICE_ENV] };
    const code = await main({ argv: ['--port', '9461'], env, stdin, stdout: out.stream, runner, spawnFn });
    const child = await captured[0];
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(child.out), { claudeOk: true, voiceOk: true, args: ['--port', '9461'] }, '子は鍵 2 つと引数を受け取った');
    assert.deepEqual(Object.keys(env).sort(), ['EXPECT_CLAUDE', 'EXPECT_VOICE', 'KEEP', 'PATH'], '渡した元の環境に鍵は足されない');
    assert.deepEqual({ claude: process.env[CLAUDE_ENV], voice: process.env[VOICE_ENV] }, before, 'この試験の環境も替わらない');
    assert.equal(out.text().includes(FAKE_CLAUDE) || out.text().includes(FAKE_VOICE), false, '画面に鍵は出ない');
    assert.match(out.text(), /Claude の鍵[^\n]*入れました/);
    assert.match(out.text(), /声の鍵[^\n]*入れました/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('本物の手順を一時のフォルダで流す: ファイルは 1 つも増えない・鍵は画面にも出ない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sk-run-'));
  try {
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home);
    mkdirSync(work);
    writeFileSync(join(work, 'runner.mjs'), FAKE_RUNNER);
    writeFileSync(
      join(work, 'driver.mjs'),
      `import { main } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};\nprocess.exit(await main({ runner: ${JSON.stringify(join(work, 'runner.mjs'))}, argv: ['--no-build'] }));\n`,
    );
    const snapshot = () => readdirSync(dir, { recursive: true }).map(String).sort();
    const before = snapshot();
    const env = { ...process.env, EXPECT_CLAUDE: FAKE_CLAUDE, EXPECT_VOICE: FAKE_VOICE, HOME: home, USERPROFILE: home, TMPDIR: home, TEMP: home, TMP: home };
    delete env[CLAUDE_ENV];
    delete env[VOICE_ENV];
    const proc = spawn(process.execPath, [join(work, 'driver.mjs')], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    proc.stdin.end(`${FAKE_CLAUDE}\n${FAKE_VOICE}\n`);
    const r = await capture(proc);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.includes(FAKE_CLAUDE) || r.out.includes(FAKE_VOICE), false, '画面(標準出力・標準エラー)に鍵が出ていない');
    assert.match(r.out, /入れました/);
    assert.deepEqual(snapshot(), before, 'フォルダの中に、ファイルもフォルダも増えていない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ソース: ファイルを書く部品を読み込まない・書く関数を呼ばない・鍵の値を console に出さない', () => {
  const src = readFileSync(SCRIPT, 'utf8').replace(/\/\/.*$/gm, '');
  assert.equal(/node:fs|writeFile|appendFile|createWriteStream|mkdir|copyFile|rename\(/.test(src), false, 'fs を使わない');
  assert.equal(/console\./.test(src), false, 'console に出さない');
  assert.equal(/process\.env\[[^\]]*\]\s*=|process\.env\.\w+\s*=[^=]/.test(src), false, 'この PC の環境変数を替えない');
});

test('package.json: start:keys がある。README(日本語・英語)に公式の 3 つのリンクと命令があり、値段は書いていない', () => {
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['start:keys'], 'node scripts/start-with-keys.mjs');
  assert.equal(pkg.scripts.start, 'node scripts/yuru-run.mjs', '前からの npm start は変えない');
  for (const f of ['README.md', 'README.en.md']) {
    const text = readFileSync(join(WEB, '..', f), 'utf8');
    for (const url of ['https://platform.claude.com/settings/keys', 'https://elevenlabs.io/app/api/api-keys', 'https://elevenlabs.io/pricing/api']) assert.ok(text.includes(url), `${f}: ${url}`);
    assert.ok(text.includes('npm run start:keys'), `${f}: 命令`);
    const section = text.split(/\n## /).find((s) => /^(鍵をかんたんに入れる|Adding keys the easy way)/.test(s));
    assert.ok(section, `${f}: 節がある`);
    assert.equal(/[¥￥円]|\$\s?\d|\d\s?%|USD|ドル|per month|\/mo/i.test(section), false, `${f}: 値段・割引を書かない`);
  }
});
