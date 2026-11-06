import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuArgs, isSoftwareRenderer, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';

test('CPU で描く描画役の名前を見分ける', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    null,
    '',
  ]) assert.equal(isSoftwareRenderer(name), true, String(name));
});

test('GPU の描画役は止めない', () => {
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M4',
    'Adreno (TM) 740',
    'Mali-G715',
  ]) assert.equal(isSoftwareRenderer(name), false, name);
});

test('起動の引数に SwiftShader を入れない', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    const args = gpuArgs(p).join(' ');
    assert.doesNotMatch(args, /swiftshader/i, p);
    assert.match(args, /--use-angle=/, p);
  }
});

test('CPU の描画なら、ブラウザを閉じて止める(exit: false で例外)', async () => {
  let closed = false;
  const page = { evaluate: async () => 'Google SwiftShader' };
  const browser = { close: async () => { closed = true; } };
  await assert.rejects(stopIfSoftwareRenderer(page, browser, { exit: false }), /CPU で描かれています/);
  assert.equal(closed, true);
});

test('GPU なら名前を返して続ける', async () => {
  const page = { evaluate: async () => 'Apple M4' };
  assert.equal(await stopIfSoftwareRenderer(page, null, { exit: false }), 'Apple M4');
});
