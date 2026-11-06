// ブラウザ(three.js、creator/viewer)で、キャラが 1 回転する動画と、育つ帯に使う正面の絵 2 枚を作る。動画の素材用。
//
// 使い方: node creator/skilltest/turntable.mjs <serve のポート> <character.json の URL> <出力フォルダ>
//           [--seconds 6] [--fps 30] [--size 1920x1080] [--bg f2f2f2] [--stills] [--no-video]
//   例: node creator/skilltest/turntable.mjs 8777 /trial/yokoso/character.json <出力フォルダ> --stills
// 出力: <出力>/turntable.mp4(H.264・yuv420p・音なし・メタデータなし。背景は 1 色)、
//       key_000.png など(確かめ用のコマ 4 枚)、--stills のとき still_color.png(色と質感)と still_clay.png(色を外した形)。
//       still は白地・正面。info.json(描画役・コマ数・カメラ・かかった秒・エラー)。
// 時間: requestAnimationFrame と performance.now を差し替え、1 コマずつ 1/fps 秒だけ進める。
//       撮る速さに関係なく、待つ間の動き(idle)とまばたきが動画の時間どおりに進む。
// 前提: creator/viewer/serve.py が動いている(--mount で characters を配る)。Chrome。ffmpeg(PATH か 環境変数 FFMPEG)。
//       GPU で描く(CPU の描画なら止まる)。大きな PC では機械の札(GPU)の中で流す。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { GPU_ARGS, assertGpu } from './gpu_only.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = '使い方: node creator/skilltest/turntable.mjs <ポート> <character.json の URL> <出力フォルダ> [--seconds 6] [--fps 30] [--size 1920x1080] [--bg f2f2f2] [--stills] [--no-video]';
const opt = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(name);

const [port, url, outDir] = process.argv.slice(2, 5);
if (!port || !url || !outDir || outDir.startsWith('--')) {
  console.error(USAGE);
  process.exit(2);
}
const SECONDS = Number(opt('--seconds', '6'));
const FPS = Number(opt('--fps', '30'));
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const BG = '#' + String(opt('--bg', 'f2f2f2')).replace(/^#/, '');
const STILLS = flag('--stills');
const VIDEO = !flag('--no-video');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FRAMES = Math.round(SECONDS * FPS);
if (!(FRAMES > 0) || !(W > 0) || !(H > 0)) {
  console.error('秒・fps・大きさが読めない。' + USAGE);
  process.exit(2);
}
const WARM_FRAMES = 20; // 動きの重みが入りきる(fadeIn)まで、撮らずに進めるコマ
const FOV_DEG = 30;
const FILL_TURN = 0.8; // 回る動画: 外接の円柱が画面の高さ(と幅)に占める割合
const FILL_STILL = 0.9; // 正面の絵: 体の高さが画面の高さに占める割合
const KEY_FRACS = [0, 0.125, 0.25, 0.5]; // 確かめ用に残すコマ(1 回転のうちの割合)
const FIT_ANGLES = 36; // カメラの距離を決めるときに調べる向きの数(10 度ごと)
const MAX_FIT_POINTS = 30000; // 距離を決めるのに使う頂点の数の上限(間引く)
const CLAY_RGB = [0.8, 0.8, 0.8]; // 形だけの絵の色(線形の値)
const LOAD_TIMEOUT_MS = 40000;

fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: GPU_ARGS, // GPU(d3d11)で描く。CPU の描画は使わない
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const renderer = await assertGpu(page);
console.log('WebGL の描画役:', renderer);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

async function fail(msg) {
  console.log(msg, JSON.stringify(errors).slice(0, 800));
  await browser.close();
  process.exit(1);
}

await page.goto(`http://127.0.0.1:${port}/creator/viewer/index.html?c=${url}&shot=1`);
try {
  // 待ち方は時間の間隔で(requestAnimationFrame はこのあと差し替えるので使わない)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: LOAD_TIMEOUT_MS, polling: 100 });
} catch {
  await fail('読み込めない。エラー:');
}
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); // あとから読む絵(毛の殻など)を待つ

// パネルを隠し、マウス追従と口の自動を切り、背景を 1 色にする
await page.evaluate((bg) => {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('look').checked = false;
  const auto = document.getElementById('auto');
  if (auto) auto.checked = false;
  window.__scene.background.set(bg);
}, BG);

// 時間を止める: 描く回しを自分の列に入れ、__step(ms) で 1 コマずつ進める
await page.evaluate(() => {
  const f = { now: performance.now(), queue: [] };
  window.__tt = f;
  Object.defineProperty(performance, 'now', { value: () => f.now, configurable: true });
  window.requestAnimationFrame = (cb) => {
    f.queue.push(cb);
    return f.queue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => {
    f.now += ms;
    const q = f.queue;
    f.queue = [];
    for (const cb of q) cb(f.now);
    return q.length;
  };
});
try {
  await page.waitForFunction(() => window.__tt.queue.length > 0, null, { timeout: 5000, polling: 50 });
} catch {
  await fail('描く回しを止められない(requestAnimationFrame の差し替えが効かない)。');
}
const step = (ms) => page.evaluate((v) => window.__step(v), ms);
for (let i = 0; i < WARM_FRAMES; i++) await step(1000 / FPS);

// 体の大きさ(休みの姿勢の頂点から)。頂点は間引いて __ttPts に持ち、カメラの距離をちょうどに合わせる(__fit)
const geo = await page.evaluate((maxPts) => {
  const c = window.__c;
  c.object3d.rotation.y = 0;
  c.object3d.updateMatrixWorld(true);
  let total = 0;
  c.object3d.traverse((o) => {
    if (o.isMesh && o.visible && !/_fur\d+$/.test(o.name)) total += o.geometry.attributes.position.count;
  });
  const stride = Math.max(1, Math.ceil(total / maxPts));
  const pts = [];
  const b = { r: 0, xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity, zmax: -Infinity };
  c.object3d.traverse((o) => {
    if (!o.isMesh || !o.visible || /_fur\d+$/.test(o.name)) return;
    const p = o.geometry.attributes.position;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < p.count; i += stride) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      pts.push(wx, wy, wz);
      b.r = Math.max(b.r, Math.hypot(wx, wz));
      b.xmin = Math.min(b.xmin, wx);
      b.xmax = Math.max(b.xmax, wx);
      b.ymin = Math.min(b.ymin, wy);
      b.ymax = Math.max(b.ymax, wy);
      b.zmax = Math.max(b.zmax, wz);
    }
  });
  window.__ttPts = pts;
  // カメラ (0, cy+elev, d) から (0, cy, 0) を見て、nAngles の向きに回した全部の点が、画面の fill の中に入る最小の d
  window.__fit = (fill, aspect, fovDeg, nAngles, cy, elev) => {
    const P = window.__ttPts;
    const t = Math.tan((fovDeg * Math.PI) / 360);
    const fits = (d) => {
      const fl = Math.hypot(elev, d);
      const fx = 0;
      const fy = -elev / fl;
      const fz = -d / fl;
      const rl = Math.hypot(fz, fx);
      const rx = -fz / rl;
      const rz = fx / rl;
      const ux = -rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy;
      for (let a = 0; a < nAngles; a++) {
        const th = (2 * Math.PI * a) / nAngles;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i] * cs + P[i + 2] * sn;
          const vy = P[i + 1] - (cy + elev);
          const vz = -P[i] * sn + P[i + 2] * cs - d;
          const zc = x * fx + vy * fy + vz * fz;
          if (zc <= 0.01) return false;
          if (Math.abs((x * rx + vz * rz) / (zc * t * aspect)) > fill) return false;
          if (Math.abs((x * ux + vy * uy + vz * uz) / (zc * t)) > fill) return false;
        }
      }
      return true;
    };
    let lo = 0.01;
    let hi = 1;
    while (!fits(hi)) {
      hi *= 1.5;
      if (hi > 500) return null;
    }
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  return { ...b, points: pts.length / 3, stride, heightM: c.heightM ?? null, name: c.name ?? c.id };
}, MAX_FIT_POINTS);
if (!Number.isFinite(geo.r) || !(geo.ymax > geo.ymin)) await fail('体の大きさが測れない: ' + JSON.stringify(geo));

const hh = geo.ymax - geo.ymin;
const cy = (geo.ymin + geo.ymax) / 2;
async function cameraFor(fill, nAngles) {
  // 少し上から見下ろす。回したどの向きでも fill の中に入る、いちばん近い距離
  const elev = hh * 0.08;
  const d = await page.evaluate((a) => window.__fit(...a), [fill, W / H, FOV_DEG, nAngles, cy, elev]);
  if (!(d > 0)) await fail('カメラの距離が決められない。');
  return { pos: [0, cy + elev, d], at: [0, cy, 0], fov: FOV_DEG, fill, angles: nAngles };
}
const setCamera = (cam) => page.evaluate((c) => {
  const k = window.__camera;
  k.fov = c.fov;
  k.position.set(...c.pos);
  k.lookAt(...c.at);
  k.updateProjectionMatrix();
}, cam);
const grab = async () => Buffer.from(await page.evaluate(() => document.querySelector('#stage canvas').toDataURL('image/png').split(',')[1]), 'base64');

const info = {
  renderer, character: geo.name, url, size: [W, H], fps: FPS, seconds: SECONDS, frames: VIDEO ? FRAMES : 0,
  background: BG, bounds: geo, keys: [], stills: [], errors,
};

if (VIDEO) {
  const cam = await cameraFor(FILL_TURN, FIT_ANGLES);
  info.camera_turn = cam;
  await setCamera(cam);
  const mp4 = path.join(outDir, 'turntable.mp4');
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '4', '-r', String(FPS),
    '-movflags', '+faststart', '-map_metadata', '-1', '-an', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg の終わりの番号 ' + code))));
  });
  const keyIdx = new Map(KEY_FRACS.map((f) => [Math.round(f * FRAMES), Math.round(f * 360)]));
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((a) => {
      window.__c.object3d.rotation.y = a;
    }, (2 * Math.PI * i) / FRAMES);
    await step(1000 / FPS);
    const png = await grab();
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (keyIdx.has(i)) {
      const name = `key_${String(keyIdx.get(i)).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(outDir, name), png);
      info.keys.push(name);
    }
  }
  ff.stdin.end();
  await done;
  info.video = 'turntable.mp4';
}

if (STILLS) {
  // 正面・白地。まばたきを止め、同じ時刻(同じ姿勢)で、色あり → 色を外した形 の順に撮る
  await page.evaluate(() => {
    const c = window.__c;
    c.object3d.rotation.y = 0;
    c.blinkTimer = 1e9;
    c.blinkT = -1;
    c.blink = 0;
    window.__scene.background.set('#ffffff');
  });
  const cam = await cameraFor(FILL_STILL, 1);
  info.camera_still = cam;
  await setCamera(cam);
  await step(1000 / FPS);
  await step(0);
  fs.writeFileSync(path.join(outDir, 'still_color.png'), await grab());
  info.stills.push('still_color.png');
  const clay = await page.evaluate((rgb) => {
    const c = window.__c;
    const faceMesh = c.face?.mesh ?? null; // 表の顔(光る顔・紙の顔)は「模様」なので、形の絵では隠す
    let base = null;
    c.object3d.traverse((o) => {
      if (!base && o.isMesh && o.material?.isMeshStandardMaterial) base = o.material;
    });
    if (!base) return { ok: false };
    const m = base.clone();
    for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap']) m[k] = null;
    m.color.setRGB(...rgb);
    m.emissive.setRGB(0, 0, 0);
    m.emissiveIntensity = 0;
    m.roughness = 0.85;
    m.metalness = 0;
    m.vertexColors = false;
    m.transparent = false;
    m.opacity = 1;
    m.alphaTest = 0;
    m.needsUpdate = true;
    let swapped = 0;
    let hidden = 0;
    c.object3d.traverse((o) => {
      if (!o.isMesh) return;
      if (o === faceMesh || /_fur\d+$/.test(o.name)) {
        o.visible = false;
        hidden++;
        return;
      }
      o.material = Array.isArray(o.material) ? o.material.map(() => m) : m;
      swapped++;
    });
    return { ok: true, swapped, hidden };
  }, CLAY_RGB);
  if (!clay.ok) await fail('形の絵の材質が作れない。');
  info.clay = clay;
  await step(0);
  fs.writeFileSync(path.join(outDir, 'still_clay.png'), await grab());
  info.stills.push('still_clay.png');
}

info.elapsed_s = Math.round((Date.now() - t0) / 100) / 10;
fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(info, null, 1));
await browser.close();
console.log('作った:', outDir, `${info.frames} コマ`, `${info.elapsed_s} 秒`, errors.length ? 'エラー ' + errors.length : '');
