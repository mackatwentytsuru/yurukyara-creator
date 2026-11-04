// スマホの「声」ボタンの画面を、録音の声を入力にして、まねて動かす(Chromium 系のブラウザ + 偽のマイク)。
//   node kiosk/tools/phone_sim.mjs <サーバーのアドレス> <録音の wav> [--browser <exe>] [--mobile] [--turns 1]
// 画面(/kiosk/?talk&stt=server&interview=1)を開き、声ボタンを押す。偽のマイクが wav を繰り返し流す。
// 見るもの: 聞き取った文字が画面に出るか(ボタンを押してから)・返事が出るまでの秒・ページのエラー・サーバーの聞き取りへの送信回数。
// 限界: iPhone の Safari(WebKit)ではなく Chromium。携帯の UA と画面の大きさをまねるだけ。安全でない接続(http)でも、マイクを許す印を付けて動かす。
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  ({ chromium } = await import('playwright-core'));
}

const args = process.argv.slice(2);
const server = (args[0] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const wav = args[1];
const opt = (k, d = '') => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const exe = opt('browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const mobile = args.includes('--mobile');
if (!wav) {
  console.error('使い方: node phone_sim.mjs <サーバー> <wav> [--browser exe] [--mobile]');
  process.exit(2);
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? `  ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, `--unsafely-treat-insecure-origin-as-secure=${server}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', permissions: ['microphone'] }
      : { permissions: ['microphone'] },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let sttCalls = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/stt')) sttCalls += 1;
  });
  await page.goto(`${server}/kiosk/?talk&stt=server&interview=1`);
  await page.waitForSelector('#mic:not([disabled])', { timeout: 10000 }).catch(() => {});
  check('声のボタンが押せる', await page.$eval('#mic', (b) => !b.disabled));
  const t0 = Date.now();
  await page.click('#mic');
  const heard = await page
    .waitForFunction(() => document.querySelector('.msg.me .bubble')?.textContent || null, null, { timeout: 40000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  const tHeard = Date.now() - t0;
  check('聞き取った文字が画面に出た', Boolean(heard), heard ? `「${heard}」 ${tHeard} ms(ボタン → 文字)` : '');
  const answer = await page
    .waitForFunction(() => {
      const bs = [...document.querySelectorAll('.msg.bot .bubble')];
      const t = bs.slice(1).map((b) => b.textContent).join('');
      return t && !/^考え中/.test(t) ? t : null; // 「考え中」の表示ではなく、返事の文字が出たとき
    }, null, { timeout: 40000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  check('返事が画面に出た', Boolean(answer), answer ? `${Date.now() - t0 - tHeard} ms(文字 → 返事)「${String(answer).slice(0, 40)}」` : '');
  check('サーバーの聞き取りに送った', sttCalls > 0, `${sttCalls} 回`);
  check('ページのエラーが無い', errors.length === 0, errors.join(' / ').slice(0, 200));
} finally {
  await browser.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
