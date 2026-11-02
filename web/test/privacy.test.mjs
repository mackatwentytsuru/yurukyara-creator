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
  const allowed = [/^\/api\/(chat|tts|metrics|status|fillers)$/, /^\/mediapipe\//];
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
  'main.js': ['character.personaUrl'], // キャラの persona.md
};

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

test('外のサーバーの住所(http:// https:// ws://)を、画面のコードに書かない(import() も含めて)', () => {
  for (const f of files) {
    assert.ok(!/\b(?:https?|wss?):\/\//.test(code(f)), `${relative(SRC, f)} に外の住所があります`);
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
