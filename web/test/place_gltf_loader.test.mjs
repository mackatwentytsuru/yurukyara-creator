// GLB の読み込みの共通の口(character/gltfLoader.js)の試験。meshopt の解凍が付き、縮めていない今の GLB もそのまま読める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGltfLoader, MeshoptDecoder } from '../src/character/gltfLoader.js';

test('読み込みの口に meshopt の解凍が付いている(解凍の部品は動く)', async () => {
  const loader = createGltfLoader();
  assert.equal(loader.meshoptDecoder, MeshoptDecoder);
  await MeshoptDecoder.ready;
  assert.equal(MeshoptDecoder.supported, true);
});

test('縮めていない今の GLB(ロボくん、絵なし)は、そのまま読める: 形・骨・シェイプキー', async () => {
  const buf = fs.readFileSync(new URL('../../characters/robo/model.glb', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((resolve, reject) => createGltfLoader().parse(ab, '', resolve, reject));
  let meshes = 0;
  let skinned = 0;
  let morphs = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (o.isSkinnedMesh) skinned += 1;
    morphs = Math.max(morphs, Object.keys(o.morphTargetDictionary ?? {}).length);
  });
  assert.ok(meshes > 0, `形 ${meshes}`);
  assert.ok(skinned > 0, `骨のある形 ${skinned}`);
  assert.ok(morphs > 0, `シェイプキー ${morphs}`);
  const used = gltf.parser.json.extensionsUsed ?? [];
  assert.ok(!used.includes('EXT_meshopt_compression'), '今の作例は縮めていない(縮めた時はこの行を直す)');
});
