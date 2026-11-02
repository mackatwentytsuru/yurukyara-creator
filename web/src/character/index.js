import { loadVrm } from './vrmCharacter.js';
import { loadRig } from './rigCharacter.js';

/**
 * キャラの入口。type が vrm でも rig でも、返る物は同じ呼び方で動く。
 *   const character = await loadCharacter(url);
 * url は characters/<id>/character.json か、.vrm / .glb を直接。
 */
export async function loadCharacter(url, overrides = {}) {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.vrm')) return loadVrm(url, { id: 'vrm', ...overrides });
  if (clean.endsWith('.glb') || clean.endsWith('.gltf')) return loadRig(url, { id: 'rig', ...overrides });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`character.json を読めません: ${url} (${res.status})`);
  const json = await res.json();
  const base = new URL(url, location.href);
  const config = {
    id: json.id,
    name: json.name,
    expressions: json.expressions ?? [],
    motions: json.motions ?? {},
    heightM: json.height_m ?? null,
    look: json.look,
    mouth: json.mouth,
    personaUrl: json.persona ? new URL(json.persona, base).href : null,
    ...overrides,
  };
  const modelUrl = new URL(json.model, base).href;
  const type = json.type ?? 'vrm';
  if (type === 'vrm') return Object.assign(await loadVrm(modelUrl, config), { personaUrl: config.personaUrl });
  if (type === 'rig') return Object.assign(await loadRig(modelUrl, config), { personaUrl: config.personaUrl });
  throw new Error(`知らない type です: ${type}`);
}
