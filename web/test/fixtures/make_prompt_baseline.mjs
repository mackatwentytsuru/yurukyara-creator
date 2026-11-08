// 指示文の見本の値(prompt_baseline.json)を作り直す道具。多言語を足す前の取り出し(6872b3f)で動かした値を置いてある。
// 指示文を意図して変えた時だけ、変えた理由と一緒に動かす: node test/fixtures/make_prompt_baseline.mjs <取り出しの印>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemBlocks } from '../../server/prompt.mjs';
import { digestAll } from './prompt_variants.mjs';

const out = join(import.meta.dirname, 'prompt_baseline.json');
const body = { source: process.argv[2] ?? 'unknown', digests: digestAll(buildSystemBlocks) };
writeFileSync(out, JSON.stringify(body, null, 1) + '\n');
console.log('書きました:', out);
