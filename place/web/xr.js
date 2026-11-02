// 見せ方の 3 つ(screen / ar / vr)の切りかえ。入口は web/ にあり、ここは AR と VR の部分。
// 共通の決まりの「見せ方の 3 つ」と同じ名前。
//
// 調べた事実(2026-11-02、docs/devlog_場所.md に出どころ):
//  - iPhone の Safari に WebXR は無い。iPhone の AR は自作の殻アプリ(ARKit の上に透明な WKWebView)で、
//    その中では window.webkit.messageHandlers.arhost がある → nativeAR.js が姿勢を受け取る。
//  - Quest 3(Meta Quest Browser)は immersive-ar(パススルー)と immersive-vr が使える。
//  - requiredFeatures を 1 つでも満たせないと requestSession ごと失敗するので、機能は全部 optional にして、
//    入ったあとに session.enabledFeatures を見て分ける。
//  - マイクは、AR/VR に入る前の 2D の画面で許可を取っておく(session の中で許可ダイアログが出ると
//    どうなるかは資料が無い)。ここでは扱わない(会話の柱の仕事)。
import { hasNativeAR } from './nativeAR.js';

export const MODES = ['screen', 'ar', 'vr'];

/** 使えれば使う機能。mesh-detection は Quest の安定版での扱いが不明なので、使えたらの扱い。 */
export const OPTIONAL_FEATURES = {
  ar: ['local-floor', 'hit-test', 'anchors', 'plane-detection', 'mesh-detection', 'depth-sensing', 'hand-tracking'],
  vr: ['local-floor', 'hand-tracking'],
};

/**
 * どのモードが使えるかを調べる。
 * 'ar' は WebXR の immersive-ar(Quest・Android の Chrome)か、iPhone の殻アプリ(native)。
 * 戻り値の ar_kind: 'webxr' | 'native' | null
 */
export async function detectXR({ nav = globalThis.navigator, win = globalThis } = {}) {
  const native = hasNativeAR(win);
  if (!nav?.xr) {
    return {
      screen: true,
      ar: native,
      vr: false,
      ar_kind: native ? 'native' : null,
      reason: native ? '' : 'このブラウザには WebXR が無い(iPhone の Safari など)',
    };
  }
  const ask = (mode) => nav.xr.isSessionSupported(mode).catch(() => false);
  const [arWebxr, vr] = await Promise.all([ask('immersive-ar'), ask('immersive-vr')]);
  const ar = arWebxr || native;
  return {
    screen: true,
    ar,
    vr,
    ar_kind: arWebxr ? 'webxr' : native ? 'native' : null,
    reason: ar || vr ? '' : 'この端末は AR も VR も使えない',
  };
}

/**
 * 画面ごとの見え方を整える。AR は現実が背景なので scene.background を外して透明にする。
 * @returns {() => void} 元に戻す関数
 */
export function applyPresentation({ mode, scene, renderer, place, background }) {
  place?.setPresentation?.(mode);
  if (mode === 'ar') {
    scene.background = null;
    renderer.setClearAlpha(0);
  } else {
    scene.background = background ?? null;
    renderer.setClearAlpha(1);
  }
  return () => applyPresentation({ mode: 'screen', scene, renderer, place, background });
}

/** 頭(カメラ)のワールド位置。キャラの目線の的に使う。AR でも VR でも、render に渡した camera でよい。 */
export function headWorldPosition(camera, out) {
  return camera.getWorldPosition(out);
}

/**
 * WebXR の session を始める(Quest・Android)。iPhone の殻アプリは nativeAR.js を使う。
 * @returns {Promise<{session: XRSession, features: string[], floor: boolean, end: () => Promise<void>}>}
 */
export async function startXR({ renderer, mode, scene, place, background, nav = globalThis.navigator }) {
  const features = OPTIONAL_FEATURES[mode];
  if (!features) throw new Error(`mode は ar か vr: ${mode}`);
  const session = await nav.xr.requestSession(mode === 'ar' ? 'immersive-ar' : 'immersive-vr', {
    optionalFeatures: features,
  });
  const enabled = [...(session.enabledFeatures ?? [])];
  // enabledFeatures を返さない実装では、local-floor があるものとして扱う(Quest は返す)
  const floor = session.enabledFeatures ? enabled.includes('local-floor') : true;
  renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
  await renderer.xr.setSession(session);
  const restore = applyPresentation({ mode, scene, renderer, place, background });
  session.addEventListener('end', restore, { once: true });
  return { session, features: enabled, floor, end: () => session.end() };
}
