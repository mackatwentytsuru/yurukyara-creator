// ブラウザ(three.js、creator/viewer)で、pack を実際に描いた絵を撮る。見る人が見る絵で質感を判定するための道具。
//
// 使い方: node creator/skilltest/shot_browser.mjs <serve のポート> <character.json の URL(/trial/... など)> <出力フォルダ> [--lift 0〜1]
//   例: node creator/skilltest/shot_browser.mjs 8777 /trial/h_ear/p1_sonnet_medium/pack/character.json <出力フォルダ>
// 出力: <出力フォルダ>/browser_front.png、browser_q.png(斜め)、browser_close.png(顔のアップ)。1024px 四方、背景は白に近い。
// 前提: creator/viewer/serve.py が動いている(--mount で試しのフォルダを配る)。Chrome が入っている。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [port, url, outDir] = process.argv.slice(2, 5);
const li = process.argv.indexOf('--lift');
const lift = li > 0 ? process.argv[li + 1] : null; // 明るさの持ち上げを上書きして撮る(試し用)
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${port}/creator/viewer/index.html?c=${url}&shot=1${lift !== null ? '&lift=' + lift : ''}`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 });
} catch (e) {
  console.log('読み込めない。エラー:', JSON.stringify(errors).slice(0, 800));
  await browser.close();
  process.exit(1);
}
// パネルを隠し、背景を白に近づけ、マウス追従を切る
await page.evaluate(() => {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('look').checked = false;
});
async function frame(n = 8) {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
await frame(30);
const info = await page.evaluate(() => {
  const c = window.__c;
  return { h: c.heightM ?? 1, motions: c.motionNames, morphs: c.morphMeshes?.length ?? 0 };
});
async function snap(name, camPos, lookAt, fov) {
  await page.evaluate(([p, l, f]) => {
    const cam = window.__camera;
    if (cam) {
      cam.position.set(...p);
      cam.lookAt(...l);
      if (f) { cam.fov = f; cam.updateProjectionMatrix(); }
    }
  }, [camPos, lookAt, fov]);
  await frame(6);
  await page.screenshot({ path: path.join(outDir, name) });
}
const h = info.h;
await snap('browser_front.png', [0, h * 0.55, h * 3.2], [0, h * 0.5, 0], 30);
await snap('browser_q.png', [h * 1.6, h * 0.6, h * 2.6], [0, h * 0.5, 0], 30);
await snap('browser_close.png', [0, h * 0.62, h * 1.7], [0, h * 0.62, 0], 28);
fs.writeFileSync(path.join(outDir, 'browser_info.json'), JSON.stringify({ ...info, errors }, null, 1));
await browser.close();
console.log('撮った:', outDir, JSON.stringify(info), errors.length ? 'エラー ' + errors.length : '');
