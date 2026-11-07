// しつかん(3D の材質)の決まり。three を読まない小さな部品(node の試験で確かめる。web/test/shitsukan.test.mjs)。
// 本人 11/7: 「3D の材質はユーザーが選ぶ形に」→ 22:1x「端末をまたいで表現が変わるのは良くない」→ 22:5x「全部の端末で既定は布。
// 光はスマホでも動く物だけ(部屋の光・縁の光・簡単な足元の影)。PC の段の重い影とすき間の陰は使わない。毛は使う人が選んだ時だけ」。
// 描き方(three)は shitsukanLook.js、上の段の切り替えは shitsukanSwitch.js。数字の出どころは docs/重さの表.md の「しつかん」。

/** しつかんの id(character.json の looks.3d.material と同じ。画面の言葉は label) */
export const SHITSUKAN_IDS = Object.freeze(['drawn', 'fabric', 'fur', 'vinyl']);
/** 全部の端末で同じ既定(端末の段で変えない) */
export const DEFAULT_SHITSUKAN = 'fabric';

/** 画面に出す言葉。子どもにも読めるように、ひらがなで短く。sub は 2 行目の小さな説明 */
export const SHITSUKAN = Object.freeze([
  Object.freeze({ id: 'drawn', label: 'いつもの', sub: 'え の まま' }),
  Object.freeze({ id: 'fabric', label: 'ぬの', sub: 'ふわふわ' }),
  Object.freeze({ id: 'fur', label: 'け', sub: 'もこもこ', heavy: true }),
  Object.freeze({ id: 'vinyl', label: 'つるつる', sub: 'つやつや' }),
]);

/** 毛を選べる時に、スマホと弱い端末で 2 行目に足す一言と、選んだ時の知らせ */
export const HEAVY_SUB = 'おもいよ';
export const HEAVY_NOTICE = 'け は おもいので、うごきが かくかく するかも。かるくするなら「ぬの」にしてね';

// 書かれ方のゆれ(作る道 B4 が日本語で書いても読む)。知らない値は null
const ALIASES = new Map(
  Object.entries({
    drawn: 'drawn', flat: 'drawn', none: 'drawn', いつもの: 'drawn', え: 'drawn', 絵: 'drawn', えのまま: 'drawn',
    fabric: 'fabric', fleece: 'fabric', cloth: 'fabric', plush: 'fabric', ぬの: 'fabric', 布: 'fabric', ぬいぐるみ: 'fabric',
    fur: 'fur', け: 'fur', 毛: 'fur', もこもこ: 'fur',
    vinyl: 'vinyl', つるつる: 'vinyl', ソフビ: 'vinyl', つやつや: 'vinyl',
  }),
);

/** 値を id にそろえる。知らない値・空は null */
export function normalizeShitsukan(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, '');
  return ALIASES.get(key) ?? null;
}

export function labelOf(id) {
  return SHITSUKAN.find((s) => s.id === id)?.label ?? '';
}

/** 2 行目の説明。heavyNote なら、重い物(毛)は「おもいよ」にする(スマホの札の幅に収まる短さ) */
export function subOf(id, { heavyNote = false } = {}) {
  const s = SHITSUKAN.find((x) => x.id === id);
  if (!s) return '';
  return s.heavy && heavyNote ? HEAVY_SUB : s.sub;
}

/** 「おもいよ」を出す端末か。PC の強い段(high)だけ出さない(スマホ・弱い PC・ヘッドセットは出す) */
export function heavyNoteWanted(tierName) {
  return tierName !== 'high';
}

/** character.json が選んでいる しつかん(作る道が looks.3d.material に書く)。無ければ null */
export function characterDefault(json) {
  return normalizeShitsukan(json?.looks?.['3d']?.material);
}

/** このブラウザで覚えた物の鍵(キャラの id ごと) */
export const STORE_KEY = 'yc.shitsukan.v1';

function readAll(storage) {
  try {
    const raw = storage?.getItem?.(STORE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {}; // 覚えられないブラウザ(プライベートの設定など)・壊れた値は、覚えていないのと同じ
  }
}

/** このブラウザで、このキャラに選んだ しつかん。無ければ null */
export function readStored(storage, charId) {
  if (!charId) return null;
  return normalizeShitsukan(readAll(storage)[charId]);
}

/** 選んだ物を覚える。覚えられたら true */
export function writeStored(storage, charId, id) {
  if (!charId || !SHITSUKAN_IDS.includes(id) || !storage?.setItem) return false;
  try {
    const all = { ...readAll(storage), [charId]: id };
    storage.setItem(STORE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * どの しつかん で見せるか。URL の ?shitsukan=(試しと撮影。覚えない)→ このブラウザで選んだ物 → character.json → 既定(ぬの)。
 * 端末の段(tier)は見ない(どの端末でも同じ見た目)。
 */
export function pickShitsukan({ url = null, stored = null, json = null } = {}) {
  const u = normalizeShitsukan(url);
  if (u) return { id: u, from: 'url' };
  const s = normalizeShitsukan(stored);
  if (s) return { id: s, from: 'stored' };
  const c = characterDefault(json);
  if (c) return { id: c, from: 'character' };
  return { id: DEFAULT_SHITSUKAN, from: 'default' };
}

/* ---------- 材質の数字(2026-11-07 に GPU の Chrome で撮って決めた値から始め、11-08 にこの画面の絵で合わせた) ---------- */

/** 材質の型。sheenTint は布のつやの色(地の色を明るくする倍率。白へ寄せると茶色が灰色に見えた) */
// 11-08 内蔵 GPU の PC で、止めた同じ姿勢の ノリー と みかん を いつもの とくらべて合わせた(体の上の 50〜62 点の色の差の平均。docs/重さの表.md の L4)。
// 布のつやの強さ 0.75 → 0.38・面の照り(specular)1 → 0.4・色の変換を neutral に・明るさ 0.85 で、差が 17.3 → 7.7(ノリー)、12.8(みかん)。
// 映画風(aces 0.58)のままだと、暗い茶色が +15 明るく・白が −16 暗くなった(灰色っぽい茶色)。
// つるつる: 部屋の光 0.75 だと照りで暗い茶色が +15 明るく(灰色)、0.5 だと白が −12 → 0.65・粗さ 0.55・照り 0.6 の間を取った。
// 毛: 毛の殻の縁の明るさとつやで暗い茶色が +22 明るくなった → 殻の rim と sheen を下げ、部屋の光は 0.9(白を保つ)
export const LOOKS = Object.freeze({
  fabric: Object.freeze({ roughness: 0.86, roughJitter: 0.08, normalScale: 0.5, sheenTint: 1.7, sheenLift: 0.04, sheenStrength: 0.38, sheenRoughness: 0.5, specular: 0.4, env: 0.75, ao: 0.38 }),
  fur: Object.freeze({ roughness: 0.9, roughJitter: 0.08, normalScale: 0.5, sheenTint: 1.7, sheenLift: 0.04, sheenStrength: 0.4, sheenRoughness: 0.65, specular: 0.15, env: 0.8, ao: 0.38 }),
  vinyl: Object.freeze({ roughness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12, specular: 0.6, env: 0.65 }),
});

/**
 * 光(スマホでも動く物だけ): 部屋の光(環境の光。外の写真は読まない)+ 縁の光(右の後ろから)+ 足元の接地の影。
 * 色の変換(映画風の曲線)は、差しかえた材質の中だけでかける(画面のほかの物 = 2D の板・VR の板・場所の形の色は変えない)。
 * 物が落とす影(影の絵)とすき間の陰(AO の後処理)は使わない(内蔵 GPU の PC で 54 → 18 fps に落ちた。11-07 の測り)
 */
export const LIGHT = Object.freeze({
  tone: 'neutral', // 色の変換の曲線: neutral(色あいを保つ)か aces(映画風)
  exposure: 0.85, // 明るさ。絵の茶色と白に合う値(上の LOOKS の合わせ)
  envIntensity: 0.75,
  rimColor: Object.freeze([0.87, 0.92, 1.0]),
  rimStrength: 0.35,
  rimPower: 2.6,
  rimDir: Object.freeze([1.6, 1.9, -2.2]), // 右の後ろの上(キャラの座標)
  contactOpacity: 0.42,
  contactWidth: 0.62, // キャラの高さに対する、足元の影の横幅
  contactDepth: 0.5,
});

/** 毛の殻(creator/viewer/furShell.js)の設定。層の数は端末の段で変えない(どの端末でも同じ見た目。重さは「おもいよ」で知らせる) */
export const FUR_LOOK = Object.freeze({
  layers: 6, hairWidth: 0.005, soft: 0.1, tipAlpha: 0.55, rim: 0.1, stray: 2, strayReach: 0.45,
  pile: 0.22, cloud: 0.2, root: 0.88, gain: 0.94, sheen: 0.12, normal: 0.3, clear: 0.7,
});

/* ---------- 部品の分け方(どのキャラにも効くように、名前と色の数字で決める) ---------- */

// 顔の部品(目・口・歯・鼻・頬・線)。元のまま残す(色の変換からも外す)。名前の頭の 1 語で見る(頭の 1 字は小文字にしてから。
// 語のすぐ後に小文字が続く名前は別の語: Brown は brow(眉)ではない・Whitebelly は white ではない。ToothWhite・cheek1・nose_line は当たる)
const FACE_NAME_RE = /^(ink|eyes?|pupil|iris|catch|highlight|black|white|mouth|inner|tongue|tooth|teeth|pink|blush|cheek|nose|brow|lash|line|face)(?![a-z])/;
const faceName = (name) => FACE_NAME_RE.test(name.charAt(0).toLowerCase() + name.slice(1));
const OUTLINE_RE = /outline/i;
const OUTLINE_MESH_RE = /^ol_/i;
const INK_MAX = 0.02; // 絵の色(線形)のいちばん明るい成分がこれより暗い物は、線と目の黒として残す

/** 平らな塗り(発光 = 絵の色 × 0.92・地の色 = 絵の色 × 0.22 の形)の発光の倍率 */
export const FLAT_EMIT_SCALE = 0.92;

/** 発光と地の色が同じ色あいで、発光がずっと強い = 平らな塗り(絵の色は発光にある) */
export function isFlatPaint(color, emissive) {
  const ratios = [];
  for (let k = 0; k < 3; k++) {
    const c = color?.[k] ?? 0;
    const e = emissive?.[k] ?? 0;
    if (c > 1e-4) ratios.push(e / c);
    else if (e > 1e-3) return false;
  }
  if (!ratios.length) return false;
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  return lo >= 2 && hi <= 9 && hi / lo <= 1.5;
}

const sum3 = (v) => (v?.[0] ?? 0) + (v?.[1] ?? 0) + (v?.[2] ?? 0);

/**
 * 材質の扱いを決める。m = { name, meshName, color:[r,g,b](線形), emissive:[r,g,b], emissiveIntensity, ownEmissive(元から発光があるか), hasMap, transparent, faceAtlas }
 * 戻り値 { kind: 'outline'|'keep'|'body', drawing:[r,g,b](差しかえる時の地の色、線形), glow:[r,g,b](差しかえても残す発光) }
 *  - outline: 黒い輪郭の殻。本物らしい見た目では隠す(付けるとアニメのおもちゃに見えた。外すなら全部)
 *  - keep: 顔の部品・光る顔の表・頬の当て布・線と目の黒。元の材質のまま
 *  - body: 体・服・小物。布・毛・つるつるの材質に差しかえる
 */
export function classifyMaterial(m = {}) {
  const color = m.color ?? [1, 1, 1];
  const ei = Number.isFinite(m.emissiveIntensity) ? m.emissiveIntensity : 1;
  const emissive = (m.emissive ?? [0, 0, 0]).map((v) => v * ei);
  const name = String(m.name ?? '');
  const meshName = String(m.meshName ?? '');
  if (OUTLINE_RE.test(name) || OUTLINE_MESH_RE.test(meshName)) return { kind: 'outline', drawing: null, glow: null };
  if (m.faceAtlas) return { kind: 'keep', drawing: null, glow: null };
  if (m.transparent && m.hasMap) return { kind: 'keep', drawing: null, glow: null };
  if (faceName(name)) return { kind: 'keep', drawing: null, glow: null };
  const own = m.ownEmissive !== false && sum3(emissive) > 1e-4;
  const flat = own && isFlatPaint(color, emissive);
  const drawing = flat ? emissive.map((e) => Math.min(1, e / FLAT_EMIT_SCALE)) : color.slice(0, 3);
  // 色の絵(map)がある物は、色が絵にある(地の色は白のことが多い)ので、暗さでは決めない
  if (!m.hasMap && Math.max(...drawing) < INK_MAX) return { kind: 'keep', drawing: null, glow: null };
  return { kind: 'body', drawing, glow: own && !flat ? emissive : null };
}

/* ---------- UV と布の毛羽の絵(three を使わずに作る。試験できるように) ---------- */

/** 布の毛羽の絵の 1 が何メートルか(絵 1 枚 = 12 cm 四方。毛羽 1 つは 1〜3 mm) */
export const TILE_M = 0.12;

/**
 * 部品ごとの円柱の投影の UV(縦の軸のまわりの角度 × 平均の半径、高さ)。継ぎ目は真後ろの 1 本だけ(キャラは +z が正面)。
 * 頂点ごとの立方体の投げ方は、輪切りをつないだ頭・胴で向きの切りかわる輪に沿って絵が伸びた(11-07)。
 * positions は [x,y,z,...]、戻り値は [u,v,...]。center([x,z])を渡すと、その縦の軸のまわりで投げる(キャラの真ん中の軸。顔のお面のような
 * 板は、板の真ん中のまわりで投げると、真ん中の近くで角度が急に変わり、毛羽が放射の筋になった。11-08)。無ければ部品の真ん中
 */
export function cylinderUv(positions, tileM = TILE_M, center = null) {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 2);
  if (!n) return out;
  let cx = 0;
  let cz = 0;
  if (center) {
    [cx, cz] = center;
  } else {
    for (let i = 0; i < n; i++) {
      cx += positions[i * 3];
      cz += positions[i * 3 + 2];
    }
    cx /= n;
    cz /= n;
  }
  let r = 0;
  for (let i = 0; i < n; i++) r += Math.hypot(positions[i * 3] - cx, positions[i * 3 + 2] - cz);
  r = Math.max(r / n, 1e-3);
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - cx;
    const dz = positions[i * 3 + 2] - cz;
    out[i * 2] = (Math.atan2(dx, dz) * r) / tileM;
    out[i * 2 + 1] = positions[i * 3 + 1] / tileM;
  }
  return out;
}

/**
 * 法線だけをならす(形は変えない)。輪切りをつないだ頭・胴は、本物らしい光を当てると輪の段が横の縞に見えた(平らな塗りでは見えない。11-07)。
 * 同じ位置で向きの近い頂点をまとめ、となりどうしの法線を平均する × iterations 回。向きが limitDeg より違う所(箱の角など)は、まとめず・混ぜない。
 * positions・normals は [x,y,z,...]、index は三角形の頂点の番号(無ければ 3 つずつ順に)。戻り値は新しい法線(Float32Array)
 */
export function smoothNormals(positions, normals, index = null, { iterations = 8, limitDeg = 40, weld = 1e-5 } = {}) {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 3);
  if (!n) return out;
  const cosLimit = Math.cos((limitDeg * Math.PI) / 180);
  // 1. 同じ位置・近い向きの頂点を 1 つにまとめる(まとめた番号 = group)
  const group = new Int32Array(n);
  const buckets = new Map();
  const reps = []; // まとめた点の代表の頂点
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(positions[i * 3] / weld)},${Math.round(positions[i * 3 + 1] / weld)},${Math.round(positions[i * 3 + 2] / weld)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    let g = -1;
    for (const r of list) {
      const j = reps[r];
      if (normals[i * 3] * normals[j * 3] + normals[i * 3 + 1] * normals[j * 3 + 1] + normals[i * 3 + 2] * normals[j * 3 + 2] >= cosLimit) {
        g = r;
        break;
      }
    }
    if (g < 0) {
      g = reps.length;
      reps.push(i);
      list.push(g);
    }
    group[i] = g;
  }
  const m = reps.length;
  let cur = new Float32Array(m * 3);
  for (let i = 0; i < n; i++) {
    const g = group[i];
    cur[g * 3] += normals[i * 3];
    cur[g * 3 + 1] += normals[i * 3 + 1];
    cur[g * 3 + 2] += normals[i * 3 + 2];
  }
  const norm = (a, k) => {
    const l = Math.hypot(a[k * 3], a[k * 3 + 1], a[k * 3 + 2]) || 1;
    a[k * 3] /= l;
    a[k * 3 + 1] /= l;
    a[k * 3 + 2] /= l;
  };
  for (let g = 0; g < m; g++) norm(cur, g);
  // 2. となりどうしの組(まとめた番号で。同じ組は 1 回)
  const tri = index ?? Array.from({ length: n }, (_, i) => i);
  const seen = new Set();
  const ea = [];
  const eb = [];
  for (let t = 0; t + 2 < tri.length; t += 3) {
    for (const [a, b] of [[tri[t], tri[t + 1]], [tri[t + 1], tri[t + 2]], [tri[t + 2], tri[t]]]) {
      const ga = group[a];
      const gb = group[b];
      if (ga === gb) continue;
      const key = ga < gb ? ga * m + gb : gb * m + ga;
      if (seen.has(key)) continue;
      seen.add(key);
      ea.push(ga);
      eb.push(gb);
    }
  }
  // 3. 向きの近いとなりとだけ平均する × iterations 回
  for (let it = 0; it < iterations; it++) {
    const next = cur.slice();
    for (let e = 0; e < ea.length; e++) {
      const a = ea[e];
      const b = eb[e];
      if (cur[a * 3] * cur[b * 3] + cur[a * 3 + 1] * cur[b * 3 + 1] + cur[a * 3 + 2] * cur[b * 3 + 2] < cosLimit) continue;
      for (let k = 0; k < 3; k++) {
        next[a * 3 + k] += cur[b * 3 + k];
        next[b * 3 + k] += cur[a * 3 + k];
      }
    }
    for (let g = 0; g < m; g++) norm(next, g);
    cur = next;
  }
  for (let i = 0; i < n; i++) {
    const g = group[i];
    out[i * 3] = cur[g * 3];
    out[i * 3 + 1] = cur[g * 3 + 1];
    out[i * 3 + 2] = cur[g * 3 + 2];
  }
  return out;
}

function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 継ぎ目の出ない毛羽の高さ(-1..1)。格子の点に乱数を置き、なめらかにつなぐ雑音を 3 つの細かさで足す(どれも絵の幅で割り切れるので、端どうしがつながる)。
 * 細かい毛羽(周期 4 画素)が主で、ゆるい房(16・64 画素)を少し
 */
export function fleeceHeight(size = 256, seed = 20261108) {
  const out = new Float32Array(size * size);
  const octaves = [
    { cells: size / 4, amp: 1.0 },
    { cells: size / 16, amp: 0.55 },
    { cells: size / 64, amp: 0.25 },
  ];
  const rand = makeRandom(seed);
  for (const { cells, amp } of octaves) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rand() * 2 - 1;
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const fy = y / step;
      const y0 = Math.floor(fy) % cells;
      const y1 = (y0 + 1) % cells;
      const ty = fy - Math.floor(fy);
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x / step;
        const x0 = Math.floor(fx) % cells;
        const x1 = (x0 + 1) % cells;
        const tx = fx - Math.floor(fx);
        const sx = tx * tx * (3 - 2 * tx);
        const a = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * sx;
        const b = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * sx;
        out[y * size + x] += amp * (a + (b - a) * sy);
      }
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let sd = 0;
  for (const v of out) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(((out[i] - mean) / sd) * 0.9);
  return out;
}

/** 高さから法線の絵(RGBA、0..255)。端は反対の端とつなぐ */
export function normalFromHeight(h, size, strength = 2.2) {
  const out = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((-dx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((dy / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 高さから、R = くぼみの暗さ(間接の光だけに効く)・G = 粗さ(毛羽の先は少しつやを落とす)の絵(RGBA) */
export function ormFromHeight(h, size, { roughness = 0.86, roughJitter = 0.08, ao = 0.38 } = {}) {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = h[i];
    const occ = 1 - ao * Math.max(0, -v);
    const rough = Math.min(1, Math.max(0, roughness + roughJitter * v));
    out[i * 4] = Math.round(occ * 255);
    out[i * 4 + 1] = Math.round(rough * 255);
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}
