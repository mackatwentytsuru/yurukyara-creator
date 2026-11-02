// 取りこんだ places/<id>/ が、偽の撮影(place/testdata/fake_scan)の正しい結果かを機械で判定する。
//   node place/tools/check_ingest.mjs <id>        → 合格なら終了コード 0、落ちたら理由を並べて 1
// 偽の撮影の正解: 4×5 m・高さ 2.5 m の部屋を 30 度回した物(箱 約 6.05×2.55×6.42 m)、床 y=-1.3、
// ドア・窓・テーブル・ソファ、ドアのほうを向く spawn(yaw 約 61 度)。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlaceJson } from '../web/placeSchema.js';

const id = process.argv[2];
if (!id) {
  console.error('使い方: node place/tools/check_ingest.mjs <id>');
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'places', id);
const problems = [];
const need = (cond, text) => { if (!cond) problems.push(text); };

function glbJson(path) {
  const b = readFileSync(path);
  if (b.toString('latin1', 0, 4) !== 'glTF') throw new Error('GLB ではない');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}

for (const f of ['place.json', 'room.glb', 'room_raw.glb']) need(existsSync(join(dir, f)), `${f} が無い`);
if (problems.length === 0) {
  const place = parsePlaceJson(JSON.parse(readFileSync(join(dir, 'place.json'), 'utf8')));
  need(place.id === id, `id が ${id} でない(${place.id})`);
  need(Math.abs(place.floor_y - -1.3) < 0.02, `floor_y が -1.3 でない(${place.floor_y})`);
  need(Math.abs(place.spawn.yaw_deg - 61) < 2, `spawn の yaw が約 61 度でない(${place.spawn.yaw_deg})`);
  need(place.variants.stylized === 'room.glb' && place.variants.raw === 'room_raw.glb', 'variants に stylized と raw が無い');
  const names = place.landmarks.map((l) => l.name);
  for (const n of ['ドア', '窓', 'テーブル', 'ソファ']) need(names.includes(n), `landmarks に「${n}」が無い(${names.join(',')})`);
  const door = place.landmarks.find((l) => l.name === 'ドア');
  need(door && Math.abs(door.position[1] - 1) < 0.1, 'ドアの y が床基準の約 1.0 m でない');

  const styled = glbJson(join(dir, 'room.glb'));
  const raw = glbJson(join(dir, 'room_raw.glb'));
  need((styled.materials?.length ?? 0) >= 5, `room.glb の材質が 5 つ未満(${styled.materials?.length ?? 0})`);
  need((styled.images?.length ?? 0) >= 4, `room.glb に埋めこんだ画像が 4 枚未満(${styled.images?.length ?? 0})`);
  need((raw.images?.length ?? 0) === 0, 'room_raw.glb に画像が入っている(素材貼り前のはず)');
  need(existsSync(join(dir, 'scan', 'room.json')) && existsSync(join(dir, 'scan', 'landmarks_hint.json')), 'scan/ に撮った物の写しが無い');
}
if (problems.length > 0) {
  console.log('不合格:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('合格: 取りこみは偽の撮影の正解と合っている');
