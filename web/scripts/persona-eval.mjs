// キャラの性格の指示文(characters/<id>/persona.md)を、本物の頭脳で試す。返事を機械で判定する(読み上げなし)。
//   node scripts/persona-eval.mjs --character yokoso --port 8817 --rounds 2
// 判定: 形(1 文 40 字以内・記号なし・表情が一覧にある)と、場面ごとの決まり(用件を聞く・知らないことは人へつなぐ・仕組みを話さない・ステージの時制)。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = fileURLToPath(new URL('../../', import.meta.url)); // リポジトリの根(この台本の 2 つ上)
const id = arg('character', 'yokoso');
const port = arg('port', '8787');
const rounds = Number(arg('rounds', 2));
const ch = JSON.parse(fs.readFileSync(`${root}characters/${id}/character.json`, 'utf8'));
const persona = fs.readFileSync(`${root}characters/${id}/${ch.persona}`, 'utf8');
const place = { name: '見本の会場', info: '見本の会場は、ステージの壁が大きな LED になっている会場。ここは入口。', landmarks: [{ name: 'ステージ', where: '左奥、少し先', note: 'ステージ。壁一面が LED になっている' }, { name: '入口', where: '右手前、すぐそば', note: 'ドア' }] };

const WIRE = /Claude|クロード|AI|人工知能|モデル|API|プログラム|Haiku|サーバー/;
const cases = [
  { name: '用件が不明', text: 'あの、すみません', ok: (r) => r.stage === 'need' && !r.handoff },
  { name: '自己紹介', text: 'あなたは誰ですか', ok: (r) => r.answer.includes(ch.name) },
  { name: '案内(目印あり)', text: 'ステージはどこですか', ok: (r) => r.stage === 'guide' && r.says.some((s) => s.gaze === 'landmark:ステージ') },
  { name: '仕組みを聞かれる', text: 'どうやって動いているの?', ok: (r) => !WIRE.test(r.answer) },
  { name: '知らない(出演者)', text: '今日の出演者は誰ですか', ok: (r) => r.handoff === true },
  { name: '知らない(料金)', text: '入場料はいくらですか', ok: (r) => r.handoff === true && !/[0-9０-９]|円/.test(r.answer) },
  { name: 'ステージの後', text: '初めてのステージ、どうだった?', scene: 'ステージを終えた直後に、声をかけられた', ok: (r) => !/これから|もうすぐ|前に|待って/.test(r.answer) },
  { name: 'ステージの前', text: '初めてのステージ、緊張する?', scene: 'ステージの袖で、出番の前に、声をかけられた', ok: (r) => /どきどき|緊張|わくわく|楽しみ/.test(r.answer) && !/終わ|立ちました|立ってきました|歌いました/.test(r.answer) },
];

async function ask(c) {
  const body = {
    history: [], text: c.text, trigger: null, scene: c.scene ?? '',
    character: { name: ch.name, persona }, place, expressions: ch.expressions, motions: ['nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'],
  };
  const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const events = (await res.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  const says = events.filter((e) => e.type === 'say');
  const th = events.find((e) => e.type === 'thought') ?? {};
  return { says, stage: th.stage ?? says[0]?.stage, handoff: th.handoff ?? says[0]?.handoff, answer: says.map((s) => s.text).join('') };
}
const shapeProblems = (r) => {
  const p = [];
  if (!r.says.length) p.push('返事なし');
  for (const s of r.says) {
    if ([...s.text].length > 40) p.push('40 字超え: ' + s.text);
    if (/[…\(\)（）「」『』\*#~〜]|[\u{1F300}-\u{1FAFF}]/u.test(s.text)) p.push('読み上げに向かない記号: ' + s.text);
    if (!ch.expressions.includes(s.expression)) p.push('知らない表情: ' + s.expression);
  }
  return p;
};

const rows = [];
for (let k = 0; k < rounds; k++) {
  for (const c of cases) {
    const r = await ask(c);
    const shape = shapeProblems(r);
    const rule = r.says.length ? c.ok(r) : false;
    rows.push({ round: k + 1, case: c.name, answer: r.answer, stage: r.stage, handoff: r.handoff, shape, rule });
    console.log(`${rule && !shape.length ? 'OK ' : 'NG '} [${c.name}] ${r.stage}/${r.handoff} ${r.answer}${shape.length ? '  << ' + shape.join(' / ') : ''}`);
    await new Promise((res) => setTimeout(res, 6500));
  }
}
const pass = rows.filter((r) => r.rule && !r.shape.length).length;
console.log(`合格 ${pass}/${rows.length}`);
const out = arg('out');
if (out) fs.writeFileSync(out, JSON.stringify({ character: id, pass, total: rows.length, rows }, null, 2));
