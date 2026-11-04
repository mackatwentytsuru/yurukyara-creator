// 会場の回線が悪いとき(スマホ ⇔ 会話サーバーの間が遅いとき)の「最初の音まで」を測る。
//   node scripts/measure-network.mjs [サーバーのURL] [--n 3] [--conds 0,100,250:1000]
// 条件は「往復の遅れ ms[:下りの速さ kbps]」をコンマでつなぐ。Chrome の開発者向けの機能(CDP)で、ブラウザ ⇔ サーバーの間だけに遅れを入れる。
// サーバー ⇔ Claude / ElevenLabs の間は変わらない。パケット損失は CDP では作れないので、測らない。
// 本物の Claude と ElevenLabs を呼ぶ(1 回あたり Claude 1 回・読み上げ約 30 字)。指標は画面の中だけで集め、実測のログ(latency.jsonl)には書かない。
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:8787';
const N = Number(opt('--n', 3));
const conds = opt('--conds', '0,100,250:1000').split(',').map((s) => {
  const [lat, kbps] = s.split(':').map(Number);
  return { label: kbps ? `往復 +${lat}ms・下り ${kbps}kbps` : lat ? `往復 +${lat}ms` : '遅れなし', latency: lat, kbps };
});
const QUESTIONS = ['こんにちは', 'お手洗いはどこですか', '休憩スペースはどこ', '入口はどっち', 'ありがとう', '今日は何ができますか', 'ここは何のお店', 'はじめまして', '少し教えて'];

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
// 指標の送信だけを画面の中で握りつぶす。page.route(通信の横取り)は使わない:
// 横取りが入ると、POST に遅れが入らなくなり、「回線が遅くても平気」という間違った数字が出た(2026-11-02)。
await page.addInitScript(() => {
  const real = window.fetch.bind(window);
  window.fetch = (url, init) => (String(url).includes('/api/metrics') && init?.method === 'POST' ? Promise.resolve(new Response('{"ok":true}')) : real(url, init));
});
await page.goto(`${base}/?character=f_led&place=test_room&auto=0`);
await page.waitForFunction(() => window.__app?.character && window.__app.speaker, null, { timeout: 60000 });
await page.click('#startSim');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
const set = (c) => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: c.latency, downloadThroughput: c.kbps ? (c.kbps * 1000) / 8 : -1, uploadThroughput: c.kbps ? (c.kbps * 1000) / 8 : -1 });

const ask = async (q) => {
  const before = await page.evaluate(() => window.__app.metrics.length);
  await page.evaluate((t) => window.__app.dialogue.send({ text: t, mode: 'text', t0: performance.now() }), q);
  await page.waitForFunction((n) => window.__app.metrics.length > n, before, { timeout: 30000 });
  await page.waitForTimeout(4500); // 読み上げが終わり、1 分あたりの上限にも触れないように
  return page.evaluate(() => {
    const m = window.__app.metrics.at(-1);
    return { total: m.totalMs, say: m.sendToFirstSayMs, tts: m.ttsFirstByteMs, valid: m.valid };
  });
};

await set({ latency: 0 });
await ask('こんにちは'); // 温め(接続の確立・キャッシュ)。数えない
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
for (const c of conds) {
  await set(c);
  // 遅れが本当に入っているかを、小さな通信で確かめる(入っていなければ数字は無効)
  const probe = await page.evaluate(async () => {
    const t0 = performance.now();
    await (await fetch('/api/status')).text();
    return Math.round(performance.now() - t0);
  });
  if (probe < c.latency * 0.8) console.log(`!! 遅れが入っていません(確認の通信 ${probe}ms)。この条件の数字は使えません`);
  const got = [];
  for (let i = 0; i < N; i++) got.push(await ask(QUESTIONS[(rows.length * N + i) % QUESTIONS.length]));
  rows.push({ c, got });
  const ok = got.filter((g) => g.valid);
  console.log(`${c.label.padEnd(24)} 確認の通信 ${probe}ms ・ 最初の音まで ${got.map((g) => g.total).join(' / ')}ms  中央値 ${med(got.map((g) => g.total))}ms  (最初の文まで ${got.map((g) => g.say).join('/')}・声の最初の一口 ${got.map((g) => g.tts).join('/')})${ok.length === got.length ? '' : '  ※本物でない回あり'}`);
}
await browser.close();
