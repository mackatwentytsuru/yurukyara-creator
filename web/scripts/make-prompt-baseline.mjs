// 指示文の見本の値(test/fixtures/prompt_baseline.json)を作り直す道具。置いてある値は、多言語を足す前の取り出し(6872b3f)で作った物。
// 指示文を意図して変えた時だけ、変えた理由と一緒に動かす: node scripts/make-prompt-baseline.mjs <取り出しの印>
// (test/ の中に置くと node --test が試験として動かして、見本を書き換えてしまうので、scripts/ に置く)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemBlocks } from '../server/prompt.mjs';
import { digestAll } from '../test/fixtures/prompt_variants.mjs';

const out = join(import.meta.dirname, '..', 'test', 'fixtures', 'prompt_baseline.json');
const body = { source: process.argv[2] ?? 'unknown', digests: digestAll(buildSystemBlocks) };
writeFileSync(out, JSON.stringify(body, null, 1) + '\n');
console.log('書きました:', out);
