// 「パソコンの つづきを スマホで」の決まり(conversation/pairLink.js。本人の案 11/7 18:0x)。DOM を使わずに確かめる。
// - QR の文は、この画面の origin + pathname + '#pair=' + 番号「だけ」(合言葉・記憶の指定・ほかの ? と # は入れない)
// - アドレスにあった害の無い ?character= と ?look= だけは、S5 の QR(questTarget)と同じ決まりで残す
// - QR で開いた端末は # を読み、すぐにアドレスの欄から消す(? はそのまま)
// - 受け取りの失敗は、子どもにも分かる言葉と「もう押しても同じか」に分ける
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAIR_HASH, PAIR_TEXT, pageLook, pairErrorText, pairLinkUrl, readPairHash, takePairFromLocation } from '../src/conversation/pairLink.js';
import { encodeQr, QR_MAX_BYTES } from '../src/stage/qrCode.js';

const loc = (href) => {
  const u = new URL(href);
  return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, hostname: u.hostname };
};

test('QR の文は origin + pathname + #pair= + 番号だけ(合言葉・記憶の指定・ほかの # は入れない)', () => {
  const cases = [
    ['https://yuru.test/', 'https://yuru.test/#pair=123456'],
    ['https://yuru.test/app/index.html?askpass=1&pass=secret&memory=1#x=1', 'https://yuru.test/app/index.html#pair=123456'],
    ['http://pc.test:8799/?perf=0', 'http://pc.test:8799/#pair=123456'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/#pair=123456'],
  ];
  for (const [href, want] of cases) {
    const l = loc(href);
    assert.equal(pairLinkUrl(l, '123456'), want, href);
    assert.equal(pairLinkUrl(l, '123456'), `${l.origin}${l.pathname}${PAIR_HASH}123456`, `${href} は origin + pathname + #pair= + 番号`);
    // pageLook は ?character= と ?look= だけを拾う(ここでは無いので、同じ文)
    assert.equal(pairLinkUrl(l, '123456', pageLook(l)), want, `${href}(pageLook)`);
  }
});

test('アドレスの ?character= と ?look= は、S5 の QR と同じ決まりで残す(id の形と 3d・2d だけ)', () => {
  const l = loc('https://yuru.test/?character=mikan&look=2d&pass=secret');
  assert.deepEqual(pageLook(l), { character: 'mikan', look: '2d' });
  assert.equal(pairLinkUrl(l, '000123', pageLook(l)), 'https://yuru.test/?character=mikan&look=2d#pair=000123');
  // id の形でない・外の URL・知らない見た目は入れない
  const odd = loc('https://yuru.test/?character=https%3A%2F%2Fevil.test%2Fc.json&look=4d');
  assert.equal(pairLinkUrl(odd, '000123', pageLook(odd)), 'https://yuru.test/#pair=000123');
  assert.deepEqual(pageLook(loc('https://yuru.test/?char=robo')), { character: 'robo', look: '' });
});

test('番号が 6 桁の数字でない・場所が http(s) でない時は、QR の文を作らない', () => {
  const l = loc('https://yuru.test/');
  for (const bad of ['12345', '1234567', 'abcdef', '12 456', ' 123456', '', null, undefined, 12345]) assert.equal(pairLinkUrl(l, bad), null, String(bad));
  assert.equal(pairLinkUrl({ origin: 'null', pathname: '/' }, '123456'), null, 'file: などの null の origin');
  assert.equal(pairLinkUrl({ origin: 'https://a@yuru.test', pathname: '/' }, '123456'), null, '名前の付いた origin');
  assert.equal(pairLinkUrl(undefined, '123456'), null);
  assert.equal(pairLinkUrl({ origin: 'https://yuru.test', pathname: '/a?b' }, '123456'), 'https://yuru.test/#pair=123456', 'パスに ? があれば / にする');
});

test('QR の文は、S5 の QR の部品で絵にできる長さ', () => {
  const long = pairLinkUrl(loc('https://a-long-preview-name-0123456789.yuru.test/some/long/path/index.html?character=norrie_main_character_32_chars&look=2d'), '999999', pageLook(loc('https://x.test/?character=norrie_main_character_32_chars&look=2d')));
  assert.ok(long && new TextEncoder().encode(long).length <= QR_MAX_BYTES, long);
  const qr = encodeQr(long);
  assert.ok(qr && qr.version <= 10);
  const short = encodeQr(pairLinkUrl(loc('https://yuru.test/'), '123456'));
  assert.ok(short.version <= 3, `短い URL は小さい版(${short.version})`);
});

test('# の読み方: #pair= の後が 6 桁の数字だけなら番号、形が違えば bad、ほかの # は読まない', () => {
  assert.deepEqual(readPairHash('#pair=123456'), { code: '123456' });
  assert.deepEqual(readPairHash('#pair=000001'), { code: '000001' });
  for (const bad of ['#pair=12345', '#pair=1234567', '#pair=abcdef', '#pair=', '#pair=123456&x=1', '#pair=１２３４５６']) assert.deepEqual(readPairHash(bad), { code: '', bad: true }, bad);
  for (const none of ['', '#', '#x=1', '#Pair=123456', '#look=2d', undefined, null]) assert.equal(readPairHash(none), null, String(none));
});

/** 偽の窓(location と history)。replaceState で、アドレスの # が本当に消えるまでまねる */
function fakeWindow(href, { failReplace = false } = {}) {
  const l = loc(href);
  const calls = [];
  const history = {
    state: { from: 'test' },
    replaceState(state, title, url) {
      calls.push({ state, title, url });
      if (failReplace) throw new Error('使えない');
      const next = new URL(url, `${l.origin}${l.pathname}`);
      Object.assign(l, { pathname: next.pathname, search: next.search, hash: next.hash });
    },
  };
  return { win: { location: l, history }, calls, loc: l };
}

test('QR で開いた時: 番号を読み、すぐにアドレスの欄から # を消す(? はそのまま・戻るの履歴を増やさない)', () => {
  const { win, calls, loc: l } = fakeWindow('https://yuru.test/app/?character=mikan&look=2d#pair=123456');
  assert.deepEqual(takePairFromLocation(win), { code: '123456' });
  assert.equal(calls.length, 1, 'replaceState を 1 回(pushState ではない)');
  assert.equal(calls[0].url, '/app/?character=mikan&look=2d');
  assert.deepEqual(calls[0].state, { from: 'test' }, 'ページの state はそのまま');
  assert.equal(l.hash, '', '# が消えた');
  assert.ok(!`${l.origin}${l.pathname}${l.search}${l.hash}`.includes('123456'), 'アドレスに番号が残らない');
  // 形の違う番号も、# は消す(bad で返す)
  const odd = fakeWindow('https://yuru.test/#pair=12x');
  assert.deepEqual(takePairFromLocation(odd.win), { code: '', bad: true });
  assert.equal(odd.loc.hash, '');
  // #pair= が無ければ何もしない
  const plain = fakeWindow('https://yuru.test/?look=2d#look');
  assert.equal(takePairFromLocation(plain.win), null);
  assert.equal(plain.calls.length, 0);
  assert.equal(plain.loc.hash, '#look');
  // 消せない端末でも、番号は返す
  const stuck = fakeWindow('https://yuru.test/#pair=654321', { failReplace: true });
  assert.deepEqual(takePairFromLocation(stuck.win), { code: '654321' });
  // 窓の無い所(node の試験・ワーカー)では何もしない
  assert.equal(takePairFromLocation({}), null);
  assert.equal(takePairFromLocation(undefined), null);
});

test('受け取りの失敗: 違う・切れた・使った(400)と間違いの続き(429)は「とじる」だけ、合言葉(403)は欄を出す、ほかはもう一度', () => {
  assert.deepEqual(pairErrorText({ status: 400, reason: 'bad_code' }), { text: PAIR_TEXT.gone, final: true, needPass: false });
  assert.deepEqual(pairErrorText({ status: 429, reason: 'locked' }), { text: PAIR_TEXT.wait, final: true, needPass: false });
  assert.deepEqual(pairErrorText({ status: 429, reason: 'pass_limited' }), { text: PAIR_TEXT.wait, final: true, needPass: false });
  assert.deepEqual(pairErrorText({ status: 403, reason: 'no_pass' }), { text: PAIR_TEXT.pass, final: false, needPass: true });
  assert.deepEqual(pairErrorText({ status: 503, reason: 'store' }), { text: PAIR_TEXT.fail, final: false, needPass: false });
  assert.deepEqual(pairErrorText(new Error('通信できない')), { text: PAIR_TEXT.fail, final: false, needPass: false });
  // 確かめの言葉(子どもにも読める): 聞く文は決まった 1 つ、切れた時の言葉は「もう一度 QR を出して」と言う
  assert.equal(PAIR_TEXT.ask, 'パソコンの つづきを はじめる?');
  assert.match(PAIR_TEXT.gone, /じかんぎれ/);
  assert.match(PAIR_TEXT.gone, /もう いちど QR を だしてね/);
  for (const t of [PAIR_TEXT.yes, PAIR_TEXT.no, PAIR_TEXT.close]) assert.ok(t.length <= 4, `ボタンの言葉は短く: ${t}`);
});
