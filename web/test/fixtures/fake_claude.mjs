// 試験用の偽の claude コマンド(RELAY_CLAUDE_BIN で指す)。本物のモデルも、本物のログインも使わない。
// - `claude auth status`: FAKE_CLAUDE_AUTH = in(既定。ログイン済み)・out(未ログイン)・garbage(読めない出力)
// - `claude -p ...`: 受けた引数・渡された環境の名前・標準入力の様子を FAKE_CLAUDE_LOG の行(JSON)に足し、stream-json の行で答える。
//   絵つき(--input-format stream-json で image の段がある)なら SVG、そうでなければ会話の 1 行(type: say)で答える。
//   FAKE_CLAUDE_SLOW_MS があれば、その間待ってから答える。FAKE_CLAUDE_FAIL=1 なら失敗で終わる。
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === 'auth' && args[1] === 'status') {
  const mode = process.env.FAKE_CLAUDE_AUTH ?? 'in';
  if (mode === 'garbage') console.log('??');
  else console.log(JSON.stringify({ loggedIn: mode === 'in', authMethod: 'claude.ai' }));
  process.exit(mode === 'in' ? 0 : 1);
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) input += c;

let images = 0;
let text = input;
if (args.includes('--input-format')) {
  const o = JSON.parse(input.trim().split('\n')[0]);
  images = o.message.content.filter((b) => b.type === 'image').length;
  text = o.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    JSON.stringify({ args, secretEnvNames: Object.keys(process.env).filter((k) => k !== 'MAX_THINKING_TOKENS' && /^(ANTHROPIC|ELEVEN|RELAY)|KEY|TOKEN|SECRET/i.test(k)), images, text: text.slice(0, 200), cwd: process.cwd() }) + '\n',
  );
}

if (process.env.FAKE_CLAUDE_SLOW_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_SLOW_MS)));

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', model: 'fake' });
if (process.env.FAKE_CLAUDE_FAIL === '1') {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['わざと失敗'] });
  process.exit(1);
}
const reply = images > 0
  ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="char"><circle cx="5" cy="5" r="4"/></g></svg>'
  : '{"type":"say","text":"Claude Code から こんにちは。","expression":"happy","motion":"wave","gaze":"person"}\n';
const half = Math.ceil(reply.length / 2);
for (const part of [reply.slice(0, half), reply.slice(half)]) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } });
}
out({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: reply });
