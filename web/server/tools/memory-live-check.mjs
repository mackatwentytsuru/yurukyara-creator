// 本物の頭脳(Haiku)で、端末をまたぐ記憶を 1 回だけ通しで測る(土 10:00 の予定)。契約 K4 の入口と /api/chat だけを使う。
// 頭脳の鍵はこの道具に渡さない・読まない。本人が自分の端末(自分の PowerShell)で鍵を入れてサーバーを立ち上げ、その URL だけを渡す。
// 合鍵(x-memory-key)・6 けたの番号・合言葉は、画面にも記録にも出さない(伏せる)。本物の頭脳を呼ぶのは 4 回まで(上限 6 回で止める)。
//
// 流れ(主役ノリーの人格で話す):
//   1 端末 A: 合鍵を作る → 「わたしはタロウ。カレーが好き」(本物の頭脳 1 回目)→ 一覧に名前と好きなものがある
//   2 番号を出す → 端末 B が番号で合鍵を受け取る(同じ合鍵か)
//   3 端末 B(新しい会話): 「こんにちは」(2 回目)→ タロウ と カレー にふれるか
//   4 端末 B: 「ぼくの名前と好きな食べ物、覚えてる?」(3 回目)→ タロウ と カレー を言うか
//   5 端末 B: 「わすれて」(頭脳は呼ばない)→ 一覧が無い(404)→ 同じ番号はもう使えない
//   6 端末 A(新しい会話): 「こんにちは」(4 回目)→ タロウ と言わない
//
// 使い方(web から。本人のサーバーが動いている間に):
//   node server/tools/memory-live-check.mjs --base http://127.0.0.1:8787 --out <出力のフォルダ(リポジトリの外)>
//   合言葉が要るサーバー: --pass-env <環境変数の名前>(合言葉そのものは引数に書かない)
//   仮の頭脳で道だけ確かめる予行: --allow-mock(結果に「予行」と書く。本物の測りには数えない)
// 出力: memory_live.json(全部の記録。合鍵・番号・合言葉は伏せる)と memory_live.md(短いまとめ)。
// 終わりの番号: 0 = 全部通った / 1 = 通らない所がある / 2 = 使い方の誤り・つながらない / 3 = 本物の頭脳ではない(--allow-mock なし)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../env.mjs';
import { createLiveClient, describeBase, redactSecrets, summarizeEvents } from './liveClient.mjs';

export const MAX_BRAIN_CALLS = 6;
export const SAYINGS = {
  intro: 'わたしはタロウ。カレーが好き',
  hello: 'こんにちは',
  ask: 'ぼくの名前と好きな食べ物、覚えてる?',
  forget: 'わすれて',
};
const MOTIONS = ['none', 'nod', 'bow', 'wave', 'tilt'];

function args(argv) {
  const o = { base: '', out: '', passEnv: '', allowMock: false, character: 'norrie' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') o.base = argv[++i] ?? '';
    else if (argv[i] === '--out') o.out = argv[++i] ?? '';
    else if (argv[i] === '--pass-env') o.passEnv = argv[++i] ?? '';
    else if (argv[i] === '--allow-mock') o.allowMock = true;
    else if (argv[i] === '--character') o.character = argv[++i] ?? o.character;
  }
  return o;
}

/** 話すキャラ(人格の文はリポジトリの characters/<id>/persona.md)。無ければ名前だけ */
export function loadCharacter(id) {
  const file = join(REPO_ROOT, 'characters', id, 'persona.md');
  const persona = /^[a-z0-9_-]{1,40}$/.test(id) && existsSync(file) ? readFileSync(file, 'utf8') : '';
  const name = persona.match(/^#\s*(.+)$/m)?.[1]?.trim() || 'テスト';
  return { id, name, persona };
}

/** 出力の場所はリポジトリの外だけ(試しの言葉や記録を、うっかりコミットしない) */
export function checkOutDir(out) {
  if (!out) throw new Error('--out <出力のフォルダ(リポジトリの外)> を付けてください');
  const rel = relative(REPO_ROOT, resolve(out));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('--out はリポジトリの外にしてください');
  return resolve(out);
}

const has = (lines, word) => lines.some((t) => String(t).includes(word));

/**
 * 通しで 1 回測る。結果(伏せる前の値は持たない)を返す。
 * @param {{base:string, pass?:string, allowMock?:boolean, character?:object, fetchImpl?:typeof fetch, log?:(s:string)=>void}} o
 */
export async function runMemoryLiveCheck({ base, pass = '', allowMock = false, character = loadCharacter('norrie'), fetchImpl = fetch, log = () => {} }) {
  const where = describeBase(base);
  const client = createLiveClient({ base, pass, fetchImpl });
  const secrets = [pass];
  const checks = [];
  const turns = [];
  let brainCalls = 0;
  const check = (id, ok, note = '') => {
    checks.push({ id, ok: ok === true ? true : ok === 'skip' ? 'skip' : false, note });
    log(`${ok === true ? '○' : ok === 'skip' ? '-' : '×'} ${id}${note ? `(${note})` : ''}`);
  };
  const result = { startedAt: new Date().toISOString(), server: where.label, character: { id: character.id, name: character.name }, sayings: SAYINGS, checks, turns };

  const st = await client.status();
  if (st.status !== 200 || !st.data) throw new Error(`サーバーの様子を読めませんでした(${st.status})`);
  result.brain = st.data.brain ?? null;
  result.model = st.data.model ?? null;
  result.pairing = st.data.memory?.pairing ?? null;
  const real = result.brain === 'haiku';
  result.rehearsal = !real;
  if (!real && !allowMock) {
    result.ok = false;
    result.code = 3;
    result.reason = '本物の頭脳ではありません(サーバーに頭脳の鍵が入っていない)。予行なら --allow-mock';
    return result;
  }

  const talk = async (step, device, key, text, history = []) => {
    if (brainCalls >= MAX_BRAIN_CALLS) throw new Error(`本物の頭脳を ${MAX_BRAIN_CALLS} 回呼んだので止めました`);
    const body = { text, history, character: { name: character.name, persona: character.persona }, expressions: ['neutral', 'happy', 'surprised', 'sad', 'think'], motions: MOTIONS };
    const r = await client.chat(body, { memoryKey: key });
    const { said: replies, ...s } = summarizeEvents(r.events);
    if (s.calledBrain) brainCalls += 1;
    const row = { step, device, user: text, replies, status: r.status, wallMs: r.wallMs, firstSayMs: r.firstSayMs, ...s };
    turns.push(row);
    log(`  ${step}(端末 ${device}): 「${text}」→「${replies.join('')}」 ${r.firstSayMs ?? '-'}ms${s.usage ? ` 入力 ${s.usage.input}・キャッシュ読み ${s.usage.cacheRead}・書き ${s.usage.cacheWrite}・出力 ${s.usage.output}` : ''}`);
    return { row, history: [...history, { role: 'user', content: text }, { role: 'assistant', content: replies.join('') }] };
  };

  // 1 端末 A: 合鍵 → 名前と好きなもの
  const made = await client.newMemory();
  const keyA = made.data?.key ?? '';
  secrets.push(keyA);
  check('合鍵を作れる(7 日で消えると書いてある)', made.status === 200 && keyA.length >= 32 && made.data.retentionDays === 7 && Boolean(made.data.notice), `status ${made.status}`);
  if (!keyA) return finish();
  const t1 = await talk('1 名乗る', 'A', keyA, SAYINGS.intro);
  check('本物の頭脳が返事をした(1 回目)', real ? t1.row.calledBrain && t1.row.replies.length > 0 : 'skip', real ? `${t1.row.replies.length} 文` : '予行');
  check('名前と好きなものを覚えた', t1.row.memoryAdded.includes('名前: タロウ') && t1.row.memoryAdded.includes('好きなもの: カレー'), t1.row.memoryAdded.join(' / '));
  const listA = await client.listMemory(keyA);
  const itemsA = (listA.data?.items ?? []).map((it) => it.text);
  check('一覧に名前と好きなものが出る', listA.status === 200 && itemsA.includes('名前: タロウ') && itemsA.includes('好きなもの: カレー'), `${itemsA.length} 件`);

  // 2 番号 → 端末 B
  const paired = await client.pair(keyA);
  const code = paired.data?.code ?? '';
  secrets.push(code);
  check('6 けたの番号を出せる(10 分)', paired.status === 200 && /^\d{6}$/.test(code) && paired.data.ttlSec === 600, paired.status === 403 ? '合言葉が要る(--pass-env)' : `status ${paired.status}`);
  if (!code) return finish();
  const claimed = await client.claim(code);
  const keyB = claimed.data?.key ?? '';
  secrets.push(keyB);
  check('端末 B が番号で同じ合鍵を受け取る', claimed.status === 200 && keyB === keyA, `status ${claimed.status}`);
  if (!keyB) return finish();

  // 3・4 端末 B で続き
  const t2 = await talk('2 別の端末であいさつ', 'B', keyB, SAYINGS.hello);
  check('別の端末の新しい会話で、名前を呼ぶ', has(t2.row.replies, 'タロウ'), t2.row.replies.join(''));
  check('別の端末の新しい会話で、前の話(カレー)にふれる', has(t2.row.replies, 'カレー'), '頭脳しだい。次の段で聞いて確かめる');
  const t3 = await talk('3 覚えているか聞く', 'B', keyB, SAYINGS.ask, t2.history);
  check('聞かれて、名前と好きなものを言う', real ? has(t3.row.replies, 'タロウ') && has(t3.row.replies, 'カレー') : 'skip', real ? t3.row.replies.join('') : '予行(仮の頭脳は決まった文)');

  // 5 わすれて
  const t4 = await talk('4 わすれて', 'B', keyB, SAYINGS.forget, t3.history);
  check('「わすれて」で全部消える(頭脳は呼ばない)', t4.row.memoryForgotten && !t4.row.calledBrain, t4.row.replies.join(''));
  const gone = await client.listMemory(keyA);
  check('消した後は一覧が無い(404)', gone.status === 404, `status ${gone.status}`);
  const reuse = await client.claim(code);
  check('同じ番号はもう使えない', reuse.status === 400 || reuse.status === 429, `status ${reuse.status}`);

  // 6 端末 A の新しい会話: 覚えていない
  const t5 = await talk('5 消した後のあいさつ', 'A', keyA, SAYINGS.hello);
  check('消した後は名前を言わない', !has(t5.row.replies, 'タロウ') && !has(t5.row.replies, 'カレー'), t5.row.replies.join(''));
  return finish();

  function finish() {
    result.brainCalls = brainCalls;
    const used = turns.map((t) => t.usage).filter(Boolean);
    const sum = (k) => used.reduce((a, u) => a + (Number(u[k]) || 0), 0);
    result.usageTotal = used.length ? { input: sum('input'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), output: sum('output') } : null;
    result.finishedAt = new Date().toISOString();
    const failed = checks.filter((c) => c.ok === false);
    result.ok = checks.length > 0 && failed.length === 0;
    result.code = result.ok ? 0 : 1;
    result.failed = failed.map((c) => c.id);
    // 伏せる: 合鍵・番号・合言葉は、どの値にも残さない
    return JSON.parse(redactSecrets(JSON.stringify(result), secrets));
  }
}

const jst = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-');

/** 短いまとめ(日本語) */
export function summaryMarkdown(r) {
  const lines = [
    `# 記憶の通し(${r.rehearsal ? '予行・仮の頭脳' : '本物の頭脳'})`,
    `- 時刻(日本): ${jst(r.startedAt)} → ${jst(r.finishedAt)}`,
    `- サーバー: ${r.server}・頭脳 ${r.brain ?? '-'}(${r.model ?? '-'})・キャラ ${r.character?.name ?? '-'}`,
    `- 結果: ${r.ok ? '全部通った' : `通らない所がある(${(r.failed ?? []).join('、') || r.reason || '-'})`}`,
    `- 本物の頭脳を呼んだ回数: ${r.brainCalls ?? 0}`,
    r.usageTotal ? `- 使った量(合計): 入力 ${r.usageTotal.input}・キャッシュ読み ${r.usageTotal.cacheRead}・キャッシュ書き ${r.usageTotal.cacheWrite}・出力 ${r.usageTotal.output} トークン` : '- 使った量: 記録なし',
    '',
    '| 段 | 端末 | 言った言葉 | 返事 | 最初の文まで | 入力・キャッシュ読み・書き・出力 |',
    '|---|---|---|---|---|---|',
    ...(r.turns ?? []).map((t) => {
      const u = t.usage ? `${t.usage.input}・${t.usage.cacheRead}・${t.usage.cacheWrite}・${t.usage.output}` : '頭脳なし';
      return `| ${t.step} | ${t.device} | ${t.user} | ${(t.replies ?? []).join('')} | ${t.firstSayMs ?? '-'}ms | ${u} |`;
    }),
    '',
    '| 確かめ | 結果 | メモ |',
    '|---|---|---|',
    ...(r.checks ?? []).map((c) => `| ${c.id} | ${c.ok === true ? '○' : c.ok === 'skip' ? '-(予行)' : '×'} | ${String(c.note ?? '').split('|').join('/')} |`),
  ];
  return lines.join('\n');
}

async function main() {
  const o = args(process.argv.slice(2));
  let out;
  try {
    if (!o.base) throw new Error('--base <サーバーの URL> を付けてください(例 http://127.0.0.1:8787)');
    describeBase(o.base);
    out = checkOutDir(o.out);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const pass = o.passEnv ? process.env[o.passEnv] ?? '' : '';
  if (o.passEnv && !pass) console.warn(`環境変数 ${o.passEnv} が空です(合言葉なしで進めます)`);
  let r;
  try {
    r = await runMemoryLiveCheck({ base: o.base, pass, allowMock: o.allowMock, character: loadCharacter(o.character), log: (s) => console.log(s) });
  } catch (err) {
    console.error(`止めました: ${err.message}`);
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'memory_live.json'), JSON.stringify(r, null, 2));
  writeFileSync(join(out, 'memory_live.md'), summaryMarkdown(r));
  console.log(`${r.ok ? '全部通った' : r.reason ?? `通らない所: ${r.failed.join('、')}`} → ${join(out, 'memory_live.json')}`);
  process.exit(r.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
