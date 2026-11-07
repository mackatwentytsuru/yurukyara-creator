// 「VR(Quest)で開く」の決まり(web/src/stage/questLink.js)と、画面へのつなぎ方(index.html・style.css・panel.js・main.js)の試験。
// QR に入れるのはこの画面の場所と ?character=(id)・?look=(3d・2d)だけ / 合言葉・記憶の番号・鍵・# は入れない /
// この PC・家の中のアドレスでは QR の代わりに 1 行 / Quest の中(immersive-vr が使える・ヘッドセットのブラウザ)では出さない。
// 「Meta Quest に送る」(本人の答え、11/7): https の時だけ、Meta 公式のウェブローンチ(WEB_LAUNCH に url= で QR と同じ URL)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { questLinkPlan, questTarget, isPrivateHost, webLaunchUrl, PRIVATE_NOTE, SCAN_HOW, WEB_LAUNCH, SEND_LABEL, SEND_NAME } from '../src/stage/questLink.js';
import { encodeQr } from '../src/stage/qrCode.js';

/** ウェブローンチの URL から、送る URL を取り出す(公式の形: WEB_LAUNCH?url=<エンコードした URL>) */
const sentUrl = (launch) => {
  const u = new URL(launch);
  assert.equal(`${u.origin}${u.pathname}`, WEB_LAUNCH, 'Meta 公式の入口だけ');
  assert.deepEqual([...u.searchParams.keys()], ['url'], 'url= の 1 つだけ');
  assert.equal(u.hash, '');
  return u.searchParams.get('url');
};

const WEB = join(import.meta.dirname, '..');

// 家の中の住所の見本は、その場で組み立てる(公開の前の履歴の書き換えの規則が、書いたままの 192.168.… と 100.64〜127.… を
// 伏せ字に言い換え、試験の中身が変わって落ちるため。S6 の頼み 11/7)
const ip = (...parts) => parts.join('.');
const read = (...p) => readFileSync(join(WEB, ...p), 'utf8').replace(/\r\n/g, '\n');
const loc = (href) => {
  const u = new URL(href);
  return { href: u.href, origin: u.origin, pathname: u.pathname, hostname: u.hostname, search: u.search, hash: u.hash };
};

test('QR の文は、この画面の場所 + ?character=(id)+ ?look=(3d・2d)だけ(ほかの ? と # は入れない)', () => {
  const page = loc('https://yuru.example/app/?character=norrie&look=2d&pass=fake-pass&memory=123456&key=fake-key&token=abc&onboard=1#yc-key=zzz');
  assert.equal(questTarget(page, { character: 'norrie', look: '2d' }), 'https://yuru.example/app/?character=norrie&look=2d');
  assert.equal(questTarget(page, {}), 'https://yuru.example/app/');
  assert.equal(questTarget(loc('https://yuru.example'), { character: 'mikan' }), 'https://yuru.example/?character=mikan');
  assert.equal(questTarget(loc('http://yuru.test:43123/?x=1'), { look: '3D' }), 'http://yuru.test:43123/?look=3d');
});

test('id の形でないキャラ・3d と 2d でない見た目は入れない(外の URL・パス・長すぎる名前)', () => {
  const page = loc('https://yuru.example/');
  for (const bad of ['../secret', 'https://evil.example/c.json', 'Norrie', 'a'.repeat(33), 'no rrie', 'x?pass=1', '']) {
    assert.equal(questTarget(page, { character: bad, look: 'vr' }), 'https://yuru.example/', bad);
  }
  assert.equal(questTarget({ origin: 'null', pathname: '/' }), null, 'origin の無い頁(file: など)は作らない');
  assert.equal(questTarget({ origin: 'https://user:pw@yuru.example', pathname: '/' }), null, '名前と合言葉の付いた origin は作らない');
  assert.equal(questTarget({ origin: 'https://yuru.example', pathname: '/a?pass=1' }), 'https://yuru.example/', 'pathname に ? が入っていたら / にする');
});

test('何も秘密が入らない: 合言葉・記憶の番号・鍵・トークン・# を URL に書いても、QR の文に出ない', () => {
  // 偽の値(本物の鍵の形にしない)。合言葉・記憶の番号・鍵・トークン・# の作る道の値・合言葉の見出しの名前・記憶の言葉
  const secrets = ['fake-passphrase', '654321', 'not-a-real-key', 'fake-token', 'yc-key', 'demo-pass', 'MEMORY'];
  const page = loc(`https://yuru.example/?pass=${secrets[0]}&code=${secrets[1]}&key=${secrets[2]}&token=${secrets[3]}&character=norrie#${secrets[4]}=1&x-${secrets[5]}=1&m=${secrets[6]}`);
  const plan = questLinkPlan({ loc: page, character: 'norrie', look: '3d' });
  assert.equal(plan.kind, 'qr');
  assert.equal(plan.target, 'https://yuru.example/?character=norrie&look=3d');
  for (const s of secrets) assert.ok(!plan.target.includes(s) && !plan.launch.includes(s), `QR の文かウェブローンチに ${s}`);
  assert.ok(!plan.target.includes('#') && !/pass|memory|key|token|code=/i.test(plan.target));
  assert.equal(sentUrl(plan.launch), plan.target, 'Quest へ送るのは QR と同じ URL だけ');
  assert.deepEqual(Object.keys(plan).sort(), ['kind', 'launch', 'show', 'target'], '決まりの返す物は 4 つだけ(ほかの値を持ち出さない)');
});

test('公開の URL: QR の文はこの画面の URL(http の試しの名前でも同じ形)。QR は小さい版に収まる', () => {
  const plan = questLinkPlan({ loc: loc('https://yuru.example/?pass=1'), character: 'yokoso', look: '2d' });
  assert.deepEqual(plan, {
    show: true,
    kind: 'qr',
    target: 'https://yuru.example/?character=yokoso&look=2d',
    launch: 'https://www.oculus.com/open_url/?url=https%3A%2F%2Fyuru.example%2F%3Fcharacter%3Dyokoso%26look%3D2d',
  });
  assert.deepEqual(questLinkPlan({ loc: loc('http://yuru.test:43123/?memory=1'), character: 'mikan' }), { show: true, kind: 'qr', target: 'http://yuru.test:43123/?character=mikan' }, 'http の時はウェブローンチを出さない(公式: https だけ)');
  const qr = encodeQr(plan.target);
  assert.ok(qr && qr.version <= 5, `QR は小さい版(${qr?.version})`);
  assert.match(SCAN_HOW, /Quest 3・3S の QR コードスキャナー/, '公式の名前で読み取り方を出す');
  assert.doesNotMatch(SCAN_HOW, /開きます|開けます/, '読み取った後に開くかは本物の Quest で確かめていないので、「開きます」と言わない');
});

test('この PC・家の中のアドレスでは、QR を出さず 1 行だけ(Quest からは開けない)', () => {
  const local = ['localhost', 'app.localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.254', ip(192, 168, 1, 20),
    '169.254.10.1', ip(100, 64, 0, 1), ip(100, 127, 1, 1), '[fd12:3456::1]', '[fe80::1]', `[::ffff:${ip(192, 168, 0, 2)}]`, '[::ffff:c0a8:2]', 'mypc', 'printer.local', 'nas.home.arpa', 'box.lan', 'db.internal', 'a.b.ts.net', 'ts.net', ''];
  for (const host of local) {
    assert.equal(isPrivateHost(host), true, host);
    const plan = questLinkPlan({ loc: { origin: `http://${host || 'x'}`, pathname: '/', hostname: host }, character: 'norrie', look: '2d' });
    assert.deepEqual(plan, { show: true, kind: 'private', note: PRIVATE_NOTE }, host);
    assert.ok(!('target' in plan) && !('launch' in plan), `${host} で QR の文を作らない`);
  }
  const open = ['yuru.example', 'example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1', '[2001:db8::1]', 'yuru.test'];
  for (const host of open) assert.equal(isPrivateHost(host), false, host);
  assert.ok(!PRIVATE_NOTE.includes('\n') && PRIVATE_NOTE.length <= 32, `1 行の短い文(${PRIVATE_NOTE.length} 字。幅 390 の箱で 1 行)`);
});

test('Quest の中(immersive-vr が使える・ヘッドセットのブラウザ)では入口を出さない', () => {
  const page = loc('https://yuru.example/');
  assert.deepEqual(questLinkPlan({ loc: page, immersiveVr: true }), { show: false, kind: 'none' });
  assert.deepEqual(questLinkPlan({ loc: page, headset: true }), { show: false, kind: 'none' });
  assert.deepEqual(questLinkPlan({ loc: loc('http://127.0.0.1:8799/'), immersiveVr: true }), { show: false, kind: 'none' }, 'Quest の中は、この PC のアドレスでも出さない');
  assert.equal(questLinkPlan({ loc: page }).show, true, 'PC・スマホでは出す');
});

test('画面へのつなぎ方: 入口は隠して始め、main.js が Quest の中でない時だけ出す。押す所は 44px。7 歩の札・LED・ヘッドセットでは隠す', () => {
  const html = read('index.html');
  assert.match(html, /<div class="quest-link" id="questLink" data-hide-in-ar hidden>/);
  assert.match(html, /id="questLinkBtn"[^>]*aria-expanded="false"[^>]*aria-controls="questLinkBox"[^>]*aria-label="VR\(Quest\)で開く"/);
  assert.match(html, /<span class="ql-short" aria-hidden="true">VR<\/span>/, '上の段の幅を保つため、ボタンの言葉は QR の印と「VR」だけ(名前は aria-label と title)');
  assert.match(html, /id="questLinkBox" role="dialog" aria-label="VR\(Quest\)で開く" tabindex="-1" hidden><\/div>/);
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /\.quest-link-btn \{[^}]*min-height: 44px; min-width: 44px;/);
  assert.match(css, /html\.fr-open \.quest-link, html\.is-led \.quest-link, html\.is-headset \.quest-link \{ display: none !important; \}/);
  // 箱の下の端は画面の 45% より上(キャラの上の段の上限と同じ。キャラは箱の下へ置き直す)
  assert.match(css, /max-height: calc\(45vh - max\(12px, env\(safe-area-inset-top\)\) - var\(--top-h, 64px\) - 22px\);/);
  assert.match(css, /max-height: calc\(45dvh - max\(12px, env\(safe-area-inset-top\)\) - var\(--top-h, 64px\) - 22px\);/);
  const main = read('src', 'main.js');
  assert.match(main, /immersiveVr: Boolean\(modes\?\.available\?\.vr\), headset: IS_HEADSET/);
  assert.match(main, /if \(!root \|\| LOOK_SWITCH_OFF \|\| !questLinkState\(\)\.show\) return;/);
  assert.match(main, /#questLinkBox:not\(\[hidden\]\)'/, 'キャラの置き直しで箱を数える');
  assert.match(main, /if \(open && drawer\?\.open\) drawer\.open = false;/, '「覚えていること」と同時に開かない');
  assert.match(main, /if \(drawer\.open\) link\.close\(\);/);
  assert.ok(main.indexOf('setupQuestLink();') > main.indexOf('await setupPresentation()'), '見せ方(VR の有無)を調べた後に付ける');
});

test('panel.js: QR に入れるのは決まりの target だけ。文字は textContent、絵は SVG の path(外の画像・外の住所・innerHTML なし)。箱・外・Escape で閉じる', () => {
  const panel = read('src', 'ui', 'panel.js');
  const body = panel.slice(panel.indexOf('export function mountQuestLink'));
  assert.match(body, /const qr = svgNs \? \(lib\?\.encodeQr\(p\.target\) \?\? null\) : null;/);
  assert.match(body, /const svgNs = button\.querySelector\('svg'\)\?\.namespaceURI \?\? null;/, 'SVG の名前空間はボタンの印から読む');
  assert.match(body, /el\('p', 'ql-url', p\.target\)/);
  assert.match(body, /el\('p', 'ql-title', 'VR\(Quest\)で開く'\)/, '箱の 1 行目に入口の名前');
  assert.match(body, /import\('\.\.\/stage\/qrCode\.js'\)/, 'QR の部品は初めて開いた時に読む');
  assert.match(body, /box\.addEventListener\('click', \(\) => close\(true\)\);/, '箱を指で押すと閉じる');
  assert.match(body, /e\.key === 'Escape'/);
  assert.match(body, /if \(opened && !root\.contains\(e\.target\)\) close\(\);/);
  assert.doesNotMatch(body, /innerHTML|<img|url\(|data:|https?:\/\//);
  // 画面のコードの外の住所は、questLink.js の WEB_LAUNCH の 1 か所だけ(privacy.test.mjs の例外 1 つ。コメントは数えない)
  const link = read('src', 'stage', 'questLink.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  assert.deepEqual([...link.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`]*/g)].map((m) => m[0]), ['https://www.oculus.com/open_url/'], 'questLink.js のコードの外の住所は WEB_LAUNCH だけ');
  assert.match(link, /^export const WEB_LAUNCH = 'https:\/\/www\.oculus\.com\/open_url\/';$/m);
});

test('ウェブローンチ(Meta 公式): https の URL だけ・公式の例と同じ作り方(URL と URLSearchParams で url= に入れる)', () => {
  assert.equal(WEB_LAUNCH, 'https://www.oculus.com/open_url/');
  // 公式の頁の例(https://www.meta.com/ を送る)と同じ文になる
  assert.equal(webLaunchUrl('https://www.meta.com/'), 'https://www.oculus.com/open_url/?url=https%3A%2F%2Fwww.meta.com%2F');
  for (const t of ['https://yuru.example/', 'https://yuru.example/app/?character=norrie&look=2d']) assert.equal(sentUrl(webLaunchUrl(t)), t, t);
  for (const bad of ['http://yuru.example/', 'http://127.0.0.1:8799/', 'https://user:pw@yuru.example/', 'https://yuru.example/#yc-key=1', 'ftp://yuru.example/', 'javascript:alert(1)', '', null, undefined, 'yuru.example']) {
    assert.equal(webLaunchUrl(bad), null, String(bad));
  }
  assert.match(SEND_LABEL, /^Meta Quest に送る$/, '押す所に Meta Quest の名前(公式の決まり)。本人の言葉「Quest に送る」を含む');
  assert.match(SEND_NAME, /Meta Quest に送る.*新しいタブ/, '読み上げの名前で、Meta の頁が新しいタブで開くと分かる');
});

test('Quest の中・この PC・家の中のアドレス・http では「Meta Quest に送る」を出さない', () => {
  const https = loc('https://yuru.example/');
  assert.equal(questLinkPlan({ loc: https, headset: true }).launch, undefined, 'ヘッドセットのブラウザ');
  assert.equal(questLinkPlan({ loc: https, immersiveVr: true }).launch, undefined, 'immersive-vr が使えるブラウザ');
  for (const href of ['https://localhost:8444/', `https://${ip(192, 168, 1, 20)}/`, 'https://mypc/', 'http://127.0.0.1:8799/', 'http://yuru.test/']) {
    assert.equal(questLinkPlan({ loc: loc(href), character: 'norrie' }).launch, undefined, href);
  }
  assert.equal(typeof questLinkPlan({ loc: https }).launch, 'string', 'https の公開の URL では出す');
});

test('panel.js:「Meta Quest に送る」は決まりの launch だけを新しいタブで開くリンク。この頁の URL を送らない・押しても箱は閉じない。押す所は 44px', () => {
  const panel = read('src', 'ui', 'panel.js');
  const body = panel.slice(panel.indexOf('export function mountQuestLink'));
  assert.match(body, /if \(p\.launch\) text\.append\(sendLink\(p\.launch\)\);/);
  const send = body.slice(body.indexOf('const sendLink'), body.indexOf('async function render'));
  assert.match(send, /el\('a', 'ql-send', SEND_LABEL\)/);
  assert.match(send, /a\.href = href;/);
  assert.match(send, /a\.target = '_blank';/);
  assert.match(send, /a\.rel = 'noopener noreferrer';/);
  assert.match(send, /a\.referrerPolicy = 'no-referrer';/);
  assert.match(send, /e\.stopPropagation\(\)/, '押しても箱を閉じない');
  const css = read('src', 'ui', 'style.css');
  assert.match(css, /\.ql-send \{[^}]*min-height: 44px; min-width: 44px;/);
});

test('*.ts.net の名前では、QR も Meta へ送るリンクも出さない(機械と tailnet の名前を画面と Meta へ出さない。CRITsec3 L3)', () => {
  for (const host of ['a.b.ts.net', '<端末名>.<tailnet>.ts.net', 'MACHINE.TS.NET']) {
    assert.equal(isPrivateHost(host), true, host);
    const plan = questLinkPlan({ loc: { origin: `https://${host}:8444`, pathname: '/', hostname: host }, character: 'norrie', look: '2d' });
    assert.equal(plan.launch, undefined, host);
    assert.equal(plan.kind, 'private', host);
  }
});
