// GLB の読み込みの共通の口(キャラ・動き・VRM・場所の 3 か所が使う)。
// meshopt で縮めた GLB(EXT_meshopt_compression)も読めるようにする。解凍の部品は three に同梱の物で、画面の部品は増えない。
// 縮めていない GLB には何も起きない(今の作例 4 体はそのまま)。KTX2 の絵は、変換の道具が決まるまで使わない(docs/重さの表.md)。
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** meshopt の解凍を付けた GLTFLoader を作る */
export function createGltfLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export { MeshoptDecoder };
