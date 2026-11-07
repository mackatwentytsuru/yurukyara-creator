// しつかん(3D の材質)を、画面の中で差しかえる(GLB は作り直さない。どのキャラにも効く)。決まりと数字は shitsukan.js。
//  - いつもの: 読み込んだままの材質(1 画素も変えない。元の材質を持っておき、戻す時はそれを戻す)
//  - ぬの: 布(フリース)。粗さ 0.86・布のつや(地の色を明るくした色)・細かい毛羽の法線の絵(ここで作る)
//  - け: ぬの + 毛の殻(creator/viewer/furShell.js)。初めて選んだ時だけ準備する(数百 ms。その間は前の見た目のまま)
//  - つるつる: ソフビ。粗さ 0.42 + 上塗りのつや
// 光はスマホでも動く物だけ: 部屋の光(差しかえた材質だけに環境の光)・縁の光(材質の中の計算)・足元の接地の影(丸いぼかしの板)。
// 色の変換(映画風の曲線)も差しかえた材質の中だけでかける。画面の全体の設定(renderer の tone mapping・scene の環境・光)は変えない
// (2D の板・VR の板・場所の形・顔の部品の色はそのまま)。影の絵とすき間の陰の後処理は使わない(弱い GPU で重い。11-07 の測り)。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyFur } from '../../../creator/viewer/furShell.js';
import { SHITSUKAN_IDS, LOOKS, LIGHT, FUR_LOOK, TILE_M, classifyMaterial, cylinderUv, smoothNormals, fleeceHeight, normalFromHeight, ormFromHeight } from './shitsukan.js';

const TEX_SIZE = 256;
const CACHE_KEY = 'yc-shitsukan-1';
// 毛を生やさず布にする小物(手袋・ちょうネクタイ・葉など)と、細い部品(しっぽ・背中の筋。毛の殻で形が変わった)。名前の頭の 1 語で見る
// (頭の 1 字は小文字にしてから。語のすぐ後に小文字が続く名前は別の語: Bowl は bow ではない)。小さい部品も布にする(下の FUR_MIN_SIZE)
const FABRIC_ONLY_RE = /^(glove|bow|ribbon|tie|button|shoe|boot|hat|cap|leaf|stem|sash|belt|scarf|collar|pocket|bag|screen|panel|metal|wood|rib|stripe|foot|feet|sole|tail)(?![a-z])/;
const fabricName = (name) => FABRIC_ONLY_RE.test(String(name ?? '').charAt(0).toLowerCase() + String(name ?? '').slice(1));
const FUR_MIN_SIZE = 0.12; // 部品の箱の対角がキャラの高さのこれより小さい物は、毛を生やさない(とがった毛玉に見える)

let shared = null;

/** ページで 1 回だけ作る物: 毛羽の絵 2 枚・白い絵(毛の殻が色の絵を読むため)・材質の中の計算の値・足元の影の絵 */
function sharedAssets() {
  if (shared) return shared;
  const h = fleeceHeight(TEX_SIZE);
  const dataTex = (data, size, srgb = false) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const normal = dataTex(normalFromHeight(h, TEX_SIZE), TEX_SIZE);
  const orm = dataTex(ormFromHeight(h, TEX_SIZE, LOOKS.fabric), TEX_SIZE);
  // 毛羽の絵は、足した UV(uv1 = 部品ごとの円柱の投影)で貼る。元の UV(色の絵・顔の表)はそのまま
  normal.channel = 1;
  orm.channel = 1;
  normal.anisotropy = 4;
  const white = dataTex(new Uint8Array(4 * 4 * 4).fill(255), 4, true);
  const uniforms = {
    ycExposure: { value: LIGHT.exposure },
    ycTone: { value: LIGHT.tone === 'aces' ? 1 : 0 },
    ycRimColor: { value: new THREE.Color().fromArray(LIGHT.rimColor) },
    ycRimStrength: { value: LIGHT.rimStrength },
    ycRimPower: { value: LIGHT.rimPower },
    ycRimDir: { value: new THREE.Vector3(...LIGHT.rimDir).normalize() },
  };
  shared = { normal, orm, white, uniforms, env: null, contactTex: null };
  return shared;
}

// 材質の中に足す計算(GLSL)。縁の光: 面が横を向くほど、縁の光の向きに近いほど明るく(地の色を少し白へ寄せた色で)。
// 色の変換(明るさ ycExposure をかけてから): ycTone 0 = 色あいを保つ曲線(Khronos の PBR Neutral の式。絵の色の明るさまでほぼそのままで、
// 明るすぎる所だけ丸める)、1 = 映画風(Narkowicz の ACES の近似。11-07 の試しの形。暗い茶色が明るく灰色に寄った)
const GLSL_DECL = `
uniform float ycExposure;
uniform float ycTone;
uniform vec3 ycRimColor;
uniform float ycRimStrength;
uniform float ycRimPower;
uniform vec3 ycRimDir;
vec3 ycNeutral( vec3 c ) {
  float x = min( c.r, min( c.g, c.b ) );
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float peak = max( c.r, max( c.g, c.b ) );
  const float start = 0.76;
  if ( peak < start ) return c;
  const float d = 1.0 - start;
  float newPeak = 1.0 - d * d / ( peak + d - start );
  c *= newPeak / peak;
  float g = 1.0 - 1.0 / ( 0.15 * ( peak - newPeak ) + 1.0 );
  return mix( c, vec3( newPeak ), g );
}
vec3 ycToneMap( vec3 c ) {
  c *= ycExposure;
  if ( ycTone > 0.5 ) return clamp( ( c * ( 2.51 * c + 0.03 ) ) / ( c * ( 2.43 * c + 0.59 ) + 0.14 ), 0.0, 1.0 );
  return clamp( ycNeutral( c ), 0.0, 1.0 );
}`;
const GLSL_RIM = `
{
  vec3 ycV = normalize( vViewPosition );
  float ycEdge = pow( 1.0 - saturate( dot( normal, ycV ) ), ycRimPower );
  float ycSide = saturate( dot( normal, ycRimDir ) * 0.6 + 0.4 );
  outgoingLight += mix( diffuseColor.rgb, vec3( 1.0 ), 0.35 ) * ycRimColor * ( ycRimStrength * ycEdge * ycSide );
}`;

function patchShader(shader, rim = true) {
  Object.assign(shader.uniforms, sharedAssets().uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_DECL}`)
    .replace('#include <opaque_fragment>', `${rim ? GLSL_RIM : ''}\n#include <opaque_fragment>`)
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = ycToneMap( gl_FragColor.rgb );');
}

/** 差しかえた材質に、縁の光と色の変換を足す(同じ形の材質は、同じ組み立て済みのプログラムを使い回す) */
function useLookShader(material) {
  material.onBeforeCompile = patchShader;
  material.customProgramCacheKey = () => CACHE_KEY;
  material.userData.ycShitsukan = true;
}

/** 毛の殻の材質(furShell.js が作る)にも、色の変換を後ろに足す。縁の光は足さない(殻は重ねて描くので、層の数だけ縁が白く浮いた) */
function wrapShellShader(material) {
  if (material.userData.ycShitsukan) return;
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    patchShader(shader, false);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|${CACHE_KEY}`;
  material.userData.ycShitsukan = true;
}

/** 部屋の光(環境の光)。three の部屋の形を PMREM で畳む(外の写真は読まない)。最初に布・毛・つるつるを選んだ時に 1 回だけ */
function ensureEnv(renderer) {
  const s = sharedAssets();
  if (s.env) return s.env;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  s.env = pmrem.fromScene(room, 0.04).texture;
  room.dispose?.();
  pmrem.dispose();
  return s.env;
}

/** 足元の接地の影の絵(その場で描く丸いぼかし。画像ファイルは使わない) */
function contactTexture() {
  const s = sharedAssets();
  if (s.contactTex) return s.contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  s.contactTex = new THREE.CanvasTexture(c);
  return s.contactTex;
}

// 色の絵(map)のある材質は、絵の色を画面から読まない(画像を取り出す道具は画面のコードで使わない決まり: web/test/privacy.test.mjs)。
// 代わりに布のつやを半分にする(地の色が白なので、つやの色も白い。強いと色が灰色に浮く)
const MAP_SHEEN_SCALE = 0.5;

/** 部品の頂点の色の平均(頂点の色で色や陰を持つ材質のつやの色に使う)。無ければ null */
function averageVertexColor(geometry) {
  const c = geometry?.attributes?.color;
  if (!c || !c.count) return null;
  const acc = [0, 0, 0];
  const step = Math.max(1, Math.floor(c.count / 2000));
  let n = 0;
  for (let i = 0; i < c.count; i += step) {
    acc[0] += c.getX(i);
    acc[1] += c.getY(i);
    acc[2] += c.getZ(i);
    n++;
  }
  return acc.map((v) => v / n);
}

/** 材質の分け方に渡す値(元の材質の数字。明るさの持ち上げ applyLift の前の発光を使う) */
function describe(mesh, material, faceMaterial) {
  const lift = material._liftBase;
  const emissive = lift ? lift.e : material.emissive;
  const ei = lift ? lift.ei : material.emissiveIntensity;
  return {
    name: material.name,
    meshName: mesh.name,
    color: material.color ? material.color.toArray() : [1, 1, 1],
    emissive: emissive ? emissive.toArray() : [0, 0, 0],
    emissiveIntensity: Number.isFinite(ei) ? ei : 1,
    hasMap: Boolean(material.map),
    transparent: Boolean(material.transparent),
    faceAtlas: material === faceMaterial,
  };
}

/** 布・毛・つるつるの材質を 1 つ作る */
function bodyMaterial(original, info, id, env, tint) {
  const s = sharedAssets();
  const p = LOOKS[id];
  const forFur = id === 'fur';
  const m = new THREE.MeshPhysicalMaterial({
    name: `${original.name}__${id}`,
    color: new THREE.Color().fromArray(info.drawing),
    map: original.map ?? (forFur ? s.white : null),
    vertexColors: original.vertexColors,
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    alphaMap: original.alphaMap ?? null,
    depthWrite: original.depthWrite,
    metalness: 0,
    roughness: p.roughness,
    specularIntensity: p.specular ?? 1,
    envMap: env,
    envMapIntensity: p.env ?? LIGHT.envIntensity,
  });
  if (info.glow) {
    // 元から光る部品(提灯の紙・ロボの目など)は、光ったまま材質だけ替える
    m.emissive.fromArray(info.glow);
    m.emissiveIntensity = 1;
    m.emissiveMap = original._liftBase ? original._liftBase.map : original.emissiveMap;
  }
  if (id === 'vinyl') {
    m.clearcoat = p.clearcoat;
    m.clearcoatRoughness = p.clearcoatRoughness;
  } else {
    m.sheen = 1;
    m.sheenColor.fromArray(tint.map((c) => Math.min(1, c * p.sheenTint + p.sheenLift) * p.sheenStrength));
    m.sheenRoughness = p.sheenRoughness;
    m.normalMap = s.normal;
    m.normalScale.set(p.normalScale, p.normalScale);
    m.roughness = 1;
    m.roughnessMap = s.orm; // G = 粗さ(0.86 ± 0.08)
    m.aoMap = s.orm; // R = くぼみの暗さ(間接の光だけ)
  }
  useLookShader(m);
  return m;
}

/**
 * しつかんの描き方を作る。stage は createStage の戻り値。
 * 戻り値: apply(character, id) → 実際に当てた id(毛の準備中は前の id)、update(character, camera)(毎フレーム、描く前に)、stateOf(character)(試験と確かめ用)
 */
export function createShitsukanLook(stage, { onFurReady = null } = {}) {
  const states = new WeakMap();
  const qTmp = new THREE.Quaternion();
  const vTmp = new THREE.Vector3();
  const sTmp = new THREE.Vector3();
  const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); // 床に寝かせる

  /** 3D の部品の読み込み(rig のキャラだけ。2D の板・VRM は対象外で null) */
  function prepare(character) {
    if (!character || character.kind !== 'rig' || character.look === '2d' || !character.gltf?.scene) return null;
    let st = states.get(character);
    if (st) return st;
    const root = character.gltf.scene;
    const faceMaterial = character.face?.mesh?.material ?? null;
    const entries = [];
    // 元から毛のあるキャラ(character.json の fur。ようこそくん)の毛の殻は、いつもの の時だけ出す(ぬの・つるつる に毛が残った)
    const ownShells = [];
    root.traverse((o) => {
      if (o.isMesh && /_fur\d+$/.test(o.name)) ownShells.push({ mesh: o, visible: o.visible });
    });
    root.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || /_fur\d+$/.test(o.name)) return;
      const m = o.material;
      if (!m.isMeshStandardMaterial) {
        entries.push({ mesh: o, original: m, kind: 'keep' });
        return;
      }
      entries.push({ mesh: o, original: m, visible: o.visible, renderOrder: o.renderOrder, ...classifyMaterial(describe(o, m, faceMaterial)) });
    });
    // キャラの高さと足元(足元の影の大きさと高さ)。止まった形で、キャラの座標で測る
    character.object3d.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const base = character.object3d.getWorldPosition(new THREE.Vector3());
    const scaleY = character.object3d.getWorldScale(new THREE.Vector3()).y || 1;
    const height = Math.max(0.1, box.max.y - box.min.y);
    st = {
      character,
      entries,
      ownShells,
      materials: new Map(), // `${id}|${元の材質の uuid}` → 差しかえる材質(部品どうしで共有)
      tints: new Map(), // 元の材質 → つやの色の元(絵の色 × 色の絵の平均 × 頂点の色の平均)
      uvReady: false,
      fur: null, // { shells, ready, pending }
      id: 'drawn',
      height,
      footY: (box.min.y - base.y) / scaleY,
      sizeOf: (mesh) => new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).length() / height,
      contact: null,
    };
    states.set(character, st);
    return st;
  }

  /** 毛羽の絵のための UV(uv1)と、毛の殻のための UV(uv が無い部品だけ)を足す。元の材質は使わない属性なので、いつもの には効かない */
  function ensureUv(st) {
    if (st.uvReady) return;
    const obj = st.character.object3d;
    obj.updateWorldMatrix(true, true);
    const toObj = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const e of st.entries) {
      if (e.kind !== 'body') continue;
      const g = e.mesh.geometry;
      if (g.userData.ycUv) continue;
      const pos = g.attributes.position;
      // getX/Y/Z で読む(縮めた GLB の整数の位置・交互に並んだ属性でも、本当の座標になる)
      const xyz = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        xyz[i * 3] = pos.getX(i);
        xyz[i * 3 + 1] = pos.getY(i);
        xyz[i * 3 + 2] = pos.getZ(i);
      }
      // 毛羽の UV は、キャラの座標(足元が原点・メートル)の真ん中の縦の軸のまわりで投げる(12 cm で絵 1 枚。部品の座標が縮めてあっても同じ細かさ)
      toObj.copy(obj.matrixWorld).invert().multiply(e.mesh.matrixWorld);
      const inObj = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.set(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]).applyMatrix4(toObj);
        inObj[i * 3] = v.x;
        inObj[i * 3 + 1] = v.y;
        inObj[i * 3 + 2] = v.z;
      }
      const uv = new THREE.BufferAttribute(cylinderUv(inObj, TILE_M, [0, 0]), 2);
      g.setAttribute('uv1', uv);
      if (!g.attributes.uv) g.setAttribute('uv', uv);
      // ならした法線(本物らしい光で輪の縞が出ないように)。いつもの に戻す時は元の法線に戻す
      const nrm = g.attributes.normal;
      if (nrm) {
        const src = new Float32Array(nrm.count * 3);
        for (let i = 0; i < nrm.count; i++) {
          src[i * 3] = nrm.getX(i);
          src[i * 3 + 1] = nrm.getY(i);
          src[i * 3 + 2] = nrm.getZ(i);
        }
        const idx = g.index ? Array.from({ length: g.index.count }, (_, i) => g.index.getX(i)) : null;
        g.userData.ycNormals = { plain: nrm, smooth: new THREE.BufferAttribute(smoothNormals(xyz, src, idx), 3) };
      }
      g.userData.ycUv = true;
    }
    st.uvReady = true;
  }

  /** 体の部品の法線を、ならした物(布・毛・つるつる)か元の物(いつもの)にする */
  function useNormals(st, smooth) {
    for (const e of st.entries) {
      const pair = e.kind === 'body' ? e.mesh.geometry.userData.ycNormals : null;
      if (pair) e.mesh.geometry.setAttribute('normal', smooth ? pair.smooth : pair.plain);
    }
  }

  function tintOf(st, e) {
    let t = st.tints.get(e.original);
    if (t) return t;
    const mapScale = e.original.map ? MAP_SHEEN_SCALE : 1;
    const vcAvg = e.original.vertexColors ? averageVertexColor(e.mesh.geometry) : null;
    t = e.drawing.map((c, k) => c * mapScale * (vcAvg ? vcAvg[k] : 1));
    st.tints.set(e.original, t);
    return t;
  }

  /** 毛のしつかんで、毛を生やさず布にする部品か(小物と小さい部品) */
  function fabricOnly(st, e) {
    // 光る部品(ロボの目・提灯の紙)にも毛を生やさない(ロボの目と口が白くにじんだ)
    if (e.fabricOnly === undefined) e.fabricOnly = Boolean(e.glow) || fabricName(e.original.name) || fabricName(e.mesh.name) || st.sizeOf(e.mesh) < FUR_MIN_SIZE;
    return e.fabricOnly;
  }

  function materialFor(st, e, id) {
    const kind = id === 'fur' && fabricOnly(st, e) ? 'fabric' : id;
    const key = `${kind}|${e.original.uuid}`;
    let m = st.materials.get(key);
    if (!m) {
      m = bodyMaterial(e.original, e, kind, ensureEnv(stage.renderer), tintOf(st, e));
      st.materials.set(key, m);
    }
    return m;
  }

  /** 毛の殻を作る(初めての時だけ。数百 ms かかるので、呼ぶ側が描く合間に回す) */
  function buildFur(st) {
    ensureUv(st);
    // 殻を作る前に、体の部品を毛の材質にする(殻はこの材質を写して作る)
    for (const e of st.entries) if (e.kind === 'body') e.mesh.material = materialFor(st, e, 'fur');
    const root = st.character.gltf.scene;
    const before = new Set();
    root.traverse((o) => before.add(o)); // 殻を作る前からある物(輪郭の殻を外す前に数える。戻した輪郭を殻と取り違えない)
    // 輪郭の殻は外しておく(毛は、毛でない部品の近くで短くなる。輪郭は体を包むので、残すと毛が生えない)。
    // 元からある毛の殻も外す(殻の材質は毛の形の材質なので、外さないと殻にも毛が生えた: ようこそくんで 96 → 912 枚)
    const outlines = [...st.entries.filter((e) => e.kind === 'outline'), ...st.ownShells].filter((e) => e.mesh.parent);
    const parents = outlines.map((e) => e.mesh.parent);
    outlines.forEach((e) => e.mesh.parent.remove(e.mesh));
    // 布だけの小物は、殻の準備の間だけ布のつやを 0 にする(furShell.js は「色の絵・法線の絵・つや」がそろった材質に毛を生やす。色の絵のある小物にも生えた)
    const plain = [...new Set(st.entries.filter((e) => e.kind === 'body' && fabricOnly(st, e)).map((e) => e.mesh.material))];
    const sheens = plain.map((m) => m.sheen);
    plain.forEach((m) => (m.sheen = 0));
    try {
      applyFur(root, { ...FUR_LOOK });
    } finally {
      outlines.forEach((e, i) => parents[i].add(e.mesh));
      plain.forEach((m, i) => (m.sheen = sheens[i]));
    }
    const shells = [];
    root.traverse((o) => {
      if (!before.has(o) && o.isMesh && /_fur\d+$/.test(o.name)) shells.push(o);
    });
    shells.forEach((o) => wrapShellShader(o.material));
    // 骨で動く殻の箱は、元の部品の箱を写す(殻の箱を後で今の姿勢から測ると、見せ方の箱が広がって置き方が変わった)
    for (const o of shells) {
      if (!o.isSkinnedMesh) continue;
      const base = st.entries.find((e) => e.mesh.geometry === o.geometry && e.mesh.isSkinnedMesh)?.mesh;
      if (!base) continue;
      if (!base.boundingBox) base.computeBoundingBox();
      if (!base.boundingSphere) base.computeBoundingSphere();
      o.boundingBox = base.boundingBox.clone();
      o.boundingSphere = base.boundingSphere.clone();
    }
    // 殻の準備で変わった物(半透明の頬の描く順・隠した板)を覚える。ほかの見た目に戻す時に元へ
    const changed = st.entries.filter((e) => e.mesh.renderOrder !== e.renderOrder || e.mesh.visible !== e.visible).map((e) => ({ e, renderOrder: e.mesh.renderOrder, visible: e.mesh.visible }));
    st.fur = { shells, changed, ready: true, pending: false };
  }

  function setFurShown(st, on) {
    if (!st.fur?.ready) return;
    st.fur.shells.forEach((o) => (o.visible = on));
    for (const c of st.fur.changed) {
      c.e.mesh.renderOrder = on ? c.renderOrder : c.e.renderOrder;
      if (c.e.kind !== 'outline') c.e.mesh.visible = on ? c.visible : c.e.visible;
    }
  }

  function contactOf(st) {
    if (st.contact) return st.contact;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactTexture(), color: 0x000000, transparent: true, opacity: LIGHT.contactOpacity, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.order = 'YXZ';
    mesh.name = 'yc_contact_shadow';
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    st.contact = mesh;
    return mesh;
  }

  /** しつかんを当てる。戻り値は実際に当てた id */
  function apply(character, wanted) {
    const st = prepare(character);
    if (!st) return 'drawn';
    let id = SHITSUKAN_IDS.includes(wanted) ? wanted : 'drawn';
    if (id === 'fur' && st.fur?.failed) id = 'fabric'; // 毛の殻を作れなかった子は、いちばん近い布で見せる
    if (id === 'fur' && !st.fur?.ready) {
      if (!st.fur?.pending) {
        st.fur = { pending: true, ready: false };
        // 描く合間に作る(押した直後のコマを止めない)。できたら次のコマで替わる
        setTimeout(() => {
          try {
            buildFur(st);
            onFurReady?.(character, true);
          } catch (err) {
            console.warn('毛の準備ができませんでした:', err?.message ?? err);
            st.fur = { pending: false, ready: false, failed: true };
            onFurReady?.(character, false);
          }
          // 準備の間に体の材質を毛にしたので、今の見た目に戻す(次の apply で替わる)
          applyMaterials(st, st.id);
        }, 30);
      }
      return st.id;
    }
    if (id !== 'drawn') ensureUv(st);
    applyMaterials(st, id);
    st.id = id;
    return id;
  }

  function applyMaterials(st, id) {
    for (const e of st.entries) {
      if (e.kind === 'body') e.mesh.material = id === 'drawn' ? e.original : materialFor(st, e, id);
      else if (e.kind === 'outline') e.mesh.visible = id === 'drawn' ? e.visible : false;
    }
    useNormals(st, id !== 'drawn');
    for (const s of st.ownShells) s.mesh.visible = id === 'drawn' ? s.visible : false;
    setFurShown(st, id === 'fur');
    const contact = contactOf(st);
    if (id === 'drawn') contact.removeFromParent();
    else if (contact.parent !== stage.scene) stage.scene.add(contact);
  }

  /** 毎フレーム(描く前に): 足元の影をキャラの足元へ・縁の光の向きを見る向きに合わせる */
  function update(character, camera) {
    const st = character ? states.get(character) : null;
    const contact = st?.contact;
    // 舞台にいない子の影は外す(見た目の切り替え・見本の子の入れ替え)。数えてから外す(外しながら数えると飛ばす)
    const stale = stage.scene.children.filter((o) => o.name === 'yc_contact_shadow' && o !== contact);
    for (const o of stale) o.removeFromParent();
    if (!st || st.id === 'drawn' || !contact) return;
    if (contact.parent !== stage.scene) stage.scene.add(contact);
    const obj = character.object3d;
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(vTmp);
    obj.getWorldQuaternion(qTmp);
    obj.getWorldScale(sTmp);
    const h = st.height;
    contact.scale.set(h * LIGHT.contactWidth, h * LIGHT.contactDepth, 1);
    contact.position.set(vTmp.x, vTmp.y + st.footY * sTmp.y + 0.004, vTmp.z);
    contact.quaternion.copy(qTmp).multiply(FLAT);
    const dir = sharedAssets().uniforms.ycRimDir.value;
    dir.set(...LIGHT.rimDir).normalize().applyQuaternion(qTmp).transformDirection(camera.matrixWorldInverse);
  }

  /** その子にその しつかん を当てられなかったか(毛の殻を作れなかった時。呼ぶ側が毎コマ頼み直さないため) */
  const failed = (character, id) => id === 'fur' && Boolean(states.get(character)?.fur?.failed);

  return { apply, update, failed, stateOf: (c) => states.get(c) ?? null, uniforms: () => sharedAssets().uniforms };
}
