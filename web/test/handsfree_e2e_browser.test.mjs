// ハンズフリーの通し(画面なしの Chrome・本物の画面・本物のサーバーの聞き取り)。
//  ① 日本語 5 回分の偽のマイク(--use-file-for-fake-audio-capture)で「はなす」を 1 回だけ押す → 何も押さずに 5 回の会話が回る(?stt=server・仮の頭脳)
//  ② QA8 ③: 許可の窓が開いている間に「はなす」を 2 回押しても、マイクが開いたままにならない(そのあと普通に聞き始められる)
// 重いので YC_BROWSER_TESTS=1 のときだけ動く。WebGL は GPU(共有の機械なら、GPU の札を取って流す)。dist(vite build の出力)・Windows の日本語の読み上げ・faster-whisper・Chrome が無い時は飛ばす。
// 自分用のポートは 9332(B13V の持ち分 9330〜9339)。止めるのは自分で起こしたサーバーと Chrome だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeMicWav, runDoubleTap, runHandsfree, startOwnServer } from '../scripts/handsfree-e2e.mjs';

const WEB = join(import.meta.dirname, '..');
const PORT = Number(process.env.HANDSFREE_PORT ?? 9332);
const SKIP = process.env.YC_BROWSER_TESTS !== '1'
  ? '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ'
  : !existsSync(join(WEB, 'dist', 'index.html'))
    ? 'dist が無い(先に vite build)'
    : process.platform !== 'win32'
      ? '偽のマイクの声を作るのに Windows の日本語の読み上げを使う'
      : false;

test('ハンズフリー: 「はなす」を 1 回押したあとは、何も押さずに 5 回の会話が回る(聞き取りはサーバー)', { skip: SKIP, timeout: 240000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-'));
  let server;
  try {
    const mic = makeFakeMicWav(dir, { gapS: 9, leadS: 4 });
    if (!mic) return t.skip('日本語の読み上げが使えない');
    server = await startOwnServer(PORT);
    // ほかの試験が同時に走って重い時は、聞き取りの確認が遅れて「使えない」と出ることがある。最大 60 秒、待ってから決める
    let status = await (await fetch(`${server.base}/api/status`)).json();
    for (let i = 0; i < 30 && !status.stt?.available; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      status = await (await fetch(`${server.base}/api/status`)).json();
    }
    if (!status.stt?.available) return t.skip('サーバーの聞き取り(faster-whisper)が使えない');
    const r = await runHandsfree({ base: server.base, wavPath: mic.path, timeoutMs: (mic.totalS + 40) * 1000 });
    assert.equal(r.clicks, 1, '押したのは 1 回だけ');
    assert.equal(r.turns, 5, `5 回の会話が回った(chat ${r.chatCalls.map((c) => c.text).join(' | ')})`);
    assert.equal(r.sttCalls.filter((s) => s.text).length >= 5, true, '聞き取りが 5 回文字を返した');
    // 順番どおり・取りこぼしなし(聞き取りの字が少し違っても、会話は 5 回)
    for (let i = 1; i < r.chatCalls.length; i++) assert.ok(r.chatCalls[i].at > r.chatCalls[i - 1].at, '時刻が進んでいる');
    assert.equal(r.end.pressed, 'true', '最後まで聞き続けている');
    assert.ok(r.end.liveAudioTracks <= 2, `マイクが開いたまま増えていない(${r.end.liveAudioTracks} 本。聞き取り 1 本 + 声の向きの 1 本まで)`);
    assert.deepEqual(r.problems, [], 'console の error なし');
  } finally {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA8 ③: 許可の窓が開いている間に「はなす」を 2 回押しても、マイクは開いたままにならない・そのあと普通に聞ける', { skip: SKIP, timeout: 120000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-'));
  let server;
  try {
    const mic = makeFakeMicWav(dir, { gapS: 2, leadS: 1, texts: ['こんにちは'] });
    if (!mic) return t.skip('日本語の読み上げが使えない');
    server = await startOwnServer(PORT + 1);
    const r = await runDoubleTap({ base: server.base, wavPath: mic.path });
    assert.equal(r.afterDouble.pressed, 'false', '2 回押したので、聞いていない');
    assert.equal(r.afterDouble.live, 0, `マイクが開いたまま残っていない(${r.afterDouble.live} 本)`);
    assert.equal(r.afterThird.pressed, 'true', 'もう 1 回押せば聞き始める');
    assert.ok(r.afterThird.live >= 1, '聞いている間はマイクが開いている');
    assert.equal(r.afterStop.pressed, 'false');
    assert.equal(r.afterStop.live, 0, '止めたら、マイクは全部閉じる');
  } finally {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
