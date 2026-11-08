// npm run start:claude-code — 使う人自身の Claude Code につないでアプリを起こす。
// 1) claude が入っていて、ログインしているかを先に確かめる(だめなら、日本語で理由と直し方を出して止まる)
// 2) この PC の中だけで待つ中継(tools/claude-code-relay)を起こす
// 3) アプリを、頭脳の行き先をその中継にして起こす(npm start と同じ見張り役)。画面は「Claude Code につないでいます」と出る(おためしモードは出ない)
// 4) Ctrl+C で、アプリと中継をいっしょに止める(自分で起こした物だけ)
// ANTHROPIC_API_KEY は使いません(環境にあっても、アプリには渡さず、中継の子にも渡しません)。アプリが受け取る「鍵」は、起こすたびに作る使い捨ての合図です。
// 使い方(web のフォルダで): node scripts/start-claude-code.mjs [--port 8787] [--host 127.0.0.1] [--no-build]
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkClaude, createCliRunner } from '../../tools/claude-code-relay/cli.mjs';
import { parseDailyCap, startRelay } from '../../tools/claude-code-relay/relay.mjs';
import { runWatcher } from './yuru-run.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (line) => process.stdout.write(`[Claude Code につなぐ] ${line}\n`);

/** 確かめの結果を、使う人に見せる日本語にする */
export function problemMessage(check) {
  if (check.ok) return '';
  if (check.reason === 'not-found') {
    return [
      'Claude Code(claude コマンド)が見つかりません。',
      'この起こし方は、あなた自身の Claude Code のプランで話します。先に Claude Code を入れて、ログインしてください。',
      '入れ方は README の「Claude Code につなぐ」にあります。入れたら、もう一度 npm run start:claude-code を流してください。',
      '(鍵で話したいときは、かわりに npm start の前に ANTHROPIC_API_KEY を入れます。)',
    ].join('\n');
  }
  if (check.reason === 'not-logged-in') {
    return [
      'Claude Code は入っていますが、ログインしていません。',
      '端末で claude と打って起こし、画面の案内どおりにログインしてから、もう一度 npm run start:claude-code を流してください。',
    ].join('\n');
  }
  return [
    `Claude Code のログインの様子を確かめられませんでした${check.detail ? `(${check.detail})` : ''}。`,
    '端末で claude auth status を流して、ログインしていると出るかを見てください。出ないときは claude と打って起こし、ログインしてください。',
  ].join('\n');
}

const SET_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_URL', 'YC_BRAIN_VIA', 'YC_BROWSER_DRAW'];

/**
 * 確かめ → 中継 → アプリ。戻り値 { ok:false, message } か { ok:true, relay, stop(), done }(done = アプリが止まった時の終わりの番号。止まると中継も閉じ、環境変数を元に戻す)
 * @param {object} [o] @param {NodeJS.ProcessEnv} [o.env] 試験で替える @param {number} [o.port] @param {string} [o.host] @param {boolean} [o.build]
 * @param {string} [o.stateDir] 1 日の回数の置き場所 @param {number} [o.cap] @param {(line:string)=>void} [o.log]
 */
export async function startClaudeCode({ env = process.env, port, host, build = true, stateDir = join(WEB, 'logs', 'claude-code-relay'), cap = parseDailyCap(env.RELAY_DAILY_CAP), log = say } = {}) {
  const check = await checkClaude({ env });
  if (!check.ok) return { ok: false, message: problemMessage(check) };

  const token = randomBytes(24).toString('hex');
  const relay = await startRelay({
    token,
    stateDir,
    cap,
    runner: createCliRunner({ baseEnv: env }),
    log: (o) => log(`#${o.n} ${o.ok ? `答えました(${o.ms} ミリ秒)` : o.refused ? `断りました(${o.refused === 'cap' ? '1 日の上限' : o.refused})` : o.skipped ?? `失敗しました(${o.code ?? '-'})`}`),
  });

  // アプリ(見張り役が起こす会話サーバー)は、この台本の環境を引き継ぐ。元に戻せるよう控える
  const appEnv = process.env; // 見張り役はここから子の環境を作る
  const saved = Object.fromEntries(SET_KEYS.map((k) => [k, appEnv[k]]));
  const hadRealKey = Boolean(saved.ANTHROPIC_API_KEY);
  appEnv.ANTHROPIC_API_KEY = token; // 鍵ではなく、この中継だけで通じる使い捨ての合図(アプリは「鍵あり」として本物の頭脳の道を使う)
  appEnv.ANTHROPIC_API_URL = relay.url;
  appEnv.YC_BRAIN_VIA = 'claude-code';
  // 絵の呼び出しもこの中継を通るので、そのまま描けるようにする(アプリの 1 日・1 人の上限は変えない。自分で入れた値があれば、それを守る)
  if (appEnv.YC_BROWSER_DRAW === undefined) appEnv.YC_BROWSER_DRAW = '1';
  const restore = () => {
    for (const k of SET_KEYS) {
      if (saved[k] === undefined) delete appEnv[k];
      else appEnv[k] = saved[k];
    }
  };

  log(`Claude Code につなぎました(中継 ${relay.url}・1 日の上限 ${cap} 回・今日これまで ${relay.counter.calls} 回)。`);
  if (hadRealKey) log('環境にある ANTHROPIC_API_KEY は使いません(Claude Code のプランで話します)。');
  const watcher = runWatcher({ ...(port !== undefined ? { port } : {}), ...(host ? { host } : {}), build });
  const done = watcher.done.finally(async () => {
    await relay.close();
    restore();
  });
  const stop = () => {
    watcher.stop();
  };
  return { ok: true, relay, stop, done };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const run = await startClaudeCode({
    port: argValue(argv, '--port') ? Number(argValue(argv, '--port')) : undefined,
    host: argValue(argv, '--host'),
    build: !argv.includes('--no-build'),
  });
  if (!run.ok) {
    process.stderr.write(`${run.message}\n`);
    process.exitCode = 2;
  } else {
    process.on('SIGINT', () => run.stop());
    process.on('SIGTERM', () => run.stop());
    process.exitCode = await run.done;
  }
}
