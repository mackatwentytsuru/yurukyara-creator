import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 開発のときは vite(5173)が画面を配り、API とキャラ・場所のデータは会話サーバー(8787)へ回す。
const API = 'http://localhost:8787';

// 公開のリンク(Vercel)は dist だけを配る。手元のサーバーのように characters/ を直接は配らないので、
// 組み立ての時にキャラのファイルを dist/characters/ へ写す(画面は /characters/<id>/character.json を読む)。
const CHARACTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'characters');
const PUBLIC_EXT = new Set(['.json', '.md', '.glb', '.gltf', '.bin', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.ktx2']);

/**
 * dist/characters/ に入れるファイル(characters/ からの相対、/ 区切り、名前の順)。
 * キャラのフォルダの中の、決まった種類だけ。_ や . で始まる物(試しのキャラ・隠しファイル)と、VRM などは入れない。
 * @param {string} [root]
 * @returns {string[]}
 */
export function listPublicCharacterFiles(root = CHARACTERS_DIR) {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (rel && PUBLIC_EXT.has(extname(name).toLowerCase())) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

/** 組み立ての時だけ、キャラのファイルを名前を変えずに dist/characters/ へ足す */
function copyCharacters(root = CHARACTERS_DIR) {
  return {
    name: 'copy-characters',
    apply: 'build',
    generateBundle() {
      for (const rel of listPublicCharacterFiles(root)) {
        this.emitFile({ type: 'asset', fileName: `characters/${rel}`, source: readFileSync(join(root, rel)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [copyCharacters()],
  // three を 1 つにまとめる(src/stage の AR の部品も同じ three を使う)
  resolve: { dedupe: ['three'] },
  server: {
    fs: { allow: ['..'] },
    host: true,
    port: 5173,
    proxy: { '/api': API, '/characters': API },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
