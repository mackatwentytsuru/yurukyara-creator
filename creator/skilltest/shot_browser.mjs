// ブラウザ(three.js、creator/viewer)で、pack を実際に描いた絵を撮る。見る人が見る絵で質感を判定するための道具。
//
// 使い方: node creator/skilltest/shot_browser.mjs <serve のポート> <character.json の URL(/trial/... など)> <出力フォルダ> [--lift 0〜1]
//   例: node creator/skilltest/shot_browser.mjs 8777 /trial/h_ear/p1_sonnet_medium/pack/character.json <出力フォルダ>
// 出力: <出力フォルダ>/browser_front.png、browser_q.png(斜め)、browser_close.png(顔のアップ)。1024px 四方、背景は白に近い。
// 前提: creator/viewer/serve.py が動いている(--mount で試しのフォルダを配る)。Chrome が入っている。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { GPU_ARGS, assertGpu } from './gpu_only.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [port, url, outDir] = process.argv.slice(2, 5);
const li = process.argv.indexOf('--lift');
const lift = li > 0 ? process.argv[li + 1] : null; // 明るさの持ち上げを上書きして撮る(試し用)
const fi = process.argv.indexOf('--fur');
const fur = fi > 0 ? encodeURIComponent(process.argv[fi + 1]) : null; // 毛の殻を足して撮る(試し用)。JSON で渡す
const SETTLE_FRAMES = 8; // 毛の殻を CPU で描くと 1 コマに数秒かかる。動きは実時間で進むので、待つコマは少なくてよい
const CAMERA_FRAMES = 2;
const SHOT_TIMEOUT_MS = 180000;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  // 毛の殻で三角形が数十万になると CPU での 1 コマが長く、GPU の見張りに落とされる(Target crashed)。撮影では見張りを切る
  // GPU(d3d11)で描く。CPU の描画は使わない(メイン PC の CPU を占めるため。GPU の札を取ってから使う)
  args: GPU_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
console.log('WebGL の描画役:', await assertGpu(page));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${port}/creator/viewer/index.html?c=${url}&shot=1${lift !== null ? '&lift=' + lift : ''}${fur !== null ? '&fur=' + fur : ''}`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 });
} catch (e) {
  console.log('読み込めない。エラー:', JSON.stringify(errors).slice(0, 800));
  await browser.close();
  process.exit(1);
}
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); // 毛の殻の写真など、あとから読む絵を待つ。待ちきれなくても撮る
// パネルを隠し、背景を白に近づけ、マウス追従を切る
await page.evaluate(() => {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('look').checked = false;
});
async function frame(n = 8) {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
// 撮影中はまばたきを止める(目を閉じた瞬間が写ると、形の判定を誤らせる)
await page.evaluate(() => { const c = window.__c; c.blinkTimer = 1e9; c.blinkT = -1; c.blink = 0; });
await frame(SETTLE_FRAMES);
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
  await frame(CAMERA_FRAMES);
  await page.screenshot({ path: path.join(outDir, name), timeout: SHOT_TIMEOUT_MS });
}
const h = info.h;
// 球や箱の胴は高さより横に広い。高さだけでカメラを決めると手が切れるので、広いほうに合わせて引く
const width = await page.evaluate(() => {
  let min = Infinity;
  let max = -Infinity;
  window.__c.object3d.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const e = o.matrixWorld.elements;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      min = Math.min(min, wx);
      max = Math.max(max, wx);
    }
  });
  return max - min;
});
const s = Number.isFinite(width) ? Math.max(h, width) : h;
// 全身は、元の絵と同じくらいの大きさで撮る(小さいと毛が画素より細くなり、砂に見える)
await snap('browser_front.png', [0, h * 0.55, s * 2.1], [0, h * 0.5, 0], 30);
await snap('browser_q.png', [s * 1.05, h * 0.6, s * 1.7], [0, h * 0.5, 0], 30);
await snap('browser_close.png', [0, h * 0.62, s * 1.7], [0, h * 0.62, 0], 28);
fs.writeFileSync(path.join(outDir, 'browser_info.json'), JSON.stringify({ ...info, errors }, null, 1));
await browser.close();
console.log('撮った:', outDir, JSON.stringify(info), errors.length ? 'エラー ' + errors.length : '');
