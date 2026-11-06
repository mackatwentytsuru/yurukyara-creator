// 公開のリンクの Content-Security-Policy(web/vercel.json)の中身を確かめる。web で `node --test` を流すと一緒に動く。
// ブラウザで本当に動くか(MediaPipe の wasm・3D・2D・自分の鍵の声・記憶の札)は csp_browser_check.mjs(GPU の札を取って流す)。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

/** vercel.json の見出しの決まりから、全部の道にかかる CSP を読み、{ 指示: [値…] } にする */
export function readCsp(config = vercel) {
  const all = config.headers.find((h) => h.source === '/(.*)');
  const raw = all?.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value ?? '';
  const out = {};
  for (const part of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    out[name] = values;
  }
  return out;
}

test('CSP: 全部の道にかかり、枠・object は無し、ほかのサイトの枠にも入らない', () => {
  const csp = readCsp();
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['frame-src'], ["'none'"], '作る道の枠(手元の PC)を公開の画面に出さない');
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
});

test('CSP: 書いた台本は自分のサイトの物だけ。wasm は許すが eval と埋め込みの台本は許さない', () => {
  const script = readCsp()['script-src'];
  assert.ok(script.includes("'self'"));
  assert.ok(script.includes("'wasm-unsafe-eval'"), '顔の追従(MediaPipe)と meshopt の wasm に要る');
  assert.ok(!script.includes("'unsafe-eval'"));
  assert.ok(!script.includes("'unsafe-inline'"));
  assert.ok(!script.some((v) => v === '*' || v.startsWith('http') || v === 'blob:' || v === 'data:'));
});

test('CSP: 外へ通信してよいのは、自分の鍵の声のサービスだけ(画面のコードの外への通信先と同じ 1 か所)', () => {
  const connect = readCsp()['connect-src'];
  const external = connect.filter((v) => /^(https?|wss?):/.test(v));
  assert.deepEqual(external, ['https://api.elevenlabs.io']);
  const eleven = readFileSync(new URL('../../src/conversation/elevenDirect.js', import.meta.url), 'utf8');
  assert.match(eleven, /https:\/\/api\.elevenlabs\.io\//, 'elevenDirect.js の宛先と合っている');
  assert.ok(connect.includes('blob:'), '3D の絵(GLB の中の画像)を blob: で読む');
});

test('CSP: 外の URL のキャラ・場所は読めない(?character= に外の URL を書いても止まる)', () => {
  const csp = readCsp();
  for (const d of ['connect-src', 'img-src', 'media-src', 'default-src']) {
    assert.ok(!csp[d].some((v) => v === '*' || v === 'https:' || v === 'http:'), `${d} に何でも許す値が無い`);
  }
});

test('vercel.json: 見出しは今までの 4 つも残っている', () => {
  const keys = vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => h.key);
  for (const k of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy', 'Content-Security-Policy']) assert.ok(keys.includes(k), k);
});
