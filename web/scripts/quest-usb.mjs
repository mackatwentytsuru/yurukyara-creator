// USB でつないだ Quest から、この PC の会話サーバーを開く。証明書も Wi-Fi の設定も要らない(Quest から見て localhost になり、安全なページの扱いになる)。
//   node scripts/quest-usb.mjs --port 8799 --character <id> [--no-open] [--wait-min 5] [--watch]
// ヘッドセットの中で「USB デバッグを許可」が出たら、押してもらうのを待つ。--watch は、つなぎ直しても道を張り直し続ける(開くのは 1 回だけ)。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = opt('port', '8799');
const CHARACTER = opt('character', '');
const WAIT_MIN = Number(opt('wait-min', 5));
const NO_OPEN = argv.includes('--no-open');
const WATCH = argv.includes('--watch');
const URL_TO_OPEN = `http://localhost:${PORT}/${CHARACTER ? `?character=${encodeURIComponent(CHARACTER)}` : ''}`;
const POLL_MS = 3000;
const WATCH_POLL_MS = 15000;

function findAdb() {
  const dirs = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'), process.env.HOME && join(process.env.HOME, 'Library', 'Android', 'sdk')];
  for (const d of dirs) {
    for (const name of ['adb.exe', 'adb']) {
      const p = d && join(d, 'platform-tools', name);
      if (p && existsSync(p)) return p;
    }
  }
  return 'adb'; // PATH にあれば、これで動く
}

const ADB = findAdb();
const adb = (...args) => new Promise((resolve, reject) => {
  execFile(ADB, args, { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
});

/** Meta の機器を優先して、1 台の状態を返す */
async function questState() {
  const out = await adb('devices', '-l');
  const rows = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[0]);
  const row = rows.find((c) => /quest|eureka|panther|hollywood/i.test(c.join(' '))) ?? rows[0];
  return row ? { serial: row[0], state: row[1] } : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let told = '';
const tell = (key, text) => {
  if (told !== key) console.log(text);
  told = key;
};

async function connect(deadline) {
  for (;;) {
    let q;
    try {
      q = await questState();
    } catch (err) {
      console.error(`adb を動かせません(Android の platform-tools を入れてください): ${err.message}`);
      process.exit(1);
    }
    if (q?.state === 'device') return q;
    if (!q) tell('none', 'Quest が見えません。USB ケーブルと電源、開発者モードを確かめてください。');
    else if (q.state === 'unauthorized') tell('auth', 'ヘッドセットをかぶって「USB デバッグを許可」→「常に許可」を押してください。');
    else tell(q.state, `Quest の状態: ${q.state}`);
    if (Date.now() > deadline) {
      console.error('時間内につながりませんでした。');
      process.exit(1);
    }
    await sleep(POLL_MS);
  }
}

const reverse = (q) => adb('-s', q.serial, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`);

const quest = await connect(WATCH ? Infinity : Date.now() + WAIT_MIN * 60000);
await reverse(quest);
console.log(`つながりました: ${quest.serial}。Quest のブラウザで ${URL_TO_OPEN} が開けます。`);
if (!NO_OPEN) {
  await adb('-s', quest.serial, 'shell', `am start -a android.intent.action.VIEW -d '${URL_TO_OPEN}' com.oculus.browser`)
    .then(() => console.log('Quest のブラウザで開きました。'))
    .catch((err) => console.log(`自動で開けませんでした。ブラウザに URL を打ってください: ${URL_TO_OPEN}(${err.message.trim().slice(0, 120)})`));
}
while (WATCH) {
  await sleep(WATCH_POLL_MS);
  const q = await connect(Infinity);
  const list = await adb('-s', q.serial, 'reverse', '--list').catch(() => '');
  if (!list.includes(`tcp:${PORT}`)) {
    await reverse(q);
    console.log('道を張り直しました。');
  }
}
