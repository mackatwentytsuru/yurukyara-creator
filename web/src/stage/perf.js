// ?perf=1 で、いまの重さを測る(L0)。キャラが出たあと、決まった秒数だけ描いて、数字を 1 つの JSON にまとめる。
//   window.__perf          … 測り終わった JSON(終わるまでは null)
//   window.__perfDone      … 測り終わると true
//   コンソールに「[perf] {...}」を 1 行出し、画面の左下に要点を出す(?perf=1 のときだけ)。
// URL の値: perfsec=測る秒数(既定 6)、perfwarm=測る前に待つ秒数(既定 2)。
// 項目の決まりは K6(docs/metrics.md の先頭)。版を変えるときは schema を上げる。
import { isSoftwareRenderer, readRendererInPage } from './gpuGuard.js';
import { deviceClass } from './tiers.js';

export const PERF_SCHEMA = 'perf/1';

// 組み立てた時のコミット(VITE_COMMIT=<短い sha> を付けて vite build した時だけ入る。無ければ null。測りの道具が後で足す)
const BUILD_COMMIT = import.meta.env?.VITE_COMMIT || null;

/**
 * 契約 K6 の 1 行(平らな欄)。コンソールには「PERF 」に続けて、この JSON を 1 行で出す。
 * renderer が SwiftShader(CPU)の行は、測った値として使わない(K6)。
 */
export function k6Record(json, { commit = null, device = 'desktop' } = {}) {
  return {
    commit,
    device,
    renderer: json.renderer?.name ?? null,
    id: json.character ?? null,
    look: json.look ?? null,
    tier: json.tier?.name ?? null,
    seconds: json.timing?.sample_s ?? null,
    fps_median: json.frames?.fps_median ?? null,
    frame_ms_p50: json.frames?.frame_ms_median ?? null,
    frame_ms_p95: json.frames?.frame_ms_p95 ?? null,
    draw_calls: json.gl?.calls ?? null,
    triangles: json.gl?.triangles ?? null,
    load_ms: json.timing?.ready_ms ?? null,
    glb_bytes: json.bytes?.model?.transfer ?? 0,
  };
}

/** 並べた数の、p の位置の値(0〜1)。空なら null */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** 住所から、場所(/characters/... など)だけを取り出す。測りの記録に、どこのサーバーかを残さない */
const pathOf = (url) => String(url).replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];

/** 読み込んだファイルを、種類ごとの数と大きさ(バイト)にまとめる */
export function summarizeResources(entries) {
  const kinds = { model: /\.(glb|gltf|vrm)(\?|$)/i, texture: /\.(png|jpe?g|webp|ktx2|basis)(\?|$)/i, motion: /\/motions\//i, script: /\.(m?js)(\?|$)/i, wasm: /\.wasm(\?|$)/i, audio: /\.(wav|mp3|ogg|m4a)(\?|$)/i };
  const out = { total: { count: 0, transfer: 0, decoded: 0 } };
  const files = [];
  for (const e of entries) {
    const kind = Object.keys(kinds).find((k) => kinds[k].test(e.name)) ?? 'other';
    const transfer = e.transferSize || e.encodedBodySize || 0;
    const decoded = e.decodedBodySize || 0;
    out[kind] ??= { count: 0, transfer: 0, decoded: 0 };
    for (const bucket of [out[kind], out.total]) {
      bucket.count += 1;
      bucket.transfer += transfer;
      bucket.decoded += decoded;
    }
    if (kind === 'model' || kind === 'texture') files.push({ path: pathOf(e.name), kind, decoded });
  }
  return { ...out, files };
}

/** 毎フレームの間隔(ms)から、滑らかさの数字を作る */
export function summarizeFrames(intervals, renderMs) {
  const f = [...intervals].sort((a, b) => a - b);
  const r = [...renderMs].sort((a, b) => a - b);
  const median = quantile(f, 0.5);
  const round = (v, d = 2) => (v === null ? null : +v.toFixed(d));
  return {
    frames: f.length,
    frame_ms_median: round(median),
    frame_ms_p95: round(quantile(f, 0.95)),
    fps_median: median ? round(1000 / median, 1) : null,
    long_frames_over_33ms: f.filter((v) => v > 33.4).length,
    render_cpu_ms_median: round(quantile(r, 0.5), 3),
    render_cpu_ms_p95: round(quantile(r, 0.95), 3),
  };
}

function countScene(scene) {
  let meshes = 0;
  let skinned = 0;
  let furLayers = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (o.isSkinnedMesh) skinned += 1;
    if (o.userData?.furLayer !== undefined || /fur/i.test(o.name)) furLayers += 1;
  });
  return { meshes, skinned_meshes: skinned, fur_meshes: furLayers };
}

function showBox(json) {
  const box = document.createElement('pre');
  box.id = 'perfBox';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;background:rgba(0,0,0,.72);color:#fff;border-radius:6px;pointer-events:none;max-width:90vw;white-space:pre-wrap';
  const mb = (b) => (b / 1048576).toFixed(2);
  box.textContent = [
    `重さ ${json.character} ・ ${json.renderer.software ? 'CPU の描画(数字は使えない)' : 'GPU'}${json.tier ? ` ・ 段 ${json.tier.name}` : ''}`,
    `fps ${json.frames.fps_median} ・ 1 フレーム ${json.frames.frame_ms_median}ms(p95 ${json.frames.frame_ms_p95})`,
    `描く呼び出し ${json.gl.calls} ・ 三角 ${json.gl.triangles} ・ 絵 ${json.gl.textures}`,
    `読み込み ${mb(json.bytes.total.transfer)}MB ・ 出るまで ${json.timing.ready_ms}ms`,
  ].join('\n');
  document.body.append(box);
}

/**
 * 測り始める。main.js がキャラを出したあと、?perf=1 のときだけ呼ぶ。
 * stage.render を包んで、描く 1 回の CPU の時間も測る(包むのは測っている間だけ)。
 */
export function startPerf({ stage, character, params, readyAt, tier = null }) {
  window.__perf = null;
  window.__perfDone = false;
  const warmS = Number(params.get('perfwarm') ?? 2);
  const sampleS = Number(params.get('perfsec') ?? 6);
  const intervals = [];
  const renderMs = [];
  const originalRender = stage.render;
  let sampling = false;
  stage.render = () => {
    if (!sampling) return originalRender();
    const t = performance.now();
    originalRender();
    renderMs.push(performance.now() - t);
  };
  let last = 0;
  const tick = (t) => {
    if (sampling && last) intervals.push(t - last);
    last = t;
    if (!window.__perfDone) requestAnimationFrame(tick);
  };
  setTimeout(() => {
    sampling = true;
    requestAnimationFrame(tick);
    setTimeout(() => finish(), sampleS * 1000);
  }, warmS * 1000);

  function finish() {
    sampling = false;
    stage.render = originalRender;
    const info = stage.renderer.info;
    const rendererName = readRendererInPage();
    const nav = performance.getEntriesByType('navigation')[0];
    const json = {
      schema: PERF_SCHEMA,
      measured_at: new Date().toISOString(),
      character: params.get('character') ?? params.get('char') ?? character.id ?? null,
      kind: character.kind ?? null,
      look: character.look ?? null,
      tier: tier ? { name: tier.name, reason: tier.reason, pixel_ratio_max: tier.pixelRatioMax, fur_layers: tier.furLayers } : null,
      url: location.pathname + location.search,
      ua: navigator.userAgent,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, pixel_ratio_used: stage.renderer.getPixelRatio() },
      renderer: { name: rendererName, software: isSoftwareRenderer(rendererName), webgl2: stage.renderer.capabilities.isWebGL2 ?? true },
      timing: {
        ready_ms: Math.round(readyAt),
        dom_content_loaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        warm_s: warmS,
        sample_s: sampleS,
      },
      frames: summarizeFrames(intervals, renderMs),
      gl: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? null,
      },
      scene: countScene(stage.scene),
      bytes: summarizeResources(performance.getEntriesByType('resource')),
      js_heap_mb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
    json.k6 = k6Record(json, { commit: BUILD_COMMIT, device: deviceClass(navigator.userAgent, navigator.maxTouchPoints) });
    window.__perf = json;
    window.__perfDone = true;
    console.info(`[perf] ${JSON.stringify(json)}`);
    console.info(`PERF ${JSON.stringify(json.k6)}`);
    showBox(json);
  }
}
