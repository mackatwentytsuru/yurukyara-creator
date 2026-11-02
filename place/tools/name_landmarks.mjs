// places/<id>/place.json の landmarks の名前と一言を、Claude に付け直してもらう。
//   node place/tools/name_landmarks.mjs <id> [--hint "カフェ。入口は北側"] [--dry-run]
// --dry-run: Claude を呼ばず、送る文だけを表示する(お金がかからない)。
// 鍵は環境変数 ANTHROPIC_API_KEY から読む(値は表示しない)。モデルは環境変数 NAMING_MODEL(既定 claude-haiku-5-5)。
// 元の landmarks は places/<id>/landmarks.raw.json に残す(戻せる)。
// お金のかかる API なので、本番で使う前に「API 残高と利用の管理」へ量を伝える(1 部屋 1 回で数円の見込み。実測は未)。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyNaming, buildPrompt, extractJson } from './landmarkNaming.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
};
if (!id) {
  console.error('使い方: node place/tools/name_landmarks.mjs <id> [--hint "..."] [--dry-run]');
  process.exit(2);
}

const dir = join(here, '..', '..', 'places', id);
const placePath = join(dir, 'place.json');
if (!existsSync(placePath)) {
  console.error('見つからない:', placePath);
  process.exit(2);
}
const place = JSON.parse(readFileSync(placePath, 'utf8'));
const prompt = buildPrompt(place, opt('--hint'));

if (flag('--dry-run')) {
  console.log(prompt);
  process.exit(0);
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY が環境変数にありません(値は表示しません)。--dry-run なら鍵なしで文だけ見られます。');
  process.exit(2);
}

const model = process.env.NAMING_MODEL ?? 'claude-haiku-5-5';
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
});
if (!res.ok) {
  console.error(`Claude の呼び出しに失敗: HTTP ${res.status}`, (await res.text()).slice(0, 300));
  process.exit(3);
}
const data = await res.json();
const text = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';
const named = applyNaming(place, extractJson(text));

writeFileSync(join(dir, 'landmarks.raw.json'), JSON.stringify(place.landmarks, null, 2) + '\n', 'utf8');
writeFileSync(placePath, JSON.stringify(named, null, 2) + '\n', 'utf8');
console.log(`名前を付け直した(${named.landmarks.length} 個)。使ったトークン: 入力 ${data.usage?.input_tokens} / 出力 ${data.usage?.output_tokens}`);
for (const l of named.landmarks) console.log(` - ${l.name}: ${l.note}`);
