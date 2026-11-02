// 使い方: node record.mjs <出力フォルダ> [コマ数=90] [port=8791] [クエリ例: motion=wave]
// ヘッドレス Chrome で page を開き、1 コマずつ透明 PNG を保存する。コマごとの秒数を timing.json に書く。
import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [outDir, n = '90', port = '8791', extra = ''] = process.argv.slice(2);
if (!outDir) throw new Error('出力フォルダを指定してください');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: (process.env.CHROME_ARGS ?? '--use-angle=d3d11 --ignore-gpu-blocklist').split(' ').filter(Boolean),
});
try {
  const page = await browser.newPage({ viewport: { width: 2840, height: 620 }, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/show/led_browser/index.html?${extra}`);
  await page.waitForFunction(() => window.ledReady === true, null, { timeout: 60000 });
  console.log('info', JSON.stringify(await page.evaluate(() => window.ledInfo)));
  const times = [];
  for (let i = 0; i < Number(n); i++) {
    const t0 = performance.now();
    const url = await page.evaluate(() => window.ledStep());
    await writeFile(join(outDir, `f_${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    times.push(performance.now() - t0);
  }
  await writeFile(join(outDir, 'timing.json'), JSON.stringify({ ms: times }));
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`frames=${times.length} avg_ms=${avg.toFixed(1)} max_ms=${Math.max(...times).toFixed(1)}`);
} finally {
  await browser.close();
}
