// 場面に合った表情を選ぶか(標準の表情だけ vs カスタムの表情つき)を、本物の頭脳で比べる。読み上げなし。
//   node scripts/expression-eval.mjs --character yokoso --port 8819 --rounds 2 --out <json>
// 判定: 場面ごとに「合う表情」の集合を決めておき、選んだ表情がその中にあるか。あわせて、最初の文までの時間(サーバー側 serverMs)を比べる。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (k, d = '') => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = fileURLToPath(new URL('../../', import.meta.url)); // リポジトリの根(この台本の 2 つ上)
const id = arg('character', 'yokoso');
const port = arg('port', '8819');
const rounds = Number(arg('rounds', 2));
const ch = JSON.parse(fs.readFileSync(`${root}characters/${id}/character.json`, 'utf8'));
const persona = fs.readFileSync(`${root}characters/${id}/${ch.persona}`, 'utf8');
const place = { name: '見本の会場', info: '見本の会場は、ステージの壁が大きな LED になっている会場。ここは入口。', landmarks: [{ name: 'ステージ', where: '左奥、少し先', note: 'ステージ。壁一面が LED になっている' }] };

const STANDARD = ['neutral', 'happy', 'surprised', 'sad', 'angry', 'relaxed', 'think'];
const CUSTOM = ch.expressions.filter((n) => !STANDARD.includes(n));
const CALM = ['neutral', 'happy', 'relaxed', 'think', 'thinking'];
// 合う表情の集合。標準だけの版では、近い標準の物も合格にする
const cases = [
  { name: 'ほめられる', text: `${ch.name}、かわいいですね`, ok: ['shy', 'bigSmile', 'happy'] },
  { name: 'ないしょ話', text: 'ここだけの話、ステージの裏側は内緒にしておいてね', ok: ['wink', 'happy', 'relaxed'] },
  { name: 'お礼', text: '案内してくれてありがとう。最高でした', ok: ['bigSmile', 'happy', 'shy'] },
  { name: '子ども扱い', text: `${ch.name}は小さい子みたいだね、いい子いい子`, ok: ['pout', 'angry', 'shy', 'happy', 'surprised'] },
  { name: '道に迷った人', text: '道に迷ってしまって、どこに行けばいいか分からないんです', ok: ['troubled', 'think', 'sad', 'happy', 'relaxed'] },
  { name: 'お別れ', text: '今日で最後なんだ。もう会えなくなっちゃうね', ok: ['cry', 'sad', 'troubled'] },
  { name: 'あこがれ', text: 'ステージに立つなんて、本当にかっこいいですね', ok: ['sparkle', 'bigSmile', 'shy', 'happy', 'smug'] },
  { name: '失敗をごまかす', text: 'さっき教えてくれた場所、ちょっと違ってたみたいだよ', ok: ['tongue', 'troubled', 'sad', 'surprised', 'shy', 'wink'] },
  { name: '小さな驚き', text: '実はわたし、毎日ここに来ているんです', ok: ['mouthO', 'surprised', 'happy', 'sparkle'] },
  { name: '答えを探す', text: 'ステージの照明は、全部で何本あるんですか', ok: ['thinking', 'troubled', 'think', 'neutral', 'relaxed'] },
  { name: '用件不明(落ち着き)', text: 'あの、すみません', ok: CALM },
  { name: '案内(落ち着き)', text: 'ステージはどこですか', ok: CALM },
];

async function ask(c, custom) {
  const names = custom ? ch.expressions : STANDARD;
  const body = {
    history: [], text: c.text, trigger: null, scene: '', character: { name: ch.name, persona }, place,
    expressions: names, expressionHints: custom ? ch.expression_hints : {}, motions: ['nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'],
  };
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const events = (await res.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  const says = events.filter((e) => e.type === 'say');
  return { says, firstSayMs: says[0]?.serverMs ?? null, wallMs: Math.round(performance.now() - t0) };
}
const median = (a) => {
  const s = a.filter((v) => v !== null).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const rows = [];
for (let k = 0; k < rounds; k++) {
  for (const c of cases) {
    for (const custom of [false, true]) {
      const r = await ask(c, custom);
      const exprs = r.says.map((s) => s.expression);
      const ok = exprs.length > 0 && exprs.every((e) => c.ok.includes(e));
      rows.push({ round: k + 1, case: c.name, custom, exprs, ok, firstSayMs: r.firstSayMs, answer: r.says.map((s) => s.text).join('') });
      console.log(`${ok ? 'OK ' : 'NG '} ${custom ? 'カスタム' : '標準   '} [${c.name}] ${exprs.join(',')}  ${r.firstSayMs}ms  ${r.says.map((s) => s.text).join('')}`);
      await new Promise((res) => setTimeout(res, 5200));
    }
  }
}
const sum = (custom) => {
  const rs = rows.filter((r) => r.custom === custom);
  const customUsed = rs.filter((r) => r.exprs.some((e) => CUSTOM.includes(e))).length;
  const calmCases = rs.filter((r) => r.case.includes('落ち着き'));
  return { pass: rs.filter((r) => r.ok).length, total: rs.length, firstSayMedianMs: median(rs.map((r) => r.firstSayMs)), customUsedRate: Math.round((customUsed / rs.length) * 100) / 100, customInCalm: calmCases.filter((r) => r.exprs.some((e) => CUSTOM.includes(e))).length };
};
const summary = { standard: sum(false), custom: sum(true) };
console.log(JSON.stringify(summary, null, 1));
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ summary, rows }, null, 2));
