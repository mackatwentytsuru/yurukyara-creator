// 接客モード(店の端末)の決まりの試験。画面なし・通信なし。
// 1) 札: 作り・期限・書き換えの検出・QR に入る長さ(213 バイト以内)。番号の形(3 けた・9 けた・数字以外は断る)
// 2) 隠す一覧に、本人の言った物が全部ある。AI の表示・マイク・文字の欄・質問のボタンは、隠す一覧にも kiosk.css の隠す規則にも無い
// 3) 隠す一覧と kiosk.css の食い違い・index.html にその部品がある
// 4) ?kiosk= の読み取り・控え・URL から札を消す・壊れた札でも接客のまま
// 5) 角の長押し・番号の入力・画面を消さない(Wake Lock)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG, HIDDEN, HOLD_MS, KIOSK_STORE, SHOWN, TOKEN_RE, checkNewPin, claimsOf, clearKiosk, createLongPress, createPinPad, exitMessage, isPinForm,
  kioskCharacterId, kioskFromSearch, loadKiosk, normalizeKioskConfig, resolveKiosk, saveKiosk, withoutKioskParam,
} from '../src/stage/kioskMode.js';
import { createWakeLock } from '../src/stage/wakeLock.js';
import { QR_LIMIT_BYTES, TOKEN_TTL_S, createKiosk, isPin } from '../server/kiosk.mjs';
import { QR_MAX_BYTES, encodeQr } from '../src/stage/qrCode.js';

const WEB = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(WEB, rel), 'utf8');
const memStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const makeKiosk = (t = { now: 1_800_000_000_000 }, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-kiosk-'));
  const kiosk = createKiosk({ file: join(dir, 'kiosk.json'), now: () => t.now, ...extra });
  return { kiosk, dir, t };
};
const withPin = (kiosk, pin = '2468') => kiosk.update({ pin, pinConfirm: pin });

test('番号の形: 4〜8 けたの数字だけ。3 けた・9 けた・数字以外は断る(画面もサーバーも同じ決まり)', () => {
  for (const ok of ['1234', '00000', '123456', '12345678']) {
    assert.equal(isPinForm(ok), true, ok);
    assert.equal(isPin(ok), true, ok);
  }
  for (const bad of ['', '123', '123456789', 'abcd', '12 34', '12.4', '１２３４', null, undefined, 1234]) {
    assert.equal(isPinForm(bad), false, String(bad));
    assert.equal(isPin(bad), false, String(bad));
  }
  assert.equal(checkNewPin('123', '123').ok, false);
  assert.equal(checkNewPin('123456789', '123456789').ok, false);
  assert.equal(checkNewPin('12ab', '12ab').ok, false);
  assert.equal(checkNewPin('1234', '1235').ok, false);
  assert.equal(checkNewPin('1234', '1234').ok, true);
  for (const r of [checkNewPin('123', '123'), checkNewPin('12ab', '12ab'), checkNewPin('1234', '1235')]) assert.ok(r.reason.length > 0, '直し方の一言が付く');
});

test('サーバー: 番号は 3 けた・9 けた・数字以外では決まらない。決めるまで、何も決められず、札も作れない', () => {
  const { kiosk } = makeKiosk();
  assert.equal(kiosk.publicSettings().hasPin, false);
  assert.equal(kiosk.update({ lang: 'multi' }).status, 409, '番号が決まるまで、ことばも決められない');
  assert.equal(kiosk.issueToken(), null, '番号が決まるまで、札を作らない(0000 などの最初の番号は無い)');
  assert.equal(kiosk.qr('https://shop.example').ok, false);
  for (const pin of ['123', '123456789', 'abcd', '12 4']) {
    const r = kiosk.update({ pin, pinConfirm: pin });
    assert.equal(r.ok, false, pin);
    assert.equal(r.status, 400, pin);
  }
  assert.equal(kiosk.update({ pin: '1234', pinConfirm: '1235' }).error, 'pin-mismatch');
  assert.equal(kiosk.publicSettings().hasPin, false);
  assert.equal(withPin(kiosk, '1234').ok, true);
  assert.equal(kiosk.publicSettings().hasPin, true);
  assert.equal(kiosk.publicSettings().pinLength, 4);
  assert.ok(!('pin' in kiosk.publicSettings()) && !JSON.stringify(kiosk.publicSettings()).includes('1234'), '番号は返さない');
});

test('札: 中身は短く、署名つき。期限は 12 時間。書き換えると断る', () => {
  const { kiosk, t } = makeKiosk();
  withPin(kiosk);
  kiosk.update({ lang: 'multi' });
  const token = kiosk.issueToken('norrie');
  assert.match(token, TOKEN_RE);
  assert.ok(!token.includes('2468'), '番号は札に入らない');
  const ok = kiosk.verifyToken(token);
  assert.equal(ok.ok, true);
  assert.deepEqual({ c: ok.claims.c, l: ok.claims.l, v: ok.claims.v }, { c: 'norrie', l: 'm', v: 1 });
  assert.equal(claimsOf(token).c, 'norrie', '画面も中身を読める(署名は確かめない)');
  // 書き換え: 中身を変える・署名を変える・つなぎ直す
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...ok.claims, c: 'evil', e: ok.claims.e + 99999 })).toString('base64url');
  assert.equal(kiosk.verifyToken(`${forged}.${sig}`).ok, false);
  assert.equal(kiosk.verifyToken(`${payload}.${sig.startsWith('A') ? 'B' : 'A'}${sig.slice(1)}`).ok, false); // 先頭の文字を替える(最後の文字は端の数ビットが捨てられ、替えても同じ署名になりうる)
  assert.equal(kiosk.verifyToken(`${payload}.${sig}.x`).ok, false);
  for (const junk of ['', 'abc', '.', 'a.b', null, undefined, '%%%.%%%']) assert.equal(kiosk.verifyToken(junk).ok, false, String(junk));
  // 期限: 12 時間の手前は通り、過ぎたら expired
  assert.equal(TOKEN_TTL_S, 12 * 3600);
  t.now += (TOKEN_TTL_S - 5) * 1000;
  assert.equal(kiosk.verifyToken(token).ok, true);
  t.now += 10 * 1000;
  assert.deepEqual(kiosk.verifyToken(token), { ok: false, expired: true });
  // 別の鍵で作った札は通らない(鍵はサーバーだけが持つ)
  const other = makeKiosk(undefined, { secret: 'another-secret' }).kiosk;
  withPin(other);
  assert.equal(kiosk.verifyToken(other.issueToken()).ok, false);
});

test('QR: 札つきの URL が 213 バイト以内に収まる。長い住所は理由つきで断る。住所の形が違えば作らない', () => {
  const { kiosk } = makeKiosk();
  withPin(kiosk);
  assert.equal(QR_LIMIT_BYTES, QR_MAX_BYTES, 'qrCode.js の上限と同じ');
  for (const origin of ['https://shop.example', 'https://a-fairly-long-shop-name.long-network-name.example.net', 'http://shop-pc.example:8787']) {
    const r = kiosk.qr(origin, 'norrie');
    assert.equal(r.ok, true, origin);
    assert.ok(r.bytes <= QR_LIMIT_BYTES, `${origin}: ${r.bytes} バイト`);
    assert.ok(encodeQr(r.url), 'QR の部品が実際に符号にできる');
    assert.ok(r.url.startsWith(`${origin}/?kiosk=`));
    assert.equal(r.secure, origin.startsWith('https://'));
  }
  const long = kiosk.qr(`https://${'a'.repeat(190)}.example`, 'norrie');
  assert.deepEqual({ ok: long.ok, reason: long.reason }, { ok: false, reason: 'too-long' });
  for (const origin of ['', 'shop.example', 'ftp://x.example', 'https://user:pw@x.example', 'https://x.example/path?x=1', 'javascript:alert(1)']) {
    assert.equal(kiosk.qr(origin).ok, false, origin);
  }
  assert.equal(kiosk.qr('https://shop.example/', 'norrie').url.includes('example//?'), false, '最後の / は 1 つにする');
});

test('サーバー: 設定の欄は決まりの形に直る(ことば・きまりの長さ・放っておく時間の幅)。公開する設定に番号が無い', () => {
  const { kiosk } = makeKiosk();
  withPin(kiosk);
  kiosk.update({ lang: 'klingon', facts: 'あ'.repeat(5000), idleSec: 5, characterId: '../evil' });
  const s = kiosk.publicSettings();
  assert.equal(s.lang, 'ja');
  assert.equal(s.facts.length, 2000);
  assert.equal(s.idleSec, 30, '短すぎる値は 30 秒に');
  assert.equal(s.characterId, '');
  kiosk.update({ lang: 'multi', idleSec: 99999, characterId: 'norrie' });
  assert.deepEqual([kiosk.publicSettings().lang, kiosk.publicSettings().idleSec, kiosk.publicSettings().characterId], ['multi', 600, 'norrie']);
  kiosk.update({ idleSec: 'abc' });
  assert.equal(kiosk.publicSettings().idleSec, 90, '数でない値は既定の 90 秒');
  // 店の端末へ見せる設定: 番号も鍵も無い。合わない札は、閉じる側に倒した既定
  const good = kiosk.configFor(kiosk.issueToken());
  assert.equal(good.valid, true);
  assert.ok(!JSON.stringify(good).includes('2468') && !('pin' in good) && !('key' in good));
  const bad = kiosk.configFor('broken.token');
  assert.deepEqual([bad.kiosk, bad.valid, bad.lang, bad.facts, bad.idleSec], [true, false, 'ja', '', 90], '壊れた札でも接客モードのまま(kiosk: true)');
});

test('隠す一覧: 本人の言った物(かえる・もっと・歯車・カメラの入切・覚えていること・VR・テレビ・見た目の切り替え)と、作る入口・考えの欄が全部ある', () => {
  const names = HIDDEN.map((h) => h.name).join('|');
  for (const want of ['かえる', 'もっと', '歯車', 'カメラの入切', '覚えていること', 'VR', 'テレビ', '見た目の切り替え', '作る入口', '考えの欄']) {
    assert.ok(names.includes(want), `隠す一覧に「${want}」が無い`);
  }
  const sel = HIDDEN.map((h) => h.selector);
  for (const s of ['#changeBtn', '#moreBtn', '.yc-audio-btn', '#camBtn', '#memoryDrawer', '#questLink', '#tvBtn', '#lookSwitch', '#modes', '#thought']) assert.ok(sel.includes(s), s);
  assert.equal(new Set(sel).size, sel.length, '同じ物を 2 回書かない');
});

test('見せる物: AI の表示・マイク・文字の欄・質問のボタンは、隠す一覧にも kiosk.css の隠す規則にも無い', () => {
  const css = read('src/ui/kiosk.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const hidingSelectors = rules.filter((r) => /display:\s*none/.test(r.body)).flatMap((r) => r.sel.split(',').map((s) => s.trim()));
  for (const { name, selector } of SHOWN) {
    assert.ok(!HIDDEN.some((h) => h.selector === selector), `${name}(${selector}) が隠す一覧にある`);
    assert.ok(!hidingSelectors.some((s) => s === `html.is-kiosk ${selector}` || s.endsWith(` ${selector}`) && !s.includes('.gate')), `${name}(${selector}) を kiosk.css が隠している`);
  }
  for (const want of ['#aiNotice', '#micBtn', '#textInput', '#choices']) assert.ok(SHOWN.some((s) => s.selector === want), want);
  assert.match(css, /html\.is-kiosk #aiNotice\s*\{\s*display:\s*block !important/, 'AI の表示は、どんな時も出す');
});

test('隠す一覧と kiosk.css が同じ: 一覧の物は全部 html.is-kiosk の下で display:none !important。index.html に、見せる物の部品がある', () => {
  const css = read('src/ui/kiosk.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].includes('#changeBtn'));
  assert.ok(rule, '隠す規則がある');
  assert.match(rule[2], /display:\s*none\s*!important/);
  const listed = rule[1].split(',').map((s) => s.trim());
  for (const { name, selector } of HIDDEN) assert.ok(listed.includes(`html.is-kiosk ${selector}`), `${name}(${selector}) が kiosk.css の隠す規則に無い`);
  for (const s of listed) assert.ok(HIDDEN.some((h) => `html.is-kiosk ${h.selector}` === s), `${s} が隠す一覧に無い`);
  const html = read('index.html');
  for (const id of ['aiNotice', 'micBtn', 'textInput', 'choices', 'caption', 'hearLangBox', 'kioskStart', 'kioskLead']) assert.ok(html.includes(`id="${id}"`), `index.html に #${id} が無い`);
  assert.match(html, /href="\/src\/ui\/kiosk\.css"/);
  assert.match(html, /src="\/src\/stage\/kioskEarly\.js"/);
});

test('?kiosk= の読み取り: 付いていれば接客モード。札の形が合う時だけ token が入る。壊れていても接客のまま', () => {
  const { kiosk } = makeKiosk();
  withPin(kiosk);
  const token = kiosk.issueToken();
  assert.deepEqual(kioskFromSearch(`?kiosk=${token}`), { present: true, token });
  assert.deepEqual(kioskFromSearch('?kiosk=broken'), { present: true, token: '' }, '壊れた札でも接客モード');
  assert.deepEqual(kioskFromSearch('?kiosk='), { present: true, token: '' });
  assert.deepEqual(kioskFromSearch('?character=norrie'), { present: false, token: '' });
  assert.deepEqual(kioskFromSearch(''), { present: false, token: '' });
  assert.equal(resolveKiosk({ search: '?kiosk=broken', storage: memStorage() }).on, true);
  assert.equal(resolveKiosk({ search: '', storage: memStorage() }).on, false, '付いていなくて控えも無ければ、ふつうの画面');
  assert.equal(resolveKiosk({ search: '', storage: null }).on, false);
});

test('控え: 札と見せてよい設定だけ。読み込み直しても接客のまま。壊れた控え・使えない端末でも止まらない。出たら消える', () => {
  const st = memStorage();
  const cfg = normalizeKioskConfig({ lang: 'multi', facts: '9 時から 17 時', idleSec: 120, characterId: 'norrie' });
  assert.equal(saveKiosk(st, { token: 'abcd.' + 'x'.repeat(22), cfg }), true);
  const again = resolveKiosk({ search: '', storage: st });
  assert.equal(again.on, true);
  assert.equal(again.cfg.lang, 'multi');
  assert.equal(again.cfg.idleMs, 120_000);
  assert.equal(again.cfg.facts, '9 時から 17 時');
  assert.ok(!st.m.get(KIOSK_STORE).includes('pin'), '控えに番号は無い');
  assert.equal(kioskCharacterId(again), 'norrie');
  assert.equal(kioskCharacterId({ token: '', cfg: DEFAULT_CONFIG }), '');
  clearKiosk(st);
  assert.equal(loadKiosk(st), null);
  assert.equal(resolveKiosk({ search: '', storage: st }).on, false, '出たら、ふつうの画面');
  st.setItem(KIOSK_STORE, '{こわれた');
  assert.equal(loadKiosk(st), null);
  assert.equal(saveKiosk({ setItem() { throw new Error('使えない'); } }, { token: '', cfg: DEFAULT_CONFIG }), false, '書けなくても投げない');
  assert.doesNotThrow(() => clearKiosk({ removeItem() { throw new Error('使えない'); } }));
  assert.equal(loadKiosk({ getItem() { throw new Error('使えない'); } }), null);
});

test('URL から札を消す: ほかの ? と # は残す。住所の頭(http(s)://名前)は落として相対にする', () => {
  assert.equal(withoutKioskParam('https://shop.example/?kiosk=abc.def'), '/');
  assert.equal(withoutKioskParam('/?kiosk=abc&character=norrie'), '/?character=norrie');
  assert.equal(withoutKioskParam('/index.html?look=2d&kiosk=a.b#x'), '/index.html?look=2d#x');
  assert.equal(withoutKioskParam('http://127.0.0.1:8787?kiosk=a.b'), '/');
  assert.equal(withoutKioskParam('/'), '/');
});

test('角の長押し: 3 秒続けた時だけ 1 回開く。途中で離す・外れると数え直し。進み具合が 0〜1 で出る', () => {
  assert.equal(HOLD_MS, 3000);
  const seen = [];
  let fired = 0;
  const lp = createLongPress({ onProgress: (p) => seen.push(p), onFire: () => (fired += 1) });
  lp.down(1000);
  assert.equal(lp.tick(2000), 1 / 3);
  assert.equal(lp.tick(3999) < 1, true);
  assert.equal(fired, 0);
  lp.up(); // 3 秒の手前で離す
  assert.equal(lp.active, false);
  assert.equal(seen.at(-1), 0, '輪は空に戻る');
  lp.tick(9000);
  assert.equal(fired, 0, '離した後は進まない');
  lp.down(10_000);
  lp.tick(11_000);
  lp.tick(13_000);
  assert.equal(fired, 1, '3 秒で開く');
  lp.tick(14_000);
  lp.tick(20_000);
  assert.equal(fired, 1, '押し続けても 1 回だけ');
  assert.ok(seen.every((p) => p >= 0 && p <= 1));
  lp.cancel();
  lp.down(30_000);
  lp.tick(31_000);
  lp.cancel();
  lp.tick(40_000);
  assert.equal(fired, 1, '外れたら数え直し');
});

test('番号の窓の入力: 数字だけ・8 けたまで・1 つ消す・全部消す。4 けたで送れる。端末のキーボードは使わない(入力欄が無い)', () => {
  const pad = createPinPad();
  for (const k of ['1', 'a', '2', '-', '3']) pad.push(k);
  assert.equal(pad.value, '123');
  assert.equal(pad.ready, false);
  pad.push('4');
  assert.equal(pad.ready, true);
  for (let i = 0; i < 20; i++) pad.push('9');
  assert.equal(pad.value.length, 8);
  pad.back();
  assert.equal(pad.value.length, 7);
  pad.clear();
  assert.equal(pad.value, '');
  const src = read('src/ui/kioskExit.js');
  assert.ok(!/createElement\(['"]input|el\(\s*['"]input|<input|<textarea/.test(src), '番号の窓に入力欄を作らない(キーボードを出さない)');
  assert.match(exitMessage({ status: 403, remaining: 2 }), /あと 2 かい/);
  assert.match(exitMessage({ status: 429, retryAfterS: 300 }), /5 ぶん/);
  assert.ok(exitMessage({ status: 0 }).length > 0);
});

test('画面を消さない(Wake Lock): 取る・裏に回って取り上げられたら戻った時に取り直す・使えない端末・断られても止まらない・離す', async () => {
  const listeners = new Map();
  const doc = { visibilityState: 'visible', addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t) => listeners.delete(t) };
  const sentinels = [];
  let denyNext = false;
  const nav = {
    wakeLock: {
      request: async () => {
        if (denyNext) throw new Error('断られた');
        const handlers = {};
        const s = { released: false, addEventListener: (t, f) => (handlers[t] = f), release: async () => { s.released = true; handlers.release?.(); }, fire: () => { s.released = true; handlers.release?.(); } };
        sentinels.push(s);
        return s;
      },
    },
  };
  const lock = createWakeLock({ nav, doc });
  assert.equal(await lock.start(), true);
  assert.equal(lock.held, true);
  assert.equal(sentinels.length, 1);
  // 画面が裏に回って、取り上げられた。戻ったら取り直す
  doc.visibilityState = 'hidden';
  sentinels[0].fire();
  assert.equal(lock.held, false);
  listeners.get('visibilitychange')();
  assert.equal(sentinels.length, 1, '裏にいる間は取りに行かない');
  doc.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sentinels.length, 2, '戻ったら取り直す');
  assert.equal(lock.held, true);
  await lock.stop();
  assert.equal(sentinels[1].released, true);
  assert.equal(lock.held, false);
  assert.equal(listeners.size, 0, '離したら、見張りもやめる');
  // 断られた・使えない端末
  denyNext = true;
  const denied = createWakeLock({ nav, doc });
  assert.equal(await denied.start(), false);
  assert.equal(denied.held, false);
  const none = createWakeLock({ nav: {}, doc });
  assert.equal(await none.start(), false);
  await none.stop();
});
