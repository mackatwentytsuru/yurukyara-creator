// 「AI のキャラクターと話しています」がいつも見えるか(11-08 BSF。使う人と話すチャットは AI だと知らせる決まり)を、画面なしの Chrome で確かめる。
// 試しの画面は、本物の web/index.html の本文と style.css と、はじめての会話の札の CSS(onboarding/styles.js)だけ(舞台の WebGL・main.js は使わない)。
// 画面の状態(入口・ふだん・はじめての会話・入口の LED・テレビ表示・低い画面・キーボード)は、main.js が付けるのと同じ html の印で作る。
// 大きさは 390x670・390x844・1280x720・1920x1080。性格の画面の「付けられない性格」の 1 行も見る。
// 重いので YC_BROWSER_TESTS=1 のときだけ動く。Chrome が無い時は飛ばす(CHROME_PATH で場所を渡せる)。BSF_SHOTS_DIR を渡すと写真を残す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const WEB = join(import.meta.dirname, '..');
const SRC = join(WEB, 'src');
const SLOW = process.env.YC_BROWSER_TESTS === '1' ? false : '画面なしの Chrome の試験は YC_BROWSER_TESTS=1 のときだけ';
const SHOTS = process.env.BSF_SHOTS_DIR || '';
const SIZES = [
  [390, 670],
  [390, 844],
  [1280, 720],
  [1920, 1080],
];
const AI_TEXT = 'AI のキャラクターと話しています';

/** 本物の index.html の本文から、main.js を外した試しの画面 */
function page() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).replace(/<script type="module" src="\/src\/main\.js"><\/script>/, '');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/src/ui/style.css"><title>AI の知らせの試し</title></head><body>${body}
<script type="module">
import { injectStyles } from '/src/ui/onboarding/styles.js';
import { openPersonaPanel } from '/src/ui/persona/panel.js';
import { defaults, seededRandom } from '/src/ui/persona/settings.js';
injectStyles(document);
window.__openPersona = () => openPersonaPanel({ initial: defaults(), characterName: 'ノリー', random: seededRandom(1), preview: async () => ({ text: 'こんにちは' }), play: () => {}, onSave() {} });
window.__ready = true;
</script></body></html>`;
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function findChrome() {
  let pw;
  try {
    pw = await import('playwright-core');
  } catch {
    return null;
  }
  // BSF_ENGINE=webkit と WEBKIT_PATH で、Safari と同じ描き方の WebKit でも流せる(iPhone の Safari の並びの目安)
  if (process.env.BSF_ENGINE === 'webkit') {
    try {
      return await pw.webkit.launch({ headless: true, ...(process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {}) });
    } catch {
      return null;
    }
  }
  const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  try {
    return await pw.chromium.launch({ ...opts, headless: true });
  } catch {
    return null;
  }
}

async function open(browser, [width, height]) {
  const touch = width < 720;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  await ctx.route('http://ai.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/' || path === '/index.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page() });
    const file = join(WEB, path);
    if (!file.startsWith(SRC) || !TYPES[extname(file)]) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: TYPES[extname(file)], body: readFileSync(file, 'utf8') });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://ai.test/');
  await p.waitForFunction(() => window.__ready === true);
  return { ctx, page: p, errors };
}

/** 画面の状態を、main.js が付けるのと同じ印で作る(上の段の高さ --top-h と下の帯の高さ --bottom-h も測って入れる) */
async function setState(p, state) {
  await p.evaluate((st) => {
    const root = document.documentElement;
    root.className = '';
    document.querySelector('.fr-sheet')?.remove();
    const gate = document.getElementById('gate');
    gate.classList.remove('hidden');
    document.getElementById('gateFirst').hidden = st !== 'gate-first';
    if (st === 'gate' || st === 'gate-first') root.classList.add('gate-up');
    else gate.classList.add('hidden');
    if (st === 'first') {
      root.classList.add('gate-up', 'fr-open');
      const sheet = document.createElement('section');
      sheet.className = 'fr-sheet';
      sheet.style.height = '58vh'; // はじめての会話の札(下から 58%)
      sheet.innerHTML = '<div class="fr-head"><b>はじめての会話</b></div>';
      document.body.append(sheet);
    }
    if (st === 'led') root.classList.add('is-led');
    if (st === 'tv') root.classList.add('tv-mode');
    if (st === 'kb') root.classList.add('kb-open');
    document.getElementById('lookSwitch').hidden = false; // 3D と 2D の両方がある子(ノリー)
    root.style.setProperty('--top-h', `${Math.round(document.querySelector('.top').getBoundingClientRect().height)}px`);
    root.style.setProperty('--bottom-h', `${Math.round(document.querySelector('.bottom').getBoundingClientRect().height)}px`);
  }, state);
  await p.waitForTimeout(50);
}

/** 知らせの 1 行が、見えていて、画面の中にあり、ほかの物に覆われていないか。押す所に重ならないか */
async function noticeFacts(p, sel) {
  return p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const vw = innerWidth;
    const vh = innerHeight;
    const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) >= 0.5 && r.width > 0 && r.height > 0;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    // 知らせは押す所ではない(pointer-events: none)ので、覆われているかを見る間だけ当たるようにする
    const before = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(cx, cy);
    el.style.pointerEvents = before;
    const overlaps = [...document.querySelectorAll('button, input, summary, .look-switch, .chip, .composer, .gate-card .primary')]
      .filter((b) => {
        const bs = getComputedStyle(b);
        if (bs.display === 'none' || bs.visibility === 'hidden' || b.closest('[hidden]')) return false;
        const q = b.getBoundingClientRect();
        if (q.width === 0 || q.height === 0) return false;
        return q.left < r.right - 0.5 && q.right > r.left + 0.5 && q.top < r.bottom - 0.5 && q.bottom > r.top + 0.5 && !el.contains(b) && !b.contains(el);
      })
      .map((b) => `${b.tagName}.${b.className}`);
    return {
      exists: true,
      text: el.textContent.trim(),
      shown,
      inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5,
      onTop: Boolean(hit && (hit === el || el.contains(hit))),
      overlaps,
      font: parseFloat(cs.fontSize),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  }, sel);
}

async function shot(p, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('「AI のキャラクターと話しています」: ふだん・はじめての会話・入口の LED・テレビ表示で、見えて・画面の中・覆われない・押す所に重ならない(4 つの大きさ)', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  try {
    for (const size of SIZES) {
      const { ctx, page: p, errors } = await open(browser, size);
      for (const st of ['normal', 'first', 'led', 'tv']) {
        await setState(p, st);
        const f = await noticeFacts(p, '#aiNotice');
        const where = `${size.join('x')} ${st}`;
        await shot(p, `ai_${st}_${size.join('x')}`);
        assert.equal(f.text, AI_TEXT, where);
        assert.ok(f.shown, `${where} 見えている ${JSON.stringify(f)}`);
        assert.ok(f.inside, `${where} 画面の中 ${JSON.stringify(f.box)}`);
        assert.ok(f.onTop, `${where} ほかの物に覆われていない ${JSON.stringify(f.box)}`);
        assert.deepEqual(f.overlaps, [], `${where} 押す所に重ならない`);
        assert.ok(f.font >= 12, `${where} 字は 12px 以上(${f.font})`);
      }
      // 画面のキーボードが出ている間だけは、入力の 1 行と字幕を先に見せるため隠す(入る前と閉じた後は見える)
      await setState(p, 'kb');
      assert.equal((await noticeFacts(p, '#aiNotice')).shown, false, `${size.join('x')} キーボードの間は隠す`);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test('入口: 「AI のキャラクターと話します。小学生以下は、おうちの人といっしょに使ってね。」が札の中に見える。はじめての訪問の 1 行が増えた低い画面でも、札の上と下まで届く', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  try {
    for (const size of SIZES) {
      const { ctx, page: p } = await open(browser, size);
      for (const st of ['gate', 'gate-first']) {
        await setState(p, st);
        await shot(p, `gate_${st}_${size.join('x')}`);
        const f = await noticeFacts(p, '#gateAi');
        const where = `${size.join('x')} ${st}`;
        assert.equal(f.text, 'AI のキャラクターと話します。小学生以下は、おうちの人といっしょに使ってね。', where);
        assert.ok(f.shown && f.onTop, `${where} 見えている ${JSON.stringify(f)}`);
        // 札が画面より高い時は、入口を巻いて、札のいちばん上(題)といちばん下(注意書き)に届く
        const reach = await p.evaluate(() => {
          const gate = document.getElementById('gate');
          const card = gate.querySelector('.gate-card');
          gate.scrollTop = 0;
          const topOk = card.getBoundingClientRect().top >= -0.5;
          gate.scrollTop = gate.scrollHeight;
          const bottomOk = card.getBoundingClientRect().bottom <= innerHeight + 0.5;
          gate.scrollTop = 0;
          return { topOk, bottomOk, overflow: gate.scrollHeight > gate.clientHeight };
        });
        assert.ok(reach.topOk && reach.bottomOk, `${where} 札の上と下に届く ${JSON.stringify(reach)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test('性格の画面: 「恋人の役・ひとりじめ・ひきとめる性格は、つけられません」の 1 行が見える(幅 390 と 1280)', { skip: SLOW }, async (t) => {
  const browser = await findChrome();
  if (!browser) return t.skip('Chrome が見つからない(CHROME_PATH で渡せます)');
  try {
    for (const size of [SIZES[0], SIZES[2]]) {
      const { ctx, page: p, errors } = await open(browser, size);
      await setState(p, 'normal');
      await p.evaluate(() => window.__openPersona());
      await p.waitForSelector('.yp-safety-note');
      await shot(p, `persona_${size.join('x')}`);
      const f = await noticeFacts(p, '.yp-safety-note');
      assert.match(f.text, /恋人の役・ひとりじめ・ひきとめる性格は、つけられません/);
      assert.ok(f.shown && f.inside, `${size.join('x')} ${JSON.stringify(f)}`);
      assert.ok(f.font >= 12);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});
