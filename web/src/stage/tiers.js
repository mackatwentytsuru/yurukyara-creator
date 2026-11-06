// 端末の段(軽いのにきれい)。端末の力に合わせて、描く画素の倍率と毛の層の数を変える。
// PC(high)は今までと同じ見た目。スマホと弱い端末だけ軽くする。?tier=high|mid|low|xr で決め打ちできる(試しと撮影用)。
// 段の決め方と数字の根拠は docs/重さの表.md。

/** 段ごとの設定。furLayers が null なら、キャラの character.json のまま(既定は 12 層) */
export const TIERS = {
  high: { pixelRatioMax: 2, furLayers: null, label: 'PC' },
  mid: { pixelRatioMax: 1.5, furLayers: 6, label: 'スマホ' },
  low: { pixelRatioMax: 1, furLayers: 3, label: '弱い端末' },
  xr: { pixelRatioMax: 1, furLayers: 4, label: 'ヘッドセット' }, // 毛の層は重ね描きなので、VR では減らす(前からの値)
};

const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile/i;
const HEADSET_RE = /OculusBrowser|Quest|Pico/i;
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/**
 * 段を決める。引数は全部、外から渡す(試験できるように、ブラウザの物を直接読まない)。
 * @param {{ua?:string, renderer?:string|null, maxTouchPoints?:number, deviceMemory?:number, cores?:number, forced?:string|null, headset?:boolean}} env
 * @returns {{name:string, reason:string} & typeof TIERS.high}
 */
export function detectTier(env = {}) {
  const pick = (name, reason) => ({ name, reason, ...TIERS[name] });
  const ua = env.ua ?? '';
  if (env.forced && TIERS[env.forced]) return pick(env.forced, 'URL の tier で決め打ち');
  if (env.headset || HEADSET_RE.test(ua)) return pick('xr', 'ヘッドセットのブラウザ');
  if (env.renderer && SOFTWARE_RE.test(env.renderer)) return pick('low', 'CPU の描画');
  // iPad の Safari は Mac と名乗るので、指で触れるかで見分ける
  const mobile = MOBILE_RE.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1);
  const weak = (env.deviceMemory && env.deviceMemory <= 3) || (env.cores && env.cores <= 4);
  if (mobile) return weak ? pick('low', 'スマホ(メモリか芯が少ない)') : pick('mid', 'スマホ');
  if (weak) return pick('mid', 'PC(メモリか芯が少ない)');
  return pick('high', 'PC');
}

/** ブラウザの中で、いまの端末の段を決める。renderer は three の WebGLRenderer(描画役の名前を読む) */
export function detectTierInBrowser(renderer, params) {
  let rendererName = null;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    rendererName = null;
  }
  return {
    ...detectTier({
      ua: navigator.userAgent,
      renderer: rendererName,
      maxTouchPoints: navigator.maxTouchPoints,
      deviceMemory: navigator.deviceMemory,
      cores: navigator.hardwareConcurrency,
      forced: params.get('tier'),
      headset: params.get('headset') === '1',
    }),
    rendererName,
  };
}

/** 段の設定を描画に当てる。毛の層は、キャラを読むときに loadCharacter へ渡す(戻り値) */
export function applyTier(stage, tier, devicePixelRatio = 1) {
  stage.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier.pixelRatioMax));
  stage.resize();
  return tier.furLayers ? { furLayers: tier.furLayers } : {};
}
