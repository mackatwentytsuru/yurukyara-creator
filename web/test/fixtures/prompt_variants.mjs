// 多言語(ML1)の「日本語だけは今日と 1 字も同じ」の確かめに使う、指示文の組み立ての見本の入力。
// 見本の値(prompt_baseline.json)は、多言語を足す前(297b916)の buildSystemBlocks の出力の SHA-256。
// 入力の形はここで決め、出力の値だけを置く(指示文そのものは置かない)。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', 'characters');

/** characters/ の中の、人格の文(persona.md)と character.json が両方ある子の一覧(名前順) */
export function listCharacters() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .flatMap((id) => {
      try {
        const persona = readFileSync(join(ROOT, id, 'persona.md'), 'utf8');
        const json = JSON.parse(readFileSync(join(ROOT, id, 'character.json'), 'utf8'));
        return [{ id, name: String(json.name ?? id), persona }];
      } catch {
        return [];
      }
    });
}

const PLACE = {
  name: 'まちの案内所',
  info: '受付は 1 階です。',
  landmarks: [
    { name: 'お手洗い', where: '左奥', note: '' },
    { name: '出口', where: '右前', note: '' },
  ],
};

/** 見本の入力の形(キャラごとに作る) */
export function variantsFor(ch) {
  const base = { name: ch.name, persona: ch.persona };
  return {
    plain: { character: base },
    shopPlace: {
      character: { ...base, role: 'shop' },
      place: PLACE,
      expressions: ['neutral', 'happy', 'sad', 'think'],
      motions: ['none', 'nod', 'bow', 'wave', 'tilt', 'point'],
    },
    stationNoPlace: { character: { ...base, role: 'station' } },
    homePlace: { character: { ...base, role: 'home' }, place: PLACE },
    interview: { character: base, interview: true },
    days3: { character: base, memoryDays: 3 },
  };
}

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/** { <キャラの id>: { <形>: [1 段目の SHA, 2 段目の SHA] } } */
export function digestAll(buildSystemBlocks) {
  const out = {};
  for (const ch of listCharacters()) {
    out[ch.id] = {};
    for (const [k, opts] of Object.entries(variantsFor(ch))) out[ch.id][k] = buildSystemBlocks(opts).map(sha);
  }
  return out;
}
