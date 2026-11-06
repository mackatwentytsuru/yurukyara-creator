// 2D のキャラの入口(ブラウザ用)。parts.json の中身と SVG の文字を受け取り、部品を板にして返す。
//   const c = await createSvg2DCharacter({ spec, svg });
//   scene.add(c.object3d); 毎コマ c.update(dt)
// 返る物は CharacterBase と同じ呼び方(lookAt・setEmotion・setMouth・play・update)。
// 通信はここでしない(読み込みは web/src/character/index.js の決まった 1 か所に任せる。privacy の試験の決まり)。
// main.js への 1 行と、character/index.js の looks.2d の読み込みは S5 が付ける。
import * as THREE from 'three';
import { Svg2DCharacter } from './svg2dCharacter.js';

/**
 * SVG の文字 → 絵(テクスチャ)。自分で作った SVG の文字を、その場の blob の URL にして three の読み込みで絵にする。
 * 外へは何も送らない。絵は読み込みが済んだら出る(それまでは透明)。
 */
export function svgTextureRasterizer() {
  const loader = new THREE.TextureLoader();
  const pending = [];
  const rasterize = (svgText) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    let tex;
    pending.push(
      new Promise((resolve, reject) => {
        tex = loader.load(
          url,
          () => {
            URL.revokeObjectURL(url);
            resolve();
          },
          undefined,
          () => {
            URL.revokeObjectURL(url);
            reject(new Error('SVG の部品を絵にできません'));
          },
        );
      }),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  return { rasterize, ready: () => Promise.all(pending) };
}

/** parts.json の中身と SVG の文字から 2D のキャラを作る。絵が全部できるまで待ってから返す */
export async function createSvg2DCharacter({ spec, svg, ...overrides }) {
  const r = svgTextureRasterizer();
  const character = new Svg2DCharacter({ spec, svg, rasterize: r.rasterize, pxPerUnit: spec.pxPerUnit ?? 1, ...overrides });
  await r.ready();
  return character;
}

export { Svg2DCharacter };
