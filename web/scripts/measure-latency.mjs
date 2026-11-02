// 返事までの時間を測る(サーバーの内側の分)。
//   node scripts/measure-latency.mjs [回数=10] [--base http://localhost:8787] [--no-tts] [--gap 5500] [--ab]
//   --ab: 1 回ごとに、2 本目の呼び出し(ヘッジ)を「なし」と「あり(1000ms)」で交互にして、同じ時間帯で比べる。
//         サーバーを HEDGE_EXPERIMENT=1 で起動したときだけ効く
//
// 測るもの(ms): 送信 → 最初の thought / 最初の say / 読み上げの最初の音のかけら
//   サーバーの中の合計 = 最初の say までの時間 + 読み上げの最初のかけらまでの時間
// 画面の中の「話し終わりから話し始めまで」(声の聞き取りと再生の始まりを含む)は、画面の下に出る数字と
// /api/metrics に記録される。この道具は、頭脳と声だけを機械的に何度も測るためのもの。
// 結果は logs/latency_server.jsonl に日付つきで足す。読み上げの文字数(上限の枠)を少し使う。
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
const BASE = opt('--base', 'http://localhost:8787');
const WITH_TTS = !flag('--no-tts');
const AB = flag('--ab');
const GAP_MS = Number(opt('--gap', 5500)); // 1 分あたりの上限(既定 12 回)に当たらない間隔。人の間合いにも近い

const PHRASES = ['こんにちは', 'お手洗いはどこですか', '休憩できる場所はありますか', 'スタッフの方と話したいです', '入口はどっちですか', 'ありがとうございます', '今日は何ができますか', 'ここは何のお店ですか', '少し教えてください', 'はじめまして'];
const place = {
  name: '試しの場所',
  landmarks: [
    { name: '入口', where: '手前、約 2.5m' },
    { name: 'お手洗い', where: '左奥、約 3.8m' },
    { name: '休憩スペース', where: '右奥、約 3.6m' },
  ],
};

async function oneTurn(text, hedgeMs) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(hedgeMs !== undefined ? { hedgeMs } : {}), text, scene: '1 人が見えている: 正面 約 1.0m', character: { name: '試しのキャラ', persona: '明るい受付' }, place }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let brain = '?';
  let tThought = null;
  let tSay = null;
  let firstSay = '';
  let hedged = false;
  let usage = null;
  outer: while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'meta') {
        brain = ev.brain ?? brain;
        if (ev.hedged !== undefined) hedged = ev.hedged;
        if (ev.usage) usage = ev.usage;
      }
      if (ev.type === 'thought' && tThought === null) tThought = performance.now() - t0;
      if (ev.type === 'say' && tSay === null) {
        tSay = performance.now() - t0;
        firstSay = ev.text;
        if (!WITH_TTS && !AB) break outer; // 続きは読まずに終える(ヘッジの記録を読むときは最後まで読む)
      }
      if (ev.type === 'error') throw new Error(ev.message);
    }
  }
  await reader.cancel().catch(() => {});
  let tTts = null;
  if (WITH_TTS && firstSay) {
    const t1 = performance.now();
    const r = await fetch(`${BASE}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: firstSay }),
    });
    if (!r.ok) throw new Error(`読み上げが ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const rd = r.body.getReader();
    await rd.read();
    tTts = performance.now() - t1;
    await rd.cancel().catch(() => {});
  }
  const total = tSay !== null && tTts !== null ? tSay + tTts : null;
  return { text, brain, hedgeMs, hedged, usage, thoughtMs: tThought && Math.round(tThought), firstSayMs: tSay && Math.round(tSay), ttsFirstChunkMs: tTts && Math.round(tTts), serverTotalMs: total && Math.round(total) };
}

const rows = [];
for (let i = 0; i < N; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
  const row = await oneTurn(PHRASES[i % PHRASES.length], AB ? (i % 2 === 0 ? 0 : 1000) : undefined);
  rows.push(row);
  console.log(`${String(i + 1).padStart(2)} ${row.brain.padEnd(5)}${AB ? (row.hedgeMs ? ' ヘッジあり' + (row.hedged ? '(送った)' : '') : ' ヘッジなし') : ''} キャッシュ読み ${row.usage?.cacheRead ?? '—'} thought ${row.thoughtMs}ms  say ${row.firstSayMs}ms  音 ${row.ttsFirstChunkMs ?? '—'}ms  合計 ${row.serverTotalMs ?? '—'}ms  「${row.text}」`);
}
if (AB) {
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  for (const [label, group] of [['ヘッジなし', rows.filter((r) => r.hedgeMs === 0)], ['ヘッジあり', rows.filter((r) => r.hedgeMs === 1000)]]) {
    const t = group.map((r) => r.serverTotalMs).filter(Number.isFinite).sort((a, b) => a - b);
    const say = group.map((r) => r.firstSayMs).filter(Number.isFinite).sort((a, b) => a - b);
    console.log(`${label}: n=${t.length} 最初の文まで 中央値 ${q(say, 0.5)}ms 90番目 ${q(say, 0.9)}ms 最大 ${say.at(-1)}ms / 合計 中央値 ${q(t, 0.5)}ms 90番目 ${q(t, 0.9)}ms ・ 2 本目を送った回 ${group.filter((r) => r.hedged).length}`);
  }
}
const totals = rows.map((r) => r.serverTotalMs).filter(Number.isFinite).sort((a, b) => a - b);
const pick = (p) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))];
if (totals.length) {
  const under = totals.filter((v) => v <= 1200).length;
  console.log(`\n中央値 ${pick(0.5)}ms ・ 90 番目 ${pick(0.9)}ms ・ 1200ms 以内 ${under}/${totals.length} 回 ・ 頭脳 ${rows[0].brain}`);
}
const logDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
mkdirSync(logDir, { recursive: true });
for (const r of rows) appendFileSync(join(logDir, 'latency_server.jsonl'), JSON.stringify({ date: new Date().toISOString(), ...r }) + '\n');
