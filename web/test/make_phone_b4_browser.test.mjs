// スマホだけで作る(B4 12b)の画面の試験: スマホで作る画面(/m/)を直接開き、押すだけで最後まで進む。
// PC では誰も /yuru-next を打たない(作る道のサーバーが --auto-next direct で自分で流す。絵は試験のふりで、Claude は呼ばない)。
// 言葉 → 絵 → この子にする → 2D → 3D にも する → 形と しつかん(見本の絵つき)→ 変換の絵 → この かたちで 3D に する → 受け渡し
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const WEB = join(import.meta.dirname, '..');
const ROOT = join(WEB, '..');
const PY = process.env.PYTHON || 'python';
const SHOTS = process.env.FR_SHOTS_DIR || '';
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const HAS_PY = !SLOW && spawnSync(PY, ['-c', 'import PIL'], { windowsHide: true }).status === 0;

async function startMake(work, token) {
  const env = { ...process.env, YC_REVIEW_TEST: '1', YC_REVIEW_TOKEN: token, YC_REVIEW_WORK: work };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawn(PY, [join(ROOT, 'creator', 'review', 'serve_review.py'), '--make', '--port', '0', '--auto-next', 'direct', '--auto-args=--fake-draw'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`作る道のサーバーが起きない: ${out}`)), 15000);
    proc.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/PORT (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.stderr.on('data', (c) => (out += c));
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

test('スマホだけで作る(390×844): 作る画面を直接開き、PC で何も打たずに 2D → 3D の形と しつかん → 変換の絵 → 受け渡しまで', { skip: SLOW || (!HAS_PY && 'python と Pillow が無い'), timeout: 240_000 }, async (t) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return t.skip('playwright-core が無い');
  }
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  } catch {
    return t.skip('Chrome が無い');
  }
  const work = mkdtempSync(join(tmpdir(), 'yc-phone-'));
  const token = randomBytes(16).toString('hex');
  const make = await startMake(work, token);
  const shot = async (page, name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `phone_${name}.png`) });
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${make.base}/m/#k=${token}&role=home`);
    await page.waitForSelector('#input:not([hidden])');
    await page.fill('#words', 'みどりの まるい かえるの子');
    await page.click('#wordsBtn');
    await page.waitForSelector('#waiting:not([hidden])');
    await page.waitForFunction(() => /パソコンが/.test(document.getElementById('waitHint').textContent), null, { timeout: 15_000 });
    assert.doesNotMatch(await page.$eval('#waitHint', (e) => e.textContent), /yuru-next/, 'スマホに「/yuru-next と打つ」を出さない');
    await shot(page, '1_waiting');
    // PC は何も打たない: サーバーが自分で /yuru-next を流して、絵が出る
    await page.waitForSelector('#c0:not([hidden])', { timeout: 60_000 });
    await page.waitForFunction(() => document.getElementById('pic').naturalWidth > 0, null, { timeout: 15_000 });
    await shot(page, '2_c0');
    await page.click('#okBtn');
    await page.waitForFunction(() => /うごく 2D に したよ/.test(document.getElementById('doneMsg').textContent), null, { timeout: 60_000 });
    await page.waitForSelector('#phone3d:not([hidden])');
    assert.match(await page.$eval('#p3Msg', (e) => e.textContent), /^3D にもする\?/);
    await shot(page, '3_ask3d');
    await page.click('#p3Choices .mk-btn.primary');
    await page.waitForFunction(() => /どんな かたちに する/.test(document.getElementById('p3Msg').textContent));
    const shapes = await page.$$eval('#p3Choices .mk-btn', (els) => els.map((e) => ({ text: e.textContent, img: Boolean(e.querySelector('img')), h: e.getBoundingClientRect().height })));
    assert.deepEqual(shapes.map((s) => s.text), ['あたまでっかち', 'まるい どう', 'おまかせ']);
    assert.ok(shapes.slice(0, 2).every((s) => s.img) && shapes.every((s) => s.h >= 44), JSON.stringify(shapes));
    await shot(page, '4_shape');
    await page.click('#p3Choices .mk-btn:nth-child(2)');
    await page.waitForFunction(() => /しつかん/.test(document.getElementById('p3Msg').textContent));
    await shot(page, '5_material');
    await page.click('#p3Choices .mk-btn:nth-child(3)'); // つるつる
    await page.waitForSelector('#convert:not([hidden])');
    await page.waitForSelector('#convOk:not([hidden])', { timeout: 60_000 });
    await page.waitForFunction(() => document.getElementById('convPic').naturalWidth > 0, null, { timeout: 15_000 });
    await shot(page, '6_convert');
    await page.click('#convOk');
    await page.waitForFunction(() => /パソコンで つくるよ/.test(document.getElementById('convAct').textContent));
    const ids = (await page.evaluate(() => fetch('/api/review/state', { headers: { 'X-YC-Key': new URLSearchParams(location.hash.slice(1)).get('k') || '' } }).then((r) => r.status)));
    assert.ok([200, 401].includes(ids));
    // 受け渡しの紙は、サーバーの次の /yuru-next が書く
    const start = Date.now();
    let found = null;
    while (Date.now() - start < 60_000 && !found) {
      const { readdirSync } = await import('node:fs');
      for (const id of readdirSync(work)) if (existsSync(join(work, id, 'convert', 'handoff.json'))) found = id;
      if (!found) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(found, '変換の絵の OK の後、make-character への受け渡しの紙ができる');
    assert.ok(existsSync(join(work, '_characters', found, '2d', 'body.svg')), '2D の子ができている');
    assert.deepEqual(errors, [], `画面のエラー: ${errors.join(' / ')}`);
    await ctx.close();
  } finally {
    await browser.close();
    make.proc.kill(); // 自分で起こした PID だけ
    rmSync(work, { recursive: true, force: true });
  }
});
