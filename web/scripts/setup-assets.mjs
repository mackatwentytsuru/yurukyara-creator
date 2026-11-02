// 起動に要る外の部品を public/mediapipe に用意する。
// - wasm: node_modules の @mediapipe/tasks-vision からコピーする
// - 顔のランドマークのモデル(口の動きで話している人を選ぶのに使う): Google 公式の保管先から 1 回だけ取る(docs/部品の一覧.md)
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

mkdirSync(outDir, { recursive: true });

if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(outDir, 'wasm'), { recursive: true });
  console.log('wasm をコピーしました');
} else {
  console.warn('wasm が見つかりません(npm install の前に実行されたかもしれません)');
}

const modelPath = join(outDir, 'face_landmarker.task');
if (!existsSync(modelPath)) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('顔のランドマークのモデルを取得しました');
  } catch (err) {
    console.warn(`顔のランドマークのモデルを取れませんでした: ${err.message}`);
  }
}
