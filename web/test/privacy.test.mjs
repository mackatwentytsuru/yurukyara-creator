// カメラの絵が端末の外に出ない、という約束を、コードの形で守る試験。
// 画面に出している注意書き(「保存も、送信もしません」)が、作りと食い違わないようにするためのもの。
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

test('画像を取り出す・記録する・外へ送る道具を、画面のコードのどこでも使っていない', () => {
  for (const f of files) {
    const text = code(f);
    for (const word of IMAGE_EXFIL) {
      assert.ok(!text.includes(word), `${relative(SRC, f)} に ${word} があります`);
    }
  }
});

test('カメラの追従(tracking/)は、通信をいっさいしない', () => {
  for (const f of files.filter((p) => p.includes(`${join('src', 'tracking')}`))) {
    assert.ok(!/\bfetch\s*\(/.test(code(f)), `${relative(SRC, f)} が fetch を使っています`);
  }
});

test('通信先は、自分のサーバー(/api/…)と、キャラ・場所のデータだけ', () => {
  // gaze/now は、入口の LED のページが床のカメラの「向きの数字」を読むだけの GET(本文を送らない)
  // memory・memory/new・pair・claim は、端末をまたぐ記憶(合鍵はヘッダーで送り、URL に入れない)
  const allowed = [/^\/api\/(chat|tts|stt|stt\/warm|metrics|status|fillers|gaze\/now|memory|memory\/new|memory\/pair|memory\/claim)$/, /^\/mediapipe\//];
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
  'stage/loadPlace.js': ['url'], // place.js が渡す、自分のサーバーの place.json
};

// 画面のコードで、外へ直接つないでよいのは 1 か所だけ: 使う人が自分で入れた声の鍵での読み上げ(鍵を私たちのサーバーに送らないため)。
// 送るのは読み上げる 1 文と、声とモデルの名前だけ。カメラ・追従・記憶の部品は読み込まない。
const EXTERNAL_OK = { 'conversation/elevenDirect.js': 'https://api.elevenlabs.io/v1/text-to-speech/' };

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

test('外のサーバーの住所(http:// https:// ws://)を、画面のコードに書かない(import() も含めて)。例外は声の鍵の読み上げの 1 か所だけ', () => {
  for (const f of files) {
    const rel = relative(SRC, f).split('\\').join('/');
    const found = [...code(f).matchAll(/\b(?:https?|wss?):\/\/[^\s'"`]*/g)].map((m) => m[0]);
    const ok = EXTERNAL_OK[rel];
    for (const url of found) assert.equal(url, ok, `${rel} に外の住所があります: ${url}`);
  }
});

test('声の鍵(BYOK)の読み上げ: 送るのは読み上げる文・モデル・言葉だけ。ほかの部品を読み込まず、鍵を扱うのは決まったファイルだけ', () => {
  const direct = code(join(SRC, 'conversation', 'elevenDirect.js'));
  assert.ok(!/\bimport\b/.test(direct), 'elevenDirect.js は、ほかの部品を読み込まない');
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

test('カメラの映像を、描画や保存の先へ渡していない(video は MediaPipe にだけ渡す)', () => {
  for (const f of files) {
    const text = code(f);
    assert.ok(!/drawImage\s*\(/.test(text), `${relative(SRC, f)} が drawImage を使っています`);
  }
  const tracker = code(join(SRC, 'tracking', 'faceTracker.js'));
  assert.ok(tracker.includes('detectForVideo'), '追従は MediaPipe の detectForVideo で行う');
  assert.ok(!/srcObject\s*=.*(upload|post|send)/i.test(tracker));
});

test('サーバーに届くのは「言葉」と「見えている様子の言葉」だけ(画像のフィールドが無い)', () => {
  const dialogue = code(join(SRC, 'conversation', 'dialogue.js'));
  const body = dialogue.slice(dialogue.indexOf('const body = {'), dialogue.indexOf('};', dialogue.indexOf('const body = {')));
  for (const key of ['history', 'text', 'trigger', 'scene', 'character', 'place', 'expressions']) {
    assert.ok(body.includes(key), `送る内容に ${key} がありません`);
  }
  assert.ok(!/image|frame|video|photo|jpeg|png/i.test(body), '送る内容に画像らしい名前があります');
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
