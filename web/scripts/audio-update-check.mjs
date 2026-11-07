// 「マイクと スピーカー」の窓と、画面のアップデートの窓の見え方の確かめ(第 12 波 b・BUX)。GPU の Chrome で、
// スマホ(390x670・390x844)と PC(1280x720・1920x1080)とテレビ表示で、次を測って絵を撮る:
//   - 窓を開いても、キャラ(描いた所の外の四角)に、窓・上の段・知らせが重ならない
//   - キャラの縦横の比が、PC(1280x720 で窓なし)の 3% 以内(細長く・平たくならない)
//   - 字は 14px 以上・押す所は 40px 以上
//   - テレビ表示では、歯車・印・窓・知らせが出ない
//   - 音がまったく来ないマイク(無音の WAV)で「声で話す」を押すと、7 秒ほどで「こえが とどいていないみたい」と窓への道が出る
//   - 既定でないマイクを選ぶと、PC の聞き取り(サーバー)へ切り替わる(画面の一言と、聞き取りの道)
// 使い方(web のフォルダで。先に npx vite build): node scripts/audio-update-check.mjs [--port 8942] [--out <フォルダ>] [--character norrie]
// 会話サーバーは鍵なし(仮の頭脳)で、この台本が起こして止める(自分の PID だけ)。CPU の描画(SwiftShader)なら止める。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_ARGS, stopIfSoftwareRenderer } from '../src/stage/gpuGuard.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const PORT = Number(arg('--port', 8942));
const OUT = resolve(arg('--out', mkdtempSync(join(tmpdir(), 'yc-audio-update-check-'))));
const CHAR = arg('--character', 'norrie');
const BASE = `http://127.0.0.1:${PORT}`;
const SIZES = [['phone670', 390, 670], ['phone844', 390, 844], ['pc720', 1280, 720], ['pc1080', 1920, 1080]];
const SHAPE_TOL = 0.03;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  (${detail})` : ''}\n`);
};

// 音がまったく来ないマイクのまね: 3 秒の無音の WAV(Chrome の決まった偽のマイクに使う)
function silentWav(path, seconds = 3, rate = 16000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(n * 2, 40);
  writeFileSync(path, b);
}

let server = null;
async function startServer() {
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LOG_DIR: mkdtempSync(join(tmpdir(), 'bux-log-')), YURU_UPDATE_UI: '1' };
  delete env.ANTHROPIC_API_KEY;
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
  server = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {
      // まだ
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('会話サーバーが立ちませんでした');
}
function stopServer() {
  if (!server?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  else server.kill('SIGTERM');
}

// ページの中: 動きを止めて、描いたキャラの外の四角(CSS の px)と縦横の比を測る
const FREEZE = () => {
  const c = window.__app.character;
  c.update = () => {};
  c.lookAt = () => {};
  c.setMouth = () => {};
};
const MEASURE = () => {
  const st = window.__app.stage;
  const cv = st.renderer.domElement;
  st.render();
  const gl = st.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 160) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const r = cv.getBoundingClientRect();
  const sx = r.width / W;
  const sy = r.height / H;
  // readPixels は下が 0。CSS の上からの位置へ
  const box = maxX < 0 ? null : { left: r.left + minX * sx, right: r.left + (maxX + 1) * sx, top: r.top + (H - maxY - 1) * sy, bottom: r.top + (H - minY) * sy };
  const rect = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0).map((b) => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom }));
  const small = [...document.querySelectorAll('.yc-sheet:not([hidden]) *, .yc-note:not([hidden]) *, #ycUpdateBadge:not([hidden]), #ycAudioBtn')]
    .filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width > 0)
    .map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((f) => f < 14);
  const taps = [...document.querySelectorAll('.yc-sheet:not([hidden]) button, .yc-sheet:not([hidden]) select, #ycAudioBtn, #ycUpdateBadge:not([hidden]), .yc-note:not([hidden]) button')]
    .map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => Math.min(b.width, b.height));
  return {
    box,
    ratio: box ? (box.right - box.left) / (box.bottom - box.top) : 0,
    covers: { sheet: rect('.yc-sheet:not([hidden])'), top: rect('.top .top-row > *, .top .chip'), note: rect('.yc-note:not([hidden])') },
    smallFonts: small,
    minTap: taps.length ? Math.min(...taps) : null,
  };
};
const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0);

async function openPage(browser, w, h, extra = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.addInitScript(() => localStorage.setItem('yc.onboarded.v1', 'done')); // 7 つのステップは、この確かめでは出さない
  await page.goto(`${BASE}/?character=${CHAR}${extra}`);
  await page.waitForSelector('#startSim:not([disabled])', { timeout: 60000 });
  await page.click('#startSim');
  await page.waitForTimeout(2500);
  await page.evaluate(FREEZE);
  await page.waitForTimeout(300);
  return page;
}

function judge(label, m, base) {
  const hit = (list) => list.reduce((s, r) => s + overlap(m.box, r), 0);
  const area = m.box ? (m.box.right - m.box.left) * (m.box.bottom - m.box.top) : 0;
  check(`${label}: キャラが見えている`, m.box && area > 400, m.box ? `${Math.round(m.box.right - m.box.left)}x${Math.round(m.box.bottom - m.box.top)}px` : 'なし');
  check(`${label}: 窓がキャラに重ならない`, hit(m.covers.sheet) === 0, `重なり ${Math.round(hit(m.covers.sheet))}px²`);
  check(`${label}: 上の段がキャラに重ならない`, hit(m.covers.top) === 0, `重なり ${Math.round(hit(m.covers.top))}px²`);
  check(`${label}: 知らせがキャラに重ならない`, hit(m.covers.note) === 0, `重なり ${Math.round(hit(m.covers.note))}px²`);
  check(`${label}: キャラの縦横が PC の 3% 以内`, base && Math.abs(m.ratio / base - 1) <= SHAPE_TOL, `${m.ratio.toFixed(4)} / PC ${base?.toFixed(4)}`);
  check(`${label}: 字は 14px 以上`, m.smallFonts.length === 0, m.smallFonts.join(','));
  if (m.minTap !== null) check(`${label}: 押す所は 40px 以上`, m.minTap >= 40, `${m.minTap.toFixed(0)}px`);
}

let ok = false;
try {
  await startServer();
  const wav = join(OUT, 'silent.wav');
  silentWav(wav);
  const { chromium } = await import('playwright-core');
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  const media = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  const browser = await chromium.launch({ ...opts, headless: true, args: [...GPU_ARGS, ...media] });
  const silentBrowser = await chromium.launch({ ...opts, headless: true, args: [...GPU_ARGS, ...media, `--use-file-for-fake-audio-capture=${wav}`] });
  try {
    // 基準: PC 1280x720 で窓なし
    const p0 = await openPage(browser, 1280, 720);
    check('描画は GPU', true, await stopIfSoftwareRenderer(p0, browser, { exit: false }));
    const base = (await p0.evaluate(MEASURE)).ratio;
    await p0.close();
    for (const [name, w, h] of SIZES) {
      const page = await openPage(browser, w, h);
      const before = await page.evaluate(MEASURE);
      judge(`${name} 窓なし`, before, base);
      // マイクとスピーカーの窓
      await page.click('#ycAudioBtn');
      await page.waitForSelector('#ycAudio:not([hidden])');
      if (await page.isVisible('#ycAudioAllow')) await page.click('#ycAudioAllow');
      await page.waitForSelector('#ycMicSelect option', { state: 'attached', timeout: 15000 });
      await page.waitForTimeout(900);
      await page.evaluate(FREEZE);
      const mAudio = await page.evaluate(MEASURE);
      judge(`${name} マイクの窓`, mAudio, base);
      await page.screenshot({ path: join(OUT, `${name}_audio.png`) });
      if (name === 'pc720') {
        const opts2 = await page.$$eval('#ycMicSelect option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
        check('マイクの一覧が出る(許可の後)', opts2.length >= 2, opts2.map((o) => o.t).join(' / '));
        const other = opts2.find((o) => o.v !== 'default');
        if (other) {
          await page.selectOption('#ycMicSelect', other.v);
          await page.waitForTimeout(400);
          const route = await page.textContent('.yc-au-route');
          const sttOk = await page.evaluate(() => Boolean(window.__app.status?.stt?.available));
          check('既定でないマイクを選ぶと、PC の聞き取りへ(一言)', sttOk ? /この PC で もじに する/.test(route) : /PC の ききとりが ないと/.test(route), `${route}(PC の聞き取り ${sttOk ? 'あり' : 'なし'})`);
          const saved = await page.evaluate(() => localStorage.getItem('yc.audio.v1'));
          check('選んだマイクを、このブラウザが覚えた', saved && saved.includes(other.v), saved?.slice(0, 80));
          await page.screenshot({ path: join(OUT, `${name}_audio_other_mic.png`) });
        }
        const speakerShown = await page.isVisible('#ycSpeakerSelect');
        const noteShown = await page.isVisible('.yc-au-msg:has-text("スピーカーを えらべない")');
        check('スピーカー: 選べる時は一覧、選べない時はやさしい一言', speakerShown || noteShown, speakerShown ? '一覧' : '一言');
      }
      await page.click('#ycAudio .yc-sheet-close');
      // アップデートの窓(歯車の窓の下の「アプリの アップデート」から。印は新しい版がある時だけ)
      await page.click('#ycAudioBtn');
      await page.waitForSelector('#ycAudio:not([hidden])');
      const hasLink = await page.isVisible('#ycAudioUpdate');
      check(`${name}: この PC の中では「アプリの アップデート」への道がある`, hasLink);
      if (hasLink) {
        await page.click('#ycAudioUpdate');
        await page.waitForSelector('#ycUpdate:not([hidden])');
        await page.waitForTimeout(1500);
        await page.evaluate(FREEZE);
        const mUp = await page.evaluate(MEASURE);
        judge(`${name} アップデートの窓`, mUp, base);
        await page.screenshot({ path: join(OUT, `${name}_update.png`) });
        await page.click('#ycUpdate .yc-sheet-close');
      }
      // 知らせ(音が来ない)
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('yc-mic-silent')));
      await page.waitForSelector('#ycAudioNote:not([hidden])');
      const mNote = await page.evaluate(MEASURE);
      judge(`${name} 音が来ない時の知らせ`, mNote, base);
      await page.screenshot({ path: join(OUT, `${name}_silent_note.png`) });
      await page.close();
    }
    // テレビ表示
    const tv = await openPage(browser, 1920, 1080, '&tv=1');
    const shown = await tv.evaluate(() => ['ycAudioBtn', 'ycUpdateBadge', 'ycAudio', 'ycUpdate', 'ycAudioNote'].map((id) => {
      const e = document.getElementById(id);
      return e ? `${id}:${getComputedStyle(e).display}` : `${id}:なし`;
    }));
    check('テレビ表示では、歯車・印・窓・知らせが出ない', shown.every((s) => /:none$|:なし$/.test(s)), shown.join(' '));
    await tv.screenshot({ path: join(OUT, 'tv_1920.png') });
    await tv.close();
    // 本当に音が来ないマイク(無音の WAV)で「声で話す」を押す → 7 秒ほどで知らせ
    const sp = await openPage(silentBrowser, 390, 670);
    const t1 = Date.now();
    await sp.click('#micBtn');
    await sp.waitForSelector('#ycAudioNote:not([hidden])', { timeout: 20000 });
    const said = await sp.textContent('#ycAudioNote');
    check('無音のマイクで押すと「こえが とどいていないみたい」と窓への道', /こえが とどいていないみたい/.test(said) && /マイクを えらぶ/.test(said), `${((Date.now() - t1) / 1000).toFixed(1)} 秒・${said}`);
    await sp.screenshot({ path: join(OUT, 'phone670_silent_real.png') });
    await sp.click('#ycAudioNote .yc-note-action');
    await sp.waitForSelector('#ycAudio:not([hidden])', { timeout: 5000 });
    check('知らせのボタンで「マイクと スピーカー」の窓が開く', true);
    const typing = await sp.isVisible('#textInput');
    check('文字で話す道は残っている', typing);
    await sp.close();
  } finally {
    await browser.close().catch(() => {});
    await silentBrowser.close().catch(() => {});
  }
  ok = results.every((r) => r.ok);
} catch (err) {
  check('止まらずに最後まで流れた', false, String(err?.message ?? err));
} finally {
  stopServer();
  writeFileSync(join(OUT, 'result.json'), `${JSON.stringify({ ok, port: PORT, character: CHAR, checks: results }, null, 2)}\n`);
  process.stdout.write(`${ok ? '全部 OK' : 'NG があります'}: ${results.filter((r) => r.ok).length}/${results.length}(${join(OUT, 'result.json')})\n`);
  process.exitCode = ok ? 0 : 1;
}
