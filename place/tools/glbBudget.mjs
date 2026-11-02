// GLB の受入検査: 三角面数・材質数・テクスチャの大きさ・ファイルの重さを測って、採用 / 警告 / 却下を返す。
//   node place/tools/glbBudget.mjs <GLB>...        → 1 つでも却下なら終了コード 1
// 基準(外の調査メモの目安を、本番の実機で測って直す前の仮の値): 三角面数 3 万以下が普通、5 万を超えたら却下(iPhone の AR)、
//   ファイル 5 MB 以下が普通、15 MB を超えたら却下、テクスチャは 1 辺 1024 以下が普通・2048 を超えたら却下。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ImageUtils, NodeIO } from '@gltf-transform/core';

export const LIMITS = {
  warn: { triangles: 30_000, bytes: 5 * 1024 * 1024, texture: 1024 },
  reject: { triangles: 50_000, bytes: 15 * 1024 * 1024, texture: 2048 },
};

/** @param {Uint8Array} bytes GLB のバイト列 */
export async function measureGlb(bytes) {
  const doc = await new NodeIO().readBinary(bytes);
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      triangles += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
    }
  }
  const textures = root.listTextures().map((t) => {
    const size = ImageUtils.getSize(t.getImage(), t.getMimeType());
    return { name: t.getName(), width: size?.[0] ?? 0, height: size?.[1] ?? 0 };
  });
  return {
    bytes: bytes.byteLength,
    triangles,
    materials: root.listMaterials().length,
    meshes: root.listMeshes().length,
    textures,
    maxTexture: Math.max(0, ...textures.flatMap((t) => [t.width, t.height])),
  };
}

/** @returns {{verdict:'採用'|'警告'|'却下', reasons:string[]}} */
export function judgeBudget(m, limits = LIMITS) {
  const reasons = [];
  let verdict = '採用';
  const check = (value, key, label, unit = '') => {
    if (value > limits.reject[key]) { verdict = '却下'; reasons.push(`${label}が多すぎる: ${value}${unit}(却下の線 ${limits.reject[key]}${unit})`); }
    else if (value > limits.warn[key]) { if (verdict === '採用') verdict = '警告'; reasons.push(`${label}が目安を超えた: ${value}${unit}(目安 ${limits.warn[key]}${unit})`); }
  };
  check(m.triangles, 'triangles', '三角面数');
  check(m.bytes, 'bytes', 'ファイルの重さ', ' バイト');
  check(m.maxTexture, 'texture', 'テクスチャの辺', ' px');
  return { verdict, reasons };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  if (files.length === 0) { console.error('使い方: node place/tools/glbBudget.mjs <GLB>...'); process.exit(2); }
  let rejected = false;
  for (const f of files) {
    const m = await measureGlb(readFileSync(f));
    const j = judgeBudget(m);
    if (j.verdict === '却下') rejected = true;
    console.log(`${j.verdict}: ${f}(三角面 ${m.triangles}、材質 ${m.materials}、テクスチャ最大 ${m.maxTexture}px、${(m.bytes / 1024).toFixed(0)} KB)${j.reasons.length ? '\n  - ' + j.reasons.join('\n  - ') : ''}`);
  }
  process.exit(rejected ? 1 : 0);
}
