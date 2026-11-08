// 公開の組み立て(vite build → dist)に、部品のライセンスの表示が入るかの試験。持ち主 S6。
// Vite 8 は部品の @license の注を落とすので、web/vite.config.js が dist/licenses.txt を置き、部品の入った JS の頭に 1 行の注を足す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_BANNER, licenseNotice, packageOfModule } from '../../vite.config.js';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));

test('モジュールのパスから部品の名前を読む(Windows の区切り・@scope・入れ子の node_modules)', () => {
  assert.equal(packageOfModule('/repo/web/node_modules/three/build/three.module.js'), 'three');
  assert.equal(packageOfModule('C:\\repo\\web\\node_modules\\@pixiv\\three-vrm\\lib\\three-vrm.module.js'), '@pixiv/three-vrm');
  assert.equal(packageOfModule('/r/node_modules/a/node_modules/@m/b/x.js'), '@m/b');
  assert.equal(packageOfModule('/repo/web/src/main.js'), null);
  assert.equal(packageOfModule('\0vite/preload-helper.js'), 'vite', 'Vite が足す読み込みの手伝い');
  assert.equal(packageOfModule('\0vite/modulepreload-polyfill.js'), 'vite');
});

test('Vite は本体の節だけを入れる(組み立てにだけ使う部品の長い節は入れない)', () => {
  const text = licenseNotice(['vite']);
  assert.match(text, /vite \d+\.\d+\.\d+ \(MIT\)/);
  assert.match(text, /Permission is hereby granted/);
  assert.doesNotMatch(text, /Licenses of bundled dependencies/);
  assert.ok(text.length < 4000, `${text.length} 字`);
});

test('licenses.txt: 部品ごとに名前・版・種類と本文。LICENSE のファイルの無い Apache-2.0 の部品には全文を添える', () => {
  const text = licenseNotice(['three', '@pixiv/three-vrm', '@mediapipe/tasks-vision', 'three']);
  const version = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../node_modules/${name}/package.json`, import.meta.url)), 'utf8')).version;
  assert.ok(text.includes(`three ${version('three')} (MIT)`));
  assert.ok(text.includes(`@pixiv/three-vrm ${version('@pixiv/three-vrm')} (MIT)`));
  assert.ok(text.includes(`@mediapipe/tasks-vision ${version('@mediapipe/tasks-vision')} (Apache-2.0)`));
  assert.equal(text.split(`three ${version('three')} (MIT)`).length, 2, '同じ部品は 1 回だけ');
  assert.match(text, /Permission is hereby granted/);
  assert.match(text, /Copyright \d{4} The MediaPipe Authors/);
  assert.match(text, /Apache License, Version 2\.0 \(full text\)/);
  assert.match(text, /END OF TERMS AND CONDITIONS/);
  assert.doesNotMatch(licenseNotice(['three']), /full text\)/, 'Apache-2.0 の部品が無ければ全文は添えない');
});

test('組み立てた dist があれば: licenses.txt に部品が並び、部品の入った JS の頭に注がある', (t) => {
  if (!existsSync(join(DIST, 'licenses.txt'))) return t.skip('dist/licenses.txt が無い(npx vite build の後に流す)');
  const text = readFileSync(join(DIST, 'licenses.txt'), 'utf8');
  for (const name of ['three ', '@pixiv/three-vrm ', '@mediapipe/tasks-vision ', 'vite ']) assert.ok(text.includes(name), name);
  const entry = readdirSync(join(DIST, 'assets')).filter((f) => /^index-.*\.js$/.test(f));
  assert.ok(entry.length >= 1);
  // 「JS の頭」= 先頭の 2 行まで。あとから読む部品がある時は、Vite が先頭に preload の 1 行(const __vite__mapDeps=…)を足すので、注は 2 行目になる
  for (const f of entry) assert.ok(readFileSync(join(DIST, 'assets', f), 'utf8').split('\n').slice(0, 2).includes(LICENSE_BANNER), f);
});
