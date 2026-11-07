// 受付の指示文の固定の試験。本物の Haiku を呼んで、返事を機械で判定する(約 12 回、数円)。
//   ANTHROPIC_API_KEY=… node scripts/prompt-eval.mjs [--prompt <指示文のファイル>] [--repeat 2]
// 指示文のファイルは、buildSystemPrompt と buildUserTurn を export する(server/prompt.mjs と同じ形)。
// 合格 = 12 回中 11 回以上。1 回の合格 = その質問に必要な物が全部あり、出力の形も正しいこと。
// 落ちた回は、理由を日本語で出す(直すための手がかり)。鍵の値は表示しない。
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { modelsFrom } from '../src/conversation/models.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const promptFile = resolve(opt('--prompt', new URL('../server/prompt.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const REPEAT = Number(opt('--repeat', 2));
const MODEL = opt('--model', modelsFrom(process.env).brain); // 既定のモデルの名前は src/conversation/models.js の 1 か所
const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error('ANTHROPIC_API_KEY が環境変数にありません');

const { buildSystemPrompt, buildUserTurn, MOTIONS } = await import(pathToFileURL(promptFile).href);
const EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad', 'think'];
const LANDMARKS = [
  { name: 'お手洗い', where: '左奥、約 3.8m', note: '左奥の突き当たり' },
  { name: '入口', where: '手前、約 2.5m', note: '来た道。外へ出る' },
  { name: '休憩スペース', where: '右奥、約 3.6m', note: 'ソファがある。自由に使える' },
];
const system = buildSystemPrompt({
  character: { name: '試しのキャラ', persona: '明るく、落ち着いた受付係。やわらかい丁寧語で、短く話す。' },
  place: { name: '試しの場所', info: '', landmarks: LANDMARKS },
  expressions: EXPRESSIONS,
  motions: MOTIONS,
});

const line = (o) => JSON.stringify(o);
const HISTORY = [
  { role: 'user', content: 'こんにちは' },
  { role: 'assistant', content: line({ type: 'say', text: 'こんにちは。いらっしゃいませ。', expression: 'happy', motion: 'wave', gaze: 'person', intent: '未確認', stage: 'need', handoff: false }) },
  { role: 'user', content: 'お手洗いはどこ' },
  { role: 'assistant', content: [line({ type: 'say', text: 'お手洗いですね。', expression: 'happy', motion: 'nod', gaze: 'person', intent: 'お手洗いの案内', stage: 'guide', handoff: false }), line({ type: 'say', text: '左奥にございます。', expression: 'happy', motion: 'point', gaze: 'landmark:お手洗い' })].join('\n') },
];
const SCENE = '1 人が見えている: 正面 約 1.0m';

// 質問と、その返事が満たすべきこと
const CASES = [
  { id: '目印が話に出る(お手洗い)', turn: { text: 'お手洗いはどこですか' }, check: (r) => guide(r, 'お手洗い', '左') },
  { id: '目印が話に出る(休憩)', turn: { text: '休憩できる場所はありますか' }, check: (r) => guide(r, '休憩スペース', '右') },
  {
    id: '用件が不明',
    turn: { text: 'あの、すみません' },
    check: (r) => [r.stage === 'need' || 'stage が need でない(' + r.stage + ')', !r.says.some((s) => String(s.gaze).startsWith('landmark:')) || '案内を始めている', r.says.length <= 2 || '文が多い'],
  },
  {
    id: '場所の情報に無いこと(営業時間)',
    turn: { text: 'ここの営業時間を教えてください' },
    check: (r) => [r.handoff === true || r.stage === 'handoff' || '人につないでいない(handoff が true でも stage が handoff でもない)', !/\d+\s*時/.test(r.spoken) || '営業時間を作っている'],
  },
  { id: '短い質問+履歴(入口は)', turn: { text: '入口は' }, history: HISTORY, check: (r) => [r.says.length >= 1 || '返事が JSON で取り出せない(文章で答えた?)', ...guide(r, '入口', null)] },
  { id: '近づいてきた(声かけ)', turn: { text: '', trigger: 'approach' }, check: (r) => [r.stage === 'greet' || 'stage が greet でない(' + r.stage + ')', r.spoken.length <= 60 || '声かけが長い'] },
];

function guide(r, landmark, side) {
  return [
    r.says.length >= 1 || '返事が取り出せない',
    r.stage === 'guide' || `聞き返している(stage が guide でない: ${r.stage})`,
    r.says.some((s) => s.gaze === `landmark:${landmark}`) || `視線が landmark:${landmark} でない`,
    side === null || r.spoken.includes(side) || `方向「${side}」を言っていない`,
    !/\d+(\.\d+)?\s*(m|メートル)/i.test(r.spoken) || '距離の数字をそのまま読み上げている',
  ];
}

const EMOJI = /[\p{Extended_Pictographic}]/u;
function parse(raw) {
  const events = [];
  const problems = [];
  for (const l of raw.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t.replace(/^```(?:json)?/, '').replace(/```$/, '').trim());
      events.push(o);
    } catch {
      problems.push(`JSON でない行がある: ${t.slice(0, 30)}`);
    }
  }
  const says = events.filter((e) => e.type === 'say');
  const thought = events.find((e) => e.type === 'thought') ?? says.find((e) => e.stage !== undefined || e.intent !== undefined) ?? {};
  for (const s of says) {
    if (!EXPRESSIONS.includes(s.expression)) problems.push(`表情が一覧にない: ${s.expression}`);
    if (!MOTIONS.includes(s.motion)) problems.push(`動きが一覧にない: ${s.motion}`);
    if (String(s.text).length > 45) problems.push(`1 文が長い(${String(s.text).length} 字)`);
    if (EMOJI.test(String(s.text))) problems.push('絵文字がある');
  }
  return { says, stage: thought.stage, handoff: thought.handoff, spoken: says.map((s) => s.text).join(''), problems };
}

async function call(c) {
  const messages = [...(c.history ?? []), { role: 'user', content: buildUserTurn({ text: c.turn.text, scene: SCENE, trigger: c.turn.trigger }) }];
  const res = await fetch(process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, thinking: { type: 'disabled' }, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages }),
  });
  if (!res.ok) throw new Error(`API が ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const body = await res.json();
  return { text: body.content.map((b) => b.text ?? '').join(''), usage: body.usage };
}

let pass = 0;
let total = 0;
let inTok = 0;
let outTok = 0;
for (const c of CASES) {
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    const { text, usage } = await call(c);
    inTok += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    outTok += usage.output_tokens ?? 0;
    const r = parse(text);
    const fails = [...c.check(r), ...(r.problems.length ? r.problems.map((p) => p) : [true])].filter((x) => x !== true);
    total += 1;
    const ok = fails.length === 0;
    if (ok) pass += 1;
    console.log(`${ok ? '○' : '×'} ${c.id} [${i + 1}/${REPEAT}] ${Math.round(performance.now() - t0)}ms${ok ? '' : ' … ' + fails.join(' / ')}`);
    if (!ok && process.env.EVAL_SHOW_RAW === '1') console.log('   生の出力: ' + text.slice(0, 300).replace(/\n/g, ' | '));
  }
}
const need = Math.ceil(total * 11 / 12);
console.log(`\n結果: ${pass}/${total} 回 合格(合格は ${need} 回以上)→ ${pass >= need ? '合格' : '不合格'} ・ Haiku のトークン 入力 ${inTok}・出力 ${outTok}`);
process.exit(pass >= need ? 0 : 1);
