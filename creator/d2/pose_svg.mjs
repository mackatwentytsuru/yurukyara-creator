#!/usr/bin/env node
// 2D のキャラの「その時の姿」を、1 枚の SVG に書き出す(WebGL を使わない。CPU で見る確かめ用)。
// 会話の画面と同じ部品(web/src/char2d の Svg2DCharacter)を、決まった刻みで動かし、
// 板ごとの位置・回転・つぶしを SVG の変換(matrix)に直して重ねる。正面から見た平行の投影(遠近なし)。
//   node creator/d2/pose_svg.mjs --parts characters/norrie/2d/parts.json --out <出力.svg> --plan '<JSON>'
//   plan = [{ emotion, mouth, gesture, seconds }...](record_preview.mjs の写真の台本と同じ形。seconds だけ進める)
// 例: --plan '[{"emotion":"happy","mouth":0.6,"seconds":0.6},{"gesture":"wave","seconds":0.75}]'
// 見える板の並びは、three の透明の板と同じ: renderOrder の小さい順。表だけの板(後ろ姿の板があるキャラ)は、裏から見ると描かない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREE = await import(new URL('../../web/node_modules/three/build/three.module.js', import.meta.url).href);
const { Svg2DCharacter } = await import(new URL('../../web/src/char2d/svg2dCharacter.js', import.meta.url).href);
const { extractGroup, extractDefs, rootXmlns, MOUTH_SHAPES } = await import(new URL('../../web/src/char2d/parts.js', import.meta.url).href);

const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const partsFile = path.resolve(ROOT, arg('parts', 'characters/norrie/2d/parts.json'));
const out = path.resolve(arg('out', 'pose.svg'));
const plan = JSON.parse(arg('plan', '[{"seconds":1}]'));
const spec = JSON.parse(fs.readFileSync(partsFile, 'utf8'));
const svg = fs.readFileSync(path.join(path.dirname(partsFile), spec.svg ?? 'body.svg'), 'utf8');

const c = new Svg2DCharacter({ spec, svg, rasterize: () => new THREE.Texture(), pxPerUnit: 1 });
c.blinkTimer = 9999; // まばたきは台本の blink だけ
const h = c.heightM ?? 1;
c.lookAt([0, h * 0.9, 3.85]); // record_preview.mjs のカメラの位置(fit 1.22・画角 18 度)を見る
const DT = 1 / 30;
for (const step of plan) {
  if (step.emotion) c.setEmotion(step.emotion, step.weight ?? 1);
  if (typeof step.mouth === 'number') c.setMouth(step.mouth);
  if (step.gesture) c.play(step.gesture);
  if (step.facing) c.setFacing(step.facing);
  if (step.blink) {
    c.blinkT = 0;
  }
  const n = Math.max(1, Math.round((step.seconds ?? DT) / DT));
  for (let i = 0; i < n; i++) c.update(DT);
}
c.object3d.updateWorldMatrix(true, true);

// 板の名前 → 元の SVG の中の箱
const boxOf = (gid) => {
  if (spec.parts?.[gid]) return spec.parts[gid].box;
  if (spec.back && (spec.back.id ?? 'back') === gid) return spec.back.box;
  const layer = (spec.faceLayers ?? []).find((l) => l.id === gid);
  if (layer) return layer.box;
  const m = /^face\.[^.]+\.([^.]+)$/.exec(gid);
  if (m) return spec.face[MOUTH_SHAPES.includes(m[1]) ? 'mouth' : m[1]].box;
  return null;
};
const [vx, vy, vw, vh] = spec.viewBox;
const u = c.unit;
const ox = vx + vw / 2;
const oy = vy + vh;
const shown = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
const meshes = [];
c.object3d.traverse((o) => {
  if (!o.isMesh || !shown(o)) return;
  const gid = o.name.replace(/^2d:/, '');
  const box = boxOf(gid);
  if (!box) return;
  // 表だけの板は、裏から見えている時は描かない(正面から見るカメラ = +z の向き)
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
  if (o.material.side === THREE.FrontSide && normal.z <= 0) return;
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  const at = (x, y) => {
    const w = new THREE.Vector3((x - cx) * u, (cy - y) * u, 0).applyMatrix4(o.matrixWorld);
    return [ox + w.x / u, oy - w.y / u, w.z];
  };
  const p0 = at(0, 0);
  const px = at(1, 0);
  const py = at(0, 1);
  const m = [px[0] - p0[0], px[1] - p0[1], py[0] - p0[0], py[1] - p0[1], p0[0], p0[1]];
  meshes.push({ gid, box, m, order: o.renderOrder, z: at(cx, cy)[2] });
});
meshes.sort((a, b) => a.order - b.order || a.z - b.z);
const f = (v) => +v.toFixed(5);
const body = meshes
  .map((p, i) => {
    const [x, y, w, hh] = p.box;
    return `<clipPath id="k${i}"><rect x="${x}" y="${y}" width="${w}" height="${hh}"/></clipPath>` +
      `<g transform="matrix(${p.m.map(f).join(' ')})"><g clip-path="url(#k${i})">${extractGroup(svg, p.gid)}</g></g>`;
  })
  .join('\n');
const W = Math.round(vw);
const H = Math.round(vh);
fs.writeFileSync(out, `<svg ${rootXmlns(svg)} viewBox="${vx} ${vy} ${vw} ${vh}" width="${W}" height="${H}">${extractDefs(svg)}\n${body}\n</svg>\n`);
console.log(JSON.stringify({ out, boards: meshes.map((p) => p.gid), facing: c.state2d.facing, emotion: c.state2d.emotion, mouth: c.state2d.mouthShape, armR: +(c.groups.arm_r?.rotation.z ?? 0).toFixed(3), foreR: +(c.groups.forearm_r?.rotation.z ?? 0).toFixed(3) }));
