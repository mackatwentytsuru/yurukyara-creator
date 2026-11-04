// Quest 3 の道(サーバーの聞き取り)で、「話し終わり → 字 → 返事の最初の文 → 最初の音」を測る。
// 偽の Quest(Chrome に Quest の UA を名乗らせ、偽のマイクに WAV を流す)で、VR には入らずに、聞き取りから返事までだけを通す。
//   測る:   node scripts/stt-latency.mjs --port 8802 --mic 声.wav --out <フォルダ> [--label 名] [--wait 115] [--word 言葉]
//   まとめ: node scripts/stt-latency.mjs --summary a.json b.json ...
// 起点は「声の区間が閉じた時刻」(声が止まって 450ms 後)。声が最後に出ていた時刻(t0)も別に残す。時刻はすべてページの中の performance.now()。
// 分かるのは、通しの時間の並び。Quest 本体のマイク・音・回線の数字ではない(PC のソフト描画の Chrome)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const median = (a) => {
  const s = a.filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null;
};
const max = (a) => {
  const s = a.filter((v) => v !== null && v !== undefined);
  return s.length ? Math.max(...s) : null;
};
const KEYS = ['sttMs', 'serverMs', 'toFirstSayMs', 'toAudioMs', 'fillerMs', 'fillerBeforeText'];

function summarize(rows, label) {
  const out = { label, n: rows.length };
  for (const k of KEYS) {
    const v = rows.map((r) => r[k]);
    out[k] = k === 'fillerBeforeText' ? `${rows.filter((r) => r.fillerBeforeText).length}/${rows.filter((r) => r.fillerMs !== null).length}` : { median: median(v), max: max(v) };
  }
  out.texts = rows.map((r) => r.text);
  return out;
}

if (argv.includes('--summary')) {
  const files = argv.slice(argv.indexOf('--summary') + 1);
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).rows);
  console.log(JSON.stringify({ all: summarize(rows, 'all'), warm: summarize(rows.filter((r) => !r.cold), 'warm(各サーバーの最初の 1 回を除く)') }, null, 1));
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = opt('port', '8802');
const MIC = opt('mic', null);
const OUT = opt('out', 'stt_latency');
const LABEL = opt('label', 'run');
const WAIT_S = Number(opt('wait', '115'));
const WORD = opt('word', null); // 録音の正しい言葉(全文)
const CHAR = opt('character', 'robo');
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4 Chrome/142.0.0.0 VR Safari/537.36';
if (!MIC) throw new Error('--mic が要ります');
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = await import(pathToFileURL(path.join(HERE, '../node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(MIC).replaceAll('\\', '/')}%noloop`],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: QUEST_UA, permissions: ['microphone'] });
const page = await context.newPage();
const sttReplies = [];
page.on('response', async (r) => {
  if (r.url().endsWith('/api/stt')) sttReplies.push(await r.json().catch(() => ({})));
});
await page.goto(`http://127.0.0.1:${PORT}/?character=${CHAR}`);
await page.waitForFunction(() => window.__app?.character && !document.getElementById('startCam').disabled, null, { timeout: 180000 });
const status = await page.evaluate(async () => (await fetch('/api/status')).json());
await page.click('#startCam');
await page.waitForFunction(() => window.__app.listener?.listening, null, { timeout: 20000 });
const t = Date.now();
// 偽のマイクの声が流れ終わるまで待つ。返事が出た数が増えなくなったら終わり
await page.waitForFunction(() => window.__app.metrics.filter((m) => m.mode === 'voice').length >= 3, null, { timeout: WAIT_S * 1000 }).catch(() => {});
await page.waitForFunction(() => !window.__app.dialogue.busy && !window.__app.speaker.speaking, null, { timeout: 40000 }).catch(() => {});

const raw = await page.evaluate(() => ({
  timings: window.__app.listener.timings,
  metrics: window.__app.metrics.filter((m) => m.mode === 'voice'),
}));
await browser.close();

// 区間と返事を、順番で結びつける(送った時刻から字が返るまで = t0ToSendMs と合うかで確かめる)
const rows = [];
raw.timings.forEach((tm, i) => {
  const m = raw.metrics[i];
  const row = { i, cold: false, text: sttReplies[i]?.text ?? null, audioS: tm.audioS };
  const closeLag = tm.closedAt ? tm.closedAt - tm.lastVoicedAt : null;
  row.closeLagMs = closeLag === null ? null : Math.round(closeLag);
  row.sttMs = tm.doneAt && tm.closedAt ? Math.round(tm.doneAt - tm.closedAt) : null; // ① 閉じてから字が返るまで
  row.serverMs = tm.serverMs; // ①の中の、Whisper だけの時間
  if (m && closeLag !== null) {
    const consistent = Math.abs(m.t0ToSendMs - (tm.doneAt - tm.lastVoicedAt)) < 40; // 結びつけが合っているか
    row.matched = consistent;
    row.toFirstSayMs = m.sendToFirstSayMs === null ? null : Math.round(m.t0ToSendMs + m.sendToFirstSayMs - closeLag); // ② 閉じてから返事の最初の文まで
    row.toAudioMs = Math.round(m.totalMs - closeLag); // ③ 閉じてから最初の音まで
    row.fillerMs = m.fillerMs === null ? null : Math.round(m.fillerMs - closeLag); // あいづちの音まで
    row.fillerBeforeText = m.fillerMs !== null && m.fillerMs < m.t0ToSendMs;
    row.ttsFirstByteMs = m.ttsFirstByteMs;
    row.valid = m.valid;
    row.fromT0 = { t0ToSendMs: m.t0ToSendMs, sendToFirstSayMs: m.sendToFirstSayMs, totalMs: m.totalMs, fillerMs: m.fillerMs };
  }
  rows.push(row);
});
if (rows[0] && !argv.includes('--warm')) rows[0].cold = true;
const norm = (x) => (x ?? '').replace(/[、。,.!?!? ]/g, '');
const wordOk = WORD ? rows.map((r) => (norm(r.text) === norm(WORD) ? 'exact' : norm(r.text).includes(norm(WORD)) ? 'contains' : 'miss')) : null; // 言葉と一致 / 余計な字つき / 外れ
const result = { label: LABEL, port: PORT, mic: path.basename(MIC), waitedS: Math.round((Date.now() - t) / 1000), brain: status.brain ?? null, stt: status.stt ?? null, tts: status.tts?.available ?? null, word: WORD, wordOk, rows, summary: summarize(rows, LABEL) };
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ label: LABEL, n: rows.length, texts: rows.map((r) => r.text), wordOk, rows: rows.map((r) => ({ stt: r.sttMs, whisper: r.serverMs, firstSay: r.toFirstSayMs, audio: r.toAudioMs, filler: r.fillerMs, matched: r.matched, valid: r.valid })) }));
