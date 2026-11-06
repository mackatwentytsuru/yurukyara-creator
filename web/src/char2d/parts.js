// 2D のキャラの部品の扱い。three も DOM も使わない(node --test でそのまま試せる)。
// 1 枚の SVG に、部品を <g id="..."> で分けて描く。顔は <g id="face.<表情>.<枠>"> で、表情ごとに描き足す。
//   体の部品: parts.json の parts に書いた名前(body・head・arm_l など)
//   顔の枠:   eyes・brows・mouth_closed・mouth_half・mouth_open(口は 3 形)
import { STANDARD_EXPRESSIONS, nearestExpression } from '../character/expressionNames.js';

export const FACE_SLOTS = ['eyes', 'brows', 'mouth_closed', 'mouth_half', 'mouth_open'];
export const MOUTH_SHAPES = ['mouth_closed', 'mouth_half', 'mouth_open'];

/** 口の開き(0〜1)を 3 形のどれかにする。少しの揺れで形が行き来しないよう、前の形を少しだけ優先する */
export function mouthShape(level, prev = null, { half = 0.12, open = 0.45, hysteresis = 0.03 } = {}) {
  const v = Number.isFinite(level) ? level : 0;
  let h = half;
  let o = open;
  if (prev === 'mouth_half') { h -= hysteresis; o += hysteresis; }
  if (prev === 'mouth_open') o -= hysteresis;
  if (prev === 'mouth_closed') h += hysteresis;
  if (v >= o) return 'mouth_open';
  if (v >= h) return 'mouth_half';
  return 'mouth_closed';
}

const ID_RE = /<g\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>/g;

/** SVG の中の <g id> を全部、出てくる順に返す */
export function listGroupIds(svg) {
  return [...String(svg).matchAll(ID_RE)].map((m) => m[1]);
}

/** <g id="id"> … </g> を、入れ子の <g> を数えて丸ごと切り出す。無ければ null */
export function extractGroup(svg, id) {
  const text = String(svg);
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<g\\b[^>]*\\bid\\s*=\\s*"${esc}"[^>]*>`).exec(text);
  if (!open) return null;
  if (open[0].endsWith('/>')) return open[0];
  const tag = /<(\/?)g\b[^>]*?(\/?)>/g;
  tag.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    if (m[1]) depth -= 1;
    else if (!m[2]) depth += 1;
    if (depth === 0) return text.slice(open.index, m.index + m[0].length);
  }
  throw new Error(`<g id="${id}"> が閉じていません`);
}

/** <defs> を全部つないで返す(グラデーション・ぼかしは部品ごとの SVG にも要る) */
export function extractDefs(svg) {
  return [...String(svg).matchAll(/<defs\b[^>]*>[\s\S]*?<\/defs>/g)].map((m) => m[0]).join('\n');
}

/**
 * 1 つの部品だけを描く小さな SVG を作る。viewBox を部品の箱にするので、画像は部品の大きさだけで済む。
 * @param {string} svg 元の SVG 全体
 * @param {string} id 部品の <g id>
 * @param {number[]} box [x, y, 幅, 高さ](元の SVG の座標)
 * @param {number} pxPerUnit 元の座標 1 あたりの画素
 */
export function partSvg(svg, id, box, pxPerUnit = 1) {
  const group = extractGroup(svg, id);
  if (!group) throw new Error(`SVG に <g id="${id}"> がありません`);
  const [x, y, w, h] = box;
  const pw = Math.max(1, Math.round(w * pxPerUnit));
  const ph = Math.max(1, Math.round(h * pxPerUnit));
  return `<svg ${rootXmlns(svg)} viewBox="${x} ${y} ${w} ${h}" width="${pw}" height="${ph}">${extractDefs(svg)}${group}</svg>`;
}

/** 元の SVG の頭の xmlns(名前空間の宣言)を、そのまま部品の SVG に写す。無ければ絵にできないので止める */
export function rootXmlns(svg) {
  const root = /<svg\b[^>]*>/.exec(String(svg))?.[0] ?? '';
  const decls = root.match(/\bxmlns(?::[\w-]+)?\s*=\s*"[^"]*"/g);
  if (!decls) throw new Error('SVG の頭に xmlns がありません(ブラウザで絵にできません)');
  return decls.join(' ');
}

/** face.<表情>.<枠> の一覧から、表情 → 枠の集合 を作る */
export function faceVariants(ids) {
  const out = new Map();
  for (const id of ids) {
    const m = /^face\.([^.]+)\.([^.]+)$/.exec(id);
    if (!m || !FACE_SLOTS.includes(m[2])) continue;
    if (!out.has(m[1])) out.set(m[1], new Set());
    out.get(m[1]).add(m[2]);
  }
  return out;
}

/**
 * ある表情のときに、ある枠で出す <g id> を決める。
 * その表情に枠が無ければ、近い表情(nearestExpression の決まり)→ neutral の順にさがす。どこにも無ければ null(出さない)。
 */
export function pickFaceId(variants, emotion, slot, fallback = {}) {
  const has = (e) => variants.get(e)?.has(slot) ?? false;
  if (has(emotion)) return `face.${emotion}.${slot}`;
  const near = nearestExpression(emotion, (e) => variants.has(e) && has(e), fallback);
  if (near) return `face.${near}.${slot}`;
  return has('neutral') ? `face.neutral.${slot}` : null;
}

/**
 * parts.json と SVG を照らし合わせる。問題の一覧(日本語)を返す。空なら合格。
 * 合格の条件: 体の部品が全部 SVG にある / 箱が 4 つの数 / neutral の目と口 3 形がある / 顔の枠の箱が全部ある
 */
export function validateParts(spec, svg) {
  const problems = [];
  const ids = new Set(listGroupIds(svg));
  if (!spec || typeof spec !== 'object') return ['parts.json が読めません'];
  if (!/<svg\b[^>]*\bxmlns\s*=/.test(String(svg))) problems.push('SVG の頭に xmlns が無い');
  if (!Array.isArray(spec.viewBox) || spec.viewBox.length !== 4) problems.push('viewBox は [x, y, 幅, 高さ] の 4 つ');
  const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > 0 && b[3] > 0;
  for (const [name, p] of Object.entries(spec.parts ?? {})) {
    if (!ids.has(name)) problems.push(`部品 ${name} の <g id> が SVG に無い`);
    if (!isBox(p.box)) problems.push(`部品 ${name} の box が正しくない`);
    if (p.parent && p.parent !== 'root' && !spec.parts[p.parent]) problems.push(`部品 ${name} の親 ${p.parent} が無い`);
  }
  if (!spec.parts?.head) problems.push('head の部品が無い(顔の枠は head に付く)');
  // 顔の上の動かない部品(鼻など)。<g id> と箱が要る。体の部品(parts)と同じ名前は使わない(二重に描かれる)
  if (spec.faceLayers !== undefined && !Array.isArray(spec.faceLayers)) problems.push('faceLayers は [{ id, box }] の並び');
  for (const [i, layer] of (Array.isArray(spec.faceLayers) ? spec.faceLayers : []).entries()) {
    const name = layer?.id ?? `${i + 1} 番目`;
    if (typeof layer?.id !== 'string' || !ids.has(layer.id)) problems.push(`顔の上の部品 ${name} の <g id> が SVG に無い`);
    if (!isBox(layer?.box)) problems.push(`顔の上の部品 ${name} の box が正しくない`);
    if (layer?.id && (spec.parts?.[layer.id] || String(layer.id).startsWith('face.'))) problems.push(`顔の上の部品 ${name} の名前が、体の部品か顔の枠と同じ`);
  }
  // 後ろ姿の板(向こうを向いた時に出す。無くてもよい)
  if (spec.back !== undefined) {
    const id = spec.back?.id ?? 'back';
    if (!ids.has(id)) problems.push(`後ろ姿の板 ${id} の <g id> が SVG に無い`);
    if (!isBox(spec.back?.box)) problems.push('後ろ姿の板の box が正しくない');
    if (spec.parts?.[id] || String(id).startsWith('face.')) problems.push(`後ろ姿の板 ${id} の名前が、体の部品か顔の枠と同じ`);
  }
  for (const slot of ['eyes', 'mouth']) {
    if (!isBox(spec.face?.[slot]?.box)) problems.push(`顔の枠 ${slot} の box が無い`);
  }
  const variants = faceVariants(ids);
  for (const slot of ['eyes', ...MOUTH_SHAPES]) {
    if (!variants.get('neutral')?.has(slot)) problems.push(`face.neutral.${slot} が無い`);
  }
  for (const id of ids) {
    if (id.startsWith('face.') && !faceVariants([id]).size) problems.push(`顔の id の形が違う: ${id}(face.<表情>.<枠>)`);
  }
  return problems;
}

/** そのキャラが 2D で出せる表情(標準の 7 つの順、その後にカスタム) */
export function availableExpressions(variants) {
  const std = STANDARD_EXPRESSIONS.filter((e) => variants.has(e));
  const custom = [...variants.keys()].filter((e) => !STANDARD_EXPRESSIONS.includes(e));
  return [...std, ...custom];
}
