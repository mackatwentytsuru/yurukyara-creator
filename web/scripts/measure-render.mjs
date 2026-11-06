// 重さを測る(L0)。会話サーバーが配るページを ?perf=1 で開き、キャラごと・画面の幅ごとに window.__perf を集める。
//   npm run build && PORT=8799 npm run server        (鍵は要らない。測りでは話さない)
//   node scripts/measure-render.mjs --port 8799 --out <出力のフォルダ> [--characters yokoso,robo] [--views pc,phone,quest] [--sec 6] [--query tier=low] [--throttle none|slow4g|cpu4] [--cold]
// GPU で描く(gpuGuard.js の GPU_ARGS)。WebGL が CPU(SwiftShader)なら、その場で止める。GPU の札と鍵を取ってから流す。
// 分かるのは、この PC の GPU での数字。スマホと Quest の幅は「幅・画素の密度・名乗り」だけをまねた物で、実機の速さではない(重さの表では別の行)。
// --throttle は、遅い回線と遅い CPU のまね(Chrome の DevTools の仕組み)。読み込みと最初のコマの時間の目安で、実機の数字ではない。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = opt('port', '8799');
const OUT = opt('out', 'perf_out');
const CHARS = opt('characters', 'yokoso,robo,f_led,d_lantern').split(',').filter(Boolean);
const VIEWS = opt('views', 'pc,phone').split(',').filter(Boolean);
const SEC = Number(opt('sec', '6'));
const EXTRA = opt('query', ''); // 足す URL の値(例 tier=low&fur=3)。比べの測りに使う
const THROTTLE = opt('throttle', 'none');
// 遅い回線のまね: 往復の遅れ 562.5ms・下り 1474.56kbps・上り 675kbps(携帯の遅い回線の想定によく使われる数字)。CPU は 4 倍遅く
const THROTTLES = {
  none: null,
  slow4g: { net: { latencyMs: 562.5, downKbps: 1474.56, upKbps: 675 }, cpu: 4 },
  cpu4: { net: null, cpu: 4 },
};
if (!(THROTTLE in THROTTLES)) throw new Error(`知らない --throttle です: ${THROTTLE}(${Object.keys(THROTTLES).join('・')})`);
const TIMEOUT_MS = (SEC + (THROTTLES[THROTTLE] ? 120 : 40)) * 1000;

/** 遅い回線と遅い CPU をまねる(開く前に、そのページにだけ掛ける) */
async function applyThrottle(page, preset) {
  if (!preset) return;
  const cdp = await page.context().newCDPSession(page);
  if (preset.net) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: preset.net.latencyMs,
      downloadThroughput: Math.floor((preset.net.downKbps * 1024) / 8),
      uploadThroughput: Math.floor((preset.net.upKbps * 1024) / 8),
    });
  }
  if (preset.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: preset.cpu });
}

const VIEW_SPECS = {
  pc: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  // 幅 390・密度 3 は今のふつうの iPhone の画面。描く画素の倍率は stage が 2 までに抑える
  // 名乗りも iPhone にして、端末の段(stage/tiers.js)がスマホの段を選ぶかも確かめる
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  // Quest 3 のブラウザの平らな窓(VR に入る前の画面)。名乗りを Quest にして、端末の段が xr を選ぶかを確かめる。VR の中の速さは vr-check.mjs
  quest: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4 Chrome/142.0.0.0 VR Safari/537.36' },
};

function commit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: path.join(HERE, '..'), encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}+未コミット` : sha;
  } catch {
    return null;
  }
}

fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(pathToFileURL(path.join(HERE, '../node_modules/playwright-core/index.mjs')).href);
// --cold: 1 件ごとに新しいブラウザで開く。描き方の命令(シェーダー)の作り置きが無い、初めて開く人に近い「最初のコマ」になる
const COLD = argv.includes('--cold');
const launch = () =>
  chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required'],
  });
const shared = COLD ? null : await launch();
const sha = commit();
const rows = [];
let guarded = false;
for (const view of VIEWS) {
  const spec = VIEW_SPECS[view];
  if (!spec) throw new Error(`知らない幅です: ${view}(${Object.keys(VIEW_SPECS).join('・')})`);
  for (const id of CHARS) {
    const browser = shared ?? (await launch());
    const context = await browser.newContext(spec);
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('503')) problems.push(`console: ${m.text().slice(0, 160)}`);
    });
    await applyThrottle(page, THROTTLES[THROTTLE]);
    await page.goto(`http://127.0.0.1:${PORT}/?character=${encodeURIComponent(id)}&perf=1&perfsec=${SEC}&auto=0${EXTRA ? `&${EXTRA}` : ''}`, { waitUntil: 'load' });
    if (!guarded || COLD) {
      await stopIfSoftwareRenderer(page, browser); // CPU の描画なら、ここで止まる(新しいブラウザごとに見る)
      guarded = true;
    }
    let perf = null;
    try {
      await page.waitForFunction(() => window.__perfDone === true, null, { timeout: TIMEOUT_MS });
      perf = await page.evaluate(() => window.__perf);
    } catch (err) {
      problems.push(`測り終わらない: ${err.message.split('\n')[0]}`);
    }
    if (perf?.renderer?.software) {
      await stopIfSoftwareRenderer(page, browser);
    }
    const shot = path.join(OUT, `${id}_${view}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    if (perf?.k6 && !perf.k6.commit) perf.k6.commit = sha; // K6 の 1 行に、測った木のコミットを入れる(組み立てに VITE_COMMIT が無い時)
    const row = { id, view, throttle: THROTTLE, cold: COLD, query: EXTRA || null, commit: sha, ok: Boolean(perf) && problems.length === 0, problems, perf };
    fs.writeFileSync(path.join(OUT, `${id}_${view}.json`), JSON.stringify(row, null, 1));
    rows.push(row);
    await context.close();
    if (!shared) await browser.close();
    const p = perf;
    console.log(p
      ? `${id}\t${view}\tfps ${p.frames.fps_median}\tframe ${p.frames.frame_ms_median}ms p95 ${p.frames.frame_ms_p95}\tcpu ${p.frames.render_cpu_ms_median}ms\tcalls ${p.gl.calls}\ttri ${p.gl.triangles}\ttex ${p.gl.textures}\ttier ${p.tier?.name ?? '-'}\tMB ${(p.bytes.total.transfer / 1048576).toFixed(2)}\tready ${p.timing.ready_ms}ms\tloop ${p.timing.loop_start_ms ?? '-'}ms\tfirst ${p.timing.first_frame_ms ?? '-'}ms${THROTTLE !== 'none' ? `\t${THROTTLE}` : ''}${problems.length ? `\t問題 ${problems.length}` : ''}`
      : `${id}\t${view}\t測れなかった\t${problems.join(' / ')}`);
  }
}
await shared?.close();
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ commit: sha, measured_at: new Date().toISOString(), throttle: THROTTLE, throttle_spec: THROTTLES[THROTTLE], cold: COLD, rows }, null, 1));
const bad = rows.filter((r) => !r.ok);
console.log(`済み: ${rows.length - bad.length}/${rows.length} 件。出力: ${path.resolve(OUT)}`);
process.exit(bad.length ? 1 : 0);
