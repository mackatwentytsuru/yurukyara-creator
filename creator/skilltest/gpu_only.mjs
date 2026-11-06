// 作る道のブラウザの道具は、WebGL を GPU で描く。CPU の描画(SwiftShader など)には落とさない(2026-11-06)。
// 理由: CPU で 3D を描くと大きな PC の CPU を占め、熱くなる。GPU を使う前に、機械の札と GPU の鍵を取る。
// 使い方: import { GPU_ARGS, assertGpu } from '<この場所>/gpu_only.mjs';
//   chromium.launch({ args: [...GPU_ARGS, ...] }) → const page = await browser.newPage(); await assertGpu(page);
// assertGpu は描画役の名前を読み、CPU の描画なら止める(例外)。名前を返す(記録用)。
export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

const CPU_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

export async function assertGpu(page) {
  const name = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'WebGL なし';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  if (CPU_RENDERERS.test(name) || name === 'WebGL なし') {
    throw new Error(`WebGL が GPU で描かれていない(${name})。CPU の描画には落とさないので止めます`);
  }
  return name;
}
