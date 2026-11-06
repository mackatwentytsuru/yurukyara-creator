// 重さを測る(L0)。会話サーバーが配るページを ?perf=1 で開き、キャラごと・画面の幅ごとに window.__perf を集める。
//   npm run build && PORT=8799 npm run server        (鍵は要らない。測りでは話さない)
//   node scripts/measure-render.mjs --port 8799 --out <出力のフォルダ> [--characters yokoso,robo] [--views pc,phone] [--sec 6] [--query tier=low]
// GPU で描く(gpuGuard.js の GPU_ARGS)。WebGL が CPU(SwiftShader)なら、その場で止める。GPU の札と鍵を取ってから流す。
// 分かるのは、この PC の GPU での数字。スマホの幅は「幅と画素の密度だけ」をまねた物で、スマホの実機の速さではない(重さの表では別の行)。
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
const TIMEOUT_MS = (SEC + 40) * 1000;

const VIEW_SPECS = {
  pc: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  // 幅 390・密度 3 は今のふつうの iPhone の画面。描く画素の倍率は stage が 2 までに抑える
  // 名乗りも iPhone にして、端末の段(stage/tiers.js)がスマホの段を選ぶかも確かめる
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
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
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required'],
});
const sha = commit();
const rows = [];
let guarded = false;
for (const view of VIEWS) {
  const spec = VIEW_SPECS[view];
  if (!spec) throw new Error(`知らない幅です: ${view}(pc か phone)`);
  for (const id of CHARS) {
    const context = await browser.newContext(spec);
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('503')) problems.push(`console: ${m.text().slice(0, 160)}`);
    });
    await page.goto(`http://127.0.0.1:${PORT}/?character=${encodeURIComponent(id)}&perf=1&perfsec=${SEC}&auto=0${EXTRA ? `&${EXTRA}` : ''}`, { waitUntil: 'load' });
    if (!guarded) {
      await stopIfSoftwareRenderer(page, browser); // CPU の描画なら、ここで止まる
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
    const row = { id, view, commit: sha, ok: Boolean(perf) && problems.length === 0, problems, perf };
    fs.writeFileSync(path.join(OUT, `${id}_${view}.json`), JSON.stringify(row, null, 1));
    rows.push(row);
    await context.close();
    const p = perf;
    console.log(p
      ? `${id}\t${view}\tfps ${p.frames.fps_median}\tframe ${p.frames.frame_ms_median}ms p95 ${p.frames.frame_ms_p95}\tcpu ${p.frames.render_cpu_ms_median}ms\tcalls ${p.gl.calls}\ttri ${p.gl.triangles}\ttex ${p.gl.textures}\ttier ${p.tier?.name ?? '-'}\tMB ${(p.bytes.total.transfer / 1048576).toFixed(2)}\tready ${p.timing.ready_ms}ms${problems.length ? `\t問題 ${problems.length}` : ''}`
      : `${id}\t${view}\t測れなかった\t${problems.join(' / ')}`);
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ commit: sha, measured_at: new Date().toISOString(), rows }, null, 1));
const bad = rows.filter((r) => !r.ok);
console.log(`済み: ${rows.length - bad.length}/${rows.length} 件。出力: ${path.resolve(OUT)}`);
process.exit(bad.length ? 1 : 0);
