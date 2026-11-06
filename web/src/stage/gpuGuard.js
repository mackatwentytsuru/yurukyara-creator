// 試験・録画・測りの道具が、WebGL を CPU(SwiftShader など)で描いていないかを確かめる。
// CPU の描画は、PC の CPU を長く占め、測った数字も実機と合わない。見つけたら、その場で止める。
// ブラウザの中でも node の中でも読める(three も他の部品も使わない)。
//   import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';
//   const browser = await chromium.launch({ args: [...GPU_ARGS, ...] });
//   await page.goto(url); await stopIfSoftwareRenderer(page, browser);  // ← 止める 1 行

/** Chrome を GPU で描かせる起動の引数。OS ごとに描画の裏側(ANGLE)を選ぶ */
export function gpuArgs(platform = globalThis.process?.platform ?? '') {
  if (platform === 'darwin') return ['--use-angle=metal', '--ignore-gpu-blocklist'];
  if (platform === 'win32') return ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  return ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
}
export const GPU_ARGS = gpuArgs();

// CPU で描く描画役の名前。SwiftShader(Chrome)・llvmpipe と softpipe(Linux の Mesa)・Microsoft Basic Render Driver(WARP)
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render driver|\bwarp\b/i;

/** 描画役の名前が CPU の描画か。名前が取れない(WebGL が無い)ときも、描けないので true */
export function isSoftwareRenderer(name) {
  if (!name || typeof name !== 'string') return true;
  return SOFTWARE_RE.test(name);
}

/** いまのページの WebGL の描画役の名前を読む(ページの中で動く関数)。WebGL が無ければ null */
export function readRendererInPage() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name);
  } catch {
    return null;
  }
}

/**
 * Playwright のページで描画役を確かめ、CPU の描画なら止める。戻り値は描画役の名前。
 * 止めるとき: ブラウザを閉じ、理由を出して、終わりの番号 3 で終わる(exit: false なら例外を投げる)。
 * 試しに CPU の描画を許すのは、ALLOW_SOFTWARE_GL=1 のときだけ(使わない決まり。理由を記録に残すこと)。
 */
export async function stopIfSoftwareRenderer(page, browser = null, { exit = true } = {}) {
  const name = await page.evaluate(readRendererInPage);
  if (!isSoftwareRenderer(name)) return name;
  if (globalThis.process?.env?.ALLOW_SOFTWARE_GL === '1') {
    console.warn(`注意: CPU の描画(${name ?? 'WebGL なし'})のまま続けます(ALLOW_SOFTWARE_GL=1)`);
    return name;
  }
  const message = `止めました: WebGL が CPU で描かれています(${name ?? 'WebGL なし'})。GPU の札と鍵を取り、GPU の引数(gpuGuard.js の GPU_ARGS)で起動し直してください`;
  await browser?.close().catch(() => {});
  if (!exit) throw new Error(message);
  console.error(message);
  globalThis.process?.exit(3);
  return name;
}
