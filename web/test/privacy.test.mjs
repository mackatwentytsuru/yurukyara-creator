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
const IMAGE_EXFIL = ['toDataURL', 'toBlob', 'getImageData', 'MediaRecorder', 'captureStream', 'createImageBitmap', 'sendBeacon', 'XMLHttpRequest', 'WebSocket'];

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
  const allowed = [/^\/api\/(chat|tts|metrics|status)$/, /^\/mediapipe\//];
  for (const f of files) {
    for (const m of code(f).matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)) {
      const url = m[2];
      assert.ok(allowed.some((re) => re.test(url)), `${relative(SRC, f)}: 想定していない通信先 ${url}`);
      assert.ok(!/^https?:\/\//.test(url), `${relative(SRC, f)}: 外のサーバーへ直接つないでいます ${url}`);
    }
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
