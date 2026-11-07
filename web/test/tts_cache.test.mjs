// 読み上げのおぼえ書き(QF3b): 同じ声・同じ文は声のサービスに 2 回頼まない・文字数も使わない・同時に来た同じ文は 1 回で済ませる・
// 前もっての温め(初めての訪問の決まった文)・上限・失敗は入れない・声の鍵と文字以外は何も残さない。
// 偽の声のサーバーを立てて、本物の声のサービスは呼ばない(鍵は偽の文字列)。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logDir = mkdtempSync(join(tmpdir(), 'yc-ttscache-'));
let fake;
let upstream; // 偽の声のサーバーが受けた本文
let delayMs = 0;
let failNext = 0;
const pcm = (n) => Buffer.alloc(n * 2, 3);
let tts;
let cacheMod;
let warm;

before(async () => {
  upstream = [];
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstream.push({ url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body || '{}') });
      if (failNext > 0) {
        failNext -= 1;
        res.writeHead(500).end('boom');
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write(pcm(1200));
        setTimeout(() => res.end(pcm(1200)), 20);
      }, delayMs);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.ELEVEN_API_URL = `http://127.0.0.1:${fake.address().port}/v1/text-to-speech/`;
  process.env.ELEVENLABS_API_KEY = 'test-dummy-key-not-real-0000000000';
  process.env.ELEVEN_DAILY_CHAR_CAP = '5000';
  process.env.LOG_DIR = logDir;
  tts = await import('../server/tts.mjs');
  cacheMod = await import('../server/ttsCache.mjs');
  warm = await import('../server/ttsWarm.mjs');
});

after(() => {
  fake?.close();
  rmSync(logDir, { recursive: true, force: true });
});

function fakeRes() {
  const chunks = [];
  const r = { head: null, ended: false, chunks };
  r.writeHead = (status, headers) => {
    r.head = { status, headers: headers ?? {} };
    return r;
  };
  r.write = (c) => chunks.push(Buffer.from(c));
  r.end = (c) => {
    if (c) chunks.push(Buffer.from(c));
    r.ended = true;
    return r;
  };
  r.body = () => Buffer.concat(chunks);
  return r;
}
const used = () => tts.ttsStatus().usedToday;
const MALE = { role: 'male', voiceId: 'GKDaBI8TKSBJVhsCLD6n' };

test('同じ声・同じ文: 2 回目はおぼえ書きから返し、声のサービスにも文字数にも触らない', async () => {
  const n0 = upstream.length;
  const u0 = used();
  const a = fakeRes();
  await tts.streamSpeech('おぼえ書きの 1 文目です。', a, undefined, MALE);
  assert.equal(a.head.status, 200);
  assert.equal(a.head.headers['x-tts-cache'], 'miss');
  assert.equal(a.body().length, 4800);
  assert.equal(upstream.length, n0 + 1);
  assert.equal(used(), u0 + [...'おぼえ書きの 1 文目です。'].length);
  const b = fakeRes();
  await tts.streamSpeech('おぼえ書きの 1 文目です。', b, undefined, MALE);
  assert.equal(b.head.headers['x-tts-cache'], 'hit');
  assert.deepEqual(b.body(), a.body(), '同じ音');
  assert.equal(upstream.length, n0 + 1, '声のサービスに頼んでいない');
  assert.equal(used(), u0 + [...'おぼえ書きの 1 文目です。'].length, '文字数を引いていない');
});

test('声が違えば別の物(同じ文でも、声の id ごと)', async () => {
  const n0 = upstream.length;
  const a = fakeRes();
  await tts.streamSpeech('おぼえ書きの 1 文目です。', a, undefined, { role: 'female', voiceId: 'fUjY9K2nAIwlALOwSiwc' });
  assert.equal(a.head.headers['x-tts-cache'], 'miss');
  assert.equal(upstream.length, n0 + 1);
  assert.match(upstream.at(-1).url, /fUjY9K2nAIwlALOwSiwc/);
});

test('同時に来た同じ文は、声のサービスに 1 回だけ頼み、全員に同じ音を流す(相乗り)', async () => {
  delayMs = 60;
  const n0 = upstream.length;
  const u0 = used();
  const text = '同時に来た 1 文です。';
  const rs = [fakeRes(), fakeRes(), fakeRes()];
  await Promise.all(rs.map((r) => tts.streamSpeech(text, r, undefined, MALE)));
  delayMs = 0;
  assert.equal(upstream.length, n0 + 1, '声のサービスへは 1 回');
  assert.equal(used(), u0 + [...text].length, '文字数も 1 回分');
  const how = rs.map((r) => r.head.headers['x-tts-cache']).sort();
  assert.deepEqual(how, ['join', 'join', 'miss']);
  for (const r of rs) assert.deepEqual(r.body(), rs[0].body());
  assert.equal(rs[0].body().length, 4800);
});

test('頼んだ人が先に切れても、音は最後まで取っておぼえ書きに入る(次は早い)', async () => {
  delayMs = 40;
  const text = '途中で切れた人がいる 1 文です。';
  const ac = new AbortController();
  const a = fakeRes();
  const p = tts.streamSpeech(text, a, ac.signal, MALE);
  setTimeout(() => ac.abort(), 10);
  await p;
  delayMs = 0;
  await new Promise((r) => setTimeout(r, 200));
  const n0 = upstream.length;
  const b = fakeRes();
  await tts.streamSpeech(text, b, undefined, MALE);
  assert.equal(b.head.headers['x-tts-cache'], 'hit');
  assert.equal(upstream.length, n0, '取り直していない');
});

test('声のサービスが失敗した文は、おぼえ書きに入れず、文字数を返す', async () => {
  const text = '失敗する 1 文です。';
  const u0 = used();
  failNext = 1;
  const a = fakeRes();
  await tts.streamSpeech(text, a, undefined, MALE);
  assert.equal(a.head.status, 502);
  assert.equal(used(), u0, '文字数は返った');
  assert.doesNotMatch(String(a.body()), /boom/, '声のサービスの返事の文は返さない');
  const b = fakeRes();
  await tts.streamSpeech(text, b, undefined, MALE);
  assert.equal(b.head.status, 200, '次は取れる(失敗を覚えていない)');
  assert.equal(b.head.headers['x-tts-cache'], 'miss');
});

test('おぼえ書きにある文は、今日の上限を使い切っていても返せる(新しい文は断る)', async () => {
  const text = '上限の前に取った 1 文です。';
  await tts.streamSpeech(text, fakeRes(), undefined, MALE);
  const left = tts.ttsStatus().remainingToday;
  assert.ok(tts.reserveChars(left), '残りを全部使う');
  try {
    const hit = fakeRes();
    await tts.streamSpeech(text, hit, undefined, MALE);
    assert.equal(hit.head.status, 200);
    assert.equal(hit.head.headers['x-tts-cache'], 'hit');
    const fresh = fakeRes();
    await tts.streamSpeech('上限のあとの新しい 1 文です。', fresh, undefined, MALE);
    assert.equal(fresh.head.status, 429);
    assert.match(String(fresh.body()), /"reason":"cap"/);
  } finally {
    tts.refundChars(left);
  }
});

test('ディスクにも残る: 記憶を空にしても(サーバーを起こし直したのと同じ)、フォルダから返す。ファイルは音だけ', async () => {
  const text = 'ディスクに残る 1 文です。';
  await tts.streamSpeech(text, fakeRes(), undefined, MALE);
  const fresh = cacheMod.createTtsCache({ dir: join(logDir, 'tts_cache') });
  const key = cacheMod.cacheKey(MALE.voiceId, 'eleven_v4_turbo', text);
  const buf = fresh.get(key);
  assert.ok(buf && buf.length === 4800, 'フォルダから読めた');
  assert.equal(fresh.stats.hitDisk, 1);
  const files = readdirSync(join(logDir, 'tts_cache'));
  assert.ok(files.length >= 1);
  for (const f of files) {
    assert.match(f, /^[0-9a-f]{64}\.pcm$/, 'ファイル名は鍵のハッシュだけ(文も声の id も入っていない)');
    assert.doesNotMatch(readFileSync(join(logDir, 'tts_cache', f)).toString('latin1'), /test-dummy-key|ディスクに残る/, '音のほかは何も入っていない');
  }
});

test('大きさの上限: 記憶もフォルダも、古い物から捨てる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-ttscache-small-'));
  try {
    const c = cacheMod.createTtsCache({ dir, memBytes: 3000, diskBytes: 5000 });
    for (let i = 0; i < 6; i += 1) c.set(cacheMod.cacheKey('v', 'm', `t${i}`), Buffer.alloc(1000, i));
    assert.ok(c.memBytes() <= 3000, `記憶 ${c.memBytes()}`);
    assert.ok(c.diskBytes() <= 5000, `フォルダ ${c.diskBytes()}`);
    assert.equal(c.get(cacheMod.cacheKey('v', 'm', 't5')).length, 1000, '新しい物は残る');
    assert.equal(c.set('x', Buffer.alloc(3)), false, '半端な長さ(奇数)は入れない');
    assert.equal(c.set('y', Buffer.alloc(0)), false);
    assert.equal(c.set('z', Buffer.alloc(cacheMod.ENTRY_MAX_BYTES + 2)), false, '大きすぎる物は入れない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('おぼえ書きの名前: 区切りに紛れる文でも、別の声・別の文は別の名前', () => {
  const k = cacheMod.cacheKey;
  assert.notEqual(k('ab', 'c', 'd'), k('a', 'bc', 'd'));
  assert.notEqual(k('a', 'b', 'c|d'), k('a', 'b|c', 'd'));
  assert.equal(k('a', 'b', 'c'), k('a', 'b', 'c'));
});

test('温め: 主役の初めてのあいさつと 7 歩目の声の文を作る。2 回目は 1 文も頼まない', async () => {
  const targets = warm.warmTargets();
  assert.ok(targets.length >= 4, `対象 ${targets.length} 文`);
  assert.ok(targets.some((t) => t.text.includes('ノリー')), '人格の文のあいさつが入る');
  assert.ok(targets.every((t) => t.voiceId === 'GKDaBI8TKSBJVhsCLD6n'), 'ノリーの声(男の子の声)で作る');
  const n0 = upstream.length;
  const r1 = await warm.warmFirstVisit({ force: true, targets });
  assert.equal(r1.skipped, null);
  assert.equal(r1.made, targets.length);
  assert.equal(upstream.length, n0 + targets.length);
  const r2 = await warm.warmFirstVisit({ force: true, targets });
  assert.equal(r2.made, 0);
  assert.equal(r2.had, targets.length);
  assert.equal(upstream.length, n0 + targets.length, '2 回目は頼んでいない');
  // 画面と同じ形の頼み(役と声の id)で来ると、温めた音が返る
  const res = fakeRes();
  await tts.streamSpeech(targets[0].text, res, undefined, tts.voiceForRequest({ voice: 'male', voiceId: 'GKDaBI8TKSBJVhsCLD6n' }));
  assert.equal(res.head.headers['x-tts-cache'], 'hit');
  // 本文の「執事」は読み方の表で「しつじ」に直してから声のサービスへ行く(おぼえ書きもその形で当たる)
  assert.ok(upstream.some((u) => u.body.text.includes('しつじ')), '読み方の表を通っている');
});

test('温め: 案内役の最初の 2 文は、初めての会話の台本(script.js)の文と同じ(文が変わったら、ここが知らせる)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'onboarding', 'script.js'), 'utf8');
  for (const line of warm.GUIDE_FIRST_LINES) assert.ok(src.includes(line.replace('ノリーデス', '${this.guideName}デス')) || src.includes(line), `台本に無い文: ${line}`);
  const texts = warm.warmTargets().map((t) => t.text);
  for (const line of warm.GUIDE_FIRST_LINES) assert.ok(texts.includes(line), '温める文に入っている');
});

test('温め: 今日の残りが少ない時はやらない(文字数を使い切らない)', async () => {
  const left = tts.ttsStatus().remainingToday;
  assert.ok(tts.reserveChars(Math.max(0, left - 100)));
  try {
    const n0 = upstream.length;
    const r = await warm.warmFirstVisit({ force: true, targets: [{ text: '残りが少ない時の別の 1 文です。', voiceId: MALE.voiceId }] });
    assert.equal(r.skipped, 'low-remaining');
    assert.equal(upstream.length, n0);
  } finally {
    tts.refundChars(Math.max(0, left - 100));
  }
});

test('鍵は、声のサービスに送る見出しにだけ付く(記録・おぼえ書き・返事の見出しには出ない)', async () => {
  const text = '見出しを確かめる 1 文です。';
  const res = fakeRes();
  await tts.streamSpeech(text, res, undefined, MALE);
  assert.equal(upstream.at(-1).key, 'test-dummy-key-not-real-0000000000');
  assert.doesNotMatch(JSON.stringify(res.head), /test-dummy-key|GKDaBI8TKSBJVhsCLD6n/, '返事の見出しに鍵も声の id も出ない');
});
