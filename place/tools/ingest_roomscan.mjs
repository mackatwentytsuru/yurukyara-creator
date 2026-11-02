// 場所スキャンで撮ったフォルダ(room_mesh.usdz と landmarks_hint.json)を places/<id>/ にする。
//   node place/tools/ingest_roomscan.mjs <撮ったフォルダ> <id> [表示の名前] [--plain]
//   環境変数 BLENDER で blender の場所を変えられる(既定: Blender 5.2)。
// やること: Blender(画面なし)で USDZ → room_raw.glb、箱の大きさを測って報告、種類ごとの素材を貼って room.glb、place.json を作る。
// --plain: 素材を貼らず、room.glb を room_raw.glb と同じにする。写真の色の版(A)ができたら room_photo.glb を variants に足す。
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildPlaceJson } from './landmarks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const plain = argv.includes('--plain');
const [scanDirArg, id, nameArg] = argv.filter((a) => !a.startsWith('--'));
if (!scanDirArg || !id) {
  console.error('使い方: node place/tools/ingest_roomscan.mjs <撮ったフォルダ> <id> [表示の名前] [--plain]');
  process.exit(2);
}
const scanDir = resolve(scanDirArg);
const usdz = join(scanDir, 'room_mesh.usdz');
const hintPath = join(scanDir, 'landmarks_hint.json');
for (const p of [usdz, hintPath]) {
  if (!existsSync(p)) { console.error('見つからない:', p); process.exit(2); }
}

const outDir = join(here, '..', '..', 'places', id);
mkdirSync(outDir, { recursive: true });
const rawPath = join(outDir, 'room_raw.glb');
const glbPath = join(outDir, 'room.glb');

const blender = process.env.BLENDER ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const run = spawnSync(blender, ['-b', '--python', join(here, 'usdz_to_glb.py'), '--', usdz, rawPath], { encoding: 'utf8' });
if (run.status !== 0 || !existsSync(rawPath)) {
  console.error('Blender の変換に失敗:\n', run.stdout?.slice(-1500), run.stderr?.slice(-1500));
  process.exit(3);
}

// 箱の大きさを測る(縮尺の確かめ。巻き尺の値と比べる)
const glb = readFileSync(rawPath);
const gltf = await new Promise((ok, ng) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, ng));
const box = new THREE.Box3().setFromObject(gltf.scene);
const size = box.getSize(new THREE.Vector3());
console.log(`GLB の箱: 幅 ${size.x.toFixed(2)} m × 高さ ${size.y.toFixed(2)} m × 奥行き ${size.z.toFixed(2)} m、床側の y=${box.min.y.toFixed(2)}`);

// 撮った物の写しを残す(あとで素材や色を作り直せるように)
const scanCopy = join(outDir, 'scan');
mkdirSync(scanCopy, { recursive: true });
copyFileSync(hintPath, join(scanCopy, 'landmarks_hint.json'));
const roomJson = join(scanDir, 'room.json');
if (existsSync(roomJson)) copyFileSync(roomJson, join(scanCopy, 'room.json'));

let stylized = false;
if (plain) {
  copyFileSync(rawPath, glbPath);
} else {
  const sargs = ['-b', '--python', join(here, 'stylize_room.py'), '--', rawPath, glbPath, '--hints', hintPath];
  if (existsSync(roomJson)) sargs.push('--room', roomJson);
  const st = spawnSync(blender, sargs, { encoding: 'utf8' });
  const report = /STYLIZE_REPORT (.*)/.exec(st.stdout ?? '');
  if (!report || !existsSync(glbPath)) {
    console.error('素材貼りに失敗:\n', st.stdout?.slice(-1500), st.stderr?.slice(-800));
    process.exit(4);
  }
  stylized = true;
  console.log('素材貼り:', report[1]);
}

const hints = JSON.parse(readFileSync(hintPath, 'utf8'));
const place = buildPlaceJson({
  id,
  name: nameArg ?? id,
  hints,
  boundsXZ: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
});
// 見た目の切りかえ(?variant=)。写真の色の版(A)ができたら room_photo.glb を 'photo' として足す
place.variants = stylized ? { stylized: 'room.glb', raw: 'room_raw.glb' } : { raw: 'room_raw.glb' };
writeFileSync(join(outDir, 'place.json'), JSON.stringify(place, null, 2) + '\n', 'utf8');
console.log(`書き出した: ${outDir}(landmarks ${place.landmarks.length} 個、floor_y ${place.floor_y}、spawn ${JSON.stringify(place.spawn)})`);
