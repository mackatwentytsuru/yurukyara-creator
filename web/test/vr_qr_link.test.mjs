// 「VR(Quest)で開く」の決まり(web/src/stage/questLink.js)と、画面へのつなぎ方(index.html・style.css・panel.js・main.js)の試験。
// QR に入れるのはこの画面の場所と ?character=(id)・?look=(3d・2d)だけ / 合言葉・記憶の番号・鍵・# は入れない /
// この PC・家の中のアドレスでは QR の代わりに 1 行 / Quest の中(immersive-vr が使える・ヘッドセットのブラウザ)では出さない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { questLinkPlan, questTarget, isPrivateHost, PRIVATE_NOTE, SCAN_HOW } from '../src/stage/questLink.js';
import { encodeQr } from '../src/stage/qrCode.js';

const WEB = join(import.meta.dirname, '..');
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
  for (const s of secrets) assert.ok(!plan.target.includes(s), `QR の文に ${s}`);
  assert.ok(!plan.target.includes('#') && !/pass|memory|key|token|code=/i.test(plan.target));
  assert.deepEqual(Object.keys(plan).sort(), ['kind', 'show', 'target'], '決まりの返す物は 3 つだけ(ほかの値を持ち出さない)');
});

test('公開の URL: QR の文はこの画面の URL(http の試しの名前でも同じ形)。QR は小さい版に収まる', () => {
  const plan = questLinkPlan({ loc: loc('https://yuru.example/?pass=1'), character: 'yokoso', look: '2d' });
  assert.deepEqual(plan, { show: true, kind: 'qr', target: 'https://yuru.example/?character=yokoso&look=2d' });
  assert.deepEqual(questLinkPlan({ loc: loc('http://yuru.test:43123/?memory=1'), character: 'mikan' }), { show: true, kind: 'qr', target: 'http://yuru.test:43123/?character=mikan' });
  const qr = encodeQr(plan.target);
  assert.ok(qr && qr.version <= 5, `QR は小さい版(${qr?.version})`);
  assert.match(SCAN_HOW, /Quest 3・3S の QR コードスキャナー/, '公式の名前で読み取り方を出す');
});

test('この PC・家の中のアドレスでは、QR を出さず 1 行だけ(Quest からは開けない)', () => {
  const local = ['localhost', 'app.localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.x.x',
    '169.254.10.1', '100.x.x.x', '100.x.x.x', '[fd12:3456::1]', '[fe80::1]', '[::ffff:192.168.x.x]', '[::ffff:c0a8:2]', 'mypc', 'printer.local', 'nas.home.arpa', 'box.lan', 'db.internal', ''];
  for (const host of local) {
    assert.equal(isPrivateHost(host), true, host);
    const plan = questLinkPlan({ loc: { origin: `http://${host || 'x'}`, pathname: '/', hostname: host }, character: 'norrie', look: '2d' });
    assert.deepEqual(plan, { show: true, kind: 'private', note: PRIVATE_NOTE }, host);
    assert.ok(!('target' in plan) && !('launch' in plan), `${host} で QR の文を作らない`);
  }
  const open = ['yuru.example', 'example.com', 'a.b.ts.net', '8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1', '[2001:db8::1]', 'yuru.test'];
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
  const link = read('src', 'stage', 'questLink.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(link, /https?:\/\//, 'questLink.js のコードに外の住所を書かない(画面のコードの決まり。privacy.test.mjs)');
});
