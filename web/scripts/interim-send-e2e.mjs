// 声の送り遅れの通し試験(画面なしの Chrome)。「途中の文字を先に送る」の前後を、同じ偽の声で比べる。
//   node scripts/interim-send-e2e.mjs --port 9370 [--final-delay 2900] [--out result.json]
// 仕組み:
//   1. 計算で作った「声らしい音」(短い発話 3 回を無音ではさんだ WAV)を、Chrome の偽のマイクに流す(--use-file-for-fake-audio-capture)
//   2. ブラウザの聞き取り(SpeechRecognition)は、画面なしの Chrome では使えないので、作り物に差し替える。作り物は、画面の「声が出ている」の印(#micBtn の hearing)に合わせて、
//      途中の文字を 0.3 秒ごとに出し、声が止まった時刻(画面の声の検出が決めた時刻)から --final-delay ミリ秒後に「確定」を出す。
//      既定の 2900 は、本人の iPhone の実測(話し終わりから送るまでの中央 2.9 秒)に合わせた。実際の Chrome の確定の速さではない
//   3. 自分用のサーバー(鍵なし = 仮の頭脳。声の鍵なし = 字幕だけ)を --port で立て、/api/chat が送られた時刻と、その時の言葉を数える
//   4. 条件ごとに Chrome を起こし直す: 先送りを切った(?interimsend=off)/ 入れた / 確定がすぐ来る / 確定が言い足されて届く
// WebGL は GPU で描く(CPU の描画なら止める)。呼ぶ前に、GPU の札を取る(machine_lock.py)。止めるのは自分で起こしたサーバーと Chrome だけ。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', '9370'));
const FINAL_DELAY = Number(arg('final-delay', '2900'));
const OUT = arg('out', '');
const UTTERANCES = 3;
const SPEECH_S = 1.8;
const GAP_S = 9;
const LEAD_S = 4;
const VAD_SILENCE_MS = 450; // listener.js の「声が止まった」と見なす静けさ。最後の声の時刻 = 止まった合図 − これ

/** 声らしい音の WAV(48kHz・モノ・16bit)。ゆっくり揺れる雑音を 4 Hz の山で区切る。声の検出の閾値(0.025)をはっきり超える */
function makeWav() {
  const rate = 48000;
  const total = Math.round((LEAD_S + UTTERANCES * (SPEECH_S + GAP_S)) * rate);
  const pcm = new Int16Array(total);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  let lp = 0;
  for (let u = 0; u < UTTERANCES; u++) {
    const start = Math.round((LEAD_S + u * (SPEECH_S + GAP_S)) * rate);
    const len = Math.round(SPEECH_S * rate);
    for (let i = 0; i < len; i++) {
      lp += (rnd() - lp) * 0.2;
      const env = 0.65 + 0.35 * Math.sin((2 * Math.PI * 4 * i) / rate);
      const fade = Math.min(1, i / 600, (len - i) / 600);
      pcm[start + i] = Math.round(lp * 2.2 * 0.3 * env * fade * 32767);
    }
  }
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  return buf;
}

/** 自分用のサーバー(鍵は全部外す = 仮の頭脳・字幕だけ) */
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
      if ((await fetch(`${base}/api/status`)).ok) return { proc, base, log: () => out, stop: () => proc.kill() };
    } catch {
      // まだ立っていない
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`サーバーが立ちませんでした: ${out}`);
}

/** ページの中で動く作り物(init script)。cfg = { finalDelay, finalExtra, vadSilence } */
function fakeRecognizer(cfg) {
  const WORDS = [
    ['こんにちは', 'きょうは', 'いいてんきですね'],
    ['ステージは', 'どこに', 'ありますか'],
    ['おすすめを', 'おしえて', 'ください'],
  ];
  const st = (window.__sr = { utt: -1, interims: 0, finals: 0, offs: [], chat: [], recs: 0 });
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    if (String(u).includes('/api/chat')) {
      let text = '';
      try {
        text = JSON.parse(o?.body ?? '{}').text ?? '';
      } catch {
        // 本文が読めなくても数える
      }
      st.chat.push({ at: performance.now(), text });
    }
    return String(u).includes('/api/metrics') ? Promise.resolve(new Response('{}')) : of(u, o);
  };
  let rec = null;
  let texts = [];
  let timer = null;
  const mk = (isFinal, t) => ({ isFinal, length: 1, 0: { transcript: t, confidence: 0.9 } });
  const emit = (idx, isFinal, text) => {
    if (!rec?.onresult) return;
    const results = texts.slice(0, idx).map((t) => mk(true, t));
    results.push(mk(isFinal, text));
    rec.onresult({ resultIndex: idx, results });
  };
  const wordsAt = (n) => WORDS[Math.max(0, st.utt) % WORDS.length].slice(0, n).join('');
  class FakeRec {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
    }
    start() {
      rec = this;
      st.recs += 1;
    }
    stop() {
      if (rec === this) rec = null;
    }
    abort() {
      this.stop();
    }
  }
  window.SpeechRecognition = FakeRec;
  window.webkitSpeechRecognition = FakeRec;
  const wire = () => {
    const btn = document.getElementById('micBtn');
    if (!btn) return setTimeout(wire, 50);
    let on = btn.classList.contains('hearing');
    let onAt = 0;
    new MutationObserver(() => {
      const now = btn.classList.contains('hearing');
      if (now === on) return;
      on = now;
      const t = performance.now();
      if (on) {
        st.utt += 1;
        onAt = t;
        clearInterval(timer);
        timer = setInterval(() => {
          const n = Math.min(3, 1 + Math.floor((performance.now() - onAt) / 600));
          st.interims += 1;
          emit(st.utt, false, wordsAt(n));
        }, 300);
      } else {
        clearInterval(timer);
        const lastVoiced = t - cfg.vadSilence;
        st.offs.push({ utt: st.utt, lastVoiced });
        const full = wordsAt(3);
        const idx = st.utt;
        texts[idx] = full;
        st.interims += 1;
        emit(idx, false, full); // 声が止まる頃には、途中の文字は言い切った形になっている
        const wait = Math.max(0, lastVoiced + cfg.finalDelay - performance.now());
        setTimeout(() => {
          st.finals += 1;
          texts[idx] = full + (cfg.finalExtra || '');
          emit(idx, true, texts[idx]);
        }, wait);
      }
    }).observe(btn, { attributes: true, attributeFilter: ['class'] });
  };
  document.addEventListener('DOMContentLoaded', wire);
}

async function runCondition(server, wavPath, cond) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: [...GPU_ARGS, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 480, height: 800 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 160)}`));
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    await page.addInitScript(fakeRecognizer, { finalDelay: cond.finalDelay, finalExtra: cond.finalExtra ?? '', vadSilence: VAD_SILENCE_MS });
    await page.goto(`${server.base}/?character=yokoso&auto=0${cond.interim ? '' : '&interimsend=off'}`);
    await stopIfSoftwareRenderer(page, browser); // CPU の描画なら止める
    await page.waitForFunction(() => window.__app?.character && window.__app.firstFrameAt !== null, null, { timeout: 60000 });
    await page.locator('#startSim').click();
    await page.waitForFunction(() => window.__app?.status, null, { timeout: 60000 });
    await page.click('#micBtn');
    await page.waitForFunction(() => document.getElementById('micBtn')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    const expectCalls = cond.expectCalls ?? UTTERANCES;
    const deadline = Date.now() + LEAD_S * 1000 + UTTERANCES * (SPEECH_S + GAP_S) * 1000 + 20000;
    let r = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      r = await page.evaluate(() => ({ chat: window.__sr.chat, offs: window.__sr.offs, interims: window.__sr.interims, finals: window.__sr.finals, recs: window.__sr.recs, hearing: window.__sr.utt }));
      if (r.finals >= UTTERANCES && r.chat.length >= expectCalls) break;
    }
    await page.waitForTimeout(2500); // 最後の確定のあとに、重ねて送られないかを見る
    r = await page.evaluate(() => ({ chat: window.__sr.chat, offs: window.__sr.offs, interims: window.__sr.interims, finals: window.__sr.finals, recs: window.__sr.recs }));
    const turns = r.offs.map((o, i) => {
      const next = r.offs[i + 1]?.lastVoiced ?? Infinity;
      const calls = r.chat.filter((c) => c.at > o.lastVoiced && c.at < next);
      return { utt: i + 1, sendMs: calls.length ? Math.round(calls[0].at - o.lastVoiced) : null, calls: calls.length, texts: calls.map((c) => c.text) };
    });
    const sends = turns.map((t) => t.sendMs).filter((v) => v !== null).sort((a, b) => a - b);
    return {
      name: cond.name,
      interimSend: cond.interim,
      finalDelayMs: cond.finalDelay,
      finalExtra: cond.finalExtra ?? '',
      utterances: r.offs.length,
      chatCalls: r.chat.length,
      sendMs: sends,
      sendMedianMs: sends.length ? sends[Math.floor(sends.length / 2)] : null,
      callsPerUtterance: turns.map((t) => t.calls),
      sentTexts: turns.map((t) => t.texts), // 試験用の作り物の言葉(本人の言葉ではない)。言い足しの回で、前の言葉が重なっていないかを見る
      doubled: turns.some((t) => t.calls > 1),
      problems,
    };
  } finally {
    await browser.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), 'interim-e2e-'));
const server = await startOwnServer(PORT);
const results = [];
try {
  const wavPath = join(dir, 'fake_mic.wav');
  writeFileSync(wavPath, makeWav());
  const conds = [
    { name: '前(先送りを切る)', interim: false, finalDelay: FINAL_DELAY },
    { name: '後(先送りを入れる)', interim: true, finalDelay: FINAL_DELAY },
    { name: '後・確定がすぐ来る(0.9 秒)', interim: true, finalDelay: 900 },
    { name: '後・確定が言い足されて来る', interim: true, finalDelay: FINAL_DELAY, finalExtra: 'ですよね', expectCalls: UTTERANCES * 2 },
  ];
  for (const c of conds) {
    const res = await runCondition(server, wavPath, c);
    results.push(res);
    console.log(`${res.name}: 送るまで(話し終わりから) ${res.sendMs.join('・')} ms / 中央 ${res.sendMedianMs} ms / 発話ごとの送信回数 ${res.callsPerUtterance.join(',')} ${res.problems.length ? '| ' + res.problems.join(' | ') : ''}`);
  }
  // 中断の知らせの試験: 送った回を、返事の途中で切る(画面が次の言葉で割り込む時と同じ)。サーバーの出力に、スタックが出ないこと
  const abortProbes = [];
  for (let i = 0; i < 5; i++) {
    const ac = new AbortController();
    const p = fetch(`${server.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ステージはどこにありますか', history: [] }), signal: ac.signal })
      .then(async (r) => {
        const reader = r.body.getReader();
        await reader.read();
        ac.abort();
      })
      .catch(() => {});
    abortProbes.push(p);
  }
  await Promise.all(abortProbes);
  await new Promise((r) => setTimeout(r, 800));
  const log = server.log();
  const stackLines = log.split('\n').filter((l) => /^\s+at\s/.test(l)).length;
  const abortLines = log.split('\n').filter((l) => /Abort/i.test(l));
  console.log(`サーバーの出力: スタックの行 ${stackLines} / Abort を含む行 ${abortLines.length}${abortLines.length ? ' → ' + abortLines.slice(0, 3).join(' | ').slice(0, 300) : ''}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ note: '偽の声(計算で作った音)と作り物の聞き取りでの試験。確定の遅れは本人の iPhone の実測に合わせた値で、実際の Chrome の速さではない', results, serverStackLines: stackLines, serverAbortLines: abortLines.length }, null, 2));
} finally {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
}
