// LED の中の会場の絵・左右のモニター(顔のアップ)・出る戻るの光。show_stage.json の予定どおりに描く。
// モニターの中は、中央のキャラと同じ動きを別のカメラで撮った物。状態はコマ番号だけで決まる。
const MONITOR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const MONITOR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpen, uFlash;
varying vec2 vUv;
void main() {
  float half_ = uOpen * 0.5;
  float d = abs(vUv.y - 0.5);
  if (d > half_) discard;
  vec3 col = texture2D(uMap, vec2(vUv.x, vUv.y)).rgb;
  // 大きなスクリーンらしい細い横の筋と、開くときの光
  col *= 0.94 + 0.06 * sin(vUv.y * 1012.0);
  col += vec3(0.35, 0.8, 0.8) * uFlash;
  float edgeX = min(vUv.x, 1.0 - vUv.x) * 900.0;
  float edgeY = (half_ - d) * 506.0;
  float rim = 1.0 - smoothstep(0.0, 5.0, min(edgeX, edgeY));
  col = mix(col, vec3(0.75, 1.0, 0.98) * 1.2, rim);
  gl_FragColor = vec4(col, 1.0);
}
`;
const FLASH_VERTEX = /* glsl */ `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const FLASH_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 uRes, uFoot;
uniform float uAge, uKind, uStretch;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = px - uFoot;
  d.x /= uStretch;
  float r = length(d);
  vec3 col = vec3(0.0);
  if (uKind < 0.5) {
    // 出る: 足元から面を伝う青緑の波と、一瞬の立ち上がる光
    float radius = 40.0 + uAge * 2600.0;
    float e = (r - radius) / (24.0 + uAge * 120.0);
    col += vec3(0.25, 1.0, 0.92) * exp(-e * e) * exp(-uAge * 2.2) * 1.3;
    float pillar = exp(-pow(d.x / 170.0, 2.0)) * smoothstep(-900.0, 0.0, d.y) * exp(-uAge * 7.0);
    col += vec3(0.7, 1.0, 0.97) * pillar * 1.5;
  } else {
    // 戻る: 周りから中心へ集まるピンクの輪と、中心の光
    float radius = max(0.0, 1500.0 * (1.0 - uAge / 0.45));
    float e = (r - radius) / 34.0;
    float inFlight = 1.0 - smoothstep(0.42, 0.5, uAge);
    col += vec3(1.0, 0.3, 0.68) * exp(-e * e) * inFlight * 1.1;
    float core = exp(-pow(r / 300.0, 2.0)) * exp(-pow((uAge - 0.45) / 0.14, 2.0));
    col += vec3(1.0, 0.8, 0.92) * core * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
const FLASH_LENGTH_SEC = { out: 1.2, back: 0.9 };
const OPEN_SEC = 0.28;
const CLOSE_SEC = 0.2;
const SHOTS = {
  // 枠の高さ m、狙う高さ(頭の骨から m)
  face: { frame: 0.44, aimUp: 0.05, push: 0.06 },
  bust: { frame: 0.92, aimUp: -0.16, push: 0.05 },
};
const FOV_DEG = 20;
const SIDE_ANGLE = 0.16; // モニターごとのカメラの横のずれ(距離に対する割合)
const FOLLOW = 0.12; // カメラが頭を追う速さ(1 コマあたり)
const PLATE_OFF = new Set(['preroll', 'calib', 'sync_head', 'tail', 'sync_tail', 'black_end']); // 黒のままの区間

export async function createStagePicture({ THREE, renderer, stage, W, H, FPS, CENTER_X, uniforms }) {
  const plate = await new THREE.TextureLoader().loadAsync('/show-data/plate.png');
  plate.colorSpace = THREE.SRGBColorSpace;
  plate.wrapS = plate.wrapT = THREE.ClampToEdgeWrapping;
  plate.flipY = false;
  plate.generateMipmaps = true;
  plate.minFilter = THREE.LinearMipmapLinearFilter;
  Object.assign(uniforms, {
    uPlate: { value: plate },
    uPlateOn: { value: 1 },
    uPlateGain: { value: stage.plate.song_gain },
    uSongMix: { value: stage.plate.song_picture },
    uPlateCx: { value: stage.plate.center_x },
    uPlateScaleY: { value: stage.plate.scale_y },
    uPlateAspect: { value: 3 },
  });

  const [mw, mh] = [stage.monitor_rects[0][2], stage.monitor_rects[0][3]];
  const targets = stage.monitor_rects.map(() => new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true }));
  const closeCamera = new THREE.PerspectiveCamera(FOV_DEG, mw / mh, 0.05, 50);
  const backdropMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { uPlate: { value: plate }, uGain: { value: 1 }, uT: { value: 0 } },
    vertexShader: FLASH_VERTEX,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uPlate; uniform float uGain, uT;
      void main() {
        vec2 uv = gl_FragCoord.xy / vec2(${mw}.0, ${mh}.0);
        // 舞台の奥の会場を、ぼけた背景として敷く
        vec3 c = textureLod(uPlate, vec2(0.12 + uv.x * 0.2 + 0.01 * sin(uT * 0.4), 0.2 + (1.0 - uv.y) * 0.55), 4.0).rgb;
        gl_FragColor = vec4(c * uGain * 3.0 + vec3(0.004, 0.012, 0.02), 1.0);
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1000;

  const overlay = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(0, W, 0, H, -1, 1);
  const monitorMeshes = stage.monitor_rects.map(([x, y, w, h], i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      uniforms: { uMap: { value: targets[i].texture }, uOpen: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: MONITOR_VERTEX, fragmentShader: MONITOR_FRAGMENT,
    }));
    mesh.position.set(x + w / 2, y + h / 2, 0);
    mesh.scale.set(w, -h, 1);
    mesh.frustumCulled = false;
    overlay.add(mesh);
    return mesh;
  });
  const flashMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: {
      uRes: { value: new THREE.Vector2(W, H) }, uFoot: { value: new THREE.Vector2(CENTER_X, stage.life_size.foot_y) },
      uAge: { value: 0 }, uKind: { value: 0 }, uStretch: { value: uniforms.uStretch.value },
    },
    vertexShader: FLASH_VERTEX, fragmentShader: FLASH_FRAGMENT,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flashMaterial);
  flash.frustumCulled = false;
  flash.renderOrder = 10;
  overlay.add(flash);

  const headAt = new THREE.Vector3();
  const follow = new THREE.Vector3();
  let followedFrame = -1;

  function monitorState(t) {
    for (const cue of stage.monitors) {
      if (t < cue.on || t >= cue.off) continue;
      const open = Math.min(1, (t - cue.on) / OPEN_SEC, (cue.off - t) / CLOSE_SEC);
      let shot = cue.shots[0];
      for (const s of cue.shots) if (s[0] <= t) shot = s;
      return { open: open * open * (3 - 2 * open), flash: Math.max(0, 1 - (t - cue.on) / OPEN_SEC) * 0.5, shotStart: shot[0], shot: SHOTS[shot[1]] };
    }
    return null;
  }

  return {
    /** 会場の絵の明るさ。歌で明るく、静かな場面で暗く、暗転と同期の間は消す */
    setPlate(section, t, song) {
      const { quiet_gain: quiet, song_gain: full } = stage.plate;
      let gain = quiet + (full - quiet) * song;
      if (PLATE_OFF.has(section.id)) gain = 0;
      else if (section.id === 'dark') gain = quiet * Math.min(1, (t - section.start) / (section.end - section.start));
      else if (section.id === 'outro') gain *= Math.max(0, 1 - (t - section.start) / (section.end - section.start));
      uniforms.uPlateGain.value = gain;
      uniforms.uPlateOn.value = gain > 0 ? 1 : 0;
    },
    characterOnLed(t) {
      return stage.led_character.some(([a, b]) => t >= a && t < b);
    },
    renderMonitors(frame, scene, character, background) {
      const t = frame / FPS;
      backdropMaterial.uniforms.uT.value = t;
      const state = monitorState(t);
      monitorMeshes.forEach((m) => { m.visible = Boolean(state); });
      if (!state) return;
      const head = character.vrm.humanoid.getRawBoneNode('head');
      head.getWorldPosition(headAt);
      if (followedFrame !== frame - 1) follow.copy(headAt);
      else follow.lerp(headAt, FOLLOW);
      followedFrame = frame;
      const { open, flash: pop, shot, shotStart } = state;
      const wasVisible = character.object3d.visible;
      character.object3d.visible = true;
      background.visible = false;
      scene.add(backdrop);
      const distance = shot.frame / 2 / Math.tan((FOV_DEG * Math.PI) / 360) * (1 - shot.push * Math.min(1, (t - shotStart) / 4));
      targets.forEach((target, i) => {
        const side = (i === 0 ? 1 : -1) * SIDE_ANGLE * distance;
        closeCamera.position.set(follow.x + side, follow.y + shot.aimUp - 0.02, follow.z + distance);
        closeCamera.lookAt(follow.x, follow.y + shot.aimUp, follow.z);
        closeCamera.updateMatrixWorld(true);
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, closeCamera);
        monitorMeshes[i].material.uniforms.uOpen.value = open;
        monitorMeshes[i].material.uniforms.uFlash.value = pop;
      });
      scene.remove(backdrop);
      background.visible = true;
      character.object3d.visible = wasVisible;
    },
    drawOver(frame) {
      const t = frame / FPS;
      const active = stage.flashes.find((f) => t >= f.t - (f.kind === 'back' ? 0.45 : 0) && t < f.t + FLASH_LENGTH_SEC[f.kind] * (f.kind === 'back' ? 0.5 : 1));
      flash.visible = Boolean(active);
      if (active) {
        flashMaterial.uniforms.uKind.value = active.kind === 'back' ? 1 : 0;
        flashMaterial.uniforms.uAge.value = active.kind === 'back' ? t - active.t + 0.45 : t - active.t;
      }
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlay, overlayCamera);
      renderer.autoClear = auto;
    },
  };
}
