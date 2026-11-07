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
import { createServer as createNetServer } from 'node:net';
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
// 番号は、空いている番号を自分で探す(決め打ちの番号は、ほかの流れのサーバーが使っていることがある。11/8 01:4x、8942 番を別のサーバーが
// 使っていて、この台本のサーバーが起きられないまま、別の版の画面を測った)
const freePort = () => new Promise((done) => {
  const s = createNetServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => done(port));
  });
});
const PORT = Number(arg('--port', 0)) || (await freePort());
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

const servers = [];
async function startServer(port = PORT, host = '127.0.0.1') {
  const env = { ...process.env, PORT: String(port), HOST: host, LOG_DIR: mkdtempSync(join(tmpdir(), 'bux-log-')), YURU_UPDATE_UI: '1' };
  delete env.ANTHROPIC_API_KEY; // 本物の頭脳・声を呼ばない
  delete env.ELEVENLABS_API_KEY;
  delete env.APP_PASSPHRASE;
  const child = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: 'ignore', windowsHide: true });
  servers.push(child);
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`この台本の会話サーバーが止まりました(番号 ${port} がほかで使われているかも)`);
    try {
      // 答えたのが自分のサーバーか: アップデートの受け口(この線にだけある)が答える
      if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok && (await fetch(`http://127.0.0.1:${port}/api/update/progress`)).ok) return;
    } catch {
      // まだ
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('会話サーバーが立ちませんでした');
}
function stopServer() {
  for (const s of servers) {
    if (!s?.pid) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    else s.kill('SIGTERM');
  }
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
    // 引き伸ばしの本当の目安: 描く大きさと画角の縦横が、canvas の箱の縦横と同じか(stage_size_browser の試験と同じ 1%)
    stretch: { buffer: (cv.width / cv.height) / (r.width / r.height), camera: st.camera.aspect / (r.width / r.height) },
    ratio: box ? (box.right - box.left) / (box.bottom - box.top) : 0,
    covers: { sheet: rect('.yc-sheet:not([hidden])'), top: rect('.top .top-row > *, .top .chip'), note: rect('.yc-note:not([hidden])') },
    smallFonts: small,
    minTap: taps.length ? Math.min(...taps) : null,
  };
};
const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0);

const pageErrors = [];
async function openPage(browser, w, h, extra = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => pageErrors.push(`${w}x${h}${extra}: ${String(e?.message ?? e).slice(0, 200)}`));
  await page.addInitScript(() => localStorage.setItem('yc.onboarded.v1', 'done')); // 7 つのステップは、この確かめでは出さない
  await page.goto(`${BASE}/?character=${CHAR}${extra}`);
  await page.waitForSelector('#startSim:not([disabled])', { timeout: 60000 });
  await page.waitForSelector('#ycAudioBtn', { state: 'attached', timeout: 10000 }).catch(() => pageErrors.push(`${w}x${h}${extra}: 歯車が無い`));
  await page.click('#startSim');
  await page.waitForTimeout(2500);
  await page.evaluate(FREEZE);
  await page.waitForTimeout(300);
  return page;
}

/** 同じ頁・同じ止めた姿勢のまま 1280x720 にして測った縦横(PC の基準)。頁を開き直すと止まる姿勢がちがい、±2% ゆれたため */
async function sameBase(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(700);
  return (await page.evaluate(MEASURE)).ratio;
}

function judge(label, m, base, plain = null) {
  const hit = (list) => list.reduce((s, r) => s + overlap(m.box, r), 0);
  const area = m.box ? (m.box.right - m.box.left) * (m.box.bottom - m.box.top) : 0;
  check(`${label}: キャラが見えている`, m.box && area > 400, m.box ? `${Math.round(m.box.right - m.box.left)}x${Math.round(m.box.bottom - m.box.top)}px` : 'なし');
  check(`${label}: 窓がキャラに重ならない`, hit(m.covers.sheet) === 0, `重なり ${Math.round(hit(m.covers.sheet))}px²`);
  check(`${label}: 上の段がキャラに重ならない`, hit(m.covers.top) === 0, `重なり ${Math.round(hit(m.covers.top))}px²`);
  check(`${label}: 知らせがキャラに重ならない`, hit(m.covers.note) === 0, `重なり ${Math.round(hit(m.covers.note))}px²`);
  check(`${label}: 引き伸ばしなし(描く大きさと画角の縦横が箱の 1% 以内)`, Math.abs(m.stretch.buffer - 1) <= 0.01 && Math.abs(m.stretch.camera - 1) <= 0.01, `${m.stretch.buffer.toFixed(4)}・${m.stretch.camera.toFixed(4)}`);
  check(`${label}: キャラの縦横が PC の 3% 以内(同じ姿勢)`, base && Math.abs(m.ratio / base - 1) <= SHAPE_TOL, `${m.ratio.toFixed(4)} / PC ${base?.toFixed(4)}(${((m.ratio / base - 1) * 100).toFixed(1)}%)`);
  if (plain) check(`${label}: 窓を開いても、窓なしと縦横が同じ(1% 以内)`, Math.abs(m.ratio / plain - 1) <= 0.01, `${m.ratio.toFixed(4)} / 窓なし ${plain.toFixed(4)}`);
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
      const later = [];
      const before = await page.evaluate(MEASURE);
      later.push([`${name} 窓なし`, before]);
      // マイクとスピーカーの窓
      await page.click('#ycAudioBtn');
      await page.waitForSelector('#ycAudio:not([hidden])');
      if (await page.isVisible('#ycAudioAllow')) await page.click('#ycAudioAllow');
      await page.waitForSelector('#ycMicSelect option', { state: 'attached', timeout: 15000 });
      await page.waitForTimeout(900);
      await page.evaluate(FREEZE);
      const mAudio = await page.evaluate(MEASURE);
      later.push([`${name} マイクの窓`, mAudio]);
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
      await page.waitForSelector('#ycAudioUpdate:not([hidden])', { timeout: 8000 }).catch(() => {}); // 手元のサーバーの答えを待つ
      const hasLink = await page.isVisible('#ycAudioUpdate');
      check(`${name}: この PC の中では「アプリの アップデート」への道がある`, hasLink);
      if (hasLink) {
        await page.click('#ycAudioUpdate');
        await page.waitForSelector('#ycUpdate:not([hidden])');
        await page.waitForTimeout(1500);
        await page.evaluate(FREEZE);
        const mUp = await page.evaluate(MEASURE);
        later.push([`${name} アップデートの窓`, mUp]);
        await page.screenshot({ path: join(OUT, `${name}_update.png`) });
        await page.click('#ycUpdate .yc-sheet-close');
      }
      // 知らせ(音が来ない)
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('yc-mic-silent')));
      await page.waitForSelector('#ycAudioNote:not([hidden])');
      const mNote = await page.evaluate(MEASURE);
      later.push([`${name} 音が来ない時の知らせ`, mNote]);
      await page.screenshot({ path: join(OUT, `${name}_silent_note.png`) });
      const same = await sameBase(page);
      for (const [l, mm] of later) judge(l, mm, same, l.endsWith('窓なし') ? null : before.ratio);
      await page.close();
    }
    // 2D の見た目(板)でも、窓を開くとキャラを窓の下へ置き直し、縦横は変わらない
    for (const [name, w, h] of [['phone670_2d', 390, 670], ['pc720_2d', 1280, 720]]) {
      const p2 = await openPage(browser, w, h, '&look=2d');
      const b2 = (await p2.evaluate(MEASURE)).ratio;
      await p2.click('#ycAudioBtn');
      await p2.waitForSelector('#ycAudio:not([hidden])');
      if (await p2.isVisible('#ycAudioAllow')) await p2.click('#ycAudioAllow');
      await p2.waitForTimeout(1200);
      await p2.evaluate(FREEZE);
      const m2 = await p2.evaluate(MEASURE);
      await p2.screenshot({ path: join(OUT, `${name}_audio.png`) });
      judge(`${name} マイクの窓`, m2, await sameBase(p2), b2);
      await p2.close();
    }
    // テレビ表示
    const tv = await openPage(browser, 1920, 1080, '&tv=1');
    await tv.evaluate(() => window.dispatchEvent(new CustomEvent('yc-mic-silent'))); // 知らせも出してみる(テレビ表示では隠れるはず)
    await tv.waitForTimeout(300);
    // 描かれているか(親ごと隠れた物は getClientRects が空)で見る
    const shown = await tv.evaluate(() => ['ycAudioBtn', 'ycUpdateBadge', 'ycAudio', 'ycUpdate', 'ycAudioNote'].map((id) => {
      const e = document.getElementById(id);
      return e ? `${id}:${e.getClientRects().length ? '見える' : '隠れる'}` : `${id}:なし`;
    }));
    check('テレビ表示では、歯車・印・窓・知らせが出ない', shown.every((s) => /:隠れる$|:なし$/.test(s)), shown.join(' '));
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
    const mReal = await sp.evaluate(MEASURE); // 聞いている間(下の注意書きが変わる)の知らせも、キャラに重ならないか
    judge('phone670 聞いている間の知らせ', mReal, await sameBase(sp), null);
    await sp.setViewportSize({ width: 390, height: 670 });
    await sp.waitForTimeout(600);
    await sp.click('#ycAudioNote .yc-note-action');
    await sp.waitForSelector('#ycAudio:not([hidden])', { timeout: 5000 });
    check('知らせのボタンで「マイクと スピーカー」の窓が開く', true);
    const typing = await sp.isVisible('#textInput');
    check('文字で話す道は残っている', typing);
    await sp.close();
    // 「はなしてみてね」: 声の WAV(--speech)を偽のマイクにして、既定でないマイクを選び、PC の聞き取りで言葉が出るか
    const speech = arg('--speech', '');
    if (speech) {
      const talkBrowser = await chromium.launch({ ...opts, headless: true, args: [...GPU_ARGS, ...media, `--use-file-for-fake-audio-capture=${resolve(speech)}`] });
      try {
        const tp = await openPage(talkBrowser, 1280, 720);
        const sttOk = await tp.evaluate(() => Boolean(window.__app.status?.stt?.available));
        await tp.click('#ycAudioBtn');
        if (await tp.isVisible('#ycAudioAllow')) await tp.click('#ycAudioAllow');
        await tp.waitForSelector('#ycMicSelect option', { state: 'attached', timeout: 15000 });
        const other = (await tp.$$eval('#ycMicSelect option', (os) => os.map((o) => o.value))).find((v) => v !== 'default');
        if (other) await tp.selectOption('#ycMicSelect', other);
        await tp.click('#ycMicTest');
        let heardText = '';
        const until = Date.now() + 25000;
        while (Date.now() < until) {
          heardText = (await tp.textContent('#ycMicHeard')) ?? '';
          if (/きこえた ことば: .*[ぁ-んァ-ン一-龥]/.test(heardText)) break;
          await tp.waitForTimeout(500);
        }
        const route = await tp.textContent('.yc-au-route');
        check('「はなしてみてね」: 既定でないマイクの声を PC の聞き取りで文字にして出す', sttOk ? /きこえた ことば: .*(こんにちは|てんき|天気)/.test(heardText) : true, `${heardText}${sttOk ? '' : '(PC の聞き取りが無いので飛ばした)'} / ${route}`);
        await tp.screenshot({ path: join(OUT, 'pc720_audio_heard.png') });
        await tp.close();
      } catch (err) {
        check('「はなしてみてね」', false, String(err?.message ?? err));
      } finally {
        await talkBrowser.close().catch(() => {});
      }
    }
    // Quest のブラウザのまね(2D の画面): 聞き取りはいつも PC。歯車の窓は開け、キャラに重ならない
    const quest = await browser.newPage({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/37.0 Chrome/130.0 Safari/537.36' });
    try {
      await quest.addInitScript(() => localStorage.setItem('yc.onboarded.v1', 'done'));
      await quest.goto(`${BASE}/?character=${CHAR}`);
      await quest.waitForSelector('#startCam:not([disabled])', { timeout: 60000 });
      await quest.click('#startCam');
      await quest.waitForTimeout(3000);
      await quest.evaluate(FREEZE);
      await quest.click('#ycAudioBtn');
      if (await quest.isVisible('#ycAudioAllow')) await quest.click('#ycAudioAllow');
      await quest.waitForSelector('#ycMicSelect option', { state: 'attached', timeout: 15000 });
      await quest.waitForTimeout(800);
      const route = await quest.textContent('.yc-au-route');
      check('Quest のまね: 聞き取りは PC(歯車の窓の一言)', /この PC で もじに する|PC の ききとりが ないと/.test(route ?? ''), route);
      const mq = await quest.evaluate(MEASURE);
      await quest.screenshot({ path: join(OUT, 'quest_audio.png') });
      await quest.click('#ycAudio .yc-sheet-close');
      await quest.waitForTimeout(500);
      const qPlain = (await quest.evaluate(MEASURE)).ratio;
      judge('Quest のまね マイクの窓', mq, qPlain, qPlain);
    } catch (err) {
      check('Quest のまね', false, String(err?.message ?? err));
    } finally {
      await quest.close();
    }
    // この PC の名前でない住所で開いた時(同じ Wi-Fi のスマホ・Quest と同じ): アップデートの印・道は出ず、受け口も答えない。
    // 0.0.0.0 で待つと PC の防火壁の確認が出ることがあるので、Chrome の名前の付け替え(yc-lan.test → 127.0.0.1)で、頁の名前と Host だけを替える
    {
      const farBrowser = await chromium.launch({ ...opts, headless: true, args: [...GPU_ARGS, ...media, '--host-resolver-rules=MAP yc-lan.test 127.0.0.1'] });
      const far = await farBrowser.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await far.addInitScript(() => localStorage.setItem('yc.onboarded.v1', 'done'));
        await far.goto(`http://yc-lan.test:${PORT}/?character=${CHAR}`);
        await far.waitForSelector('#startSim:not([disabled])', { timeout: 60000 });
        await far.click('#startSim');
        await far.waitForTimeout(2500);
        const seen = await far.evaluate(async () => ({
          badge: Boolean(document.getElementById('ycUpdateBadge')),
          api: (await fetch('/api/update')).status,
          gear: Boolean(document.getElementById('ycAudioBtn')),
        }));
        await far.click('#ycAudioBtn');
        await far.waitForSelector('#ycAudio:not([hidden])');
        const link = await far.isVisible('#ycAudioUpdate');
        check('PC の名前でない住所: アップデートの印も道も出ない・受け口は 404・歯車はある', !seen.badge && seen.api === 404 && seen.gear && !link, JSON.stringify({ ...seen, link }));
        await far.screenshot({ path: join(OUT, 'lan_phone844_audio.png') });
      } catch (err) {
        check('PC の名前でない住所', false, String(err?.message ?? err));
      } finally {
        await farBrowser.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await silentBrowser.close().catch(() => {});
  }
  check('頁の中のエラーが無い', pageErrors.length === 0, pageErrors.slice(0, 5).join(' / '));
  ok = results.every((r) => r.ok);
} catch (err) {
  check('止まらずに最後まで流れた', false, `${String(err?.message ?? err).split('\n')[0]}${pageErrors.length ? ` / 頁のエラー: ${pageErrors.slice(0, 3).join(' / ')}` : ''}`);
} finally {
  stopServer();
  writeFileSync(join(OUT, 'result.json'), `${JSON.stringify({ ok, port: PORT, character: CHAR, checks: results }, null, 2)}\n`);
  process.stdout.write(`${ok ? '全部 OK' : 'NG があります'}: ${results.filter((r) => r.ok).length}/${results.length}(${join(OUT, 'result.json')})\n`);
  process.exitCode = ok ? 0 : 1;
}
