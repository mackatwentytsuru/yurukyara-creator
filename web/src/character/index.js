import { loadVrm } from './vrmCharacter.js';
// 人型でないキャラ(type: "rig")は、キャラの柱が作った読み込み(creator/viewer/rigRuntime.js)を使う。
// CharacterBase を継いでいるので、lookAt・setExpression・setMouth・play・update は VRM と同じ呼び方。
import { loadRigCharacter } from '../../../creator/viewer/rigRuntime.js';

/** 何も指定が無い時に出すキャラ。先頭から、読めた物を使う(主役 → 作例) */
export const DEFAULT_CHARACTERS = Object.freeze(['tegaki_neko', 'yokoso']);

/** characters/<id>/ の id、または character.json の URL、または .vrm の URL を、URL にする */
export function characterUrl(spec) {
  if (!spec) return `/characters/${DEFAULT_CHARACTERS[0]}/character.json`;
  if (/[/.]/.test(spec)) return spec;
  return `/characters/${spec}/character.json`;
}

/**
 * 見た目の方式(契約 K1 の looks)。?look=2d|3d が先、次に character.json の looks.default、無ければ 3d。
 * 3D の形(model)が無く 2D がある時は 2D、その逆は 3D にする(出せる方を出す)。
 */
export function pickLook(json, asked = '') {
  const want = String(asked ?? '').toLowerCase();
  const has2d = Boolean(json?.looks?.['2d']);
  const has3d = Boolean(json?.model);
  let look = want === '2d' || want === '3d' ? want : json?.looks?.default === '2d' ? '2d' : '3d';
  if (look === '3d' && !has3d && has2d) look = '2d';
  return look;
}

// 通信はこの 2 つだけ(宛先は、渡された character.json と、その中に書いてある自分のサーバーのファイル。privacy の試験が見る)
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

/**
 * looks.2d(K1)から、SVG の部品を板に描く 2D のキャラを作る(S2 の char2d)。
 * looks.2d.parts は parts.json のパス(S2 の形)。書いていなければ、決まりの場所 2d/parts.json を試す。
 * SVG は parts.json の svg(parts.json からの相対)。無ければ looks.2d.svg(character.json からの相対)。
 */
async function load2d(json, base) {
  const two = json.looks?.['2d'] ?? {};
  const partsUrl = new URL(typeof two.parts === 'string' ? two.parts : '2d/parts.json', base).href;
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
 * overrides.look は '2d' | '3d'(無ければ character.json の looks.default)。ほかの値は 3D の読み込みに渡す。
 */
export async function loadCharacter(url, overrides = {}) {
  const { look: askedLook = '', ...rest } = overrides;
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.vrm')) return Object.assign(await loadVrm(url, { id: 'vrm', ...rest }), { kind: 'vrm', look: '3d' });
  if (!clean.endsWith('.json')) throw new Error(`知らない形式です(character.json か .vrm): ${url}`);

  const json = await getJson(url, 'character.json ');
  const base = new URL(url, location.href);
  if (pickLook(json, askedLook) === '2d') {
    try {
      return await load2d(json, base);
    } catch (err) {
      if (!json.model) throw err; // 3D の形も無い: 理由をそのまま出す
      console.warn(`2D で出せなかったので 3D で出します: ${err.message}`);
    }
  }
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
 * ?character= が無い時: DEFAULT_CHARACTERS を順に試し、最初に読めたキャラを返す。
 * 指定がある時は、そのキャラだけ(読めなければ理由を出す)。
 * @returns {Promise<{character: object, id: string|null}>}
 */
export async function loadFirstCharacter(spec, overrides = {}) {
  if (spec) return { character: await loadCharacter(characterUrl(spec), overrides), id: spec };
  let lastErr = null;
  for (const id of DEFAULT_CHARACTERS) {
    try {
      return { character: await loadCharacter(characterUrl(id), overrides), id };
    } catch (err) {
      lastErr = err;
      console.info(`既定のキャラ ${id} は出せませんでした: ${err.message}`);
    }
  }
  throw lastErr ?? new Error('出せるキャラがありません');
}

/** そのキャラが実際に使える動きの名前(Claude に選ばせる一覧)。idle と talk は自動なので外す。2D の板は 3D と同じ手続きの動きが全部動く */
export function motionChoices(character) {
  if (character.kind === 'rig') return ['none', ...character.motionNames.filter((n) => n !== 'idle' && n !== 'talk')];
  return ['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'];
}
