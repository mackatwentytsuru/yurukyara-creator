import * as THREE from 'three';

/**
 * ブラウザ側で毛の殻を重ねる。同じ形と同じ骨を使い回して何度か描くので、GLB は増えず、骨とシェイプキーにそのまま付いて動く。
 *
 * - 各層を、骨で動かした後の法線の向きへ少しずつふくらませる。
 * - 全部の層で同じ毛の位置を使い、外の層ほど高い毛だけを残す。下から見ると毛の柱になる。根元を暗くすると厚みが出る。
 * - 対象は毛足の材質(色の絵と法線の絵と sheen を持つ物)。Blender で作った殻(alphaTest で抜く物)は隠す。
 * - 目・口・頬など、毛足でない部品の周りは毛を短くする。埋もれて顔が消えるのを防ぐ。
 *
 * character.json: "fur": { "layers": 12 }  省略できる値: length、hairWidth、tile、root、sheen、normal、flat、pile、cloud、gain、stray、strayReach、clear
 *   layers: 層の数。弱い GPU では減らす。length: 毛の長さ(既定はキャラの高さの 2%)。hairWidth: 毛 1 本の太さ(キャラの高さに対する割合)。tile: UV の 1 あたりの毛の模様の繰り返し(書けば hairWidth より優先)。
 *   root: 根元の明るさ。normal: 毛足の法線の強さに掛ける値。flat: 色の絵の筋を消す割合(1 で一色)。pile: 毛 1 本ずつの明暗の強さ。cloud: ふわっとしたむらの強さ。gain: 毛の明るさに掛ける値。stray: 外へ飛び出す毛の層の数。strayReach: 飛び出す長さ(毛の長さの何倍か)。clear: 顔の部品から、毛を生やさない距離(毛の長さの何倍か)。
 */
const FUR_TEXTURE_SIZE = 256;
const FUR_HAIR_COUNT = 26000;
const CUT_INNER = 0.08;
const CUT_OUTER = 0.8;
const CUT_STRAY = 0.93;
const HAIR_WIDTH_TEXELS = 3.4; // 毛の画像の中の毛 1 本の太さの目安(画素)
const UV_JUMP = 0.25;
const LENGTH_OF_HEIGHT = 0.02;
const PATCH_KEEP_RADIUS = 0.3; // 当て布の絵の中心からの距離(絵の幅が 1)
const CLEAR_FADE = 1.5; // 毛を生やさない範囲の外で、元の長さへ戻すまでの距離(毛の長さの何倍か)

/** 毛の高さの画像を作る。乱数は固定し、毎回同じ見た目にする。 */
function makeHairHeights() {
  const size = FUR_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let n = 0; n < FUR_HAIR_COUNT; n += 1) {
    const cx = Math.floor(rand() * size);
    const cy = Math.floor(rand() * size);
    const height = 0.3 + 0.7 * rand();
    const radius = 1.0 + 1.2 * rand();
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const d = Math.hypot(dx, dy) / radius;
        if (d >= 1) continue;
        const x = (cx + dx + size) % size;
        const y = (cy + dy + size) % size;
        const i = (y * size + x) * 4;
        const v = Math.round(255 * height * (1 - d * d));
        if (v > data[i]) {
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
        }
      }
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function isFurMaterial(m) {
  return Boolean(m && m.isMeshStandardMaterial && m.map && m.normalMap && m.sheen > 0 && !(m.alphaTest > 0));
}

/** 頂点の位置を、世界の座標で返す(骨を動かす前の形)。 */
function worldPositions(mesh) {
  const attr = mesh.geometry.attributes.position;
  const out = new Float32Array(attr.count * 3);
  const v = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < attr.count; i += 1) {
    v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

/** 毛を短くする基準の点。頬のような透明の当て布は、四角い網の全部ではなく、色の付いた丸の中だけを使う(四角い跡が出ないように)。 */
function faceKeepPoints(mesh) {
  const pos = worldPositions(mesh);
  const uv = mesh.geometry.attributes.uv;
  if (!mesh.material?.transparent || !uv) return pos;
  const kept = [];
  for (let i = 0; i < uv.count; i += 1) {
    if (Math.hypot(uv.getX(i) - 0.5, uv.getY(i) - 0.5) < PATCH_KEEP_RADIUS) kept.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  }
  return new Float32Array(kept);
}

/** UV の 1 が、モデルの長さでいくつに当たるか(三角形の辺の長さの比で測る)。作業役ごとに UV の繰り返しが違っても、毛の太さをそろえるため。 */
function modelLengthPerUv(mesh) {
  const pos = worldPositions(mesh);
  const uv = mesh.geometry.attributes.uv;
  const index = mesh.geometry.index;
  if (!uv || !index) return 1;
  let world = 0;
  let flat = 0;
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const dUv = Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b));
    if (dUv <= 0 || dUv > UV_JUMP) continue; // UV の継ぎ目をまたぐ辺は数えない
    world += Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    flat += dUv;
  }
  return flat > 0 ? world / flat : 1;
}

/** 毛の長さの倍率を頂点ごとに決める。顔の部品の近くは 0、離れると 1。 */
function furLengthAttribute(mesh, facePoints, clear, fade) {
  const cell = clear + fade;
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map();
  for (let i = 0; i < facePoints.length; i += 3) {
    const k = key(facePoints[i], facePoints[i + 1], facePoints[i + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const pos = worldPositions(mesh);
  const out = new Float32Array(pos.length / 3);
  for (let n = 0; n < out.length; n += 1) {
    const [x, y, z] = [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]];
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell));
          if (!list) continue;
          for (const i of list) {
            const d = Math.hypot(facePoints[i] - x, facePoints[i + 1] - y, facePoints[i + 2] - z);
            if (d < best) best = d;
          }
        }
      }
    }
    out[n] = THREE.MathUtils.clamp((best - clear) / fade, 0, 1);
  }
  return new THREE.BufferAttribute(out, 1);
}

/** 1 層分の材質。元の材質を写し、ふくらませる処理と毛を抜く処理を足す。 */
function layerMaterial(source, hairs, layer, cfg) {
  const m = source.clone();
  const uniforms = {
    uFurOffset: { value: cfg.length * layer },
    uFurLayer: { value: Math.min(layer, 1) },
    uFurCut: { value: layer <= 1 ? CUT_INNER + (CUT_OUTER - CUT_INNER) * layer : CUT_OUTER + (CUT_STRAY - CUT_OUTER) * ((layer - 1) / cfg.strayReach) },
    uFurShade: { value: cfg.root + (1 - cfg.root) * Math.min(layer, 1) },
    uFurTile: { value: cfg.tile },
    uFurFlat: { value: cfg.flat },
    uFurPile: { value: cfg.pile },
    uFurCloud: { value: cfg.cloud },
    uFurGain: { value: cfg.gain },
    uFurHairs: { value: hairs },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFurLength;
        varying float vFurLength;
        uniform float uFurOffset;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        vFurLength = aFurLength;
        transformed += normalize(objectNormal) * uFurOffset * aFurLength;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFurLength;
        uniform float uFurLayer;
        uniform float uFurCut;
        uniform float uFurShade;
        uniform float uFurTile;
        uniform float uFurFlat;
        uniform float uFurPile;
        uniform float uFurCloud;
        uniform float uFurGain;
        uniform sampler2D uFurHairs;
        float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float furCloud(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(furHash(i), furHash(i + vec2(1.0, 0.0)), f.x), mix(furHash(i + vec2(0.0, 1.0)), furHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float furTint;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float furHair = texture2D(uFurHairs, vMapUv * uFurTile).r;
        if (vFurLength < uFurLayer * 0.999 || furHair < uFurCut) discard;
        // 1 本ずつの明暗(細かい)と、ふわっとしたむら(大きい)。色の絵の筋の代わりに、ここで布らしさを出す
        furTint = uFurGain * uFurShade * (1.0 + uFurPile * (furHair - 0.5))
          * (1.0 + uFurCloud * (furCloud(vMapUv * 18.0) * 0.6 + furCloud(vMapUv * 46.0) * 0.4 - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, textureLod(map, vMapUv, 8.0).rgb * diffuse, uFurFlat) * furTint;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance, textureLod(map, vMapUv, 8.0).rgb * emissive, uFurFlat) * furTint;`);
  };
  m.customProgramCacheKey = () => 'fur-shell';
  return m;
}

/** 毛の殻を足す。戻り値は足した層の数。 */
export function applyFur(scene, options = {}) {
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const cfg = {
    length: Math.max(size.y, 1e-3) * LENGTH_OF_HEIGHT,
    layers: 12,
    tile: null,
    hairWidth: 0.004,
    root: 0.88,
    sheen: 0.35,
    normal: 0.15,
    flat: 0.95,
    pile: 0.5,
    cloud: 0.18,
    gain: 1.1,
    stray: 4,
    strayReach: 1.2,
    clear: 0.6,
    ...options,
  };
  const hairs = makeHairHeights();
  const targets = [];
  const faceParts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.alphaTest > 0) o.visible = false;
    else if (isFurMaterial(o.material)) targets.push(o);
    else faceParts.push(o);
  });
  const faceChunks = faceParts.map(faceKeepPoints);
  const facePoints = new Float32Array(faceChunks.reduce((n, a) => n + a.length, 0));
  faceChunks.reduce((at, a) => {
    facePoints.set(a, at);
    return at + a.length;
  }, 0);
  const clear = cfg.length * cfg.clear;
  const fade = cfg.length * CLEAR_FADE;

  // 材質は部品どうしで共有されている。層の材質は 1 回だけ作り、土台を暗くするのも 1 回だけにする
  const layersOf = new Map();
  for (const mesh of targets) {
    if (layersOf.has(mesh.material)) continue;
    const base = mesh.material;
    // 毛の太さを、キャラの高さに対する割合で決める(tile を直接書いたときは、そちらを使う)
    const repeatLength = (size.y * cfg.hairWidth * FUR_TEXTURE_SIZE) / HAIR_WIDTH_TEXELS;
    const layerCfg = { ...cfg, tile: cfg.tile ?? modelLengthPerUv(mesh) / repeatLength };
    base.sheen = cfg.sheen;
    base.sheenRoughness = Math.max(base.sheenRoughness, 0.8);
    base.normalScale.multiplyScalar(cfg.normal);
    const layers = [];
    for (let k = 1; k <= cfg.layers; k += 1) layers.push(layerMaterial(base, hairs, k / cfg.layers, layerCfg));
    // 外へ飛び出す毛: まばらな層を毛の長さの外まで足す。輪郭に細かいはみ出しが出る
    for (let k = 1; k <= cfg.stray; k += 1) layers.push(layerMaterial(base, hairs, 1 + (k / cfg.stray) * cfg.strayReach, layerCfg));
    // 土台の面は根元の明るさにそろえる(毛の根元が見える所が、明るく浮かないように)
    base.color.multiplyScalar(cfg.root);
    base.emissiveIntensity *= cfg.root;
    layersOf.set(base, layers);
  }
  let added = 0;
  for (const mesh of targets) {
    mesh.geometry.setAttribute('aFurLength', furLengthAttribute(mesh, facePoints, clear, fade));
    for (const material of layersOf.get(mesh.material)) {
      const shell = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
      if (mesh.isSkinnedMesh) shell.bind(mesh.skeleton, mesh.bindMatrix);
      shell.position.copy(mesh.position);
      shell.quaternion.copy(mesh.quaternion);
      shell.scale.copy(mesh.scale);
      shell.frustumCulled = false;
      added += 1;
      shell.name = `${mesh.name}_fur${added}`;
      if (mesh.morphTargetInfluences) {
        shell.morphTargetInfluences = mesh.morphTargetInfluences; // 同じ配列を見る。口やまばたきに一緒に動く
        shell.morphTargetDictionary = mesh.morphTargetDictionary;
      }
      mesh.parent.add(shell);
    }
  }
  return added;
}
