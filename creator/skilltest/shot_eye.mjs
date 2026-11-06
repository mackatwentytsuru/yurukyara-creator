// ブラウザ(three.js、creator/viewer)で、キャラの「目の寄り」と「胸から上」を、本番と同じ描き方で撮る。目の周りの前後比べ用。
//
// 使い方: CHECK_GPU=1 node creator/skilltest/shot_eye.mjs <serve のポート> <出力フォルダ> [id,id,...] [前の shot_eye_info.json(同じカメラで撮る)]
//   例: CHECK_GPU=1 node creator/skilltest/shot_eye.mjs 8777 before yokoso,robo,f_led,d_lantern
// 出力: <出力フォルダ>/<id>_eye.png(顔の中心を大きく)、<id>_chest.png(胸から上)。1024px 四方、背景は薄い灰色。
// 前提: creator/viewer/serve.py が動いている。CHECK_GPU=1 なら GPU(d3d11)で描く(作業用 PC では GPU の札を先に取る)。
// 前後で同じ絵になるよう、動きを時刻 0 で止め、まばたきを止め、視線を正面の固定の目標へ向ける。カメラは顔の部品(Eyes / Face)の箱から決める。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { GPU_ARGS, assertGpu } from './gpu_only.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [port, outDir, idsArg, fixedPath] = process.argv.slice(2, 6);
const fixed = fixedPath ? JSON.parse(fs.readFileSync(fixedPath, 'utf-8')) : null; // 前の撮影の shot_eye_info.json。同じカメラで撮り直す(姿勢の数 mm のずれで絵が動かないように)
const ids = (idsArg ?? 'yokoso,robo,f_led,d_lantern').split(',');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: GPU_ARGS,
});
const summary = {};
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  console.log('WebGL の描画役:', await assertGpu(page));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/creator/viewer/index.html?c=../../characters/${id}/character.json&shot=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 40000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const frame = async (n = 8) => { for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };
  await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    // 視線は切らない: 切ると IdleGaze が乱数で目を動かし、撮るたびに目の位置が変わる。入れたままなら、正面の固定の目標を見る
    const c = window.__c;
    c.blinkTimer = 1e9; c.blinkT = -1; c.blink = 0;
  });
  await page.waitForTimeout(8000); // 視線の戻りは実時間で進む。コマ数でなく時間で待つ(撮るたびに目の位置が数 mm ずれるのを防ぐ)
  await frame(8);
  // 動きを時刻 0 で止める(前後で同じ姿勢にする)
  await page.evaluate(() => { const m = window.__c.mixer; m.setTime(0); m.timeScale = 0; });
  await frame(4);
  // 目の位置: 目の骨があればその中心(ようこそくん・ロボくん)。無ければ顔の面(Face)の箱(パネルくん・提灯くん)
  const geo = await page.evaluate(() => {
    const c = window.__c;
    c.object3d.updateWorldMatrix(true, true);
    const out = { h: c.heightM ?? 1, bones: [], face: null };
    for (const b of c.eyeBones ?? []) {
      const v = b.getWorldPosition(b.position.clone());
      out.bones.push([v.x, v.y, v.z]);
    }
    c.object3d.traverse((o) => {
      if (!o.isMesh || o.name !== 'Face') return;
      const g = o.geometry; g.computeBoundingBox();
      const bb = g.boundingBox; const e = o.matrixWorld.elements;
      const xs = []; const ys = []; const zs = [];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        xs.push(e[0] * x + e[4] * y + e[8] * z + e[12]);
        ys.push(e[1] * x + e[5] * y + e[9] * z + e[13]);
        zs.push(e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      out.face = { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], z: [Math.min(...zs), Math.max(...zs)] };
    });
    return out;
  });
  let cx; let cy; let cz; let span;
  if (geo.bones.length >= 2) {
    const [a, b] = geo.bones;
    cx = (a[0] + b[0]) / 2; cy = (a[1] + b[1]) / 2; cz = Math.max(a[2], b[2]);
    span = Math.abs(a[0] - b[0]) * 2.6;
  } else {
    const f = geo.face;
    cx = (f.x[0] + f.x[1]) / 2; cz = f.z[1];
    cy = (f.y[0] + f.y[1]) / 2 + (f.y[1] - f.y[0]) * 0.12; // 目は面の中心より少し上
    span = (f.x[1] - f.x[0]) * 0.9;
  }
  if (fixed?.[id]) { [cx, cy, cz] = fixed[id].center; span = fixed[id].span; }
  const fov = 28;
  const dist = (vis) => vis / (2 * Math.tan((fov / 2) * Math.PI / 180));
  const snap = async (name, pos, look) => {
    await page.evaluate(([p, l, f]) => {
      const cam = window.__camera;
      cam.position.set(...p); cam.lookAt(...l); cam.fov = f; cam.updateProjectionMatrix();
    }, [pos, look, fov]);
    await frame(3);
    await page.screenshot({ path: path.join(outDir, name), timeout: 180000 });
  };
  const h = geo.h;
  // 斜めから見た寄り(EYE_YAW 度、EYE_PITCH 度。目の板の浮きや、縁の毛を斜めで確かめる用。指定が無ければ正面)
  const yaw = (Number(process.env.EYE_YAW ?? 0) * Math.PI) / 180;
  const pit = (Number(process.env.EYE_PITCH ?? 0) * Math.PI) / 180;
  const dd = dist(span);
  const suffix = process.env.EYE_YAW || process.env.EYE_PITCH ? `_y${process.env.EYE_YAW ?? 0}p${process.env.EYE_PITCH ?? 0}` : '';
  await snap(`${id}_eye${suffix}.png`, [cx + dd * Math.sin(yaw) * Math.cos(pit), cy + dd * Math.sin(pit), cz + dd * Math.cos(yaw) * Math.cos(pit)], [cx, cy, cz]);
  if (suffix) { summary[id] = { center: [cx, cy, cz], span, errors }; await page.close(); continue; }
  const ty = cy - 0.12 * h;
  await snap(`${id}_chest.png`, [cx, ty, cz + dist(0.62 * h)], [cx, ty, cz]);
  summary[id] = { center: [cx, cy, cz].map((v) => +v.toFixed(4)), span: +span.toFixed(4), errors };
  await page.close();
}
fs.writeFileSync(path.join(outDir, 'shot_eye_info.json'), JSON.stringify(summary, null, 1));
await browser.close();
console.log('撮った:', outDir, JSON.stringify(summary));
