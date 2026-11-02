// AR(スマホ・Quest のパススルー)と VR を始める部分。
// 共通の決まりの「見せ方の 3 つ」: screen / ar / vr。入口は web/ にあり、ここは AR と VR の部分。
//
// 状態(2026-11-02 に確かめた事実は docs/devlog_場所.md):
//  - iPhone の Safari は WebXR に未対応。ここの ar は Android の Chrome と Quest 3 のブラウザ用。
//  - Quest 3 の実機でのテストはまだ。mesh-detection は optional に入れてあるだけ(使えたら使う)。

/** どのモードが使えるかを調べる。navigator.xr が無い(Safari など)ときは両方 false。 */
export async function detectXR(nav = globalThis.navigator) {
  if (!nav?.xr) return { screen: true, ar: false, vr: false, reason: 'このブラウザには WebXR が無い' };
  const ask = (mode) => nav.xr.isSessionSupported(mode).catch(() => false);
  const [ar, vr] = await Promise.all([ask('immersive-ar'), ask('immersive-vr')]);
  return { screen: true, ar, vr, reason: ar || vr ? '' : 'この端末は AR も VR も使えない' };
}

const SESSION_INIT = {
  ar: {
    requiredFeatures: ['local-floor'],
    // 使えれば使う物。無くても始まる。
    optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'mesh-detection'],
  },
  vr: {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking'],
  },
};

/**
 * @param {object} args
 * @param {import('three').WebGLRenderer} args.renderer
 * @param {'ar'|'vr'} args.mode
 * @param {{setPresentation(m:string):void}} args.place
 * @returns {Promise<XRSession>} 終わったら place を screen に戻す
 */
export async function startXR({ renderer, mode, place, nav = globalThis.navigator }) {
  const init = SESSION_INIT[mode];
  if (!init) throw new Error(`mode は ar か vr: ${mode}`);
  const session = await nav.xr.requestSession(mode === 'ar' ? 'immersive-ar' : 'immersive-vr', init);
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  place.setPresentation(mode);
  session.addEventListener('end', () => place.setPresentation('screen'));
  return session;
}
