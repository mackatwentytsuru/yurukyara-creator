// 会話の本体を配るサーバー。画面(dist)・キャラと場所のデータ・会話と読み上げの API を持つ。
// カメラの絵はここに届かない(追従は端末の中だけで行う)。
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { config, REPO_ROOT, WEB_ROOT } from './env.mjs';
import { runTurn } from './brain.mjs';
import { createShop, SHOP_KEYS, SHOP_LABELS, MEMORY_CATEGORIES } from './shop/index.mjs';
import { streamSpeech, ttsStatus } from './tts.mjs';
import { createStt, MAX_WAV_BYTES } from './stt.mjs';
import { createLimiter } from './limits.mjs';
import { ensureFillers, fillerPath, listFillers } from './fillers.mjs';
import { ValidationError, sanitizeChatBody, sanitizeMetric } from './validate.mjs';

const DIST = join(WEB_ROOT, 'dist');
const LOG_DIR = join(WEB_ROOT, 'logs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const claudeLimiter = createLimiter({
  file: join(LOG_DIR, 'claude_usage.json'),
  dailyCap: config.claudeDailyCallCap,
  perMinute: config.claudePerMinute,
});

const shop = createShop();

const stt = createStt();
const sttLimiter = createLimiter({ file: join(LOG_DIR, 'stt_usage.json'), dailyCap: 3000, perMinute: 40 });
stt.check().then((ok) => console.log(`聞き取り(サーバー): ${ok ? 'faster-whisper' : 'なし(pip install faster-whisper で使えます)'}`));

const json = (res, status, obj) => res.writeHead(status, { 'content-type': MIME['.json'] }).end(JSON.stringify(obj));

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new ValidationError('本文が大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('本文が JSON ではありません');
  }
}

/** 音など、JSON でない本文をそのまま読む */
async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new ValidationError('本文が大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** root の外に出られないようにしてファイルを返す */
function sendFile(res, root, rel) {
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(full).pipe(res);
  return true;
}

function sendDevVrm(res) {
  if (!config.devVrmPath || !existsSync(config.devVrmPath)) return false;
  res.writeHead(200, { 'content-type': MIME['.vrm'], 'cache-control': 'no-store' });
  createReadStream(config.devVrmPath).pipe(res);
  return true;
}

function appendMetric(entry) {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(join(LOG_DIR, 'latency.jsonl'), JSON.stringify(entry) + '\n');
}

function latencySummary() {
  const file = join(LOG_DIR, 'latency.jsonl');
  if (!existsSync(file)) return { count: 0 };
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // 頭脳が Haiku で声が ElevenLabs の回だけを数える(仮の頭脳・字幕のみの回は、本物の数字にしない)
  const totals = rows.filter((r) => r.valid === true).map((r) => r.totalMs).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const pick = (p) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))];
  const fillers = rows.filter((r) => r.valid === true && Number.isFinite(r.fillerMs)).map((r) => r.fillerMs).sort((a, b) => a - b);
  return {
    // あいづちの声が出るまで(話し終わりから)。本当の返事の最初の音(totalMs)とは、別の数字として数える
    filler: { count: fillers.length, medianMs: fillers.length ? fillers[Math.floor(fillers.length / 2)] : null },
    count: totals.length,
    ignored: rows.length - totals.length,
    medianMs: totals.length ? pick(0.5) : null,
    p90Ms: totals.length ? pick(0.9) : null,
    underTargetRate: totals.length ? totals.filter((v) => v <= 1200).length / totals.length : null,
    lastDate: rows.at(-1)?.date ?? null,
  };
}

async function handleChat(req, res) {
  // 型・長さを確かめてから先へ(枠を使う前に、おかしな本文を断る)
  const body = sanitizeChatBody(await readBody(req, 256 * 1024)); // 日本語は 1 字 3 バイトなので、読む上限は余裕を持たせ、長さは sanitize が切る
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const t0 = Date.now();
  // 本物の Claude を呼ぶときだけ、回数の上限を数える(仮の頭脳は無料)
  const client = req.socket.remoteAddress ?? 'unknown';
  const paid = Boolean(config.anthropicKey);
  if (paid) {
    const slot = claudeLimiter.take(client);
    if (!slot.ok) {
      send({ type: 'error', message: slot.message, reason: slot.reason });
      return res.end();
    }
  }
  try {
    const afterMs = config.hedgeExperiment && Number.isFinite(body.hedgeMs) ? body.hedgeMs : config.hedgeMs;
    await runTurn(body, {
      signal: ac.signal,
      shop,
      onEvent: (ev) => send({ ...ev, serverMs: Date.now() - t0 }),
      // 2 本目も 1 回として、1 日・1 分の上限に数える。足りなければ送らない
      hedge: { afterMs: paid ? afterMs : 0, take: () => claudeLimiter.take(client).ok },
    });
    send({ type: 'done', serverMs: Date.now() - t0 });
  } catch (err) {
    if (!ac.signal.aborted) {
      if (paid) claudeLimiter.refund(client); // 呼べなかった回は、数えない
      send({ type: 'error', message: err.message });
    }
  }
  res.end();
}

const useTls = Boolean(config.tlsCert && config.tlsKey);
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && path === '/api/status') {
      const snap = await shop.snapshot();
      return json(res, 200, {
        shop: snap
          ? { available: true, label: snap.source.label, venue: snap.venue, memory: snap.memory ? { label: snap.memory.source.label, categories: MEMORY_CATEGORIES.filter(([k]) => snap.memory.categories[k]).map(([k, label]) => ({ key: `m_${k}`, label, count: snap.memory.categories[k].items.length })), notFound: snap.memory.missing } : null, sections: SHOP_KEYS.filter((k) => snap.sections[k]).map((k) => ({ key: k, label: SHOP_LABELS[k], updatedAt: snap.sections[k].updatedHm })) }
          : { available: false },
        brain: config.anthropicKey ? 'haiku' : 'mock',
        model: config.model,
        tts: ttsStatus(),
        stt: stt.status(),
        claude: claudeLimiter.status(),
        latency: latencySummary(),
      });
    }
    if (req.method === 'GET' && path === '/api/fillers') return json(res, 200, { sampleRate: 24000, fillers: listFillers() });
    if (req.method === 'GET' && path.startsWith('/api/fillers/')) {
      const file = fillerPath(path.slice('/api/fillers/'.length));
      if (file && existsSync(file)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
        return createReadStream(file).pipe(res);
      }
      return json(res, 404, { error: '見つかりません' });
    }
    if (req.method === 'POST' && path === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && path === '/api/tts') {
      const body = await readBody(req);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      return await streamSpeech(body.text, res, ac.signal);
    }
    if (req.method === 'POST' && path === '/api/stt/warm') {
      stt.warm();
      return json(res, 200, stt.status());
    }
    if (req.method === 'POST' && path === '/api/stt') {
      const slot = sttLimiter.take(req.socket.remoteAddress ?? 'unknown');
      if (!slot.ok) return json(res, 429, { error: slot.message });
      if (!stt.status().available) return json(res, 503, { error: '聞き取りの部品がありません(pip install faster-whisper)' });
      return json(res, 200, await stt.transcribe(await readRaw(req, MAX_WAV_BYTES + 1024)));
    }
    if (req.method === 'POST' && path === '/api/metrics') {
      const body = await readBody(req);
      appendMetric({ date: new Date().toISOString(), ...sanitizeMetric(body) });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/api/metrics') return json(res, 200, latencySummary());

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path.startsWith('/characters/') || path.startsWith('/places/')) {
        if (path === '/characters/_test/model.vrm' && !existsSync(join(REPO_ROOT, path)) && sendDevVrm(res)) return;
        if (sendFile(res, REPO_ROOT, path)) return;
        return json(res, 404, { error: '見つかりません' });
      }
      // キオスクの画面(kiosk/web)。設定(kiosk/config.json)も同じ道で渡す
      if (path === '/kiosk' || path === '/kiosk/') return sendFile(res, join(REPO_ROOT, 'kiosk', 'web'), 'index.html') || json(res, 404, { error: '見つかりません' });
      if (path === '/kiosk/config.json') return sendFile(res, join(REPO_ROOT, 'kiosk'), 'config.json') || json(res, 404, { error: '見つかりません' });
      // 顔の検出の速さの確認の画面(kiosk/web/fps.html)に、MediaPipe の JS を渡す
      if (path === '/kiosk/mp/vision_bundle.mjs') return sendFile(res, join(WEB_ROOT, 'node_modules', '@mediapipe', 'tasks-vision'), 'vision_bundle.mjs') || json(res, 404, { error: '見つかりません' });
      // 声の向きの部品(web/src/tracking/audio)を、マイクの確認の画面へ渡す(同じ物を 2 か所に写さない)
      if (path.startsWith('/kiosk/lib/')) return sendFile(res, join(WEB_ROOT, 'src', 'tracking', 'audio'), path.slice('/kiosk/lib/'.length)) || json(res, 404, { error: '見つかりません' });
      if (path.startsWith('/kiosk/')) return sendFile(res, join(REPO_ROOT, 'kiosk', 'web'), path.slice('/kiosk/'.length)) || json(res, 404, { error: '見つかりません' });
      if (sendFile(res, DIST, path === '/' ? 'index.html' : path)) return;
      if (sendFile(res, DIST, 'index.html')) return;
      return json(res, 404, { error: '先に npm run build をしてください' });
    }
    json(res, 405, { error: 'この方法は使えません' });
  } catch (err) {
    if (!(err instanceof ValidationError)) console.error(err);
    if (!res.headersSent) json(res, err instanceof ValidationError ? err.status : 500, { error: err.message });
    else res.end();
  }
};

const server = useTls
  ? createHttpsServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, handler)
  : createHttpServer(handler);

ensureFillers().then((r) => console.log(`あいづちの声: ${r.have} 種類(今回作った ${r.made} 種類、読み上げの文字数 ${r.chars} 字)`));

server.listen(config.port, config.host, () => {
  console.log(`会話サーバー: ${useTls ? 'https' : 'http'}://${config.host}:${config.port}${config.host === '127.0.0.1' ? '(この端末だけ)' : ''}`);
  console.log(`頭脳: ${config.anthropicKey ? config.model : '仮の頭脳(ANTHROPIC_API_KEY なし)'} / 読み上げ: ${config.elevenKey ? 'あり' : 'なし'}`);
});
