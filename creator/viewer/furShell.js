import * as THREE from 'three';

/**
 * ブラウザ側で毛の殻を重ねる。同じ形と同じ骨を使い回して何度か描くので、GLB は増えず、骨とシェイプキーにそのまま付いて動く。
 *
 * - 各層を、骨で動かした後の法線の向きへ少しずつふくらませる。
 * - 全部の層で同じ毛の位置を使い、外の層ほど高い毛だけを残す。下から見ると毛の柱になる。根元を暗くすると厚みが出る。
 * - 対象は毛足の材質(色の絵と法線の絵と sheen を持つ物)。Blender で作った殻(alphaTest で抜く物)は隠す。
 * - 目・口・頬など、毛足でない部品と、色の違う毛の部品の周りは毛を短くする。埋もれて顔が消えたり、毛が混ざったりするのを防ぐ。
 *
 * character.json: "fur": { "layers": 12 }  省略できる値: length、hairWidth、tile、root、sheen、normal、flat、pile、cloud、gain、stray、strayReach、clear、thin
 *   layers: 層の数。弱い GPU では減らす。length: 毛の長さ(既定はキャラの高さの 1.5%)。hairWidth: 毛 1 本の太さ(キャラの高さに対する割合)。tile: UV の 1 あたりの毛の模様の繰り返し(書けば hairWidth より優先)。
 *   look: 名前の付いた設定のまとまり(試しの設定で、既定ではない。判定の数字は creator/skilltest/結果表.md)。ほかの値を書くと、そちらが優先。
 *     "fleece" = 布の写真の房 + 半透明の毛先。"teddy"(Poly Haven Curly Teddy Natural)・"felt"(ambientCG Fabric034)= 面そのものに素材の法線・ラフネス・明暗を貼る + 殻の房。
 *   material: 素材の名前(assets/ の下のフォルダ)。surface: true で、面そのものに素材の法線・ラフネス・細かい明暗を貼る(色は元の絵のまま)。surfaceNormal・surfaceShade・surfaceFlat: その強さ。layers: 0 で殻なし(面だけ)。assetBase: 素材の置き場の URL(試し用)。
 *     "megaclay"(Clay Toy Bear)・"megarug"(Historic Bazaar Rug Fabric)・"meghat"(Urban Camping Gear Hat Fabric)= Megascans を持っている人向けのおまけ。teddy・felt と同じ仕組みで、絵は assets_local/<look 名>/(git に入らない置き場、.gitignore 済み)。絵が無いときは警告だけ出して既定の見た目に戻る。
 *   soft: 毛先を半透明でぼかす幅(0 で切る)。輪郭と面の粒が画素で切れて砂に見えるのを防ぐ。rim: 真横を向いた面を明るくする強さ(毛は光を透かすので、輪郭が暗くならない)。tipAlpha: いちばん外の毛の濃さ。
 *   photo: true で、布の写真(assets/fleece、Poly Haven「Polar Fleece」CC0)の房を毛の高さと明暗に使う。photoRepeat: 写真 1 枚がキャラの高さの何倍か。photoHeight: 高さのうち写真の割合。photoContrast: 写真の明暗の強さ。photoNormal: 写真の法線の強さ。
 *   thin: 薄い部品の毛を短くする目安(毛の長さの何倍の厚みまでを「薄い」とするか。既定 0 = 働かない。葉は 0.67 に縮んだがマントには効かず、sheen=0.0 の決まりのほうが効いたので既定は切った)。厚みが毛の長さの thin 倍より薄い部品は、その割合だけ毛を短くする(下限 0.2)。葉・マント・角の縁の針のような毛羽立ちを防ぐ。
 *   root: 根元の明るさ。normal: 毛足の法線の強さに掛ける値。flat: 色の絵の筋を消す割合(1 で一色)。pile: 毛 1 本ずつの明暗の強さ。cloud: ふわっとしたむらの強さ。gain: 毛の明るさに掛ける値。stray: 外へ飛び出す毛の層の数。strayReach: 飛び出す長さ(毛の長さの何倍か)。clear: 顔の部品から、毛を生やさない距離(毛の長さの何倍か)。
 */
const FUR_TEXTURE_SIZE = 256;
const FUR_HAIR_COUNT = 26000;
const CUT_INNER = 0.08;
const CUT_OUTER = 0.8;
const CUT_STRAY = 0.93;
const HAIR_WIDTH_TEXELS = 3.4; // 毛の画像の中の毛 1 本の太さの目安(画素)
const UV_JUMP = 0.25;
const LENGTH_OF_HEIGHT = 0.015;
const PATCH_KEEP_RADIUS = 0.3; // 当て布の絵の中心からの距離(絵の幅が 1)
const CLEAR_FADE = 1.5; // 毛を生やさない範囲の外で、元の長さへ戻すまでの距離(毛の長さの何倍か)
const PATCH_RENDER_ORDER = 100;
const THIN_FLOOR = 0.2; // 薄い部品でも、毛の長さをこの割合より短くはしない
const SHELL_LOOK = { soft: 0.08, rim: 0.25, tipAlpha: 0.5, stray: 2, strayReach: 0.5, photo: true, photoRepeat: 0.35, photoHeight: 0.5, photoContrast: 2.0 };
// 素材の絵は assets/<素材>/<素材>_{detail,height,normal,rough}.jpg(1K、1 枚 300KB まで)。look の名前 → 設定。
// fleece = 房の殻だけ(Poly Haven Polar Fleece)。teddy・felt = 面そのものに法線・ラフネス・明暗を貼り、さらに殻の房にも使う(面 + 殻)。写真 1 枚はキャラの高さの 0.35
const FUR_LOOKS = {
  fleece: { ...SHELL_LOOK, material: 'fleece' },
  teddy: { ...SHELL_LOOK, material: 'curly_teddy_natural', surface: true },
  felt: { ...SHELL_LOOK, material: 'fabric034', surface: true },
  // Megascans などを持っている人向けのおまけ。絵は assets_local/<look 名>/(git に入らない置き場)。無ければ既定の見た目に戻る。surfaceNormal は絵ごとの法線の傾きに合わせてある
  megaclay: { ...SHELL_LOOK, material: 'megaclay', surface: true, local: true, surfaceNormal: 1.0, surfaceShade: 1.5 },
  megarug: { ...SHELL_LOOK, material: 'megarug', surface: true, local: true, surfaceNormal: 0.5, surfaceShade: 1.5 },
  meghat: { ...SHELL_LOOK, material: 'meghat', surface: true, local: true, surfaceNormal: 0.6, surfaceShade: 1.5 },
};
const SURFACE_DEFAULTS = { surfaceNormal: 0.6, surfaceShade: 2.0, surfaceFlat: 0.95 }; // 面そのものに貼るときの法線の強さ・明暗の強さ・色の絵の筋を消す割合(殻の flat と同じ)

/** assets_local の絵があるか(1 回だけ確かめる)。無い・読めないときは false。applyFur は同期で呼ばれるので、同期の問い合わせにしてある。 */
function localAssetsPresent(material, assetBase) {
  try {
    const base = assetBase ?? new URL('./assets_local', import.meta.url).href;
    return ['detail', 'height', 'normal', 'rough'].every((kind) => {
      const x = new XMLHttpRequest();
      x.open('HEAD', `${base}/${material}/${material}_${kind}.jpg`, false);
      x.send();
      return x.status >= 200 && x.status < 300;
    });
  } catch {
    return false;
  }
}

/** 布の写真を読む。読み終わる前は灰色 1 色なので、撮るときは読み終わりを待つ。ラフネスは面に貼るときだけ読む。 */
function loadPhoto(material, withRough, assetBase, local = false) {
  const loader = new THREE.TextureLoader();
  const base = assetBase ?? new URL(local ? './assets_local' : './assets', import.meta.url).href;
  const load = (kind, srgb = false) => {
    const tex = loader.load(`${base}/${material}/${material}_${kind}.jpg`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { detail: load('detail'), height: load('height'), normal: load('normal'), rough: withRough ? load('rough') : null };
}

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

/** 薄い部品(葉・マント・角)の毛の長さの倍率。部品の一番薄い向きの厚み(世界の座標の箱)が、毛の長さの k 倍より薄いと、その割合まで毛を短くする。
 *  薄い縁に毛の長さがそのまま付くと、縁が針のように毛羽立つ。k が 0 なら働かない(倍率 1)。 */
function thinFactor(mesh, length, k) {
  if (!(k > 0)) return 1;
  const box = new THREE.Box3().setFromObject(mesh);
  const s = box.getSize(new THREE.Vector3());
  const thickness = Math.min(s.x, s.y, s.z);
  return THREE.MathUtils.clamp(thickness / (k * length), THIN_FLOOR, 1);
}

/** 1 層分の材質。元の材質を写し、ふくらませる処理と毛を抜く処理を足す。 */
function layerMaterial(source, hairs, layer, cfg, photo) {
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
    uFurSoft: { value: cfg.soft },
    uFurRim: { value: cfg.rim },
    uFurAlpha: { value: 1 - (1 - cfg.tipAlpha) * Math.min(layer, 1) },
    ...(photo ? {
      uPhotoDetail: { value: photo.detail },
      uPhotoHeight: { value: photo.height },
      uPhotoTile: { value: cfg.photoTile },
      uPhotoMix: { value: cfg.photoHeight },
      uPhotoContrast: { value: cfg.photoContrast },
    } : {}),
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFurLength;
        attribute float aFurThin;
        varying float vFurLength;
        uniform float uFurOffset;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        vFurLength = aFurLength;
        transformed += normalize(objectNormal) * uFurOffset * aFurLength * aFurThin;`);
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
        uniform float uFurSoft;
        uniform float uFurRim;
        uniform float uFurAlpha;
        float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float furCloud(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(furHash(i), furHash(i + vec2(1.0, 0.0)), f.x), mix(furHash(i + vec2(0.0, 1.0)), furHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float furTint;
        ${photo ? `uniform sampler2D uPhotoDetail;
        uniform sampler2D uPhotoHeight;
        uniform float uPhotoTile;
        uniform float uPhotoMix;
        uniform float uPhotoContrast;` : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float furHair = texture2D(uFurHairs, vMapUv * uFurTile).r;
        ${photo ? `furHair = mix(furHair, texture2D(uPhotoHeight, vMapUv * uPhotoTile).r, uPhotoMix);` : ''}
        float furEdge = uFurSoft > 0.0 ? smoothstep(uFurCut - uFurSoft, uFurCut + uFurSoft, furHair) : step(uFurCut, furHair);
        if (vFurLength < uFurLayer * 0.999 || furEdge <= 0.01) discard;
        diffuseColor.a *= furEdge * uFurAlpha;
        // 1 本ずつの明暗(細かい)と、ふわっとしたむら(大きい)。色の絵の筋の代わりに、ここで布らしさを出す
        furTint = uFurGain * uFurShade * (1.0 + uFurPile * (furHair - 0.5))
          * (1.0 + uFurCloud * (furCloud(vMapUv * 18.0) * 0.6 + furCloud(vMapUv * 46.0) * 0.4 - 0.5));
        ${photo ? `furTint *= 1.0 + uPhotoContrast * (texture2D(uPhotoDetail, vMapUv * uPhotoTile).r * 2.0 - 1.0);` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, textureLod(map, vMapUv, 8.0).rgb * diffuse, uFurFlat) * furTint;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float furRim = 1.0 + uFurRim * pow(1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition))), 3.0);
        diffuseColor.rgb *= furRim;
        totalEmissiveRadiance = mix(totalEmissiveRadiance, textureLod(map, vMapUv, 8.0).rgb * emissive, uFurFlat) * furTint * furRim;`);
  };
  if (cfg.soft > 0) {
    m.transparent = true;
    m.depthWrite = false;
  }
  m.customProgramCacheKey = () => (photo ? 'fur-shell-photo' : 'fur-shell');
  return m;
}

/** 毛の殻を足す。戻り値は足した層の数。 */
export function applyFur(scene, options = {}) {
  // 素材の絵が無い look(Megascans を持っていない)は、エラーにせず既定の見た目({})に戻る
  const wanted = FUR_LOOKS[options.look];
  if (wanted?.local && !localAssetsPresent(wanted.material, options.assetBase)) {
    console.warn(`fur look "${options.look}": assets_local/${wanted.material}/ に絵が無いので、既定の見た目にします`);
    const { look, ...rest } = options;
    options = rest;
  }
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const cfg = {
    length: Math.max(size.y, 1e-3) * LENGTH_OF_HEIGHT,
    layers: 12,
    tile: null,
    hairWidth: 0.004,
    root: 0.93,
    sheen: 0.35,
    normal: 0.15,
    flat: 0.95,
    pile: 0.25,
    cloud: 0.18,
    gain: 1.1,
    stray: 4,
    strayReach: 0.8,
    clear: 0.6,
    thin: 0,
    soft: 0,
    rim: 0,
    tipAlpha: 1,
    photo: false,
    photoRepeat: 0.7,
    photoHeight: 0.6,
    photoContrast: 2.5,
    photoNormal: 0.5,
    material: 'fleece',
    surface: false,
    local: false,
    assetBase: null,
    ...SURFACE_DEFAULTS,
    ...(FUR_LOOKS[options.look] ?? {}),
    ...options,
  };
  const hairs = makeHairHeights();
  const photo = cfg.photo || cfg.surface ? loadPhoto(cfg.material, cfg.surface, cfg.assetBase, Boolean(cfg.local)) : null;
  const targets = [];
  const faceParts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.alphaTest > 0) o.visible = false;
    else if (isFurMaterial(o.material)) targets.push(o);
    else faceParts.push(o);
  });
  const joinPoints = (chunks) => {
    const out = new Float32Array(chunks.reduce((n, a) => n + a.length, 0));
    chunks.reduce((at, a) => {
      out.set(a, at);
      return at + a.length;
    }, 0);
    return out;
  };
  // 半透明の毛は奥行きを書かないので、頬の当て布は毛のあとに描く(先に描くと、毛に削られて輪郭が崩れる)
  if (cfg.soft > 0 && cfg.layers > 0) faceParts.filter((o) => o.material?.transparent).forEach((o) => { o.renderOrder = PATCH_RENDER_ORDER; });
  const faceChunks = faceParts.map(faceKeepPoints);
  // 色の違う毛の部品の境目でも毛を短くする(青とクリームの毛が混ざって汚れて見えるのを防ぐ)
  const furChunks = targets.map((m) => ({ material: m.material, points: worldPositions(m) }));
  const avoidFor = new Map();
  for (const m of targets) {
    if (avoidFor.has(m.material)) continue;
    const others = furChunks.filter((c) => c.material !== m.material).map((c) => c.points);
    avoidFor.set(m.material, joinPoints([...faceChunks, ...others]));
  }
  const clear = cfg.length * cfg.clear;
  const fade = cfg.length * CLEAR_FADE;

  // 材質は部品どうしで共有されている。層の材質は 1 回だけ作り、土台を暗くするのも 1 回だけにする
  const layersOf = new Map();
  for (const mesh of targets) {
    if (layersOf.has(mesh.material)) continue;
    const base = mesh.material;
    // 毛の太さを、キャラの高さに対する割合で決める(tile を直接書いたときは、そちらを使う)
    const repeatLength = (size.y * cfg.hairWidth * FUR_TEXTURE_SIZE) / HAIR_WIDTH_TEXELS;
    const lengthPerUv = modelLengthPerUv(mesh);
    const photoTile = lengthPerUv / (size.y * cfg.photoRepeat);
    const layerCfg = { ...cfg, tile: cfg.tile ?? lengthPerUv / repeatLength, photoTile };
    base.sheen = cfg.sheen;
    base.sheenRoughness = Math.max(base.sheenRoughness, 0.8);
    const repeated = (src) => {
      const tex = src.clone();
      tex.repeat.set(photoTile, photoTile);
      tex.needsUpdate = true;
      return tex;
    };
    if (photo && cfg.surface) {
      // 面そのもの: 素材の法線・ラフネス・細かい明暗を貼る(色は元の絵のまま。明暗は掛けるだけ)
      base.normalMap = repeated(photo.normal);
      base.normalScale.set(cfg.surfaceNormal, cfg.surfaceNormal);
      base.roughnessMap = repeated(photo.rough);
      base.roughness = 1;
      const surf = { uSurfDetail: { value: photo.detail }, uSurfTile: { value: photoTile }, uSurfShade: { value: cfg.surfaceShade }, uSurfFlat: { value: cfg.surfaceFlat } };
      base.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, surf);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D uSurfDetail;
            uniform float uSurfTile;
            uniform float uSurfShade;
            uniform float uSurfFlat;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            float surfTint = 1.0 + uSurfShade * (texture2D(uSurfDetail, vMapUv * uSurfTile).r * 2.0 - 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, textureLod(map, vMapUv, 8.0).rgb * diffuse, uSurfFlat) * surfTint;`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance = mix(totalEmissiveRadiance, textureLod(map, vMapUv, 8.0).rgb * emissive, uSurfFlat) * surfTint;`);
      };
      base.customProgramCacheKey = () => 'fur-surface';
    } else if (photo && cfg.photoNormal > 0) {
      base.normalMap = repeated(photo.normal);
      base.normalScale.set(cfg.photoNormal, cfg.photoNormal);
    } else {
      base.normalScale.multiplyScalar(cfg.normal);
    }
    const stray = cfg.layers > 0 ? cfg.stray : 0;
    const layers = [];
    for (let k = 1; k <= cfg.layers; k += 1) layers.push(layerMaterial(base, hairs, k / cfg.layers, layerCfg, cfg.photo ? photo : null));
    // 外へ飛び出す毛: まばらな層を毛の長さの外まで足す。輪郭に細かいはみ出しが出る
    for (let k = 1; k <= stray; k += 1) layers.push(layerMaterial(base, hairs, 1 + (k / stray) * cfg.strayReach, layerCfg, cfg.photo ? photo : null));
    // 土台の面は根元の明るさにそろえる(毛の根元が見える所が、明るく浮かないように)。殻がないとき(layers: 0)は元の明るさのまま
    if (layers.length) {
      base.color.multiplyScalar(cfg.root);
      base.emissiveIntensity *= cfg.root;
    }
    layersOf.set(base, layers);
  }
  let added = 0;
  for (const mesh of targets) {
    mesh.geometry.setAttribute('aFurLength', furLengthAttribute(mesh, avoidFor.get(mesh.material), clear, fade));
    const thin = thinFactor(mesh, cfg.length, cfg.thin);
    mesh.userData.furThin = thin;
    mesh.geometry.setAttribute('aFurThin', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(thin), 1));
    for (const material of layersOf.get(mesh.material)) {
      added += 1;
      const shell = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
      if (mesh.isSkinnedMesh) shell.bind(mesh.skeleton, mesh.bindMatrix);
      shell.position.copy(mesh.position);
      shell.quaternion.copy(mesh.quaternion);
      shell.scale.copy(mesh.scale);
      shell.frustumCulled = false;
      shell.renderOrder = 1 + layersOf.get(mesh.material).indexOf(material); // 半透明のとき、内の層から順に重ねる
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
