// 本物の頭脳(サーバーの /api/chat)に、1 回だけ聞いて、最初に出た返事をそのまま JSON に書く(読み上げなし)。
// 動画に「実際の返事を収録」と書くための証拠。書き直し・選び直しはしない(通信の失敗で返事が 0 件のときだけ、やり直してよい)。
//   node scripts/once-reply.mjs --character yokoso --question "初めてのステージ、どうだった?" --scene "無人の舞台で一人で歌い、一礼した直後に声をかけられた" --out <json> [--port 8787] [--place-name 見本の会場]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = fileURLToPath(new URL('../../', import.meta.url)); // リポジトリの根(この台本の 2 つ上)
const id = arg('character', 'f_led');
const question = arg('question');
if (!question) throw new Error('--question が要ります');
const ch = JSON.parse(fs.readFileSync(`${root}characters/${id}/character.json`, 'utf8'));
const persona = ch.persona ? fs.readFileSync(`${root}characters/${id}/${ch.persona}`, 'utf8') : '';
const body = {
  history: [],
  text: question,
  trigger: null,
  scene: arg('scene'),
  character: { name: ch.name, persona },
  place: { name: arg('place-name'), info: arg('place-info'), landmarks: [] },
  expressions: ch.expressions,
  expressionHints: ch.expression_hints ?? {},
  motions: Object.keys(ch.motions ?? {}),
};
const res = await fetch(`http://127.0.0.1:${arg('port', '8787')}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const events = (await res.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
const says = events.filter((e) => e.type === 'say').map(({ text, expression, motion, gaze }) => ({ text, expression, motion, gaze }));
if (!says.length) throw new Error('返事が 0 件でした(通信の失敗なら、やり直してよい): ' + JSON.stringify(events.slice(-2)));
const out = {
  question,
  answer: says.map((s) => s.text).join(''),
  mood: says[0].expression,
  model: events.find((e) => e.model)?.model ?? '',
  at: new Date().toISOString(),
  says,
  scene: arg('scene'),
  note: '頭脳(/api/chat)で 1 回だけ実行した、最初の返事をそのまま。書き直し・選び直しなし。読み上げなし。mood は最初の文の表情',
};
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 1));
