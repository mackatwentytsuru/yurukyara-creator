#!/usr/bin/env node
// 2D のキャラの部品を点検する。
//   node creator/d2/check_parts.mjs characters/<id>/2d                 … parts.json と SVG の点検、表情と枠の一覧
//   node creator/d2/check_parts.mjs characters/<id>/2d --base old.svg  … 表情を描き足す前の SVG と比べ、顔以外の部品が変わっていないか
// 問題があれば終わりの番号 1。描き足しは「目・眉・口の <g id="face.…"> だけ」が決まり(ほかの部品のハッシュが同じ)。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { faceVariants, listGroupIds, extractGroup, validateParts, availableExpressions, FACE_SLOTS } from '../../web/src/char2d/parts.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const baseIdx = args.indexOf('--base');
const basePath = baseIdx >= 0 ? args[baseIdx + 1] : null;
if (!dir) {
  console.error('使い方: node creator/d2/check_parts.mjs <characters/<id>/2d> [--base 前の.svg]');
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(path.join(dir, 'parts.json'), 'utf8'));
const svg = fs.readFileSync(path.join(dir, spec.svg ?? 'body.svg'), 'utf8');
const problems = validateParts(spec, svg);

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const bodyIds = (text) => listGroupIds(text).filter((id) => !id.startsWith('face.') && extractGroup(text, id) !== null);

if (basePath) {
  const base = fs.readFileSync(basePath, 'utf8');
  // 入れ子の <g id> は外側の部品に含まれるので、外側(parts.json の部品)だけを比べる
  const names = Object.keys(spec.parts ?? {});
  for (const id of names) {
    const a = extractGroup(base, id);
    const b = extractGroup(svg, id);
    if (a === null) continue; // 前の SVG に無かった部品は、新しく足した物
    if (b === null) problems.push(`部品 ${id} が消えた`);
    else if (hash(a) !== hash(b)) problems.push(`顔以外の部品 ${id} が変わった(${hash(a)} → ${hash(b)})`);
  }
  const defsA = (base.match(/<defs\b[\s\S]*?<\/defs>/g) ?? []).join('');
  const defsB = (svg.match(/<defs\b[\s\S]*?<\/defs>/g) ?? []).join('');
  if (defsA && !defsB.includes(defsA.replace(/<\/defs>$/, ''))) problems.push('defs の前からある物が変わった(足すのは後ろへ)');
}

const variants = faceVariants(listGroupIds(svg));
const table = availableExpressions(variants).map((e) => `${e}: ${FACE_SLOTS.filter((s) => variants.get(e).has(s)).join(' ')}`);
console.log(JSON.stringify({ dir, parts: bodyIds(svg), expressions: table, bytes: Buffer.byteLength(svg), problems }, null, 2));
process.exit(problems.length ? 1 : 0);
