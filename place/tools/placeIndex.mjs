// places/index.json を作り直す。デモのページが「場所」の選び口を出すための一覧(新しい順)。
// ARステージは開く URL を組み立て時に固定するので、新しく撮った部屋はこの一覧から選んで開く。
//   node place/tools/placeIndex.mjs   (ingest_roomscan.mjs も最後に呼ぶ)
// 先頭が _ のフォルダ(試し用)は入れない。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultPlacesDir = resolve(here, '..', '..', 'places');

/** placesDir の中の place.json を持つフォルダを新しい順に並べて返す。 */
export function listPlaces(placesDir = defaultPlacesDir) {
  return readdirSync(placesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(placesDir, d.name, 'place.json')))
    .map((d) => {
      const file = join(placesDir, d.name, 'place.json');
      const name = JSON.parse(readFileSync(file, 'utf8')).name ?? d.name;
      return { id: d.name, name, mtime: statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ id, name }) => ({ id, name }));
}

export function writePlaceIndex(placesDir = defaultPlacesDir) {
  const places = listPlaces(placesDir);
  writeFileSync(join(placesDir, 'index.json'), JSON.stringify({ places }, null, 2) + '\n', 'utf8');
  return places;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const places = writePlaceIndex();
  console.log(`places/index.json: ${places.map((p) => p.id).join(', ') || '(なし)'}`);
}
