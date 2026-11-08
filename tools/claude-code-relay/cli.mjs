// 使う人の Claude Code(claude -p)を 1 回動かして、モデルの文を受け取る所。
// - 道具は付けない(--tools "")・MCP は読まない(--strict-mcp-config)・CLAUDE.md や設定は読まない(--safe-mode・空の作業フォルダ)。
// - 子の環境から ANTHROPIC*・鍵・トークンの類を外す(lib.mjs の cleanEnv)。鍵は読まない・出さない。ログインは Claude Code 自身が持つ物を使う。
// - 止めるのは、自分で起こした子(とその子)の PID だけ。名前では止めない。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { cleanEnv, readCliLine, streamInputLine } from './lib.mjs';

/**
 * claude の起こし方 { cmd, prefix } を探す。
 * RELAY_CLAUDE_BIN があればそれ(試験用。.mjs / .js なら node で動かす)。Windows は npm の殻(claude.cmd)を使えないので、中の claude.exe を探す。
 */
export function resolveClaude(env = process.env, platform = process.platform) {
  const forced = env.RELAY_CLAUDE_BIN;
  if (forced) return /\.(mjs|js|cjs)$/i.test(forced) ? { cmd: process.execPath, prefix: [forced] } : { cmd: forced, prefix: [] };
  if (platform !== 'win32') return { cmd: 'claude', prefix: [] };
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    if (existsSync(join(dir, 'claude.exe'))) return { cmd: join(dir, 'claude.exe'), prefix: [] };
    const inner = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (existsSync(inner)) return { cmd: inner, prefix: [] };
  }
  return { cmd: 'claude', prefix: [] };
}

/** 自分で起こした子の木を止める(Windows は taskkill /T /F。窓は出さない) */
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // もう居ない
    }
  }
}

/** claude -p に渡す引数。道具なし・MCP なし・設定を読まない。絵があるときだけ stream-json の入力 */
export function cliArgs({ model, systemFile, withImages = false, long = false }) {
  return [
    '-p',
    ...(withImages ? ['--input-format', 'stream-json'] : []),
    '--safe-mode',
    '--model', model,
    '--tools', '',
    '--system-prompt-file', systemFile,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources', 'project',
    '--settings', '{"alwaysThinkingEnabled":false}',
    // 短い会話は考える量を最低に(速さのため)。長く書く絵の道は既定のまま
    ...(long ? [] : ['--effort', 'low']),
  ];
}

/**
 * Claude Code が入っていて、ログインしているかを確かめる(claude auth status。1 回、時間の上限つき)。
 * 戻り値: { ok: true } か { ok: false, reason: 'not-found' | 'not-logged-in' | 'unknown', detail }
 */
export function checkClaude({ env = process.env, timeoutMs = 20_000 } = {}) {
  const { cmd, prefix } = resolveClaude(env);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(cmd, [...prefix, 'auth', 'status'], { env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, reason: e.code === 'ENOENT' ? 'not-found' : 'unknown', detail: String(e.message) });
    }
    const timer = setTimeout(() => {
      killTree(child.pid);
      done({ ok: false, reason: 'unknown', detail: '確かめるのに時間がかかりすぎました' });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (out.length < 8000) out += d;
    });
    child.stderr.on('data', () => {});
    child.on('error', (e) => done({ ok: false, reason: e.code === 'ENOENT' ? 'not-found' : 'unknown', detail: String(e.message) }));
    child.on('close', (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(out);
      } catch {
        // 文字の出力(古い版など)
      }
      if (parsed?.loggedIn === true) return done({ ok: true });
      if (parsed?.loggedIn === false || /not logged in/i.test(out)) return done({ ok: false, reason: 'not-logged-in', detail: '' });
      return done({ ok: false, reason: 'unknown', detail: `終わりの番号 ${code}` });
    });
  });
}

/**
 * 本物の claude -p で答える関数を作る。返す関数は 1 回の呼び出し({ model, system, prompt, images, long, onText, signal })で、
 * 文が届くたびに onText を呼び、最後に { text } を返す(失敗は Error。err.code = timeout | aborted | cli | spawn)。
 * close() は動いている子をすべて止め、作業フォルダを消す。
 */
export function createCliRunner({ timeoutMs = 60_000, longTimeoutMs = 150_000, baseEnv = process.env, workRoot = tmpdir() } = {}) {
  const { cmd, prefix } = resolveClaude(baseEnv);
  const work = mkdtempSync(join(workRoot, 'claude-code-relay-'));
  const cwd = join(work, 'empty'); // CLAUDE.md の無い、空のフォルダで動かす
  mkdirSync(cwd, { recursive: true });
  const children = new Set();
  let n = 0;

  function run({ model, system, prompt, images = [], long = false, onText, signal }) {
    const withImages = images.length > 0;
    const timeout = long || withImages ? longTimeoutMs : timeoutMs;
    return new Promise((resolve, reject) => {
      const info = { stderr: '', exitCode: null };
      if (signal?.aborted) return reject(Object.assign(new Error('呼んだ側が先に切れました'), { code: 'aborted' }));
      const systemFile = join(work, `system_${++n}.md`);
      writeFileSync(systemFile, system, 'utf8');
      const env = cleanEnv(baseEnv, { MAX_THINKING_TOKENS: '0', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_THINKING: '1' });
      const child = spawn(cmd, [...prefix, ...cliArgs({ model, systemFile, withImages, long })], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      children.add(child);
      let text = '';
      let assistantText = '';
      let result = null;
      let deltas = 0;
      let buf = '';
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        try {
          unlinkSync(systemFile);
        } catch {
          // もう無い
        }
        if (err) reject(err);
        else resolve({ text });
      };
      const alive = () => child.exitCode === null && child.signalCode === null;
      const stop = (message, code) => {
        if (alive()) killTree(child.pid);
        finish(Object.assign(new Error(message), { code }));
      };
      const timer = setTimeout(() => stop(`claude -p が ${Math.round(timeout / 1000)} 秒で終わらなかったので止めました`, 'timeout'), timeout);
      const onAbort = () => stop('呼んだ側が切れたので止めました', 'aborted');
      signal?.addEventListener('abort', onAbort, { once: true });

      const handle = (line) => {
        const r = readCliLine(line);
        if (r.kind === 'text') {
          deltas += 1;
          text += r.text;
          if (!settled) onText?.(r.text);
        } else if (r.kind === 'assistant') assistantText += r.text;
        else if (r.kind === 'result') result = r;
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) handle(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => {
        if (info.stderr.length < 4000) info.stderr += d;
      });
      child.on('error', (e) => finish(Object.assign(new Error(`claude を起こせませんでした: ${e.message}`), { code: 'spawn' })));
      child.on('close', (code) => {
        children.delete(child);
        if (buf.trim()) handle(buf.trim());
        buf = '';
        info.exitCode = code;
        if (result?.ok) {
          if (deltas === 0) {
            // 部分の文が届かなかったとき(古い版など)は、まとめの文を 1 回で渡す
            const whole = result.text || assistantText;
            if (whole) {
              text = whole;
              if (!settled) onText?.(whole);
            }
          }
          return finish(null);
        }
        const why = result ? result.text || (result.errors ?? []).join(' / ') || result.subtype : info.stderr.trim().split(/\r?\n/).slice(-3).join(' / ');
        finish(Object.assign(new Error(`claude -p が失敗しました(終わりの番号 ${code}): ${String(why || '理由の出力なし').slice(0, 300)}`), { code: 'cli' }));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(withImages ? streamInputLine(prompt, images) : prompt, 'utf8');
    });
  }

  run.close = () => {
    for (const c of children) killTree(c.pid);
    children.clear();
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // 使われている間は消せないことがある
    }
  };
  return run;
}
