// サーバーが短く止まったあとの「つながり直して送り直す」通し試験(画面なしの Chrome)。
//   node scripts/reconnect-e2e.mjs --port 9373 [--out result.json]
// 仕組み:
//   1. 自分用のサーバー(鍵なし = 仮の頭脳・字幕だけ)を --port で立てる
//   2. 画面の中で fetch を包み、「止める」間は /api/chat と /api/status を TypeError で失敗させる(サーバーが落ちている時と同じ見え方。サーバー自体は止めない)
//   3. 文字で 1 回話しかける → 「つながらないよ」が出る → 止めたまま数秒 → 止めるのをやめる → リロードなしで、同じ言葉が 1 回だけ /api/chat に送り直され、「エラー:」の表示が消えることを確かめる
//   4. マイク(作り物の聞き取り)を入れたまま、同じことをして、聞き取りが止まらない(aria-pressed が true のまま)ことを確かめる
// WebGL は GPU で描く(CPU の描画なら止める)。呼ぶ前に、GPU の札を取る(machine_lock.py)。止めるのは自分で起こしたサーバーと Chrome だけ。
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '9373'));
const OUT = arg('out', '');

async function startOwnServer(port) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'APP_PASSPHRASE']) delete env[k];
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, stop: () => proc.kill() };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** ページの中の作り物(init script): fetch を包んで「止める」を作る。聞き取りは何も言わない作り物 */
function installOutage() {
  window.__down = false;
  window.__chat = [];
  window.__probes = 0;
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.includes('/api/metrics')) return Promise.resolve(new Response('{}'));
    if (window.__down && (url.includes('/api/chat') || url.includes('/api/status'))) {
      if (url.includes('/api/status')) window.__probes += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (url.includes('/api/chat')) {
      let text = '';
      try {
        text = JSON.parse(o?.body ?? '{}').text ?? '';
      } catch {
        // 本文が読めなくても数える
      }
      window.__chat.push({ at: performance.now(), text });
    }
    return of(u, o);
  };
  class FakeRec {
    start() {}
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeRec;
  window.webkitSpeechRecognition = FakeRec;
}

const server = await startOwnServer(PORT);
const result = { problems: [] };
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: [...GPU_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 800 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => result.problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  await page.addInitScript(installOutage);
  await page.goto(`${server.base}/?character=yokoso&auto=0`);
  await stopIfSoftwareRenderer(page, browser); // CPU の描画なら止める
  await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 60000 });
  await page.getByText('カメラなしで試す').click();
  await page.waitForFunction(() => window.__app?.status, null, { timeout: 60000 });

  // マイクを入れる(作り物の聞き取り。何も言わない)
  await page.click('#micBtn');
  await page.waitForFunction(() => document.getElementById('micBtn')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });

  // サーバーを「止める」→ 文字で話しかける → 「つながらない」
  await page.evaluate(() => (window.__down = true));
  await page.fill('#textInput', 'ステージはどこですか');
  await page.press('#textInput', 'Enter');
  await page.waitForFunction(() => /エラー:/.test(document.getElementById('tReply')?.textContent ?? ''), null, { timeout: 10000 });
  result.errorShown = await page.evaluate(() => document.getElementById('tReply').textContent);
  await page.waitForTimeout(5000); // 止めたまま。調べ続けている(つながらない)
  const mid = await page.evaluate(() => ({ chat: window.__chat.length, probes: window.__probes, mic: document.getElementById('micBtn').getAttribute('aria-pressed'), listening: window.__app.listener?.listening ?? false }));
  result.whileDown = mid;

  // 止めるのをやめる → リロードなしで、送り直される
  const t0 = await page.evaluate(() => {
    window.__down = false;
    return performance.now();
  });
  await page.waitForFunction(() => window.__chat.length >= 1, null, { timeout: 30000 });
  await page.waitForTimeout(3000); // 重ねて送られないか
  result.afterUp = await page.evaluate((t) => ({
    chat: window.__chat.map((c) => ({ text: c.text, afterMs: Math.round(c.at - t) })),
    errorGone: !/エラー:/.test(document.getElementById('tReply')?.textContent ?? ''),
    mic: document.getElementById('micBtn').getAttribute('aria-pressed'),
    listening: window.__app.listener?.listening ?? false,
    replyText: document.getElementById('tReply')?.textContent ?? '',
  }), t0);

  const ok =
    result.whileDown.chat === 0 &&
    result.whileDown.probes >= 1 &&
    result.whileDown.mic === 'true' &&
    result.afterUp.chat.length === 1 &&
    result.afterUp.chat[0].text === 'ステージはどこですか' &&
    result.afterUp.errorGone &&
    result.afterUp.mic === 'true' &&
    result.afterUp.listening === true;
  result.ok = ok;
  console.log(JSON.stringify(result, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.stop();
}
