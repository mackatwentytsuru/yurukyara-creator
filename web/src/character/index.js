import { loadVrm } from './vrmCharacter.js';
// 人型でないキャラ(type: "rig")は、キャラの柱が作った読み込み(creator/viewer/rigRuntime.js)を使う。
// CharacterBase を継いでいるので、lookAt・setExpression・setMouth・play・update は VRM と同じ呼び方。
import { loadRigCharacter } from '../../../creator/viewer/rigRuntime.js';

/** characters/<id>/ の id、または character.json の URL、または .vrm の URL を、URL にする */
export function characterUrl(spec) {
  if (!spec) return '/characters/_test/character.json';
  if (/[/.]/.test(spec)) return spec;
  return `/characters/${spec}/character.json`;
}

/**
 * キャラの入口。type が vrm でも rig でも、返る物は同じ呼び方で動く。
 *   const character = await loadCharacter(url);
 * url は characters/<id>/character.json か、.vrm を直接。character.kind は 'vrm' | 'rig'。
 */
export async function loadCharacter(url, overrides = {}) {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.vrm')) return Object.assign(await loadVrm(url, { id: 'vrm', ...overrides }), { kind: 'vrm' });
  if (!clean.endsWith('.json')) throw new Error(`知らない形式です(character.json か .vrm): ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`character.json を読めません: ${url} (${res.status})`);
  const json = await res.json();
  const type = json.type ?? 'vrm';

  if (type === 'rig') {
    // 身長合わせの大きさは、rigRuntime が中身(gltf.scene)に掛ける。object3d の座標は、メートルのまま
    return Object.assign(await loadRigCharacter(url, overrides), { kind: 'rig', expressionHints: json.expression_hints ?? {} });
  }
  if (type !== 'vrm') throw new Error(`知らない type です: ${type}`);
  const base = new URL(url, location.href);
  const config = {
    id: json.id,
    name: json.name,
    expressions: json.expressions ?? [],
    motions: json.motions ?? {},
    heightM: json.height_m ?? null,
    expressionFallback: json.expression_fallback ?? {},
    ...overrides,
  };
  const character = await loadVrm(new URL(json.model, base).href, config);
  return Object.assign(character, { kind: 'vrm', expressionHints: json.expression_hints ?? {}, personaUrl: json.persona ? new URL(json.persona, base).href : null });
}

/** そのキャラが実際に使える動きの名前(Claude に選ばせる一覧)。idle と talk は自動なので外す */
export function motionChoices(character) {
  if (character.kind === 'rig') return ['none', ...character.motionNames.filter((n) => n !== 'idle' && n !== 'talk')];
  return ['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'];
}
