// Mac に AirDrop で届いた撮影を PC に取りこんで、ブラウザ・ARステージで開ける状態にする。
//   node place/tools/receive_scan.mjs <id> [表示の名前] [--minutes=180] [--local=<撮ったフォルダ>]
// 流れ: Mac の ~/Downloads から集める(mac_collect_scan.py)→ scp で work\scans_in\<日時>\ へ
//       → ingest_roomscan.mjs → check_ingest.mjs(偽の撮影用なので警告だけ)→ 開く URL を表示。
// --local を付けると Mac を通さず、そのフォルダを取りこむ(試し用)。
// 撮った本物のデータは scans_in(リポジトリの外)に置く。コミットする前に、顔・住所が写っていないか見ること。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const [id, nameArg] = argv.filter((a) => !a.startsWith('--'));
if (!id) {
  console.error('使い方: node place/tools/receive_scan.mjs <id> [表示の名前] [--minutes=180] [--local=<撮ったフォルダ>]');
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
  console.error('id は半角の小文字・数字・_ - だけ(先頭に _ は使わない。_ で始まる物は一覧に出ない)');
  process.exit(2);
}

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) { console.error(`${label} が失敗(終了コード ${r.status})`); process.exit(r.status || 1); }
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let scanDir = opt('local') ? resolve(opt('local')) : join('work\\scans_in', stamp);

if (!opt('local')) {
  const macDir = `~/sample_work/scans_in/${stamp}`;
  const script = readFileSync(join(here, 'mac_collect_scan.py'), 'utf8');
  const collect = spawnSync('ssh', ['pc3', `python3 - ${macDir} ${opt('minutes') ?? 180}`], { input: script, encoding: 'utf8' });
  process.stdout.write(collect.stdout ?? '');
  process.stderr.write(collect.stderr ?? '');
  if (collect.status !== 0) {
    console.error(collect.status === 3 ? '時刻が離れているので止めた(混ざりの疑い)。' : 'Mac で撮影が見つからない。AirDrop の届き先(~/Downloads)を見る。');
    process.exit(collect.status || 1);
  }
  mkdirSync(dirname(scanDir), { recursive: true });
  run('scp', ['-r', `pc3:sample_work/scans_in/${stamp}`, dirname(scanDir)], 'scp');
}
if (!existsSync(join(scanDir, 'room_mesh.usdz'))) { console.error('撮影フォルダに room_mesh.usdz が無い:', scanDir); process.exit(2); }

run(process.execPath, [join(here, 'ingest_roomscan.mjs'), scanDir, id, ...(nameArg ? [nameArg] : [])], '取りこみ');

const ip = Object.values((await import('node:os')).networkInterfaces()).flat().find((n) => n?.family === 'IPv4' && /^192\.168\./.test(n.address))?.address ?? '<PCのIP>';
console.log(`\n撮影の原本: ${scanDir}`);
console.log(`ARステージ / ブラウザで開く: https://${ip}:8443/place/web/demo.html?place=${id}`);
