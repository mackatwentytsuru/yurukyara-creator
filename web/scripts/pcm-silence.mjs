// 声(PCM 16bit・24kHz・モノラル)の前後の無音と、話す速さを測る。API は使わない(前もって作った声のファイルを読むだけ)。
//   node scripts/pcm-silence.mjs [フォルダか PCM ファイル …]   既定は cache/fillers
// 無音の判定: 音量が「ピークの -40dB」より小さい間。前の無音は、最初の音が出るまでの余計な待ち。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILLER_PHRASES, listFillers } from '../server/fillers.mjs';

const RATE = 24000;
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {Buffer} buf @returns {{ms:number, leadMs:number, tailMs:number, peak:number}} */
export function measure(buf, dbBelowPeak = -40) {
  const n = Math.floor(buf.length / 2);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf.readInt16LE(i * 2)));
  const gate = peak * 10 ** (dbBelowPeak / 20);
  let first = 0;
  while (first < n && Math.abs(buf.readInt16LE(first * 2)) <= gate) first++;
  let last = n - 1;
  while (last > first && Math.abs(buf.readInt16LE(last * 2)) <= gate) last--;
  const ms = (k) => Math.round((k / RATE) * 1000);
  return { ms: ms(n), leadMs: ms(first), tailMs: ms(n - 1 - last), peak };
}

if (process.argv[1]?.endsWith('pcm-silence.mjs')) {
  const targets = process.argv.slice(2);
  const files = [];
  for (const t of targets.length ? targets : [join(WEB, 'cache', 'fillers')]) {
    if (!existsSync(t)) continue;
    if (statSync(t).isDirectory()) readdirSync(t).filter((f) => f.endsWith('.pcm')).forEach((f) => files.push(join(t, f)));
    else files.push(t);
  }
  // ファイル名 → 言葉(今の声の設定のものだけ分かる)
  const names = new Map(listFillers().map((f) => [f.url.split('/').pop(), f.text]));
  const rows = files.map((f) => {
    const m = measure(readFileSync(f));
    const name = f.split(/[\\/]/).pop();
    return { name, text: names.get(name) ?? '(今の設定の言葉ではない)', ...m };
  });
  for (const r of rows) console.log(`${r.name}  ${r.text.padEnd(12)}  全体 ${String(r.ms).padStart(5)}ms  前の無音 ${String(r.leadMs).padStart(4)}ms  後ろの無音 ${String(r.tailMs).padStart(4)}ms  ピーク ${r.peak}`);
  const mine = rows.filter((r) => FILLER_PHRASES.includes(r.text));
  if (mine.length) {
    const avg = (k) => Math.round(mine.reduce((s, r) => s + r[k], 0) / mine.length);
    console.log(`\n今の声 ${mine.length} 件の平均: 前の無音 ${avg('leadMs')}ms / 後ろの無音 ${avg('tailMs')}ms / 全体 ${avg('ms')}ms`);
  }
}
