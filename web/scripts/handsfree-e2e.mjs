// ハンズフリーの通し試験(画面なしの Chrome)。「はなす」を 1 回だけ押したあとは、何も押さずに 5 回会話が回ることを確かめる。
//   node scripts/handsfree-e2e.mjs --port 9331 [--gap 9] [--out result.json] [--keep-wav dir]
// 仕組み:
//   1. 日本語の短い発話 5 つ(Windows の日本語の読み上げで作る)を、無音ではさんだ WAV にする
//   2. Chrome を --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<WAV> で起こす(偽のマイクがその WAV を流す)
//   3. 自分用のサーバーを --port で立てる(鍵なし = 仮の頭脳。声の鍵なし = 字幕だけ。聞き取りは、このサーバーの faster-whisper)
//   4. ?stt=server で開き、「はなす」を 1 回押す。あとは、/api/stt の答えと /api/chat の呼びが 5 回に届くかを待つ
// WebGL は GPU で描く(CPU の描画なら止める)。共有の機械では、呼ぶ前に GPU の札を取る。止めるのは自分で起こしたサーバーと Chrome だけ。
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';
import { UTTERANCES, composeWav, synthJapanese } from './lib/handsfreeWav.mjs';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 自分用のサーバーを立てる(鍵は全部外す = 仮の頭脳・字幕だけ)。{ proc, base, stop } を返す */
export async function startOwnServer(port) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE']) delete env[k];
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) return { proc, base, log: () => out, stop: () => proc.kill() };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** 偽のマイクの WAV を作って、置き場所と、発話の時刻の表を返す。作れなければ null */
export function makeFakeMicWav(dir, { gapS = 9, leadS = 4, texts = UTTERANCES } = {}) {
  const files = synthJapanese(texts, join(dir, 'utt'));
  if (!files) return null;
  const { wav, startsS, durS, totalS } = composeWav(files, { gapS, leadS });
  const path = join(dir, 'fake_mic.wav');
  writeFileSync(path, wav);
  return { path, startsS, durS, totalS, texts };
}

/**
 * 通しを 1 回流す。
 * @returns {Promise<object>} { turns, texts, chatCalls, sttCalls, clicks, micGetUserMedia, liveTracks, pressed, ... }
 */
export async function runHandsfree({ base, wavPath, expectTurns = 5, timeoutMs = 150000, character = 'yokoso', shots = '' }) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: [
      ...GPU_ARGS,
      '--use-fake-ui-for-media-stream', // 許可の窓を自動で「許可」にする(窓の押し方の試験ではない)
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 800 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 160)}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    const t0 = Date.now();
    const sec = () => +((Date.now() - t0) / 1000).toFixed(1);
    const chatCalls = [];
    const sttCalls = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      const u = new URL(req.url()).pathname;
      if (u === '/api/chat') {
        let text = '';
        try {
          text = JSON.parse(req.postData() ?? '{}').text ?? '';
        } catch {
          // 本文が読めなくても数える
        }
        chatCalls.push({ at: sec(), text });
      }
    });
    page.on('response', async (res) => {
      if (res.request().method() !== 'POST' || new URL(res.url()).pathname !== '/api/stt') return;
      try {
        const j = await res.json();
        sttCalls.push({ at: sec(), text: j.text ?? '', ms: j.ms ?? null, silent: Boolean(j.silent) });
      } catch {
        sttCalls.push({ at: sec(), text: '', ms: null, silent: false });
      }
    });
    // マイクを取った数・今開いているマイクの数(2 本目が開いたまま残っていないかを見る)
    await page.addInitScript(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      window.__mic = { calls: 0, streams: [] };
      md.getUserMedia = async (c) => {
        const s = await orig(c);
        if (c?.audio) {
          window.__mic.calls += 1;
          window.__mic.streams.push(s);
        }
        return s;
      };
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => (String(u).includes('/api/metrics') ? Promise.resolve(new Response('{}')) : of(u, o)); // 実測の記録を汚さない
    });
    await page.goto(`${base}/?character=${character}&auto=0&stt=server`);
    await stopIfSoftwareRenderer(page, browser); // CPU の描画なら止める
    try {
      await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 60000 });
    } catch (err) {
      throw new Error(`舞台が出ませんでした: ${problems.join(' / ')} (${err.message})`);
    }
    await page.getByText('カメラなしで試す').click();
    await page.waitForFunction(() => window.__app?.status?.stt?.available === true, null, { timeout: 60000 });
    // 唯一のタップ。このあとは、画面に何も触らない
    await page.click('#micBtn');
    const tapAt = sec();
    await page.waitForFunction(() => document.getElementById('micBtn')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    const listenAt = sec();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && chatCalls.length < expectTurns) await page.waitForTimeout(500);
    // 5 回目の返事が出終わるまで少し待ち、その後も聞いているか(ボタンが押されたまま・マイクが 1 本だけ)を見る
    await page.waitForTimeout(3000);
    const end = await page.evaluate(() => ({
      pressed: document.getElementById('micBtn')?.getAttribute('aria-pressed'),
      provider: window.__app?.status?.stt?.available ? 'server' : '?',
      micCalls: window.__mic.calls,
      liveAudioTracks: window.__mic.streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live').length,
      speaking: Boolean(window.__app?.speaker?.speaking),
    }));
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'handsfree_end.png') });
    }
    return {
      turns: chatCalls.length,
      expectTurns,
      clicks: 1,
      tapAt,
      listenAt,
      chatCalls,
      sttCalls,
      end,
      problems: problems.slice(0, 10),
      totalS: sec(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * QA8 ③: 許可の窓が開いている間(マイクの答えが遅い)に「はなす」を 2 回押しても、マイクが開いたままにならない。
 * 本物の窓は出せないので、getUserMedia の答えを 1.5 秒遅らせて「窓が開いている間」を作る。そのあと、もう 1 回押せば普通に聞き始める(取り消しが残らない)ことも確かめる。
 */
export async function runDoubleTap({ base, wavPath, character = 'yokoso' }) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: [...GPU_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 800 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      window.__mic = { calls: 0, streams: [], delayMs: 0 };
      md.getUserMedia = async (c) => {
        if (c?.audio && window.__mic.delayMs) await new Promise((r) => setTimeout(r, window.__mic.delayMs));
        const s = await orig(c);
        if (c?.audio) {
          window.__mic.calls += 1;
          window.__mic.streams.push(s);
        }
        return s;
      };
      const of = window.fetch.bind(window);
      window.fetch = (u, o) => (String(u).includes('/api/metrics') ? Promise.resolve(new Response('{}')) : of(u, o));
    });
    await page.goto(`${base}/?character=${character}&auto=0&stt=server`);
    await stopIfSoftwareRenderer(page, browser);
    await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 60000 });
    await page.getByText('カメラなしで試す').click();
    await page.waitForFunction(() => window.__app?.status?.stt?.available === true, null, { timeout: 60000 });
    const state = () => page.evaluate(() => ({
      pressed: document.getElementById('micBtn')?.getAttribute('aria-pressed'),
      calls: window.__mic.calls,
      live: window.__mic.streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === 'live').length,
    }));
    await page.evaluate(() => { window.__mic.delayMs = 1500; });
    await page.click('#micBtn'); // 1 回目: 窓が開く(答えは 1.5 秒後)
    await page.waitForTimeout(300);
    await page.click('#micBtn'); // 2 回目: 窓が開いている間
    await page.waitForTimeout(4000); // 答えが来る時間を十分に待つ
    const afterDouble = await state();
    // 取り消しが残らないか: 遅れを無くして、もう 1 回押す
    await page.evaluate(() => { window.__mic.delayMs = 0; });
    await page.click('#micBtn');
    await page.waitForFunction(() => document.getElementById('micBtn')?.getAttribute('aria-pressed') === 'true', null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    const afterThird = await state();
    // 止めると、全部閉じる
    await page.click('#micBtn');
    await page.waitForTimeout(500);
    const afterStop = await state();
    return { afterDouble, afterThird, afterStop };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- 手で流す ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const port = Number(arg('port', 9331));
  const dir = arg('keep-wav', '') || mkdtempSync(join(tmpdir(), 'hf-'));
  const mic = makeFakeMicWav(dir, { gapS: Number(arg('gap', 9)), leadS: Number(arg('lead', 4)) });
  if (!mic) {
    console.error('日本語の読み上げが使えないので、偽のマイクの録音を作れません(Windows の日本語の声が要ります)');
    process.exit(3);
  }
  console.log(`偽のマイク: ${mic.totalS} 秒・発話の始まり ${mic.startsS.join(', ')} 秒`);
  const server = await startOwnServer(port);
  let result;
  try {
    result = await runHandsfree({ base: server.base, wavPath: mic.path, timeoutMs: Math.max(60000, (mic.totalS + 40) * 1000), shots: arg('shots', '') });
  } finally {
    server.stop();
    if (!arg('keep-wav', '')) rmSync(dir, { recursive: true, force: true });
  }
  const out = { mic: { totalS: mic.totalS, startsS: mic.startsS, texts: mic.texts }, ...result };
  if (arg('out', '')) writeFileSync(arg('out', ''), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(result.turns >= result.expectTurns ? 0 : 1);
}
