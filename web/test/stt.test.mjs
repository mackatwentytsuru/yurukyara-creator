import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWav, cleanText, createStt, MAX_WAV_BYTES } from '../server/stt.mjs';
import { encodeWav } from '../src/conversation/wav.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lib', 'fake_stt_worker.mjs');
const wav = () => Buffer.from(encodeWav(new Float32Array(1600)));

function fake(mode) {
  process.env.FAKE_STT = mode;
  return createStt({ command: process.execPath, args: [FAKE], engine: 'local' });
}

test('WAV でない物、大きすぎる物は断る', () => {
  assert.throws(() => assertWav(Buffer.from('これは音ではありません。'.repeat(10))), /WAV ではありません/);
  const big = Buffer.alloc(MAX_WAV_BYTES + 1);
  big.write('RIFF', 0, 'latin1');
  big.write('WAVE', 8, 'latin1');
  assert.throws(() => assertWav(big), /長すぎます/);
});

test('無音のときに Whisper が作りがちな文は、空にする', () => {
  assert.equal(cleanText(' ご視聴ありがとうございました '), '');
  assert.equal(cleanText('ショーは何時からですか'), 'ショーは何時からですか');
  assert.equal(cleanText(undefined), '');
});

test('係へ渡した音は一時ファイルに置かれ、終わると消える', async () => {
  const stt = fake('');
  const before = readdirSync(tmpdir()).filter((f) => f.startsWith('stt_')).length;
  const r = await stt.transcribe(wav());
  assert.equal(r.text, 'ファイルがある');
  assert.equal(readdirSync(tmpdir()).filter((f) => f.startsWith('stt_')).length, before);
  stt.stop();
});

test('同時に来ても順番に答える。混みすぎたら断る', async () => {
  const stt = fake('text=はい');
  const jobs = [stt.transcribe(wav()), stt.transcribe(wav()), stt.transcribe(wav())];
  await assert.rejects(stt.transcribe(wav()), /混んでいます/);
  assert.deepEqual((await Promise.all(jobs)).map((r) => r.text), ['はい', 'はい', 'はい']);
  stt.stop();
});

test('係が落ちたら失敗を返し、次の区間では作り直す', async () => {
  const stt = fake('crash');
  await assert.rejects(stt.transcribe(wav()), /止まりました/);
  process.env.FAKE_STT = 'text=戻った';
  assert.equal((await stt.transcribe(wav())).text, '戻った');
  stt.stop();
});

test('実行ファイルが無ければ、使えない扱いにする(サーバーは止まらない)', async () => {
  const stt = createStt({ command: 'no-such-python-xyz', args: [], engine: 'local' });
  assert.equal(await stt.check(), false);
  assert.equal(stt.status().available, false);
});

test('STT_ENGINE=off なら、調べずに使えない扱いにする', async () => {
  const stt = createStt({ command: process.execPath, args: [FAKE], engine: 'off' });
  assert.equal(await stt.check(), false);
});
