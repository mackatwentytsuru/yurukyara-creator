// stt.test.mjs 用の偽の聞き取りの係。本物と同じ決まりで、1 行のパスに 1 行の JSON を返す。
// 環境変数 FAKE_STT で動きを変える: crash = 1 回目で落ちる / text=<文字> = その文字を返す / hang = 返さない
// echohint = 手がかりの欄を返す / echoline = 受けた 1 行の欄の数と、手がかり・聞く言葉の欄を返す(ML1)
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_STT ?? '';
console.log('読み込みの余計な出力');
console.log(JSON.stringify({ ready: true }));
createInterface({ input: process.stdin }).on('line', (line) => {
  const fields = line.split('\t'); // パス、または パス<タブ>手がかりの言葉、または パス<タブ>手がかり<タブ>聞く言葉
  const [path, hint = ''] = fields;
  if (mode === 'crash') process.exit(1);
  if (mode === 'hang') return;
  if (mode === 'echohint') return console.log(JSON.stringify({ text: `hint=${hint}`, ms: 5 }));
  if (mode === 'echoline') return console.log(JSON.stringify({ text: `fields=${fields.length}|hint=${hint}|lang=${fields[2] ?? ''}`, ms: 5 }));
  console.log(JSON.stringify({ text: mode.startsWith('text=') ? mode.slice(5) : existsSync(path) ? 'ファイルがある' : 'ファイルがない', ms: 5 }));
});
