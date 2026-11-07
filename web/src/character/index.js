import { loadVrm } from './vrmCharacter.js';
// 人型でないキャラ(type: "rig")は、キャラの柱が作った読み込み(creator/viewer/rigRuntime.js)を使う。
// CharacterBase を継いでいるので、lookAt・setExpression・setMouth・play・update は VRM と同じ呼び方。
import { loadRigCharacter } from '../../../creator/viewer/rigRuntime.js';
// 既定のキャラの順(主役ノリー → ようこそくん)と主役。試験できるよう、別の小さな部品に置いてある
import { DEFAULT_CHARACTERS, MAIN_CHARACTER, loadFirstOf } from './defaults.js';
// 見た目の方式(3D と 2D)の決まりと、このタブで選んだ見た目の覚え方(three を読まない小さな部品)
import { LOOKS, pickLook, partsPath, twoDHint, readRemembered } from './looks.js';
import { cuteChoices } from './cuteLayer.js'; // B5G: どのキャラでも使える仕草の名前

export { DEFAULT_CHARACTERS, MAIN_CHARACTER, pickLook };

/** characters/<id>/ の id、または character.json の URL、または .vrm の URL を、URL にする */
export function characterUrl(spec) {
  if (!spec) return `/characters/${DEFAULT_CHARACTERS[0]}/character.json`;
  if (/[/.]/.test(spec)) return spec;
  return `/characters/${spec}/character.json`;
}

// 通信はこの 3 つだけ(宛先は、渡された character.json と、その中に書いてある自分のサーバーのファイル。privacy の試験が見る)
async function getJson(url, what) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${what}を読めません: ${url} (${res.status})`);
  return res.json();
}
async function getText(url, what) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${what}を読めません: ${url} (${res.status})`);
  return res.text();
}
/** そのファイルがあるか(2D の部品の表の決まりの場所を見るだけ。中身は使わない) */
async function exists(url) {
  try {
    const res = await fetch(url);
    return res.ok && /json/i.test(res.headers.get('content-type') ?? 'json');
  } catch {
    return false;
  }
}

/**
 * looks.2d(K1)から、SVG の部品を板に描く 2D のキャラを作る(S2 の char2d)。
 * looks.2d.parts は parts.json のパス(S2 の形)。書いていなければ、決まりの場所 2d/parts.json を試す。
 * SVG は parts.json の svg(parts.json からの相対)。無ければ looks.2d.svg(character.json からの相対)。
 */
async function load2d(json, base) {
  const two = json.looks?.['2d'] ?? {};
  const partsUrl = new URL(partsPath(json), base).href;
  const spec = await getJson(partsUrl, '2D の部品の表(parts.json)');
  const svgUrl = spec.svg ? new URL(spec.svg, partsUrl).href : typeof two.svg === 'string' ? new URL(two.svg, base).href : null;
  if (!svgUrl) throw new Error('2D の SVG の場所が、parts.json にも looks.2d にも書いてありません');
  const svg = await getText(svgUrl, '2D の SVG');
  const { createSvg2DCharacter } = await import('../char2d/index.js'); // 2D の時だけ読む
  const character = await createSvg2DCharacter({ spec, svg, id: json.id ?? spec.id, name: json.name ?? json.id ?? spec.id, expressionFallback: json.expression_fallback ?? {} });
  return Object.assign(character, {
    kind: '2d',
    look: '2d',
    expressionHints: json.expression_hints ?? {},
    personaUrl: json.persona ? new URL(json.persona, base).href : null,
  });
}

/**
 * キャラの入口。type が vrm でも rig でも 2D の板でも、返る物は同じ呼び方で動く。
 *   const character = await loadCharacter(url, { look: '2d' });
 * url は characters/<id>/character.json か、.vrm を直接。character.kind は 'vrm' | 'rig' | '2d'。
 * overrides.look は '2d' | '3d'(無ければ、このタブで選んだ物 → character.json の looks.default)。
 * overrides.lookMemory は、このタブで選んだ見た目を覚えている所(sessionStorage など。無ければ使わない)。ほかの値は 3D の読み込みに渡す。
 * 返すキャラには lookSource(元の URL と character.json)が付く。見た目の切り替え(availableLooks)が使う。
 */
export async function loadCharacter(url, overrides = {}) {
  const { look: askedLook = '', lookMemory = null, ...rest } = overrides;
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.vrm')) return Object.assign(await loadVrm(url, { id: 'vrm', ...rest }), { kind: 'vrm', look: '3d' });
  if (!clean.endsWith('.json')) throw new Error(`知らない形式です(character.json か .vrm): ${url}`);

  const json = await getJson(url, 'character.json ');
  const base = new URL(url, location.href);
  const lookSource = { url, json, base: base.href };
  if (pickLook(json, askedLook, lookMemory ? readRemembered(lookMemory, json.id) : '') === '2d') {
    try {
      return Object.assign(await load2d(json, base), { lookSource });
    } catch (err) {
      if (!json.model) throw err; // 3D の形も無い: 理由をそのまま出す
      console.warn(`2D で出せなかったので 3D で出します: ${err.message}`);
    }
  }
  return Object.assign(await load3d(json, url, base, rest), { lookSource });
}

/** 3D の形(rig か vrm)を読む */
async function load3d(json, url, base, rest) {
  const type = json.type ?? 'vrm';
  if (type === 'rig') {
    // 身長合わせの大きさは、rigRuntime が中身(gltf.scene)に掛ける。object3d の座標は、メートルのまま
    return Object.assign(await loadRigCharacter(url, rest), { kind: 'rig', look: '3d', expressionHints: json.expression_hints ?? {} });
  }
  if (type !== 'vrm') throw new Error(`知らない type です: ${type}`);
  const config = {
    id: json.id,
    name: json.name,
    expressions: json.expressions ?? [],
    motions: json.motions ?? {},
    heightM: json.height_m ?? null,
    expressionFallback: json.expression_fallback ?? {},
    ...rest,
  };
  const character = await loadVrm(new URL(json.model, base).href, config);
  return Object.assign(character, { kind: 'vrm', look: '3d', expressionHints: json.expression_hints ?? {}, personaUrl: json.persona ? new URL(json.persona, base).href : null });
}

/**
 * ?character= が無い時: DEFAULT_CHARACTERS(主役ノリー → ようこそくん)を順に試し、最初に読めたキャラを返す。
 * 主役の characters/norrie がまだ無い木では、404 が 1 回出て、ようこそくんになる。
 * 指定がある時は、そのキャラだけ(読めなければ理由を出す)。
 * @returns {Promise<{character: object, id: string|null}>}
 */
export async function loadFirstCharacter(spec, overrides = {}) {
  if (spec) return { character: await loadCharacter(characterUrl(spec), overrides), id: spec };
  return loadFirstOf(DEFAULT_CHARACTERS, (id) => loadCharacter(characterUrl(id), overrides), (id, err) =>
    console.info(`既定のキャラ ${id} は出せませんでした: ${err.message}`),
  );
}

/**
 * そのキャラが出せる見た目の方式(LOOKS の順。例 ['3d', '2d'])。2 つあれば、画面に切り替えを出す。
 * 3D は model があれば。2D は、いま 2D で出ている・looks.2d に部品の表の場所が書いてある・
 * looks はあるが 2d が書いていない時は決まりの場所(2d/parts.json)にある、のどれか。前の形(looks が無い)は見に行かない(404 を出さない)。
 */
export async function availableLooks(character) {
  const src = character?.lookSource;
  if (!src?.json) return [character?.look ?? '3d'];
  const { json, base } = src;
  const found = new Set([character.look ?? '3d']);
  if (json.model) found.add('3d');
  const hint = twoDHint(json);
  if (hint === 'yes' || (hint === 'probe' && character.look !== '2d' && (await exists(new URL(partsPath(json), base).href)))) found.add('2d');
  return LOOKS.filter((l) => found.has(l));
}

/**
 * そのキャラが実際に使える動きの名前(Claude に選ばせる一覧)。idle と talk は自動なので外す。
 * B5G: かわいい仕草の層(cuteLayer.js)の名前は、どのキャラでも骨や板で動く(腕の無いキャラは腕の仕草を外す)。rig の動きのファイル(bow・wave など)も残す
 */
export function motionChoices(character) {
  const cute = cuteChoices(character.cute?.caps ?? {});
  if (character.kind === 'rig') return [...new Set(['none', ...character.motionNames.filter((n) => n !== 'idle' && n !== 'talk'), ...cute])];
  return [...new Set(['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point', ...cute])];
}
