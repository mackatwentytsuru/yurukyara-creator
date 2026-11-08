// 接客モード(店の端末)を、画面なしの Chrome で確かめる(KD の「kiosk_browser.test」)。
// 試しの画面は、本物の web/index.html の本文と style.css・kiosk.css と、接客モードの部品(stage/kioskMode.js・ui/kioskExit.js・conversation/shopDevice.js・ui/aiNotice.js)だけ。
// 舞台の WebGL と main.js は使わない(main.js の配線を含めた確かめは、GPU の Chrome で本物のサーバーを起こす道具で別にする)。
// 番号の照合は、本物のサーバーの決まり(server/kiosk.mjs)を、頁の /api/kiosk/exit の答えに使う。
// 見る物: 隠す物が見えない・AI の表示が見える・読み込み直しても接客のまま・角の長押し 3 秒で数字の窓・違う番号では残る・正しい番号でふつうへ・放っておくと字幕と会話が空。
// 大きさは 390x844(iPhone)・412x915(Android)・1280x720(PC)。重いので YC_BROWSER_TESTS=1 のときだけ動く。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。
// KIOSK_SHOTS_DIR を渡すと写真を残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createKiosk } from '../server/kiosk.mjs';
import { HIDDEN, SHOWN } from '../src/stage/kioskMode.js';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const SHOTS = process.env.KIOSK_SHOTS_DIR || '';
const SIZES = [
  { name: 'iphone_390x844', w: 390, h: 844 },
  { name: 'android_412x915', w: 412, h: 915 },
  { name: 'pc_1280x720', w: 1280, h: 720 },
];
const PIN = '4821';
const IDLE_TEST_MS = 1200;
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** 本物の index.html の本文から、main.js と kioskEarly.js を外した試しの画面。main.js が接客モードで付ける物と同じ順に、小さな部品を並べる */
function page() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const body = html
    .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
    .replace(/<script type="module" src="\/src\/main\.js"><\/script>/, '')
    .replace(/<script type="module" src="\/src\/stage\/kioskEarly\.js"><\/script>/, '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/src/ui/style.css"><link rel="stylesheet" href="/src/ui/kiosk.css"><title>接客モードの試し</title></head><body>${body}
<script type="module">
import { KIOSK_CLASS, resolveKiosk, saveKiosk, withoutKioskParam } from '/src/stage/kioskMode.js';
import { createIdleClear } from '/src/conversation/shopDevice.js';
import { mountKioskExit } from '/src/ui/kioskExit.js';
import { setAiNotice } from '/src/ui/aiNotice.js';
// main.js と同じ決まり: 札は控えへ移して URL から消す。控えがあれば、URL に無くても接客のまま
const KIOSK = resolveKiosk({ search: location.search, storage: window.localStorage });
if (KIOSK.on) {
  document.documentElement.classList.add(KIOSK_CLASS);
  if (KIOSK.fromUrl) {
    saveKiosk(window.localStorage, KIOSK);
    history.replaceState(history.state, '', withoutKioskParam(location.href));
  }
}
document.getElementById('gate').classList.add('hidden'); // 入口は閉じた後の画面を見る(接客の入口の見え方は、本物の画面の道具で見る)
document.getElementById('topMain').hidden = false; // ふつうの画面では main.js が上の段(はなす・かえる・もっと)を出す。接客モードでは kiosk.css が段ごと隠す
window.__kiosk = KIOSK.on;
window.__exited = 0;
window.__ready = false;
if (KIOSK.on) {
  mountKioskExit({ onExit: () => { window.__exited += 1; document.documentElement.classList.remove(KIOSK_CLASS); } });
}
// 会話の履歴と字幕(放っておくと空になる物)
window.__history = [];
const idle = createIdleClear({
  isOn: () => KIOSK.on,
  ms: () => ${IDLE_TEST_MS},
  onClear: () => {
    window.__history = [];
    const cap = document.getElementById('caption');
    cap.textContent = '';
    cap.hidden = true;
    window.__cleared = (window.__cleared || 0) + 1;
  },
});
window.__say = (text) => {
  window.__history.push(text);
  const cap = document.getElementById('caption');
  cap.textContent = text;
  cap.hidden = false;
  idle.touch();
};
window.__notice = (name, lang) => setAiNotice({ name, lang });
window.__notice('ノリー', 'ja');
window.__ready = true;
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

/** 試しの頁を開く。/api/kiosk/exit は、本物のサーバーの決まり(kiosk)で答える */
async function open(browser, { w, h }, kiosk, query = '?kiosk=') {
  const touch = w < 720;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const posted = [];
  await ctx.route('http://shop.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/kiosk/exit') {
      const pin = JSON.parse(req.postData() || '{}').pin;
      posted.push(pin);
      const r = kiosk.exit(pin);
      const body = r.ok ? { ok: true } : r.status === 429 ? { ok: false, locked: true, retryAfterS: r.retryAfterS } : { ok: false, remaining: r.remaining ?? null };
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (path === '/' || path === '/index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page() });
    const file = join(WEB, path);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://shop.test/${query}`);
  await p.waitForFunction(() => window.__ready === true);
  return { ctx, page: p, errors, posted };
}

const shot = async (p, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: join(SHOTS, `${name}.png`) });
};

/** その物が、いま見えているか(置かれていて、display / visibility が消えていなくて、大きさがある。hidden の中も見えない) */
const isShown = (p, selector) =>
  p.evaluate((s) => {
    const nodes = [...document.querySelectorAll(s)];
    return nodes.some((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return !el.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
  }, selector);

function freshKiosk(dir) {
  const k = createKiosk({ file: join(dir, 'kiosk.json') });
  assert.equal(k.update({ pin: PIN, pinConfirm: PIN }).ok, true);
  return k;
}

for (const size of SIZES) {
  test(`接客モード(${size.name}): 隠す物が見えず、AI の表示・マイク・文字の欄・質問のボタンが見える`, { skip: SLOW }, async (t) => {
    const browser = await findChrome();
    if (!browser) return t.skip('Chrome が見つからない');
    const dir = mkdtempSync(join(tmpdir(), 'kiosk-b-'));
    const { ctx, page: p, errors } = await open(browser, size, freshKiosk(dir));
    try {
      // 質問のボタン(店のデータがある時だけ main.js が出す)と、字幕を、出した形にする
      await p.evaluate(() => {
        const box = document.getElementById('choices');
        box.hidden = false;
        box.replaceChildren(...['営業時間は?', 'トイレはどこ?'].map((s) => Object.assign(document.createElement('button'), { type: 'button', textContent: s })));
        window.__say('いらっしゃいませ');
        // 下の帯の高さ(main.js が測って入れる --bottom-h)を、同じように入れる
        document.documentElement.style.setProperty('--bottom-h', `${Math.round(document.querySelector('.bottom').getBoundingClientRect().height)}px`);
      });
      await p.waitForTimeout(150);
      for (const h of HIDDEN) assert.equal(await isShown(p, h.selector), false, `${h.name}(${h.selector})が見えている`);
      for (const s of SHOWN.filter((x) => x.selector !== '#hearLangBox')) assert.equal(await isShown(p, s.selector), true, `${s.name}(${s.selector})が見えない`);
      const notice = await p.evaluate(() => document.getElementById('aiNotice').textContent.trim());
      assert.match(notice, /AI キャラクターのノリーと話しています/);
      // 押す物は、ほかの物に覆われていない(中心を指で押すと、その物に当たる)
      for (const sel of ['#micBtn', '#textInput', '#choices button']) {
        const hit = await p.evaluate((s) => {
          const el = document.querySelector(s);
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(top && (el === top || el.contains(top) || top.contains(el)));
        }, sel);
        assert.equal(hit, true, `${sel} がほかの物に覆われている`);
      }
      // 画面の外にはみ出さない
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `横にはみ出している(${overflow}px)`);
      await shot(p, `kiosk_${size.name}_talk`);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('接客モード: 札は URL から消え、読み込み直しても接客のまま。印が無い頁は、ふつうの画面(隠さない)', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-b-'));
  const kiosk = freshKiosk(dir);
  const token = kiosk.issueToken('');
  const { ctx, page: p } = await open(browser, SIZES[0], kiosk, `?kiosk=${token}&x=1`);
  try {
    assert.equal(await p.evaluate(() => window.__kiosk), true);
    assert.equal(await p.evaluate(() => location.search), '?x=1', '札が URL に残っている');
    await p.reload();
    await p.waitForFunction(() => window.__ready === true);
    assert.equal(await p.evaluate(() => window.__kiosk), true, '読み込み直したら、ふつうの画面に戻った');
    assert.equal(await isShown(p, '#moreBtn'), false);
    // 古い・壊れた札でも接客のまま(閉じる側)
    const broken = await open(browser, SIZES[0], kiosk, '?kiosk=こわれた');
    assert.equal(await broken.page.evaluate(() => window.__kiosk), true, '壊れた札で、ふつうの画面になった');
    assert.equal(await isShown(broken.page, '#moreBtn'), false);
    await broken.ctx.close();
    // ふつうの画面(印も控えも無い)は、隠さない
    const plain = await open(browser, SIZES[0], kiosk, '');
    assert.equal(await plain.page.evaluate(() => window.__kiosk), false);
    assert.equal(await isShown(plain.page, '#moreBtn'), true, 'ふつうの画面で「もっと」が消えている');
    assert.equal(await isShown(plain.page, '#changeBtn'), true);
    await plain.ctx.close();
  } finally {
    await ctx.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('接客モード: 左上の角を 3 秒長押しで数字の窓。途中で離すと出ない。違う番号では残り、正しい番号でふつうへ', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-b-'));
  const kiosk = freshKiosk(dir);
  const { ctx, page: p, posted } = await open(browser, SIZES[0], kiosk);
  try {
    const dialogShown = () => isShown(p, '#kioskExit');
    const zone = await p.locator('#kioskExitZone').boundingBox();
    assert.ok(zone, '角の場所が無い');
    const x = zone.x + zone.width / 2;
    const y = zone.y + zone.height / 2;
    // 1.5 秒で離す: 出ない
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.waitForTimeout(1500);
    await p.mouse.up();
    await p.waitForTimeout(300);
    assert.equal(await dialogShown(), false, '3 秒たたないのに窓が出た');
    // 3.4 秒押し続ける: 出る(途中で輪が満ちていく)
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.waitForTimeout(1600);
    const mid = await p.evaluate(() => Number(document.getElementById('kioskExitZone').style.getPropertyValue('--p')));
    assert.ok(mid > 0.3 && mid < 0.8, `輪の進みがおかしい(${mid})`);
    await shot(p, 'kiosk_iphone_390x844_holding');
    await p.waitForTimeout(1800);
    await p.mouse.up();
    await p.waitForFunction(() => !document.getElementById('kioskExit').hidden, null, { timeout: 3000 });
    assert.equal(await dialogShown(), true);
    // 窓は入力欄を持たない(端末のキーボードを出さない)
    assert.equal(await p.locator('#kioskExit input, #kioskExit textarea').count(), 0);
    await shot(p, 'kiosk_iphone_390x844_pad');
    const press = async (digits) => {
      for (const d of digits) await p.click(`#kioskExit .kx-key[data-k="${d}"]`);
    };
    // 違う番号
    await press('1111');
    await p.click('#kioskExit .kx-ok');
    await p.waitForFunction(() => /ちがうよ/.test(document.querySelector('#kioskExit .kx-msg').textContent));
    assert.equal(await dialogShown(), true, '違う番号で窓が閉じた');
    assert.equal(await p.evaluate(() => window.__exited), 0);
    assert.equal(await isShown(p, '#moreBtn'), false, '違う番号でふつうの画面に戻った');
    await shot(p, 'kiosk_iphone_390x844_wrong');
    // 正しい番号
    await press(PIN);
    await p.click('#kioskExit .kx-ok');
    await p.waitForFunction(() => window.__exited === 1);
    assert.equal(await isShown(p, '#moreBtn'), true, '正しい番号でふつうの画面に戻らない');
    assert.deepEqual(posted, ['1111', PIN]);
  } finally {
    await ctx.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('接客モード: 5 回違うと窓が止まる(サーバーが数える)。止まっている間は、正しい番号でも出られない', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-b-'));
  const kiosk = freshKiosk(dir);
  const { ctx, page: p } = await open(browser, SIZES[1], kiosk);
  try {
    await p.evaluate(() => document.getElementById('kioskExit').hidden = false); // 窓を直接出す(長押しは上の試験が見る)
    const enter = async (pin) => {
      for (const d of pin) await p.click(`#kioskExit .kx-key[data-k="${d}"]`);
      await p.click('#kioskExit .kx-ok');
      await p.waitForFunction(() => document.querySelector('#kioskExit .kx-msg').textContent !== 'たしかめているよ…');
    };
    for (let i = 0; i < 5; i++) await enter('9999');
    const msg = await p.evaluate(() => document.querySelector('#kioskExit .kx-msg').textContent);
    assert.match(msg, /まって/);
    await enter(PIN);
    assert.equal(await p.evaluate(() => window.__exited), 0, '止めている間に出られた');
    await shot(p, 'kiosk_android_412x915_locked');
  } finally {
    await ctx.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('接客モード: 放っておくと、字幕と会話が空になる(話している間は数え直す)。ふつうの画面は空にしない', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない');
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-b-'));
  const kiosk = freshKiosk(dir);
  const { ctx, page: p } = await open(browser, SIZES[0], kiosk);
  try {
    await p.evaluate(() => window.__say('こんにちは'));
    await p.waitForTimeout(IDLE_TEST_MS - 500);
    await p.evaluate(() => window.__say('もうひとこと')); // 話しかけたので、数え直し
    await p.waitForTimeout(IDLE_TEST_MS - 500);
    assert.equal(await p.evaluate(() => window.__history.length), 2, '話している間に空になった');
    await p.waitForFunction(() => window.__cleared === 1, null, { timeout: 4000 });
    assert.equal(await p.evaluate(() => window.__history.length), 0);
    assert.equal(await p.evaluate(() => document.getElementById('caption').textContent), '');
    assert.equal(await isShown(p, '#caption'), false);
    await shot(p, 'kiosk_iphone_390x844_empty');
    // ふつうの画面は、放っておいても空にしない
    const plain = await open(browser, SIZES[0], kiosk, '');
    await plain.page.evaluate(() => window.__say('そのまま'));
    await plain.page.waitForTimeout(IDLE_TEST_MS + 600);
    assert.equal(await plain.page.evaluate(() => window.__history.length), 1);
    await plain.ctx.close();
  } finally {
    await ctx.close();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
