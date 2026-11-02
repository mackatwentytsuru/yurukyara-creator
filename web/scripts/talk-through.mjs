// 本物の頭脳と声で、画面を通して話させて測る(画面なしの Chrome)。
//   node scripts/talk-through.mjs --port 8817 --character sample_vrm --label flash --out <json>
// 測るもの: 最初の音までの時間(あいづちと本当の返事は別)・口と声の合い(相関とずれ)・まばたき・うなずき・視線・揺れ物・割り込み。
// 声(ElevenLabs)の文字数を使う。サーバーの 1 日の上限(logs/tts_usage.json)が先に止める。
// 注意: 出力の音は聞けない。ここで言う「口の合い」は、声の音量の波(analyser)と、画面の口(aa)の合い。端末の出力の遅れは入らない。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = arg('port', '8787');
const CHAR = arg('character', 'sample_vrm');
const LABEL = arg('label', 'run');
const OUT = arg('out', '');
const QUESTIONS = (arg('questions', '') || 'ステージはどこにありますか|あの、すみません|初めてのステージ、どうですか|ここの営業時間を教えてください').split('|');
const GAP_MS = Number(arg('gap', 6500));

const { chromium } = await import(pathToFileURL('repo/web/node_modules/playwright-core/index.mjs').href);
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
const consoleProblems = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) consoleProblems.push(m.type() + ': ' + m.text().slice(0, 160));
});
page.on('pageerror', (e) => consoleProblems.push('pageerror: ' + e.message.slice(0, 160)));
// 実測のログ(logs/latency.jsonl)を汚さない
await page.addInitScript(() => {
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => (String(u).includes('/api/metrics') ? Promise.resolve(new Response('{}')) : of(u, o));
});
await page.goto(`http://127.0.0.1:${PORT}/?character=${CHAR}&place=test_room&auto=0`);
await page.waitForFunction(() => window.__app?.character?.vrm, null, { timeout: 90000 });
await page.getByText('カメラなしで試す').click();
await page.waitForTimeout(2000);

// 場所をサンプル会場の受付にして、毎コマの記録を始める
await page.evaluate(() => {
  const app = window.__app;
  app.place.name = 'サンプル会場';
  app.place.info = 'サンプル会場は、ステージの壁が大きな LED になっている会場。ここは入口。';
  for (const l of app.place.landmarks) if (l.name === '机') Object.assign(l, { name: 'ステージ', note: 'ステージ。壁一面が LED になっている' });
  const c = app.character;
  const em = c.vrm.expressionManager;
  const head = c.vrm.humanoid.getNormalizedBoneNode('head');
  const an = app.speaker.analyser;
  const buf = new Float32Array(an.fftSize);
  // 揺れ物: 髪・羽根・スカートの先の節を 1 つずつ(頭に対する位置の動きを見る)
  const joints = [...(c.vrm.springBoneManager?.joints ?? [])];
  const allTips = joints.filter((j) => !joints.some((k) => k.child === j.bone)).map((j) => j.bone);
  const groupOf = (n) => n.name.replace(/[_\d].*$/, '') || n.name;
  const seen = new Set();
  const tips = allTips.filter((n) => !seen.has(groupOf(n)) && seen.add(groupOf(n))).slice(0, 8);
  const rest = tips.map((n) => n.quaternion.clone());
  window.__rec = { t: [], rms: [], aa: [], blink: [], headX: [], headY: [], lookL: [], lookR: [], spring: tips.map(() => []), tipNames: tips.map((n) => n.name), sources: [] };
  const R = window.__rec;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    R.t.push(performance.now());
    R.rms.push(Math.sqrt(s / buf.length));
    R.aa.push(em.getValue('aa') ?? 0);
    R.blink.push(em.getValue('blink') ?? 0);
    R.headX.push(head.rotation.x);
    R.headY.push(head.rotation.y);
    R.lookL.push(em.getValue('lookLeft') ?? 0);
    R.lookR.push(em.getValue('lookRight') ?? 0);
    R.sources.push(app.speaker.sources.size);
    tips.forEach((n, i) => R.spring[i].push(n.quaternion.angleTo(rest[i])));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const turns = [];
for (let i = 0; i < QUESTIONS.length; i++) {
  await page.mouse.move(240 + (i % 2 ? 60 : -60), 300);
  const m0 = await page.evaluate(() => window.__app.metrics.length);
  const q = QUESTIONS[i];
  const tStart = await page.evaluate((text) => {
    const t0 = performance.now();
    window.__app.dialogue.send({ text, mode: 'voice', t0 });
    return t0;
  }, q);
  await page.waitForFunction((n) => window.__app.metrics.length > n, m0, { timeout: 30000 }).catch(() => {});
  // 話し終わるまで待つ
  await page.waitForFunction(() => !window.__app.speaker.speaking, null, { timeout: 40000 }).catch(() => {});
  const r = await page.evaluate(({ n, t0 }) => {
    const a = window.__app;
    return { metric: a.metrics[n] ?? null, history: a.dialogue.history.at(-1)?.content ?? '', t0 };
  }, { n: m0, t0: tStart });
  turns.push({ q, ...r });
  await page.waitForTimeout(GAP_MS);
}

// 割り込み: 話し始めて 0.7 秒後に止める(2 回)
const interrupts = [];
for (let k = 0; k < Number(arg('interrupts', 2)); k++) {
  await page.evaluate(() => window.__app.dialogue.send({ text: 'ステージのことを、くわしく教えてください', mode: 'voice', t0: performance.now() }));
  await page.waitForFunction(() => window.__app.speaker.sources.size > 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  const res = await page.evaluate(async () => {
    const a = window.__app;
    const t = performance.now();
    a.dialogue.cancel();
    const R = window.__rec;
    const start = R.t.length;
    await new Promise((r) => setTimeout(r, 600));
    let mouthClosedMs = null;
    for (let i = start; i < R.t.length; i++) {
      if (R.aa[i] < 0.05) {
        mouthClosedMs = Math.round(R.t[i] - t);
        break;
      }
    }
    return { sourcesAfter: a.speaker.sources.size, pending: a.speaker.pending, speaking: a.speaker.speaking, mouthClosedMs };
  });
  interrupts.push(res);
  await page.waitForTimeout(GAP_MS);
}

// 視線: 人を左・中央・右に置く
const gaze = [];
for (const x of [60, 240, 420]) {
  await page.mouse.move(x, 300);
  await page.waitForTimeout(1800);
  gaze.push({ mouseX: x, ...(await page.evaluate(() => {
    const a = window.__app;
    const c = a.character;
    const em = c.vrm.expressionManager;
    const head = c.vrm.humanoid.getNormalizedBoneNode('head');
    return { headYawDeg: Math.round((head.rotation.y * 180) / Math.PI * 10) / 10, headPitchDeg: Math.round((head.rotation.x * 180) / Math.PI * 10) / 10, lookLeft: Math.round(em.getValue('lookLeft') * 100) / 100, lookRight: Math.round(em.getValue('lookRight') * 100) / 100, people: a.lastAttention.tracks.length };
  })) });
}
// 話していない 12 秒(まばたき・揺れ物の動きを見る)
await page.waitForTimeout(12000);
const rec = await page.evaluate(() => window.__rec);

// ---- 集計
const n = rec.t.length;
const dts = rec.t.slice(1).map((t, i) => t - rec.t[i]).sort((a, b) => a - b);
const medianDt = dts[Math.floor(dts.length / 2)];
const corrAt = (lagFrames, idxs) => {
  const xs = [];
  const ys = [];
  for (const i of idxs) {
    const j = i + lagFrames;
    if (j < 0 || j >= n) continue;
    xs.push(rec.rms[i]);
    ys.push(rec.aa[j]);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
};
// 声の出ている区間(前後 0.5 秒を含める)
const voiced = [];
for (let i = 0; i < n; i++) if (rec.sources[i] > 0) voiced.push(i);
const idxs = new Set();
for (const i of voiced) for (let d = -Math.round(500 / medianDt); d <= Math.round(500 / medianDt); d++) if (i + d >= 0 && i + d < n) idxs.add(i + d);
const window_ = [...idxs].sort((a, b) => a - b);
let best = { lagMs: null, r: -2 };
const maxLag = Math.round(300 / medianDt);
for (let l = -maxLag; l <= maxLag; l++) {
  const r = corrAt(l, window_);
  if (r !== null && r > best.r) best = { lagMs: Math.round(l * medianDt), r: Math.round(r * 1000) / 1000 };
}
const zero = corrAt(0, window_);
const silent = rec.t.map((_, i) => i).filter((i) => rec.sources[i] === 0 && rec.rms[i] < 0.002);
const openWhileSilent = silent.filter((i) => rec.aa[i] > 0.1).length / Math.max(1, silent.length);
const speaking = voiced.filter((i) => rec.rms[i] > 0.02);
const closedWhileSpeaking = speaking.filter((i) => rec.aa[i] < 0.05).length / Math.max(1, speaking.length);
// まばたき: blink の山(0.5 を上へ横切る回数)
let blinks = 0;
for (let i = 1; i < n; i++) if (rec.blink[i - 1] < 0.15 && rec.blink[i] >= 0.15) blinks += 1;
const secs = (rec.t[n - 1] - rec.t[0]) / 1000;
const range = (a) => Math.round((Math.max(...a) - Math.min(...a)) * 1000) / 1000;
const deg = (r) => Math.round((r * 180) / Math.PI * 10) / 10;
const springMaxDeg = rec.spring.map((a, i) => ({ name: rec.tipNames[i], maxDeg: deg(Math.max(...a)) }));

const summary = {
  label: LABEL,
  character: CHAR,
  frames: n,
  seconds: Math.round(secs),
  fps: Math.round(1000 / medianDt),
  turns: turns.map((t) => ({
    q: t.q,
    answer: t.history.split(String.fromCharCode(10)).map((l) => { try { return JSON.parse(l).text; } catch { return l; } }).join(''),
    totalMs: t.metric?.totalMs ?? null,
    fillerMs: t.metric?.fillerMs ?? null,
    ttsFirstByteMs: t.metric?.ttsFirstByteMs ?? null,
    sendToFirstSayMs: t.metric?.sendToFirstSayMs ?? null,
    valid: t.metric?.valid ?? null,
  })),
  mouth: { bestLagMs: best.lagMs, bestR: best.r, rAtZeroLag: zero === null ? null : Math.round(zero * 1000) / 1000, openWhileSilentRate: Math.round(openWhileSilent * 1000) / 1000, closedWhileSpeakingRate: Math.round(closedWhileSpeaking * 1000) / 1000, aaMax: Math.round(Math.max(...rec.aa) * 100) / 100 },
  blink: { max: Math.round(Math.max(...rec.blink) * 100) / 100, count: blinks, perMinute: Math.round((blinks / secs) * 600) / 10 },
  head: { pitchRangeRad: range(rec.headX), yawRangeRad: range(rec.headY), eyeLookMax: Math.round(Math.max(...rec.lookL, ...rec.lookR) * 100) / 100 },
  springMaxDeg,
  gaze,
  interrupts,
  consoleProblems: consoleProblems.slice(0, 8),
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
await browser.close();
