// 視線の回転が体の骨に積み上がらないことを、ブラウザで数百コマ回して確かめる。
//
// 使い方: node creator/skilltest/test_look_drift.mjs <serve のポート> <character.json の URL> [--frames 600]
// 終わりの番号: 0 = 合格、1 = 上限を超えた、2 = 読み込めない。
// 測り方: 同じ動きを、まず視線なしで回して、骨の角度の最大を測る(これが動きの分)。次に、横と上を見続けたまま回す。
// 体の骨の角度は「動きの分 + 視線の上限」を超えてはいけない。動きの再生中と、動きが終わって人を見続けている間の両方を見る。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { GPU_ARGS, assertGpu } from './gpu_only.mjs';

const [port, url] = process.argv.slice(2, 4);
const fi = process.argv.indexOf('--frames');
const FRAMES = fi > 0 ? Number(process.argv[fi + 1]) : 600;
const MARGIN_DEG = 1.0;
const DT = 1 / 30;

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: GPU_ARGS,
});
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
console.log('WebGL の描画役:', await assertGpu(page));
await page.goto(`http://127.0.0.1:${port}/creator/viewer/index.html?c=${url}&shot=1`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
} catch {
  console.log('読み込めない');
  await browser.close();
  process.exit(2);
}

const report = await page.evaluate(
  ({ FRAMES, DT }) => {
    const c = window.__c;
    document.getElementById('look').checked = false;
    const bone = c.lookBone;
    if (!bone) return { skipped: true };
    const rest = c.lookRest.clone();
    const angle = () => (bone.quaternion.angleTo(rest) * 180) / Math.PI;
    const motions = c.motionNames.filter((m) => m !== 'idle' && m !== 'talk');
    const step = (lookAt) => {
      c.lookAt(lookAt);
      c.update(DT);
      return angle();
    };
    // 動きを順に流して、そのあと見続ける。視線の有無を変えて 2 回通す
    const run = (lookAt) => {
      const out = { playing: 0, holding: 0, trace: [] };
      for (const m of motions) {
        c.play(m);
        for (let i = 0; i < FRAMES / (motions.length + 1); i += 1) {
          out.playing = Math.max(out.playing, step(lookAt));
        }
      }
      for (let i = 0; i < FRAMES; i += 1) {
        const a = step(lookAt);
        out.holding = Math.max(out.holding, a);
        if (i % 100 === 0) out.trace.push(Math.round(a * 10) / 10);
      }
      return out;
    };
    c.lookBone = null;
    const base = run(null);
    c.lookBone = bone;
    const yawDeg = (c.maxYaw * 180) / Math.PI;
    const pitchDeg = (c.maxPitch * 180) / Math.PI;
    // 視線で体が回る割合は rigRuntime の 0.6
    const lookLimit = Math.hypot(yawDeg, pitchDeg) * 0.6;
    const gaze = run([3, 3, 1]);
    return { bone: bone.name, motions, base, gaze, lookLimit };
  },
  { FRAMES, DT },
);
await browser.close();

if (report.skipped) {
  console.log('視線で動かす骨がないので、見ることがない');
  process.exit(0);
}
const limit = Math.max(report.base.playing, report.base.holding) + report.lookLimit + MARGIN_DEG;
const worst = Math.max(report.gaze.playing, report.gaze.holding);
console.log(`骨 ${report.bone} / 動き ${report.motions.join('、')}`);
console.log(`動きだけの最大 ${Math.max(report.base.playing, report.base.holding).toFixed(1)} 度、視線の上限 ${report.lookLimit.toFixed(1)} 度 → 上限 ${limit.toFixed(1)} 度`);
console.log(`視線あり: 再生中 ${report.gaze.playing.toFixed(1)} 度、見続けている間 ${report.gaze.holding.toFixed(1)} 度(100 コマごと: ${report.gaze.trace.join(', ')})`);
if (worst > limit) {
  console.log(`NG: ${worst.toFixed(1)} 度が上限を超えた。視線の回転が積み上がっている`);
  process.exit(1);
}
console.log('OK: 積み上がっていない');
