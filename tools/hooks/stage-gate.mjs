// フック: 段の関所。作る段(yc-<N>-…のスキル)に入る前に、前の段に人の OK(か、おまかせの印)が無ければ止める。
// 毎回止める(Claude がもう一度呼んでも通さない)。人が無人の通しと決めた時だけ、環境変数 YC_AUTOPILOT=1 で飛ばす。
// 登録の案(本人の OK の後だけ。まだ登録していない。tools/hooks/README.md):
//   PreToolUse の matcher "Skill"(Claude が段のスキルを呼ぶ時。tool_input.skill と tool_input.args を読む)
//   UserPromptSubmit(人が /yc-3-… と打った時。prompt の先頭を読む)
import { checkGate } from './lib/gate-core.mjs';
import { block, isAutopilot, logBlock, projectRoot, readInput } from './lib/hook-io.mjs';

const input = await readInput();
if (isAutopilot()) process.exit(0);

let name = '';
let args = '';
if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'Skill') {
  const ti = input.tool_input ?? {};
  name = ti.skill ?? ti.name ?? '';
  args = ti.args ?? '';
} else if (input.hook_event_name === 'UserPromptSubmit') {
  const m = /^\s*\/(\S+)\s*(.*)$/s.exec(String(input.prompt ?? ''));
  if (m) [, name, args] = m;
} else {
  process.exit(0);
}

const root = projectRoot();
const g = checkGate(root, name, args);
if (!g.gated || g.ok) process.exit(0);

logBlock(root, 'stage-gate', `stage ${g.stage}: ${g.why}`);
block('段の関所', [
  `段 ${g.stage} に入る前に: ${g.why}`,
  '前の段を人が確かめて OK を付けてから進めます(スマホの確認画面か creator/review/review_state.py)。',
  '人が無人の通しと決めた時だけ、環境変数 YC_AUTOPILOT=1 で飛ばせます。Claude が自分で付けて飛ばしてはいけません。',
]);
