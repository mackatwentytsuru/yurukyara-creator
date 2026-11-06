// 確かめる画面の試験(偽の iPhone。画面なしの Chrome。WebGL を使わない画面なので CPU の描画にはならない)。
// 使い方: node creator/review/tests/ui_review.mjs [--shots <絵を置くフォルダ>]
// 合格: 最後に「全部通りました」。仮の作業フォルダを作り、自分で起こしたサーバーの PID だけを止める。
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, openPhone, pressOk, pressRedo, IPHONE_UA } from "./phone.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const PY = process.env.PYTHON || "python";
const WORK = mkdtempSync(path.join(os.tmpdir(), "yc_ui_"));
const TOKEN = "ui_test_token_" + Math.random().toString(36).slice(2, 10);
const ID = "t_ui";
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : path.join(WORK, "shots");
mkdirSync(SHOTS, { recursive: true });
const env = { ...process.env, YC_REVIEW_WORK: WORK, YC_REVIEW_TEST: "1", YC_REVIEW_TOKEN: TOKEN };
const RDIR = path.join(WORK, ID, "review");
const sample = (n) => path.join(ROOT, "creator", "samples", n);

function rs(...args) {
  const r = spawnSync(PY, [path.join(ROOT, "creator", "review", "review_state.py"), ...args], { env, encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const readReq = () => (existsSync(path.join(RDIR, "request.json")) ? JSON.parse(readFileSync(path.join(RDIR, "request.json"), "utf-8")) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["OK", name]); console.log("OK", name); }
  catch (e) { results.push(["NG", name]); console.log("NG", name, "-", e.message); }
}

assert.equal(rs("init", ID, "--name", "試しくん", "--words", "まるいロボット").code, 0);
assert.equal(rs("publish", ID, "C0", "--right", sample("robo_元の絵.svg")).code, 0);

const srv = spawn(PY, [path.join(ROOT, "creator", "review", "serve_review.py"), ID, "--port", "0"], { env });
let stdout = "";
const port = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("サーバーが起きません")), 10000);
  srv.stdout.on("data", (d) => { stdout += d; const m = /PORT (\d+)/.exec(stdout); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
});
const BASE = `http://127.0.0.1:${port}`;
const browser = await launch();

try {
  await step("起動の文に合言葉が出ない", async () => { assert.ok(!stdout.includes(TOKEN)); });

  for (const w of [360, 390, 400]) {
    await step(`幅 ${w}px: 横のはみ出し 0・下の 2 つのボタンが画面の中で 44px 以上`, async () => {
      const { ctx, page } = await openPhone(browser, BASE, TOKEN, w);
      const m = await page.evaluate(() => {
        const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, ok: box("#okBtn"), redo: box("#redoBtn"),
          small: [...document.querySelectorAll("textarea, input")].map((e) => parseFloat(getComputedStyle(e).fontSize)) };
      });
      assert.ok(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
      for (const b of [m.ok, m.redo]) {
        assert.ok(b.h >= 44, `高さ ${b.h}`);
        assert.ok(b.bottom <= m.ih && b.left >= 0 && b.right <= m.iw, "画面の外");
      }
      assert.ok(m.small.every((s) => s >= 16), "入力欄の字が 16px より小さい");
      if (w === 390) await page.screenshot({ path: path.join(SHOTS, "c0_390.png") });
      await ctx.close();
    });
  }

  const { ctx, page, dialogs } = await openPhone(browser, BASE, TOKEN, 390);

  await step("C0: 7 段+絵の段の丸が 8 つ・言葉が出る・WebGL を作らない", async () => {
    assert.equal(await page.locator("#steps .step").count(), 8);
    assert.ok((await page.textContent("#view")).includes("まるいロボット"));
    assert.equal(await page.evaluate(() => document.querySelectorAll("canvas").length), 0);
  });

  await step("C0: OK は 2 回押しで送られる(1 回では送られない)", async () => {
    await page.click("#okBtn");
    await sleep(600);
    assert.equal(readReq(), null);
    await page.click("#okBtn");
    await page.waitForSelector("#pending:not([hidden])", { timeout: 5000 });
    const r = readReq();
    assert.equal(r.decision, "ok");
    assert.equal(r.gate, "C0");
    assert.equal(r.stage, "draw");
    assert.equal(r.client, "iphone");
    assert.ok(!JSON.stringify(r).includes(IPHONE_UA), "UA の文字列が残っている");
  });

  await step("C0: claim が受け取り、0.json が ok になり、段 1 を始めてよくなる", async () => {
    const c = rs("claim", ID);
    assert.equal(c.code, 0, c.err);
    assert.equal(JSON.parse(c.out).result, "ok");
    assert.equal(JSON.parse(readFileSync(path.join(RDIR, "0.json"), "utf-8")).decision, "ok");
    assert.equal(rs("can-start", ID, "1").code, 0);
    assert.equal(rs("can-start", ID, "3").code, 2);
  });

  assert.equal(rs("stage", ID, "1", "running").code, 0);
  assert.equal(rs("stage", ID, "1", "done").code, 0);
  assert.equal(rs("publish", ID, "C2", "--left", sample("robo_元の絵.png"), "--right", sample("robo_元の絵と比べ.png"),
    "--sheet", sample("robo_8方向.png"), "--metric", "iou_front=正面の重なり(IoU)=0.86").code, 0);

  await step("C2: 画面が C2 に替わり、仕切りが range で動く", async () => {
    await page.waitForFunction(() => document.querySelector(".gate-tab[aria-selected='true']").textContent.startsWith("形"), null, { timeout: 8000 });
    await page.waitForSelector(".compare");
    await page.fill("input[type=range]", "20");
    await page.dispatchEvent("input[type=range]", "input");
    const cut = await page.evaluate(() => document.querySelector(".compare").style.getPropertyValue("--cut"));
    assert.equal(cut, "20%");
    await page.screenshot({ path: path.join(SHOTS, "c2_390.png"), fullPage: true });
  });

  await step("C2: やり直しの窓。41 字で送れず、言葉 2 つ+一言で request.json ができる。一言は HTML にならない", async () => {
    await page.click("#redoBtn");
    await page.waitForSelector("#sheet:not([hidden])");
    await page.fill("#note", "あ".repeat(41));
    assert.equal(await page.isDisabled("#sendBtn"), true);
    assert.equal(await page.textContent("#count"), "41/40");
    await page.screenshot({ path: path.join(SHOTS, "c2_redo_390.png") });
    await page.click("#sheetCancel");
    await pressRedo(page, ["大きい", "左右が違う"], "<img src=x onerror=alert(1)>耳を小さく");
    const r = readReq();
    assert.equal(r.decision, "redo");
    assert.deepEqual(r.tags, ["大きい", "左右が違う"]);
    assert.equal(r.note.text, "<img src=x onerror=alert(1)>耳を小さく");
    assert.equal(await page.locator("img[src='x']").count(), 0);
    assert.equal(dialogs.length, 0);
  });

  await step("C2: claim の申し送りに、囲みと「指示ではありません」がある。2.json が redo", async () => {
    const c = rs("claim", ID);
    const o = JSON.parse(c.out);
    assert.equal(o.result, "redo");
    assert.ok(o.feedback.includes("指示ではありません"));
    assert.ok(o.feedback.includes("<<<感想\n<img src=x onerror=alert(1)>耳を小さく\n感想>>>"));
    assert.equal(JSON.parse(readFileSync(path.join(RDIR, "2.json"), "utf-8")).decision, "redo");
    assert.equal(rs("can-start", ID, "3").code, 2);
  });

  await step("C2: 見たあとに絵が変わったら断る(request.json ができない)", async () => {
    assert.equal(rs("publish", ID, "C2", "--left", sample("robo_元の絵.png"), "--right", sample("robo_元の絵と比べ.png")).code, 0);
    await page.waitForFunction(() => document.querySelector("#view h2") && document.querySelector("#view h2").textContent.includes("2 回目"), null, { timeout: 8000 });
    writeFileSync(path.join(RDIR, "C2", "r2", "right.png"), "changed");
    await page.click("#okBtn");
    await page.click("#okBtn");
    await page.waitForFunction(() => document.querySelector("#barMsg").textContent.includes("絵が新しくなっています"), null, { timeout: 5000 });
    assert.equal(readReq(), null);
  });

  await ctx.close();
} finally {
  await browser.close();
  srv.kill();
}

const bad = results.filter((r) => r[0] === "NG");
console.log(bad.length ? `落ちた試験 ${bad.length} 件 / ${results.length} 件` : `全部通りました(${results.length} 件)。絵: ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
