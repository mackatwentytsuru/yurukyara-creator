import { defineConfig } from 'vite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// 組み立てに入った部品(node_modules)のライセンスの文を dist/licenses.txt に置き、部品の入った JS の頭に 1 行の注で場所を示す。
// Vite 8 の組み立ては部品の @license の注を落とすので、MIT と Apache-2.0 の「配る物に表示を添える」決まりをここで守る。
const NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), 'node_modules');
export const LICENSE_BANNER = '/*! Third-party licences for this build: /licenses.txt */';
const RULE = '='.repeat(72);

/** モジュールの id(パス)から、いちばん奥の node_modules の部品の名前を読む(@scope/name も)。部品でなければ null。
 *  Vite が足す小さな部品(読み込みの手伝い・modulepreload の補い)は、名前だけの id なので vite とする */
export function packageOfModule(id) {
  const s = String(id);
  if (/(^|\0)vite\/(preload-helper|modulepreload-polyfill)/.test(s)) return 'vite';
  const all = [...s.matchAll(/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g)];
  return all.length ? all.at(-1)[1].replace('\\', '/') : null;
}

/** 部品の中の LICENSE のファイル。無ければ、型の文書の頭の Copyright の 1 行(MediaPipe は LICENSE のファイルを持たない) */
function licenseOf(dir) {
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'].map((f) => join(dir, f)).find((p) => existsSync(p));
  // Vite の LICENSE.md は、本体の節の後に、組み立てに使う部品(画面には入らない)の長い節が続く。本体の節だけを使う
  if (file) return { text: readFileSync(file, 'utf8').split(/\n# Licenses of bundled dependencies/)[0].trim(), full: true };
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.d.ts')).sort()) {
    const m = /Copyright \d{4}[^\n*]*/.exec(readFileSync(join(dir, name), 'utf8').slice(0, 2000));
    if (m) return { text: m[0].trim(), full: false };
  }
  return { text: '', full: false };
}

/** node_modules の中から Apache License 2.0 の全文を 1 つ探す(LICENSE のファイルを持たない Apache-2.0 の部品に添える) */
function apacheText(nodeModules) {
  const dirs = readdirSync(nodeModules).flatMap((n) => (n.startsWith('@') ? readdirSync(join(nodeModules, n)).map((m) => join(nodeModules, n, m)) : [join(nodeModules, n)]));
  for (const dir of dirs.sort()) {
    const file = join(dir, 'LICENSE');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/^\s*Apache License\s+Version 2\.0, January 2004/.test(text) && /END OF TERMS AND CONDITIONS/.test(text)) return text.slice(0, text.indexOf('END OF TERMS AND CONDITIONS') + 27).trim();
  }
  throw new Error('Apache License 2.0 の全文が node_modules に見つかりません(licenses.txt を作れません)');
}

/** licenses.txt の中身。部品ごとに名前・版・ライセンスの種類と本文。LICENSE のファイルの無い Apache-2.0 の部品には全文を最後に添える */
export function licenseNotice(names, nodeModules = NODE_MODULES) {
  const out = ['Third-party software in this build (web/dist). Each part keeps its own licence.', 'The list of all parts with versions is THIRD_PARTY.md in the repository.', ''];
  let apache = false;
  for (const name of [...new Set(names)].sort()) {
    const dir = join(nodeModules, ...name.split('/'));
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lic = licenseOf(dir);
    out.push(RULE, `${pkg.name} ${pkg.version} (${pkg.license})`, '', lic.text);
    if (!lic.full && pkg.license === 'Apache-2.0') {
      apache = true;
      out.push('Licensed under the Apache License, Version 2.0 (full text at the end of this file).');
    }
    out.push('');
  }
  if (apache) out.push(RULE, 'Apache License, Version 2.0 (full text)', '', apacheText(nodeModules), '');
  return out.join('\n');
}

/** 組み立ての時だけ: 部品の入った JS の頭に注を足し、dist/licenses.txt を置く */
function licenseNotices() {
  return {
    name: 'license-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const names = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const pkgs = (chunk.moduleIds ?? Object.keys(chunk.modules ?? {})).map(packageOfModule).filter(Boolean);
        if (!pkgs.length) continue;
        pkgs.forEach((p) => names.add(p));
        chunk.code = `${LICENSE_BANNER}\n${chunk.code}`;
      }
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: licenseNotice([...names]) });
    },
  };
}

export default defineConfig({
  plugins: [copyCharacters(), licenseNotices()],
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
