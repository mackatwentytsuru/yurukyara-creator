// 接客モードの、PC 側の窓(店の人用)を、画面なしの Chrome で確かめる。
// - 番号が決まっている時、QR は窓の一番上にあり、窓の高さ 720〜800(幅 1024・1280)で、スクロールしないで見える
// - 店の端末が間違いで止まっている時だけ、止まりを解くボタンが出る。押すと止まりが解け、ボタンが消える
// 試しの画面は、本物の web/index.html の本文と style.css・kiosk.css と、PC の窓の部品(ui/kioskQr.js)だけ。舞台の WebGL と main.js は使わない。
// 設定・QR・解く、の答えは、本物のサーバーの決まり(server/kiosk.mjs)で返す。重いので YC_BROWSER_TESTS=1 のときだけ動く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createKiosk, MAX_WRONG } from '../server/kiosk.mjs';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const PIN = '4821';
const ORIGIN = 'https://shop.example';
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SIZES = [
  { w: 1280, h: 720 },
  { w: 1280, h: 760 },
  { w: 1280, h: 800 },
  { w: 1024, h: 720 },
  { w: 1024, h: 760 },
  { w: 1024, h: 800 },
];
const MIN_QR_PX = 150;

function page() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const body = html
    .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
    .replace(/<script type="module" src="\/src\/main\.js"><\/script>/, '')
    .replace(/<script type="module" src="\/src\/stage\/kioskEarly\.js"><\/script>/, '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/ui/style.css"><link rel="stylesheet" href="/src/ui/kiosk.css"><title>PC の窓の試し</title></head><body>${body}
<script type="module">
import { mountKioskSetup } from '/src/ui/kioskQr.js';
document.getElementById('gate').classList.add('hidden');
document.getElementById('topMain').hidden = false;
window.__setup = mountKioskSetup({ app: { character: { id: 'norrie' } }, local: true });
window.__ready = Boolean(window.__setup);
</script></body></html>`;
}

async function findChrome() {
  let pw;
  try {
    pw = await import('playwright-core');
  } catch {
    return null;
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  try {
    return await pw.chromium.launch({ ...opts, headless: true });
  } catch {
    return null;
  }
}

/** 試しの頁。/api/kiosk/* は、本物のサーバーの決まり(kiosk)で答える */
async function open(browser, { w, h }, kiosk) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.route('http://shop.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (path === '/api/kiosk/settings' && req.method() === 'GET') return reply(200, { ...kiosk.publicSettings(), ...kiosk.lockInfo(), originSet: true, secure: true });
    if (path === '/api/kiosk/qr') return reply(200, kiosk.qr(ORIGIN, 'norrie'));
    if (path === '/api/kiosk/unlock' && req.method() === 'POST') return reply(200, { ok: true, ...kiosk.unlockAll() });
    if (path === '/' || path === '/index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page() });
    const file = join(WEB, path);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://shop.test/');
  await p.waitForFunction(() => window.__ready === true);
  return { ctx, page: p, errors };
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'yc-kiosk-pcw-'));
  const t = { now: 1_800_000_000_000 };
  const kiosk = createKiosk({ file: join(dir, 'kiosk.json'), now: () => t.now });
  assert.equal(kiosk.update({ pin: PIN, pinConfirm: PIN }).ok, true);
  return { kiosk, t, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('PC の窓: 番号が決まっていれば、QR は窓の一番上に出て、高さ 720〜800 でもスクロールしないで全部見える', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const s = fresh();
  try {
    for (const size of SIZES) {
      const { ctx, page, errors } = await open(browser, size, s.kiosk);
      try {
        await page.click('#kioskSetupBtn');
        await page.waitForSelector('#kioskQrCanvas', { timeout: 5000 });
        const m = await page.evaluate(() => {
          const sheet = document.getElementById('ycKiosk');
          const c = document.getElementById('kioskQrCanvas').getBoundingClientRect();
          const sr = sheet.getBoundingClientRect();
          return { top: c.top, bottom: c.bottom, left: c.left, right: c.right, w: c.width, h: c.height, sheetTop: sr.top, sheetBottom: sr.bottom, sheetClient: sheet.clientHeight, sheetScroll: sheet.scrollTop, vh: window.innerHeight, vw: window.innerWidth, pageScroll: document.scrollingElement.scrollTop };
        });
        const label = `${size.w}x${size.h}`;
        assert.ok(m.w >= MIN_QR_PX && Math.abs(m.w - m.h) < 1, `${label}: QR の大きさ ${m.w}x${m.h}`);
        assert.ok(m.top >= m.sheetTop - 0.5, `${label}: QR の上が窓の中`);
        assert.ok(m.bottom <= m.sheetBottom + 0.5, `${label}: QR の下(${m.bottom})が窓の下(${m.sheetBottom})より上 = スクロールが要らない`);
        assert.ok(m.bottom <= m.vh, `${label}: QR の下が画面の中`);
        assert.ok(m.left >= 0 && m.right <= m.vw, `${label}: QR の横が画面の中`);
        assert.equal(m.sheetScroll, 0, `${label}: 窓はスクロールされていない`);
        assert.deepEqual(errors, [], label);
        // 番号・お店のきまりの欄は、QR の下にある(まだ使える)
        assert.ok(await page.locator('#kioskPinCur').count() === 1 && await page.locator('#kioskSave').count() === 1);
        // 止まっていなければ、解くボタンは出ない
        assert.equal(await page.locator('#kioskUnlock').count(), 0, `${label}: 止まっていないのにボタンが出ている`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    s.done();
  }
});

test('PC の窓: 店の端末が止まっている時だけ「とまっているのを ぜんぶ とく」が出て、押すと解ける', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const s = fresh();
  try {
    s.t.now += 1000;
    const visitorToken = s.kiosk.issueToken();
    for (let i = 0; i < MAX_WRONG; i++) s.kiosk.exit('1111', visitorToken);
    assert.equal(s.kiosk.exit(PIN, visitorToken).status, 429);
    const { ctx, page, errors } = await open(browser, { w: 1280, h: 800 }, s.kiosk);
    try {
      await page.click('#kioskSetupBtn');
      await page.waitForSelector('#kioskUnlock', { timeout: 5000 });
      assert.match(await page.locator('#kioskLockNote').innerText(), /とまっています/);
      assert.equal(await page.locator('#kioskQrCanvas').count(), 1, '止まっている時も QR は出ている');
      await page.click('#kioskUnlock');
      await page.waitForFunction(() => !document.getElementById('kioskUnlock'), null, { timeout: 5000 });
      assert.match(await page.locator('#kioskMsg').innerText(), /といたよ/);
      assert.equal(s.kiosk.exit(PIN, visitorToken).ok, true, '解いた後は、その端末が正しい番号で出られる');
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
    s.done();
  }
});
