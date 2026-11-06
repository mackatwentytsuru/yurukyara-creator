// フックの共通部品: 標準入力の JSON、リポジトリの根、止める時の書き方、止めた記録。
// 形は Claude Code のフックの決まりに合わせる(標準入力に JSON。止める時は終了コード 2 と stderr の理由)。
// 置き場所は tools/hooks/(登録は本人の OK の後。settings.json から "$CLAUDE_PROJECT_DIR/tools/hooks/<名前>.mjs" を呼ぶ)。
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** リポジトリの根。CLAUDE_PROJECT_DIR があればそれ、無ければこのファイルの 3 つ上(tools/hooks/lib の上) */
export function projectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return resolve(process.env.CLAUDE_PROJECT_DIR);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** 人が決めた無人の通し(YC_AUTOPILOT=1)の時だけ、段の関所を飛ばす */
export const isAutopilot = () => process.env.YC_AUTOPILOT === '1';

/** 止めた事を 1 行の JSON で残す(契約 K6。数字の表がこれを数える)。書けなくても止める事は変えない */
export function logBlock(root, hook, reason) {
  const file = process.env.YC_HOOK_LOG || join(root, 'creator', 'work', '_hooks', 'blocked.jsonl');
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), hook, decision: 'block', reason })}\n`);
  } catch {
    /* 記録できなくても止める */
  }
}

/** 止める。理由は stderr に出し、終了コード 2(PreToolUse なら呼び出しを止め、Claude に理由が渡る) */
export function block(title, lines) {
  console.error(`[${title}]`);
  for (const l of lines) console.error(` - ${l}`);
  process.exitCode = 2;
}
