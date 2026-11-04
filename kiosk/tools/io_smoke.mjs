// 声の入出力のつなぎ込みの確認(ヘッドレス Chrome)。サーバーを起動しておき、そのアドレスを渡す。
//   node kiosk/tools/io_smoke.mjs http://127.0.0.1:8861
// 確かめること: (1) 声の部品が読み込まれ、声のボタンが押せる (2) 質問すると返事が /api/tts に送られる
//              (3) 声のボタンで聞き取りが始まり、もう一度押すと止まる (4) ?voice=0 では文字だけで動く
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ttsBodies = [];
  await page.route('**/api/tts', async (route) => {
    ttsBodies.push(JSON.parse(route.request().postData() ?? '{}').text);
    // 24kHz・16bit の無音 0.2 秒
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.alloc(24000 * 2 * 0.2) });
  });
  let warmed = false;
  await page.route('**/api/stt/warm', (route) => {
    warmed = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"available":false}' });
  });

  await page.goto(`${base}/kiosk/?talk&stt=server`);
  await page.waitForSelector('#mic:not([disabled])', { timeout: 8000 }).catch(() => {});
  check('声のボタンが押せる', await page.$eval('#mic', (b) => !b.disabled));
  check('KioskIO ができている', await page.evaluate(() => typeof window.KioskIO?.tts?.speak === 'function' && typeof window.KioskIO?.stt?.start === 'function'));

  await page.fill('#field', '営業時間を教えてください');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('.msg.bot .bubble').length > 1 || document.querySelector('.msg.bot .bubble')?.textContent.length > 20, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  check('返事が読み上げ(/api/tts)に送られた', ttsBodies.length > 0, `${ttsBodies.length} 文`);

  await page.click('#mic');
  await page.waitForTimeout(600);
  const listening = await page.evaluate(() => window.KioskIO.stt.listening);
  check('声のボタンで聞き取りが始まった', listening === true);
  check('サーバー側の聞き取りを温めた', warmed);
  await page.click('#mic');
  await page.waitForTimeout(200);
  check('もう一度押すと止まる', (await page.evaluate(() => window.KioskIO.stt.listening)) === false);

  const page2 = await ctx.newPage();
  await page2.goto(`${base}/kiosk/?talk&voice=0`);
  await page2.waitForTimeout(800);
  check('?voice=0 は文字だけ(ボタンは無効)', await page2.$eval('#mic', (b) => b.disabled));

  check('ページのエラーが無い', errors.length === 0, errors.join(' / ').slice(0, 200));
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
