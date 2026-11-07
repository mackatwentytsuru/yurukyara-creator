// 取り付けの印(character.json の origin.made_with・origin.capabilities・origin.sample)が、画面の読み込みの決まりを変えない試験。
// 印は creator/pipeline/pk04_install.py が書く。画面の側は origin を読まないので、印があってもなくても同じ見た目を選ぶ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickLook, partsPath, twoDHint } from '../src/character/looks.js';

const root = new URL('../../characters/', import.meta.url);
const ids = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), d.name, 'character.json')))
  .map((d) => d.name);

function stamped(json) {
  return { ...json, origin: { ...(json.origin ?? {}), made_with: '1.0.0', capabilities: ['blink', 'mouth3'], sample: false } };
}

test('作例のキャラが 1 体以上ある', () => {
  assert.ok(ids.length >= 5, `キャラが少ない: ${ids}`);
});

test('印があっても、見た目の選び方・2D の部品の表の場所・2D を出せるかは同じ', () => {
  for (const id of ids) {
    const json = JSON.parse(readFileSync(new URL(`${id}/character.json`, root), 'utf8'));
    const s = stamped(json);
    for (const asked of ['', '2d', '3d']) assert.equal(pickLook(s, asked), pickLook(json, asked), `${id} ?look=${asked}`);
    assert.equal(partsPath(s), partsPath(json), id);
    assert.equal(twoDHint(s), twoDHint(json), id);
  }
});

test('印の無い前の形(origin が無い・made_with が無い)も、そのまま読める', () => {
  const old = { id: 'old', name: '前の子', model: 'model.glb', type: 'rig', persona: 'persona.md' };
  assert.equal(pickLook(old), '3d');
  assert.equal(twoDHint(old), 'no');
  assert.equal(pickLook({ ...old, origin: { input: 'words' } }), '3d');
});
