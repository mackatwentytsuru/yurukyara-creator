// カメラの絵の約束を、コードの形で守る試験。
// 画面に出している注意書きが、作りと食い違わないようにするためのもの。
// BCV(11-08 本人「カメラは使う人が決める・カメラの中身にも答える」)で約束を変えた: カメラの絵は、使う人がカメラを入れて(知らせを読んで)
// 話しかけた回だけ、その時の 1 枚を答えを作るために Claude へ送る(保存しない)。絵にできるのは conversation/cameraFrame.js の 1 か所だけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((p) => p.endsWith('.js'));
const cssFiles = walk(SRC).filter((p) => p.endsWith('.css'));
const INDEX_HTML = join(SRC, '..', 'index.html');
const read = (p) => readFileSync(p, 'utf8');
// コメントは数えない(「送信しない」と書いた説明文で引っかからないように)
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

// 画像を取り出す・記録する・外へ送る道具。画面のどこにも使わない。
// 'new Image(' は画像ビーコン(src に宛先を入れて送る)、EventSource・Worker は別の通り道、ImageCapture・getDisplayMedia は別の撮り方。
// 「検査の検査」(scripts/mutation-check.mjs)で、これらが素通りだったので足した。
const IMAGE_EXFIL = [
  'toDataURL', 'toBlob', 'getImageData', 'MediaRecorder', 'captureStream', 'createImageBitmap', 'sendBeacon', 'XMLHttpRequest', 'WebSocket',
  'EventSource', 'ImageCapture', 'grabFrame', 'takePhoto', 'getDisplayMedia', 'OffscreenCanvas', 'new Image(', 'new Worker', 'SharedWorker',
];

// BCV: カメラの絵を 1 枚の JPEG にしてよいのは、このファイルだけ。使ってよいのは drawImage と toDataURL だけ(ほかの道具は、ここでも使わない)
const CAMERA_FRAME = join('conversation', 'cameraFrame.js');
const CAMERA_FRAME_OK = ['toDataURL'];

test('画像を取り出す・記録する・外へ送る道具を、画面のコードのどこでも使っていない(例外は cameraFrame.js の toDataURL だけ)', () => {
  for (const f of files) {
    const text = code(f);
    const allowed = relative(SRC, f) === CAMERA_FRAME ? CAMERA_FRAME_OK : [];
    for (const word of IMAGE_EXFIL) {
      if (allowed.includes(word)) continue;
      assert.ok(!text.includes(word), `${relative(SRC, f)} に ${word} があります`);
    }
  }
});

test('BCV: 絵の 1 枚(cameraFrame.js)は通信・保存をせず、JPEG を 1 回作るだけ。使うのは main.js だけ', () => {
  const frame = code(join(SRC, CAMERA_FRAME));
  for (const word of ['fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'caches.', 'createObjectURL', 'FileReader', 'Blob(', 'postMessage', 'import ', 'import(']) {
    assert.ok(!frame.includes(word), `cameraFrame.js に ${word} があります`);
  }
  assert.match(frame, /toDataURL\('image\/jpeg', q\)/, 'JPEG だけを作る');
  assert.match(frame, /clearRect\(/, '下書きの絵を消す');
  const users = files.filter((p) => /from '\.\/conversation\/cameraFrame\.js'|from '\.\.\/conversation\/cameraFrame\.js'|from '\.\/cameraFrame\.js'/.test(read(p))).map((p) => relative(SRC, p).split('\\').join('/'));
  assert.deepEqual(users, ['stage/cameraUse.js'], 'カメラの絵を作れるのは stage/cameraUse.js の getImage だけ(main.js が 1 回作る)');
  // cameraUse.js: 絵を送るのは、使う人が選んだカメラ(consent)が動いていて、近づいた合図でない回だけ
  const use = code(join(SRC, 'stage', 'cameraUse.js'));
  assert.match(use, /dialogue\.getImage = \(\{ trigger \} = \{\}\) => \(trigger !== 'approach' && use\.seeing\(\) \? takeFrame\(app\.source\.video\) : null\);/);
  assert.match(use, /seeing: \(\) => use\.consent && app\.mode === 'camera' && app\.source\?\.kind === 'mediapipe'/);
  assert.match(use, /if \(e\.isTrusted && use\.plan\.show\) use\.consent = true;/, '入口は人が押した時だけ(自動で始める画面の click() では選んだことにしない)');
  assert.ok(!/\bfetch\s*\(/.test(use), 'cameraUse.js は通信しない(送るのは会話の側)');
  assert.match(code(join(SRC, 'main.js')), /app\.camera = createCameraUse\(\{/, 'main.js は 1 回作るだけ');
});

test('カメラの追従(tracking/)は、通信をいっさいしない', () => {
  for (const f of files.filter((p) => p.includes(`${join('src', 'tracking')}`))) {
    assert.ok(!/\bfetch\s*\(/.test(code(f)), `${relative(SRC, f)} が fetch を使っています`);
  }
});

test('通信先は、自分のサーバー(/api/…)と、キャラ・場所のデータだけ', () => {
  // gaze/now は、入口の LED のページが床のカメラの「向きの数字」を読むだけの GET(本文を送らない)
  // memory・memory/new・pair・claim は、端末をまたぐ記憶(合鍵はヘッダーで送り、URL に入れない)
  // draw は、ブラウザから描く設定(サーバーの YC_BROWSER_DRAW=1。既定は切ってある)の時だけ使う(B4 12b)
  // kiosk/config・kiosk/exit は、接客モードの店の端末が、設定を読む・番号を送って出る(番号は本文で送り、URL に入れない。札は見出し)。kiosk/settings・kiosk/qr は PC の窓(kioskQr.js の call(path))
  // characters は、作った子の一覧・名前の変更・消す(送るのは子の id と名前だけ。手元のサーバーの characters/yb* だけを触る)
  // update・update/… は、この PC の中で開いた画面のアップデート(BUX。手元のサーバーが localhost からだけ受ける。送るのはキャラの id と押したボタンだけ)
  const allowed = [/^\/api\/(chat|tts|stt|stt\/warm|metrics|status|fillers|gaze\/now|memory|memory\/new|memory\/pair|memory\/claim|draw|characters|update|update\/(check|apply|undo|progress|offer)|kiosk\/(config|exit))$/, /^\/mediapipe\//];
  for (const f of files) {
    for (const m of code(f).matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)) {
      const url = m[2];
      assert.ok(allowed.some((re) => re.test(url)), `${relative(SRC, f)}: 想定していない通信先 ${url}`);
      assert.ok(!/^https?:\/\//.test(url), `${relative(SRC, f)}: 外のサーバーへ直接つないでいます ${url}`);
    }
  }
});

// 変数を宛先にした fetch は、中身が見えない。今あるのは「読み込み」の 3 か所だけ。増えたら、中身を確かめてからここに足す。
const VARIABLE_FETCH = {
  'character/index.js': ['url'], // character.json(?character= で渡された物)
  'conversation/speaker.js': ['f.url'], // /api/fillers が返した、自分のサーバーの声のファイル
  'conversation/elevenDirect.js': ['url'], // 使う人の声の鍵(BYOK)での読み上げ。宛先は下の EXTERNAL_OK の 1 つだけ(下の試験が見る)
  'main.js': ['character.personaUrl'], // キャラの persona.md
  'ui/kioskQr.js': ['path'], // 接客モードの PC の窓: 自分のサーバーの /api/kiosk/settings と /api/kiosk/qr だけ(呼ぶ所は call(path) の 1 つ。文字の道を渡す)
  'stage/loadPlace.js': ['url'], // place.js が渡す、自分のサーバーの place.json
};

// 画面のコードに外の住所を書いてよいのは、次の 2 か所の 1 つずつだけ(ファイルと住所の文字まで決め打ち)。
// - 声の鍵の読み上げ(conversation/elevenDirect.js): 使う人が自分で入れた声の鍵で、声のサービスへ直接(鍵を私たちのサーバーに送らないため)。
//   送るのは読み上げる 1 文と、声とモデルの名前だけ。カメラ・追従・記憶の部品は読み込まない。外へ「つなぐ」のは、ここだけ。
// - Meta 公式のウェブローンチ(stage/questLink.js。11-07 本人の答え Q-0098 = B「Quest に送る」): 使う人が押した時に開く頁の住所で、
//   この画面の URL(場所と、害の無い ?character= と ?look= だけ。vr_qr_link の試験が見る)を Quest のブラウザへ送る公式の入口。
//   fetch はしない(下の 2 つの試験が、文字の宛先も変数の宛先も止める)。https の決まった 1 つの住所だけで、ほかの道や ? の付いた形は通さない。
const EXTERNAL_OK = Object.freeze({
  'conversation/elevenDirect.js': 'https://api.elevenlabs.io/v1/text-to-speech/',
  'stage/questLink.js': 'https://www.oculus.com/open_url/',
});

/**
 * 文字の見かけを変えて住所を隠す形をほどく(CRITsec3 L2): 逃がし文字(\/ \uXXXX \u{…} \xXX)と、つないだ文字('ht' + 'tps://…')。
 * 声の鍵・Meta の例外の住所は、そのままの形で書いてあるので、ほどいた後も同じ(例外の比べ方は変わらない)
 */
export function unmask(source) {
  return String(source)
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')
    .replace(/(['"`])\s*\+\s*(['"`])/g, '');
}

// 外の住所の形: http:// https:// ws:// wss://、と、文字や括弧・= の直後から始まる //名前(この頁と同じ https で外へ行く住所)
const EXTERNAL_ADDRESS = /\b(?:https?|wss?):\/\/[^\s'"`<>]*|(?<=['"`(=])\/\/[A-Za-z0-9][^\s'"`<>)]*/g;

/** そのファイル(src からの道)のコードにある外の住所のうち、許していない物(コメントは数えない) */
function forbiddenAddresses(rel, source) {
  return [...unmask(source).matchAll(EXTERNAL_ADDRESS)].map((m) => m[0]).filter((url) => url !== EXTERNAL_OK[rel]);
}

// index.html の外の住所は、help のリンク(GitHub の README の 1 つ)だけ。CSS には 1 つも無い
const HTML_EXTERNAL_OK = /^https:\/\/github\.com\/[\w.-]+\/yurukyara-creator\/blob\/HEAD\/README\.md#[^\s'"]*$/;
const htmlAddresses = (html) => [...unmask(html).replace(/<!--[\s\S]*?-->/g, '').matchAll(EXTERNAL_ADDRESS)].map((m) => m[0]);

test('fetch の宛先は、文字で書いた許可済みの物か、確かめ済みの変数だけ(変数の宛先に画像を忍ばせられない)', () => {
  for (const f of files) {
    const rel = relative(SRC, f).split('\\').join('/');
    for (const m of code(f).matchAll(/\bfetch\(\s*([^,)]+)/g)) {
      const arg = m[1].trim();
      if (/^['"`]/.test(arg)) continue; // 文字の宛先は、上の試験が見る
      assert.ok((VARIABLE_FETCH[rel] ?? []).includes(arg), `${rel}: 確かめていない変数の宛先 fetch(${arg})`);
    }
  }
});

test('外のサーバーの住所(http:// https:// ws://)を、画面のコードに書かない(import() も含めて)。例外は声の鍵の読み上げと、Meta 公式のウェブローンチの 1 つずつだけ', () => {
  for (const f of files) {
    const rel = relative(SRC, f).split('\\').join('/');
    assert.deepEqual(forbiddenAddresses(rel, code(f)), [], `${rel} に外の住所があります`);
  }
});

test('index.html と CSS にも、外の住所が無い(例外は index.html の help のリンク 1 つ = GitHub の README だけ)', () => {
  const found = htmlAddresses(read(INDEX_HTML));
  assert.equal(found.length, 1, 'index.html の外の住所は help のリンクの 1 つだけ');
  assert.ok(HTML_EXTERNAL_OK.test(found[0]), `index.html に想定していない外の住所があります: ${found[0]}`);
  assert.ok(cssFiles.length >= 1);
  for (const f of cssFiles) assert.deepEqual(htmlAddresses(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), [], `${relative(SRC, f)} に外の住所があります(url()・@import)`);
});

test('見張りの確かめ(CRITsec3 L2): 逃がし文字・つないだ文字・//名前に隠した外の住所も落ちる。ふつうの書き方は通る', () => {
  const evil = 'https://evil.example/collect';
  const bad = [
    `const a = '${evil}';`, // 前からの形
    "const a = '//evil.example/x';", // この頁と同じ https で外へ行く
    'const a = "//evil.example/x";',
    "const a = 'https:\\/\\/evil.example/x';", // 逃がした /
    "const a = '\\u0068ttps://evil.example/x';", // \uXXXX
    "const a = '\\x68ttps://evil.example/x';", // \xXX
    "const a = '\\u{68}ttps://evil.example/x';", // \u{…}
    "const a = 'ht' + 'tps://evil.example/x';", // つないだ文字
    'const a = "ht" + `tps://evil.example/x`;',
    "const a = 'wss://evil.example/x';",
    "location.href = '//evil.example';",
    "img.src = ('//evil.example/p.gif');",
  ];
  for (const src of bad) assert.equal(forbiddenAddresses('ui/panel.js', src).length, 1, `落ちるはず: ${src}`);
  // 通る: 外の住所の無い、ふつうの書き方(正規表現の //・道だけの文字・割り算・つなぐだけの文字は数えない)
  const ok = ["const re = /^https?:\\/\\//;", "const a = '/api/chat';", 'const u = `${base}/x//y`;', 'const half = a / b;', "const n = 'a' + 'b';"];
  for (const src of ok) assert.deepEqual(forbiddenAddresses('ui/panel.js', src), [], `通るはず: ${src}`);
  // index.html と CSS: help のリンクだけ通り、ほかの href・src・//名前・url()・@import は落ちる
  const help = 'https://github.com/someone/yurukyara-creator/blob/HEAD/README.md#x';
  assert.deepEqual(htmlAddresses(`<link rel="help" href="${help}">`).filter((u) => !HTML_EXTERNAL_OK.test(u)), []);
  for (const html of ['<script src="https://evil.example/x.js"></script>', '<img src="//evil.example/x.png">', '<link href="https://github.com/other/repo">']) {
    assert.equal(htmlAddresses(html).filter((u) => !HTML_EXTERNAL_OK.test(u)).length, 1, `落ちるはず: ${html}`);
  }
  assert.equal(htmlAddresses('body { background: url(https://evil.example/x.png); } @import "//evil.example/a.css";').length, 2, 'CSS の url()・@import も見える');
});

test('例外の確かめ: ウェブローンチの住所は questLink.js の決まった 1 つだけ通り、ほかの住所・ほかのファイル・形を変えた住所は落ちる', () => {
  const launch = EXTERNAL_OK['stage/questLink.js'];
  assert.equal(launch, 'https://www.oculus.com/open_url/', 'Meta 公式のウェブローンチの入口(developers.meta.com/horizon/documentation/web/web-launch)');
  // 通る: questLink.js に、決まった住所を 1 つの文字で書いて、URL と URLSearchParams で組む形(S5 の作り)
  assert.deepEqual(forbiddenAddresses('stage/questLink.js', `export const WEB_LAUNCH = '${launch}';\nconst u = new URL(WEB_LAUNCH);`), []);
  // 落ちる: questLink.js でも、ほかの住所・http・ほかの道・? を付けた形・ws
  for (const bad of ['https://example.com/', 'http://www.oculus.com/open_url/', 'https://www.oculus.com/open_url/x', 'https://www.oculus.com/open_url/?url=https%3A%2F%2Fexample.com', 'https://www.meta.com/', 'wss://www.oculus.com/open_url/']) {
    assert.deepEqual(forbiddenAddresses('stage/questLink.js', `const a = '${bad}';`), [bad], `questLink.js の ${bad} は落ちる`);
  }
  assert.deepEqual(forbiddenAddresses('stage/questLink.js', `const a = '${launch}'; const b = 'https://example.com/';`), ['https://example.com/'], '決まった住所の横に足した住所は落ちる');
  // 落ちる: ほかのファイルに書いたウェブローンチ(画面のどこからでも外へ出られる形にしない)
  for (const rel of ['ui/panel.js', 'main.js', 'conversation/elevenDirect.js', 'stage/vr.js']) {
    assert.deepEqual(forbiddenAddresses(rel, `const a = '${launch}';`), [launch], `${rel} のウェブローンチは落ちる`);
  }
  // 声の鍵の例外も、そのファイルの決まった 1 つだけ
  assert.deepEqual(forbiddenAddresses('conversation/elevenDirect.js', `const a = '${EXTERNAL_OK['conversation/elevenDirect.js']}';`), []);
  assert.deepEqual(forbiddenAddresses('stage/questLink.js', `const a = '${EXTERNAL_OK['conversation/elevenDirect.js']}';`).length, 1, '声のサービスの住所は questLink.js では落ちる');
  // 本物の questLink.js: 外の住所は、無いか、決まった 1 つだけ(S5 の「Quest に送る」が入る前と後のどちらでも通る)
  const real = code(join(SRC, 'stage', 'questLink.js'));
  const inReal = [...real.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`]*/g)].map((m) => m[0]);
  assert.ok(inReal.every((u) => u === launch), `questLink.js の外の住所: ${inReal.join(' ')}`);
  assert.ok(!/\bfetch\s*\(/.test(real), 'questLink.js は通信しない(ウェブローンチは、押した時に開く頁の住所だけ)');
});

test('声の鍵(BYOK)の読み上げ: 送るのは読み上げる文・モデル・言葉だけ。ほかの部品を読み込まず、鍵を扱うのは決まったファイルだけ', () => {
  const direct = code(join(SRC, 'conversation', 'elevenDirect.js'));
  // 読み込んでよいのは、定数だけの models.js(声のモデルの名前の 1 か所。通信も DOM も無い)だけ
  const imports = [...direct.matchAll(/\bimport\b[^;]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['./models.js'], 'elevenDirect.js が読み込むのは ./models.js だけ');
  assert.equal((direct.match(/\bimport\b/g) ?? []).length, 1, 'import は 1 つだけ(動的な import も無い)');
  const models = code(join(SRC, 'conversation', 'models.js'));
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|document|window|import)\b/.test(models), 'models.js は通信も DOM も使わない');
  const body = direct.match(/body: JSON\.stringify\(\{([^}]*)\}\)/);
  assert.ok(body, '送る本文が 1 か所に書かれている');
  const keys = [...body[1].matchAll(/(\w+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['language_code', 'model_id', 'text']);
  assert.match(direct, /credentials: 'omit'/, 'クッキーを送らない');
  // 声の鍵を読む(voiceKey.js を読み込む)のは、読み上げと鍵の欄だけ。会話・記憶の通信は鍵を知らない
  const users = files.filter((p) => /from '\.\/voiceKey\.js'|from '\.\.\/conversation\/voiceKey\.js'/.test(read(p))).map((p) => relative(SRC, p).split('\\').join('/')).sort();
  assert.deepEqual(users, ['conversation/speaker.js', 'conversation/voiceKeyForm.js']);
  for (const f of files) {
    const rel = relative(SRC, f).split('\\').join('/');
    if (rel !== 'conversation/elevenDirect.js') assert.ok(!code(f).includes('xi-api-key'), `${rel} が声の鍵の見出しを書いています`);
  }
});

test('カメラの映像を、描画や保存の先へ渡していない(video は MediaPipe と、話しかけた回の 1 枚 = cameraFrame.js にだけ渡す)', () => {
  for (const f of files) {
    if (relative(SRC, f) === CAMERA_FRAME) continue; // BCV: 絵の 1 枚を作る、ただ 1 つの場所
    const text = code(f);
    assert.ok(!/drawImage\s*\(/.test(text), `${relative(SRC, f)} が drawImage を使っています`);
  }
  const tracker = code(join(SRC, 'tracking', 'faceTracker.js'));
  assert.ok(tracker.includes('detectForVideo'), '追従は MediaPipe の detectForVideo で行う');
  assert.ok(!/srcObject\s*=.*(upload|post|send)/i.test(tracker));
});

test('サーバーに届くのは「言葉」と「見えている様子の言葉」と、BCV の絵 1 枚(使う人がカメラを入れて話しかけた回だけ)', () => {
  const dialogue = code(join(SRC, 'conversation', 'dialogue.js'));
  const body = dialogue.slice(dialogue.indexOf('const body = {'), dialogue.indexOf('};', dialogue.indexOf('const body = {')));
  for (const key of ['history', 'text', 'trigger', 'scene', 'character', 'place', 'expressions']) {
    assert.ok(body.includes(key), `送る内容に ${key} がありません`);
  }
  // BCV: 画像の名前は、getImage が返した 1 枚を入れる 1 行だけ(近づいた合図の回は getImage を呼ばない)
  const withoutCamera = body.replace('...(cameraImage ? { image: cameraImage } : {}),', '');
  assert.ok(!/image|frame|video|photo|jpeg|png/i.test(withoutCamera), '送る内容に画像らしい名前があります');
  assert.match(dialogue, /const cameraImage = trigger === 'approach' \? null : \(this\.getImage\?\.\(\{ mode, trigger \}\) \?\? null\);/);
  assert.ok(!/history\.push\([^)]*cameraImage/.test(dialogue), '絵を履歴に入れない(次の回に送り直さない)');
});

// ---- 声の向き(ステレオのマイク): 音も、端末の中で数字にするだけ ----
const AUDIO_FILES = [...files.filter((p) => p.includes(join('tracking', 'audio'))), join(SRC, '..', 'public', 'stereo-tap.worklet.js')];
const AUDIO_FORBIDDEN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'MediaRecorder', 'localStorage', 'sessionStorage', 'indexedDB', 'importScripts', 'toBlob', 'createObjectURL', 'Blob(', 'FileReader', 'showSaveFilePicker', 'caches.'];

test('声の向き(tracking/audio と stereo-tap.worklet.js)は、通信・保存・録音の道具を使わない', () => {
  assert.ok(AUDIO_FILES.length >= 4);
  for (const f of AUDIO_FILES) {
    const text = code(f);
    for (const word of AUDIO_FORBIDDEN) assert.ok(!text.includes(word), `${relative(join(SRC, '..'), f)} に ${word} があります`);
  }
});

test('声の向きの部品は、音を受け取って数字を返すだけ: 受け取った配列を、どこにも貯めない(枠の分だけ)', () => {
  const t = code(join(SRC, 'tracking', 'audio', 'stereoBearing.js'));
  // 長い録音を持てるような、追記する配列(push の先が history 以外)を作っていない
  assert.ok(!/\.(push|concat)\(\s*(l|r)\b/.test(t));
  assert.ok(!/new Float32Array\(\s*(fs|this\.o\.fs)\s*\*/.test(t), '秒単位の長さの配列を作っています');
});
