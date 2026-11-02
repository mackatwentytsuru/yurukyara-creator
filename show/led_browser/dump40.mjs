import { chromium } from '../../web/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 2840, height: 620 } });
await page.goto('http://127.0.0.1:8791/show/led_browser/index.html?motion=wave&top=225&bottom=1080&cx=2189&look=' + (process.argv[2] ?? '0'));
await page.waitForFunction(() => window.ledReady, null, { timeout: 60000 });
for (let i = 1; i <= 45; i++) { await page.evaluate(() => window.ledStep()); if ([1, 20, 30, 40, 45].includes(i)) console.log(JSON.stringify(await page.evaluate(() => window.ledDump()))); }
await browser.close();
