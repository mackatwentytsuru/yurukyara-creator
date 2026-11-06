// 偽の iPhone(Chrome の画面なし。WebGL は使わない画面)で確かめる画面を開く小さな道具。
// 試験(ui_review.mjs)と、1 往復の記録(press)の両方で使う。
// 使い方(押すだけ): node creator/review/tests/phone.mjs press <URL の頭> <ok|redo> [--tag 言葉]… [--note 一言] [--shot 絵.png] [--width 390]
//   合言葉は環境変数 YC_REVIEW_TOKEN から読む(引数・記録に書かない)。
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const require = createRequire(path.join(ROOT, "web", "package.json"));
const { chromium } = require("playwright-core");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export async function launch() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome が見つかりません(CHROME_PATH で場所を教えてください)");
  return chromium.launch({ executablePath: exe, headless: true });
}

export async function openPhone(browser, base, token, width = 390) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "ja-JP",
  });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(`${base}/k?k=${encodeURIComponent(token)}`);
  await page.waitForSelector("#name:not(:empty)");
  await page.waitForFunction(() => document.querySelector("#name").textContent !== "読み込み中…");
  await page.waitForSelector("#view .card");
  return { ctx, page, dialogs };
}

export async function pressOk(page) {
  await page.click("#okBtn");
  await page.waitForFunction(() => document.querySelector("#okBtn").classList.contains("armed"));
  await page.click("#okBtn");
  await page.waitForSelector("#pending:not([hidden])", { timeout: 5000 });
}

export async function pressRedo(page, tags = [], note = "") {
  await page.click("#redoBtn");
  await page.waitForSelector("#sheet:not([hidden])");
  for (const t of tags) await page.locator("#tags .tag", { hasText: t }).first().click();
  if (note) await page.fill("#note", note);
  await page.click("#sendBtn");
  await page.waitForSelector("#pending:not([hidden])", { timeout: 5000 });
}

async function cli() {
  const [cmd, base, decision, ...rest] = process.argv.slice(2);
  if (cmd !== "press" || !base || !["ok", "redo"].includes(decision)) {
    console.error("使い方: node phone.mjs press <URL の頭> <ok|redo> [--tag 言葉]… [--note 一言] [--shot 絵.png] [--width 390]");
    process.exit(2);
  }
  const token = process.env.YC_REVIEW_TOKEN;
  if (!token) { console.error("YC_REVIEW_TOKEN がありません"); process.exit(2); }
  const tags = []; let note = ""; let shot = null; let width = 390;
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === "--tag") tags.push(rest[i + 1]);
    else if (rest[i] === "--note") note = rest[i + 1];
    else if (rest[i] === "--shot") shot = rest[i + 1];
    else if (rest[i] === "--width") width = Number(rest[i + 1]);
  }
  const browser = await launch();
  try {
    const { page } = await openPhone(browser, base, token, width);
    if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "_before.png"), fullPage: true });
    const t0 = Date.now();
    if (decision === "ok") await pressOk(page); else await pressRedo(page, tags, note);
    if (shot) await page.screenshot({ path: shot, fullPage: false });
    console.log(JSON.stringify({ pressed: decision, tags, note_chars: [...note].length, ms: Date.now() - t0 }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => { console.error(e.message); process.exit(1); });
}
