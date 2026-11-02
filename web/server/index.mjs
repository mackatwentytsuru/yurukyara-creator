// 会話の本体を配るサーバー。画面(dist)・キャラと場所のデータ・会話と読み上げの API を持つ。
// カメラの絵はここに届かない(追従は端末の中だけで行う)。
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { config, REPO_ROOT, WEB_ROOT } from './env.mjs';
import { runTurn } from './brain.mjs';
import { streamSpeech, ttsStatus } from './tts.mjs';
import { createLimiter } from './limits.mjs';

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

const json = (res, status, obj) => res.writeHead(status, { 'content-type': MIME['.json'] }).end(JSON.stringify(obj));

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('本文が大きすぎます');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
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
  return {
    count: totals.length,
    ignored: rows.length - totals.length,
    medianMs: totals.length ? pick(0.5) : null,
    p90Ms: totals.length ? pick(0.9) : null,
    underTargetRate: totals.length ? totals.filter((v) => v <= 1200).length / totals.length : null,
    lastDate: rows.at(-1)?.date ?? null,
  };
}

async function handleChat(req, res) {
  const body = await readBody(req, 256 * 1024);
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
    await runTurn(body, {
      signal: ac.signal,
      onEvent: (ev) => send({ ...ev, serverMs: Date.now() - t0 }),
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
      return json(res, 200, {
        brain: config.anthropicKey ? 'haiku' : 'mock',
        model: config.model,
        tts: ttsStatus(),
        claude: claudeLimiter.status(),
        latency: latencySummary(),
      });
    }
    if (req.method === 'POST' && path === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && path === '/api/tts') {
      const body = await readBody(req);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      return await streamSpeech(body.text, res, ac.signal);
    }
    if (req.method === 'POST' && path === '/api/metrics') {
      const body = await readBody(req);
      appendMetric({ date: new Date().toISOString(), ...body });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/api/metrics') return json(res, 200, latencySummary());

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path.startsWith('/characters/') || path.startsWith('/places/')) {
        if (path === '/characters/_test/model.vrm' && !existsSync(join(REPO_ROOT, path)) && sendDevVrm(res)) return;
        if (sendFile(res, REPO_ROOT, path)) return;
        return json(res, 404, { error: '見つかりません' });
      }
      if (sendFile(res, DIST, path === '/' ? 'index.html' : path)) return;
      if (sendFile(res, DIST, 'index.html')) return;
      return json(res, 404, { error: '先に npm run build をしてください' });
    }
    json(res, 405, { error: 'この方法は使えません' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
};

const server = useTls
  ? createHttpsServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, handler)
  : createHttpServer(handler);

server.listen(config.port, config.host, () => {
  console.log(`会話サーバー: ${useTls ? 'https' : 'http'}://${config.host}:${config.port}${config.host === '127.0.0.1' ? '(この端末だけ)' : ''}`);
  console.log(`頭脳: ${config.anthropicKey ? config.model : '仮の頭脳(ANTHROPIC_API_KEY なし)'} / 読み上げ: ${config.elevenKey ? 'あり' : 'なし'}`);
});
