// 会話の本体を配るサーバー。画面(dist)・キャラと場所のデータ・会話と読み上げの API を持つ。
// 顔の追従は端末の中だけで行う。カメラの絵は、使う人がカメラを入れて話しかけた回だけ 1 枚届き、その回の頭脳の呼び出しにだけ使う
// (BCV。ファイル・記録・記憶には書かない。形は server/camera.mjs が確かめる)。
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { config, REPO_ROOT, WEB_ROOT } from './env.mjs';
import { runTurn } from './brain.mjs';
import { isAbortError } from './abort.mjs';
import { createMemoryStore, fileBackend, NOTICE as MEMORY_NOTICE } from './memory/store.mjs';
import { createMemoryRoutes, forgetReplyEvents, isForgetRequest } from './memory/routes.mjs';
import { extractFacts, memoryAddedEvent, selfNamesOf } from './memory/reflect.mjs';
import { streamSpeech, ttsStatus, voiceForRequest } from './tts.mjs';
import { warmFirstVisit } from './ttsWarm.mjs';
import { createStt, MAX_WAV_BYTES } from './stt.mjs';
import { createUpdateRoutes, findUpdatePython, RESTART_CODE } from './update.mjs'; // BUX: 画面のアップデート
import { createLimiter } from './limits.mjs';
import { createDrawer } from './draw.mjs'; // B4(12b): ブラウザから描く。既定は切ってある(YC_BROWSER_DRAW=1 の時だけ)
import { ensureFillers, fillerPath, listFillerSets } from './fillers.mjs';
import { ValidationError, sanitizeChatBody, sanitizeMetric } from './validate.mjs';
import { CAMERA_CAP_NOTICE, IMAGE_LIMITS, cameraImageCap } from './camera.mjs'; // BCV: カメラの絵(大きさの決まり・1 日の枚数)

const DIST = join(WEB_ROOT, 'dist');
const LOG_DIR = config.logDir;
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
  imageCap: cameraImageCap(), // BCV: カメラの絵の枚数も、同じ 1 日の記録で数える
});

// 端末をまたぐ記憶(合鍵・6 桁の番号・一覧・わすれて)
const memory = createMemoryStore({ backend: fileBackend(config.memoryDir), pepper: config.memoryPepper });
const memoryLimiter = createLimiter({ file: join(LOG_DIR, 'memory_usage.json'), dailyCap: 2000, perMinute: 10 });

const stt = createStt();
// B4(12b): ブラウザから描く係(切ってある時は /api/draw が 404、/api/status の draw.on が false)
const drawer = createDrawer({ config, root: REPO_ROOT, usageFile: join(LOG_DIR, 'draw_usage.json') });
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



/** 合鍵がある回: 覚えていることを読み、この回の言葉から覚える事を足す(知らせは send で) */
function rememberWithKey(memoryKey, text, send, selfNames = []) {
  const recalled = memory.recall(memoryKey);
  let learned = [];
  try {
    learned = memory.add(memoryKey, extractFacts(text, { selfNames }));
  } catch {
    learned = []; // 合鍵の記憶が無い(消えた・7 日たった)ときは、覚えずに話す
  }
  if (learned.length) send(memoryAddedEvent(learned));
  return { recalled, learned };
}

/**
 * 合鍵がまだ無い回(公開の関数の rememberForChat と同じ決まり。CRITsec F8): 覚える事が出た最初の回にだけ合鍵を作り、
 * 返事のイベント { type:'memory', key, added, ... } で画面に渡す。あいさつだけ・開いただけでは作らない。
 * 作る回数は /api/memory/new と同じ上限(1 分 10 回・1 日 2000 回)で数え、超えたら覚えずに話す。合鍵は記録に書かない
 */
function rememberFirstTime(text, client, send, selfNames = []) {
  const none = { recalled: null, learned: [] };
  const facts = extractFacts(text, { selfNames });
  if (!facts.length || !memoryLimiter.take(client).ok) return none;
  const made = memory.create();
  const learned = memory.add(made.key, facts);
  send(memoryAddedEvent(learned, { key: made.key, notice: made.notice, retentionDays: made.retentionDays, expiresAt: made.expiresAt }));
  return { recalled: null, learned };
}

async function handleChat(req, res) {
  // 型・長さを確かめてから先へ(枠を使う前に、おかしな本文を断る)
  // 日本語は 1 字 3 バイトなので、読む上限は余裕を持たせ、長さは sanitize が切る。BCV: カメラの絵 1 枚の分(base64 の上限)を足す
  let body = sanitizeChatBody(await readBody(req, 256 * 1024 + IMAGE_LIMITS.maxBase64 + 1024));
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
  const client = req.socket.remoteAddress ?? 'unknown';
  // 記憶: 合鍵(ヘッダー)があれば、覚えていることを読み、この回の言葉から覚える事を足す
  const memoryKey = typeof req.headers['x-memory-key'] === 'string' ? req.headers['x-memory-key'] : '';
  if (memoryKey && isForgetRequest(body.text)) {
    for (const ev of forgetReplyEvents(memory.forgetAll(memoryKey), body.character?.persona ?? '')) send(ev);
    send({ type: 'done', serverMs: Date.now() - t0 });
    return res.end();
  }
  const selfNames = selfNamesOf(body.character); // 話しかけているキャラの名前は、使う人の名前や好きなものとして覚えない
  const { recalled, learned } = memoryKey ? rememberWithKey(memoryKey, body.text, send, selfNames) : rememberFirstTime(body.text, client, send, selfNames);
  // 本物の Claude を呼ぶときだけ、回数の上限を数える(仮の頭脳は無料)。上限に当たったら、仮の頭脳で話し続ける
  let paid = Boolean(config.anthropicKey);
  if (paid) {
    const slot = claudeLimiter.take(client);
    if (!slot.ok) {
      send({ type: 'meta', limited: true, reason: slot.reason, notice: `仮の頭脳です(${slot.message})` });
      paid = false;
    }
  }
  // BCV: 本物の頭脳へ絵を送る回は、絵の枚数も 1 日の上限で数える。届いていたら、絵を外して言葉だけで話す(仮の頭脳の回は数えない)
  let imageTaken = false;
  if (paid && body.image) {
    if (claudeLimiter.takeImage().ok) imageTaken = true;
    else {
      const { image: _notSent, ...rest } = body;
      body = rest;
      send({ type: 'meta', camera: 'capped', cameraNotice: CAMERA_CAP_NOTICE });
    }
  }
  try {
    const afterMs = config.hedgeExperiment && Number.isFinite(body.hedgeMs) ? body.hedgeMs : config.hedgeMs;
    await runTurn(body, {
      signal: ac.signal,
      memory: recalled,
      learned,
      forceMock: !paid,
      onEvent: (ev) => send({ ...ev, serverMs: Date.now() - t0 }),
      // 2 本目も 1 回として、1 日・1 分の上限に数える。足りなければ送らない
      hedge: { afterMs: paid ? afterMs : 0, take: () => claudeLimiter.take(client).ok },
    });
    send({ type: 'done', serverMs: Date.now() - t0 });
  } catch (err) {
    if (!ac.signal.aborted) {
      if (paid) claudeLimiter.refund(client); // 呼べなかった回は、数えない
      if (imageTaken) claudeLimiter.refundImage(); // BCV: 絵の枚数も返す
      send({ type: 'error', message: err.message });
    }
  }
  res.end();
}

const memoryRoutes = createMemoryRoutes({ store: memory, config, limiter: memoryLimiter, readBody });

// ---- BUX(第 12 波 b): 画面のアップデートの受け口(この PC の中からだけ。update.mjs)。見張り役(scripts/yuru-run.mjs)の下なら、
// 新しくし終えた後に決まった番号で閉じ、見張り役が組み立て直して起こし直す。YURU_UPDATE_UI=0 で受け口ごと無くす ----
const updateRoutes = createUpdateRoutes({
  repoRoot: REPO_ROOT,
  python: findUpdatePython(),
  watched: process.env.YURU_WATCHER === '1',
  enabled: process.env.YURU_UPDATE_UI !== '0',
  fellBack: process.env.YURU_UPDATE_FELL_BACK === '1',
  restart: () => {
    server.close();
    setTimeout(() => process.exit(RESTART_CODE), 200);
  },
});
// ---- BUX ここまで ----

const useTls = Boolean(config.tlsCert && config.tlsKey);
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  try {
    if (await memoryRoutes(req, res, path, url)) return;
    if (await updateRoutes(req, res, path)) return; // BUX: 画面のアップデート(この PC の中からだけ)
    if (req.method === 'GET' && path === '/api/status') {
      warmFirstVisit().catch(() => {}); // 初めての訪問の決まった文の声を、前もって作る(全部そろうまで 10 分に 1 回まで。待たない)
      return json(res, 200, {
        memory: { notice: MEMORY_NOTICE, pairing: Boolean(config.appPass) || ['127.0.0.1', '::1', 'localhost'].includes(config.host) },
        brain: config.anthropicKey ? 'haiku' : 'mock',
        model: config.model,
        tts: ttsStatus(),
        stt: stt.status(),
        claude: claudeLimiter.status(),
        draw: drawer.status(), // B4(12b)
        latency: latencySummary(),
      });
    }
    // あいづちの声: fillers は女の子の役の組(前からの形)、roles は役ごとの組(画面は話す役の組を使う。11-07 第 11 波)
    if (req.method === 'GET' && path === '/api/fillers') {
      const roles = listFillerSets();
      return json(res, 200, { sampleRate: 24000, fillers: roles.female, roles });
    }
    if (req.method === 'GET' && path.startsWith('/api/fillers/')) {
      const file = fillerPath(path.slice('/api/fillers/'.length));
      if (file && existsSync(file)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
        return createReadStream(file).pipe(res);
      }
      return json(res, 404, { error: '見つかりません' });
    }
    if (req.method === 'POST' && path === '/api/chat') return await handleChat(req, res);
    // B4(12b): ブラウザから描く(既定は切ってある)。絵は base64 で 6MB まで
    if (req.method === 'POST' && path === '/api/draw') {
      if (!drawer.status().on) return json(res, 404, { error: 'この設定では、ブラウザから描けません' });
      const r = await drawer.draw(await readBody(req, 6 * 1024 * 1024), req.socket.remoteAddress ?? 'unknown');
      return json(res, r.status, r.json);
    }
    if (req.method === 'POST' && path === '/api/tts') {
      const body = await readBody(req);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      // 声は話す役ごと(本文の voice: 'auto'|'male'|'female' と、その子自身の声 voiceId。形の違う値は使わない)
      return await streamSpeech(body.text, res, ac.signal, voiceForRequest(body));
    }
    if (req.method === 'POST' && path === '/api/stt/warm') {
      stt.warm();
      return json(res, 200, stt.status());
    }
    if (req.method === 'POST' && path === '/api/stt') {
      const slot = sttLimiter.take(req.socket.remoteAddress ?? 'unknown');
      if (!slot.ok) return json(res, 429, { error: slot.message });
      if (!stt.status().available) return json(res, 503, { error: '聞き取りの部品がありません(pip install faster-whisper)' });
      // 手がかり = 話しかけているキャラの名前(画面が x-stt-hint で送る。URL エンコード)。聞き違い(ノリー → 乗り)を減らす
      let hint = '';
      try {
        hint = decodeURIComponent(String(req.headers['x-stt-hint'] ?? '').slice(0, 300));
      } catch {
        // 形の違う値は、手がかり無しで聞く
      }
      return json(res, 200, await stt.transcribe(await readRaw(req, MAX_WAV_BYTES + 1024), { hint }));
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
      if (sendFile(res, DIST, path === '/' ? 'index.html' : path)) return;
      if (sendFile(res, DIST, 'index.html')) return;
      return json(res, 404, { error: '先に npm run build をしてください' });
    }
    json(res, 405, { error: 'この方法は使えません' });
  } catch (err) {
    if (!(err instanceof ValidationError) && !isAbortError(err)) console.error(err); // 声を途中で止めた(画面が切った)時の AbortError は、失敗ではない
    if (!res.headersSent) json(res, err instanceof ValidationError ? err.status : 500, { error: err.message });
    else res.end();
  }
};

const server = useTls
  ? createHttpsServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) }, handler)
  : createHttpServer(handler);

ensureFillers()
  .then((r) => console.log(`あいづちの声: ${r.have} 種類(今回作った ${r.made} 種類、読み上げの文字数 ${r.chars} 字)`))
  .then(() => warmFirstVisit({ force: true }))
  .then((r) => console.log(`初めての訪問の声: 作った ${r.made} 文・もうあった ${r.had} 文${r.skipped ? `(止めた理由: ${r.skipped})` : ''}`))
  .catch(() => {});

server.listen(config.port, config.host, () => {
  console.log(`会話サーバー: ${useTls ? 'https' : 'http'}://${config.host}:${config.port}${config.host === '127.0.0.1' ? '(この端末だけ)' : ''}`);
  console.log(`頭脳: ${config.anthropicKey ? config.model : '仮の頭脳(ANTHROPIC_API_KEY なし)'} / 読み上げ: ${config.elevenKey ? 'あり' : 'なし'}`);
});
