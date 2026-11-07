// BCV(11-08 本人「カメラは使う人が決める・カメラの中身にも答える」)の、サーバーの側の試験。
// - 絵の形と大きさの点検(JPEG の頭・base64・長い辺)
// - 本物の頭脳へは [絵, 絵の決まり + この回の言葉] で 1 回だけ送る(指示文の段は変えない・2 本目を送らない)
// - 仮の頭脳は絵を見ず、聞かれたら「本物の頭脳の時だけ見られる」とやさしく言う
// - 安全の層が先(つらい話は、絵があっても頭脳を呼ばずに決まった案内)
// - 1 日の上限で、絵の枚数も数える(手元のサーバー・公開の関数)
// - 絵は、記録・記憶・画面の出力のどこにも残らない(手元のサーバーを別の記録の場所で起こして確かめる)
// 本物の頭脳は呼ばない(偽の API)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CAMERA_MOCK_LINES, CAMERA_TURN_RULES, IMAGE_LIMITS, imageTokens, jpegSize, readCameraImage, seeingAsked } from '../server/camera.mjs';
import { ValidationError, sanitizeChatBody, sanitizePublicChatBody } from '../server/validate.mjs';
import { SAFETY_RULES } from '../server/safety.mjs';
import { createLimiter } from '../server/limits.mjs';

const WEB = join(import.meta.dirname, '..');

/** 試験の絵: JPEG の頭(SOI・APP0・SOF0 に幅と高さ)と、毎回ちがう中身(切れ端を探せるように) */
function fakeJpeg(width = 512, height = 384, payload = 3000) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  // 中身に FF が混ざらないように(印に見えないように)
  const body = Buffer.from(randomBytes(payload).map((b) => (b === 0xff ? 0x7f : b)));
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof0, ...sos]), body, Buffer.from([0xff, 0xd9])]);
}
const imageOf = (buf) => ({ type: 'jpeg', data: buf.toString('base64') });

test('JPEG の頭から幅と高さを読む。JPEG でない・壊れた物は null', () => {
  assert.deepEqual(jpegSize(fakeJpeg(512, 384)), { width: 512, height: 384 });
  assert.deepEqual(jpegSize(fakeJpeg(288, 512)), { width: 288, height: 512 });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(jpegSize(png), null, 'PNG は読まない');
  assert.equal(jpegSize(fakeJpeg().subarray(0, 25)), null, '絵の頭の前で切れた物');
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])), null, '絵の頭より先に中身が来た物');
});

test('絵の点検: 受ける形は { type: jpeg, data: base64 } だけ。大きさ・長い辺・文字の形を確かめる', () => {
  const ok = readCameraImage(imageOf(fakeJpeg(512, 384)));
  assert.equal(ok.mediaType, 'image/jpeg');
  assert.equal(ok.width, 512);
  assert.equal(ok.height, 384);
  assert.equal(imageTokens(ok), Math.ceil((512 * 384) / 750), '読みの量の目安 = 幅 × 高さ ÷ 750');
  assert.equal(readCameraImage(undefined), null, '無ければ null');
  const fail = (m) => new ValidationError(m);
  const bad = [
    'data:image/jpeg;base64,xx', // 文字だけ
    [], // 配列
    { type: 'png', data: fakeJpeg().toString('base64') }, // JPEG 以外の名乗り
    { type: 'jpeg', data: 'not base64!!' }, // base64 でない
    { type: 'jpeg', data: Buffer.from('hello world, not a picture').toString('base64') }, // JPEG でない
    { type: 'jpeg', data: 'A'.repeat(IMAGE_LIMITS.maxBase64 + 4) }, // 長すぎる
    imageOf(fakeJpeg(2048, 1536)), // 長い辺が大きすぎる
    imageOf(fakeJpeg(512, 8)), // 短い辺が小さすぎる
  ];
  for (const raw of bad) assert.throws(() => readCameraImage(raw, fail), ValidationError, JSON.stringify(raw).slice(0, 60));
});

test('本文の点検: 話しかけた回の絵は残し、近づいた合図の回の絵は受けない。形の違う絵は 400', () => {
  const pic = imageOf(fakeJpeg());
  const talk = sanitizeChatBody({ text: 'これなに?', image: pic });
  assert.equal(talk.image.width, 512);
  assert.equal(sanitizePublicChatBody({ text: 'これなに?', image: pic }).image.height, 384, '公開の関数の点検でも同じ');
  assert.equal(sanitizeChatBody({ trigger: 'approach', image: pic }).image, undefined, '近づいた合図の回は絵を受けない');
  assert.equal(sanitizeChatBody({ text: 'こんにちは' }).image, undefined, '絵の無い回は今までどおり');
  assert.throws(() => sanitizeChatBody({ text: 'これなに?', image: { type: 'jpeg', data: '!!' } }), ValidationError);
});

test('絵について聞く言葉を見分ける(仮の頭脳の答えのため)', () => {
  for (const s of ['これなに?', 'これ何', '何が見える?', 'みて!', 'なにいろ?', 'これ読んで', 'どっちに行けばいい?', 'カメラに何が写ってる?']) assert.ok(seeingAsked(s), s);
  for (const s of ['こんにちは', 'カレーが好き', 'きょうはいい天気']) assert.ok(!seeingAsked(s), s);
});

// ---- 偽の API で runTurn を通す ----
function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
const reply = '{"type":"say","text":"赤いリンゴが見えるよ。","expression":"happy","motion":"nod","gaze":"person","intent":"見えた物","stage":"chat","handoff":false}';

async function withFakeApi(fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse([{ type: 'message_start', message: { usage: { input_tokens: 1234, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } }]));
      res.write(sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }]));
      res.write(sse([{ type: 'message_delta', usage: { output_tokens: 30 } }, { type: 'message_stop' }]));
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const keep = { url: process.env.ANTHROPIC_API_URL, key: process.env.ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}/v1/messages`;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const { runTurn } = await import(`../server/brain.mjs?camera=${Math.random()}`);
  try {
    return await fn(runTurn, seen);
  } finally {
    server.close();
    if (keep.url === undefined) delete process.env.ANTHROPIC_API_URL;
    else process.env.ANTHROPIC_API_URL = keep.url;
    if (keep.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = keep.key;
  }
}

test('本物の頭脳: 絵のついた回は、最後の発言を [絵, 絵の決まり + この回の言葉] にする。指示文の段は 2 つのまま・2 本目は送らない', async () => {
  await withFakeApi(async (runTurn, seen) => {
    const body = sanitizeChatBody({ text: 'これなに?', scene: '1 人が見えている', character: { name: 'ノリー', persona: 'おっとり' }, image: imageOf(fakeJpeg(512, 384)) });
    const events = [];
    await runTurn(body, { onEvent: (e) => events.push(e), signal: new AbortController().signal, hedge: { afterMs: 1, take: () => true } });
    assert.equal(seen.length, 1, '絵のついた回は、2 本目を送らない(hedge を頼まれても)');
    const sent = seen[0];
    assert.equal(sent.system.length, 2, '指示文の段は変えない(キャッシュが効く)');
    assert.equal(sent.system[0].text, SAFETY_RULES, '1 段目は安全の決まりのまま');
    const last = sent.messages.at(-1);
    assert.ok(Array.isArray(last.content), '最後の発言は段の列');
    assert.equal(last.content[0].type, 'image', '絵を先に置く');
    assert.equal(last.content[0].source.media_type, 'image/jpeg');
    assert.equal(last.content[0].source.data, body.image.data);
    assert.equal(last.content[1].type, 'text');
    assert.ok(last.content[1].text.startsWith(CAMERA_TURN_RULES), '絵の決まりが言葉の先頭');
    assert.match(last.content[1].text, /【使う人の言葉】これなに\?/);
    assert.match(CAMERA_TURN_RULES, /名前を言わない/);
    assert.match(CAMERA_TURN_RULES, /個人の情報は、読み上げない/);
    const metas = events.filter((e) => e.type === 'meta');
    assert.equal(metas[0].camera, 'sent');
    assert.equal(metas.at(-1).usage.imageTokensEstimate, Math.ceil((512 * 384) / 750));
    assert.equal(events.find((e) => e.type === 'say').text, '赤いリンゴが見えるよ。');
  });
});

test('本物の頭脳: 絵の無い回は、今までどおり文字だけ(形を変えない)', async () => {
  await withFakeApi(async (runTurn, seen) => {
    await runTurn(sanitizeChatBody({ text: 'こんにちは' }), { onEvent: () => {}, signal: new AbortController().signal });
    assert.equal(typeof seen[0].messages.at(-1).content, 'string');
    assert.doesNotMatch(seen[0].messages.at(-1).content, /カメラの絵/);
  });
});

test('安全の層が先: つらい話は、絵があっても頭脳を呼ばずに決まった案内(絵はどこへも送らない)', async () => {
  await withFakeApi(async (runTurn, seen) => {
    const events = [];
    await runTurn(sanitizeChatBody({ text: 'もう死にたい', image: imageOf(fakeJpeg()) }), { onEvent: (e) => events.push(e), signal: new AbortController().signal });
    assert.equal(seen.length, 0, '頭脳は呼ばない');
    assert.equal(events[0].safety, 'distress');
  });
});

test('仮の頭脳: 絵は見ない。絵について聞かれたら、本物の頭脳の時だけ見られるとやさしく言う', async () => {
  const { runTurn } = await import(`../server/brain.mjs?mock=${Math.random()}`);
  const pic = imageOf(fakeJpeg());
  const asked = [];
  await runTurn(sanitizeChatBody({ text: 'これなに?', image: pic }), { onEvent: (e) => asked.push(e), brain: 'mock', paceMs: 0 });
  assert.deepEqual(asked.filter((e) => e.type === 'say').map((e) => e.text), [...CAMERA_MOCK_LINES]);
  assert.ok(asked.some((e) => e.type === 'meta' && e.camera === 'mock' && !e.cameraNotice), '返事が「見られない」と言う回は、知らせを足さない(字幕の上の段を増やさない)');
  const other = [];
  await runTurn(sanitizeChatBody({ text: 'カレーが好き', image: pic }), { onEvent: (e) => other.push(e), brain: 'mock', paceMs: 0 });
  const said = other.filter((e) => e.type === 'say').map((e) => e.text);
  assert.ok(said.length > 0 && !said.includes(CAMERA_MOCK_LINES[0]), '聞かれていない回は、ふつうの返事(知らせだけ)');
  assert.ok(other.some((e) => e.type === 'meta' && e.camera === 'mock' && e.cameraNotice && !e.notice), '知らせは cameraNotice(「仮の頭脳です」を上書きしない)');
  const plain = [];
  await runTurn(sanitizeChatBody({ text: 'これなに?' }), { onEvent: (e) => plain.push(e), brain: 'mock', paceMs: 0 });
  assert.ok(!plain.some((e) => e.camera), '絵の無い回は、カメラの知らせを出さない');
});

test('1 日の上限: 絵の枚数も、会話の回数と同じ 1 日の記録で数える。上限で断り、返すと戻る', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-camcap-'));
  const lim = createLimiter({ file: join(dir, 'u.json'), dailyCap: 10, perMinute: 10, imageCap: 2 });
  assert.equal(lim.take('a').ok, true);
  assert.equal(lim.takeImage().ok, true);
  assert.equal(lim.takeImage().ok, true);
  const third = lim.takeImage();
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'image-daily');
  const s = lim.status();
  assert.equal(s.usedToday, 1);
  assert.equal(s.imagesToday, 2);
  assert.equal(s.imageCapToday, 2);
  lim.refundImage();
  assert.equal(lim.status().imagesRemainingToday, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8')), { date: JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8')).date, calls: 1, images: 1 }, '記録は数だけ(絵は入らない)');
});

// ---- 公開の関数 ----
async function publicChat({ body, cfg = {}, brainKey = false, imageUsed = 0 }) {
  const { handleChat } = await import('../api/_lib/chat.mjs');
  const { runTurn } = await import(`../server/brain.mjs?pub=${Math.random()}`);
  const counts = new Map([[`img:x`, imageUsed]]);
  const store = {
    async get() {
      return null;
    },
    async set() {},
    async incr(key) {
      const k = key.startsWith('img:') ? 'img:x' : key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k);
    },
  };
  const conf = { passphrase: 'x'.repeat(20), hasBrainKey: brainKey, dailyCap: 300, perMinute: 10, maxBodyBytes: 32768, maxImageBytes: 163840, dailyImageCap: 1, ...cfg };
  const text = JSON.stringify(body);
  const request = new Request('http://local/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), 'x-demo-pass': 'x'.repeat(20) }, body: text });
  const seenBodies = [];
  const res = await handleChat(request, {
    cfg: conf,
    store,
    sanitize: sanitizePublicChatBody,
    runTurn: async (b, o) => {
      seenBodies.push(b);
      return runTurn(b, { ...o, ...(o.brain ? {} : { brain: 'mock', paceMs: 0 }) }); // 本物の代わりに仮の頭脳で返す(呼んだ本文だけ見る)
    },
  });
  return { status: res.status, data: res.status === 200 ? await res.json() : null, seenBodies };
}

test('公開の関数: 絵のついた本文は、絵 1 枚の分まで大きくてよい。絵の無い大きな本文は今までどおり 413', async () => {
  const pic = imageOf(fakeJpeg(512, 384, 30000)); // 約 40KB の base64(元の上限 32KB を超える)
  const withImage = await publicChat({ body: { text: 'これなに?', image: pic } });
  assert.equal(withImage.status, 200);
  assert.ok(withImage.data.events.some((e) => e.type === 'say' && e.text === CAMERA_MOCK_LINES[0]), '仮の頭脳: 本物の頭脳の時だけ見られる、と言う');
  const big = await publicChat({ body: { text: 'あ', scene: 'x'.repeat(40000) } });
  assert.equal(big.status, 413, '絵の無い本文の上限は 32KB のまま');
});

test('公開の関数: 本物の頭脳の回は、絵の枚数を 1 日の上限で数え、届いたら絵を外して言葉だけで話す', async () => {
  const pic = imageOf(fakeJpeg());
  const first = await publicChat({ body: { text: 'これなに?', image: pic }, brainKey: true, imageUsed: 0 });
  assert.equal(first.status, 200);
  assert.ok(first.seenBodies[0].image, '上限の内なら、絵を頭脳へ渡す');
  const capped = await publicChat({ body: { text: 'これなに?', image: pic }, brainKey: true, imageUsed: 1 });
  assert.equal(capped.seenBodies[0].image, undefined, '上限に届いたら、絵を外す');
  assert.ok(capped.data.events.some((e) => e.type === 'meta' && e.camera === 'capped' && e.cameraNotice), '外したことを知らせる');
});

test('公開の関数: 絵の数えができない時(置き場の故障)は、送らない方へ倒す(絵を外して言葉だけ)', async () => {
  const { takeImageSlot } = await import('../api/_lib/gate.mjs');
  const broken = { incr: async () => { throw new Error('down'); } };
  assert.equal(await takeImageSlot({ cfg: { dailyImageCap: 100 }, store: broken }), false);
  const ok = { incr: async () => 1 };
  assert.equal(await takeImageSlot({ cfg: { dailyImageCap: 100 }, store: ok }), true);
  assert.equal(await takeImageSlot({ cfg: { dailyImageCap: 0 }, store: ok }), false, '上限 0 なら送らない');
});

test('手元の上限: CLAUDE_DAILY_IMAGE_CAP=0 なら絵は送らない(数えは同じ記録)。形の違う値は既定の 100', async () => {
  const { cameraImageCap } = await import('../server/camera.mjs');
  assert.equal(cameraImageCap({ CLAUDE_DAILY_IMAGE_CAP: '0' }), 0);
  assert.equal(cameraImageCap({}), 100);
  assert.equal(cameraImageCap({ CLAUDE_DAILY_IMAGE_CAP: 'たくさん' }), 100);
  const dir = mkdtempSync(join(tmpdir(), 'yc-camcap0-'));
  const lim = createLimiter({ file: join(dir, 'u.json'), dailyCap: 10, perMinute: 10, imageCap: 0 });
  assert.equal(lim.takeImage().ok, false);
});

// ---- 手元のサーバー: 絵が記録・記憶・画面の出力に残らない ----
const freePort = () =>
  new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
function walk(dir) {
  try {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  } catch {
    return [];
  }
}

test('手元のサーバー: 絵は頭脳への 1 回にだけ渡り、記録・記憶・画面の出力のどこにも残らない。枚数は 1 日の記録に数だけ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yc-camlog-'));
  let apiSeen = null;
  const api = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      apiSeen = JSON.parse(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }, { type: 'message_stop' }]));
      res.end();
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_DIR: join(dir, 'logs'),
    MEMORY_DIR: join(dir, 'memory'),
    ANTHROPIC_API_KEY: 'test-key-not-real',
    ANTHROPIC_API_URL: `http://127.0.0.1:${api.address().port}/v1/messages`,
    ELEVENLABS_API_KEY: '',
    APP_PASSPHRASE: '',
    CLAUDE_DAILY_IMAGE_CAP: '5',
  };
  const proc = spawn(process.execPath, [join(WEB, 'server', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  proc.stdout.on('data', (c) => (out += c));
  proc.stderr.on('data', (c) => (out += c));
  const base = `http://127.0.0.1:${port}`;
  const jpeg = fakeJpeg(512, 384, 6000);
  const b64 = jpeg.toString('base64');
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {
        // まだ立っていない
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const key = (await (await fetch(`${base}/api/memory/new`, { method: 'POST' })).json()).key;
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-memory-key': key },
      body: JSON.stringify({ text: 'ぼくはタロウ。カレーが好き。これなに?', image: { type: 'jpeg', data: b64 } }),
    });
    const stream = await res.text();
    assert.match(stream, /赤いリンゴが見えるよ/);
    assert.equal(apiSeen.messages.at(-1).content[0].source.data, b64, '頭脳への 1 回には、絵がそのまま届いた');
    await fetch(`${base}/api/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'text', brain: 'haiku', totalMs: 900, image: b64 }) });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.claude.imagesToday, 1, '絵の枚数を 1 日の記録で数えた');
    assert.equal(status.claude.imageCapToday, 5);
    const files = [...walk(join(dir, 'logs')), ...walk(join(dir, 'memory'))];
    assert.ok(files.length >= 2, `記録と記憶のファイルができた(${files.length})`);
    const slices = [b64.slice(0, 40), b64.slice(2000, 2040), b64.slice(-60, -20)];
    for (const f of files) {
      const raw = readFileSync(f);
      const text = raw.toString('utf8');
      for (const s of slices) assert.ok(!text.includes(s), `${f} に絵の切れ端があります`);
      assert.ok(!raw.includes(jpeg.subarray(200, 260)), `${f} に絵のバイトがあります`);
    }
    for (const s of slices) assert.ok(!out.includes(s), 'サーバーの画面の出力に絵の切れ端があります');
    assert.ok(!stream.includes(b64.slice(0, 40)), '返事の流れに絵を戻さない');
  } finally {
    proc.kill();
    api.close();
  }
});
