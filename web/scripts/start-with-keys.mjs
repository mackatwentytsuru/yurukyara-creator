// 鍵をかんたんに入れて起こす: `npm run start:keys`
// - Claude の鍵と声の鍵を、画面に出さずに聞く(どちらも Enter だけなら入れない)。
// - 入れた鍵は、起こすアプリ(npm start と同じ見張り役 → 会話サーバー)の「子の環境変数」にだけ渡す。
//   ファイルには書かない・画面には出さない(出すのは「入れました」「入れていません」だけ)。この PC の環境変数も替えない。
// - Windows(PowerShell・コマンドプロンプト)と Mac / Linux の端末で動く。
// 使い方(web のフォルダで): npm run start:keys [-- --port 8787 --no-build]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(WEB, 'scripts', 'yuru-run.mjs');
const KEY_SHAPE = /^[\x21-\x7e]{8,400}$/; // 見える ASCII だけ(空白・日本語・改行が混ざった貼り間違いは入れない)

/** 聞く鍵の一覧。env はそれぞれの環境変数の名前 */
export const KEY_QUESTIONS = Object.freeze([
  { env: 'ANTHROPIC_API_KEY', label: 'Claude の鍵(本物の頭脳)', ask: 'Claude の鍵を貼ってください(Enter だけで入れない): ' },
  { env: 'ELEVENLABS_API_KEY', label: '声の鍵(ElevenLabs)', ask: '声の鍵を貼ってください(Enter だけで入れない): ' },
]);

/** 入れた文字を整える。形が合わなければ null(その鍵は入れない)。値は返すだけで、どこにも出さない */
export function cleanKey(raw) {
  const v = String(raw ?? '').trim();
  return KEY_SHAPE.test(v) ? v : null;
}

/** 端末(TTY)で、1 文字ずつ受けて画面に出さずに 1 行読む。Ctrl+C は 130 で終わる */
function readHiddenTty(stdin, stdout, prompt) {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = '';
    const finish = (result) => {
      stdin.off('data', onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // もう閉じている
      }
      stdin.pause();
      stdout.write('\n');
      if (result === null) process.exit(130);
      resolve(result);
    };
    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return finish(value);
        if (ch === '\x03' || ch === '\x04') return finish(null);
        if (ch === '\x7f' || ch === '\b') value = value.slice(0, -1);
        else if (ch === '\x15') value = '';
        else if (ch >= ' ') value += ch;
      }
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

/** 端末でない入力(パイプ・試験)から、行を 1 つずつ渡す読み手 */
function lineReader(stdin) {
  const rl = createInterface({ input: stdin, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  return {
    async next() {
      const r = await it.next();
      return r.done ? '' : r.value;
    },
    close: () => rl.close(),
  };
}

/**
 * 鍵を聞く。返すのは { 環境変数の名前: 鍵 } だけ(入れた物だけ)。画面には「入れました」「入れていません」だけ出す。
 * @param {{stdin?: any, stdout?: any}} io
 */
export async function collectKeys({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const keys = {};
  const lines = stdin.isTTY ? null : lineReader(stdin);
  for (const q of KEY_QUESTIONS) {
    const raw = lines ? (stdout.write(q.ask), await lines.next()) : await readHiddenTty(stdin, stdout, q.ask);
    if (lines) stdout.write('\n');
    const trimmed = String(raw ?? '').trim();
    const key = cleanKey(trimmed);
    if (key) {
      keys[q.env] = key;
      stdout.write(`  ${q.label}: 入れました\n`);
    } else {
      stdout.write(`  ${q.label}: 入れていません${trimmed ? '(形が違うので入れませんでした)' : ''}\n`);
    }
  }
  lines?.close();
  return keys;
}

/** 子に渡す環境。元の環境に、入れた鍵だけを足した新しい物(元の環境は替えない) */
export function childEnv(baseEnv, keys) {
  return { ...baseEnv, ...keys };
}

/**
 * 聞いて、アプリを起こして、終わりの番号を返す。
 * @param {{argv?: string[], env?: object, stdin?: any, stdout?: any, runner?: string, spawnFn?: Function}} o
 */
export async function main({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin, stdout = process.stdout, runner = RUNNER, spawnFn = spawn } = {}) {
  stdout.write('鍵をかんたんに入れて、アプリを起こします。鍵は画面に出ず、ファイルにも書きません。\n');
  const keys = await collectKeys({ stdin, stdout });
  stdout.write('アプリを起こします…\n');
  const child = spawnFn(process.execPath, [runner, ...argv], { cwd: WEB, env: childEnv(env, keys), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  const onSigint = () => {}; // Ctrl+C は同じ端末の子にも届く。子が終わるまで待つ(名前では止めない)
  process.on('SIGINT', onSigint);
  return new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => {
      process.off('SIGINT', onSigint);
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
