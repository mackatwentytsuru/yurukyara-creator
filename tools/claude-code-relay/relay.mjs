// Claude Code 中継: アプリの頭脳・絵の呼び出し(POST /v1/messages)を受けて、使う人自身の Claude Code(claude -p)で答える。
// - この PC の中(127.0.0.1)だけで待つ。合図(x-api-key)は起こすたびに作る使い捨ての値で、本物の鍵ではない。
// - API の鍵は読まない・使わない・探さない・出さない。ログインは Claude Code 自身が持つ物を使う。
// - 1 回に 1 つだけ呼ぶ(後の物は順に待たせる)。時間の上限つき。1 日の回数の上限を超えたら断る(日付が替わると 0 から)。
// - 記録には回数と時間だけを残し、話した内容は残さない。
// 使い方: 普通は web/scripts/start-claude-code.mjs(npm run start:claude-code)が起こす。単体: RELAY_TOKEN=<合図> node relay.mjs
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RequestError, allowedModels, errorJson, events, messageJson, parseRequest, sseFrame } from './lib.mjs';
import { createCliRunner } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DAILY_CAP = 300;
const MAX_BODY = 8 * 1024 * 1024; // 絵(base64。実物 5MB まで)を受けるため

const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE');

/** 1 日の回数(ファイルに残すので、起こし直しても 0 に戻らない。日付が替わると 0 から)。読めないファイルは「上限に達した」とみなす */
export function createCounter(file, cap, now = () => new Date()) {
  const read = () => {
    const today = localDate(now());
    if (!existsSync(file)) return { date: today, calls: 0 };
    try {
      const u = JSON.parse(readFileSync(file, 'utf8'));
      if (!Number.isFinite(u?.calls) || typeof u?.date !== 'string') return { date: today, calls: cap };
      return u.date === today ? u : { date: today, calls: 0 };
    } catch {
      return { date: today, calls: cap };
    }
  };
  return {
    cap,
    get calls() {
      return read().calls;
    },
    /** 1 回ぶん引き当てる。上限なら false */
    take() {
      const u = read();
      if (u.calls >= cap) return false;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ date: u.date, calls: u.calls + 1 }));
      } catch {
        return false; // 数えられないなら通さない
      }
      return true;
    },
  };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new RequestError('本文が大きすぎます');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError('本文が JSON ではありません');
  }
}

const sendJson = (res, status, obj) => {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(obj));
};

/** Host の見出しが、この PC の中の名前と待っている番号か(別の名前で来た呼び出し = DNS の化けを断つ) */
export function hostAllowed(host, port) {
  return typeof host === 'string' && [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

/**
 * 中継の HTTP サーバーを作る(listen はしない)。
 * @param {{runner:Function, counter:{cap:number, calls:number, take:()=>boolean}, token:string, models?:string[], maxWaiting?:number, log?:(o:object)=>void}} o
 */
export function createRelayServer({ runner, counter, token, models = allowedModels(), maxWaiting = 6, log = () => {} }) {
  if (typeof token !== 'string' || token.length < 16) throw new Error('合図(token)は 16 字以上の値にしてください');
  let chain = Promise.resolve();
  let waiting = 0;
  let busy = false;
  let seq = 0;
  const iso = () => new Date().toISOString();

  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    if (!hostAllowed(req.headers.host, port)) return sendJson(res, 403, errorJson('permission_error', 'この名前では受けません'));
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true, calls: counter.calls, cap: counter.cap, busy, waiting });
    if (req.method !== 'POST' || path !== '/v1/messages') return sendJson(res, 404, errorJson('not_found_error', 'POST /v1/messages だけです'));
    if (req.headers['x-api-key'] !== token) return sendJson(res, 401, errorJson('authentication_error', 'この中継の合図がちがいます'));
    let parsed;
    try {
      parsed = parseRequest(await readJson(req), { models });
    } catch (err) {
      const bad = err instanceof RequestError;
      return sendJson(res, bad ? 400 : 500, errorJson(bad ? 'invalid_request_error' : 'api_error', bad ? err.message : '中継の中で問題が起きました'));
    }
    if (waiting >= maxWaiting) return sendJson(res, 529, errorJson('overloaded_error', '待っている呼び出しが多すぎます。少しあとで'));

    const n = ++seq;
    const id = `msg_relay_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ac.abort();
    });
    const tIn = Date.now();
    const base = { n, model: parsed.model, images: parsed.images.length, stream: parsed.stream };
    waiting += 1;

    const runOne = async () => {
      waiting -= 1;
      if (ac.signal.aborted) return log({ ...base, at: iso(), skipped: '始まる前に呼んだ側が切れた' });
      if (!counter.take()) {
        sendJson(res, 429, errorJson('rate_limit_error', `この中継の 1 日の上限(${counter.cap} 回)に達しました`));
        return log({ ...base, at: iso(), refused: 'cap' });
      }
      busy = true;
      const t0 = Date.now();
      let started = false;
      let firstTextMs = null;
      const write = (ev) => {
        if (!res.destroyed) res.write(sseFrame(ev));
      };
      const start = () => {
        if (started) return;
        started = true;
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        write(events.messageStart(id, parsed.model));
        write(events.blockStart());
      };
      const onText = (t) => {
        if (firstTextMs === null) firstTextMs = Date.now() - t0;
        if (!parsed.stream || !t) return;
        start();
        write(events.textDelta(t));
      };
      try {
        const out = await runner({ model: parsed.model, system: parsed.system, prompt: parsed.prompt, images: parsed.images, long: parsed.long, onText, signal: ac.signal });
        if (parsed.stream) {
          start();
          write(events.blockStop());
          write(events.messageDelta());
          write(events.messageStop());
          if (!res.destroyed) res.end();
        } else {
          sendJson(res, 200, messageJson(id, parsed.model, out.text));
        }
        log({ ...base, at: iso(), ok: true, waitedMs: t0 - tIn, ms: Date.now() - t0, firstTextMs, chars: out.text.length });
      } catch (err) {
        const type = err.code === 'timeout' ? 'timeout_error' : 'api_error';
        if (!ac.signal.aborted) {
          if (started && parsed.stream) {
            write(events.error(type, err.message));
            if (!res.destroyed) res.end();
          } else {
            sendJson(res, err.code === 'timeout' ? 504 : 502, errorJson(type, err.message));
          }
        }
        log({ ...base, at: iso(), ok: false, code: err.code ?? null, ms: Date.now() - t0, error: String(err.message).slice(0, 200) });
      } finally {
        busy = false;
      }
    };

    const job = chain.then(runOne);
    chain = job.catch(() => {});
    await job;
  });
}

/**
 * 中継を起こす(試験からも、起動の台本からも使う)。port 0 なら空いている番号。
 * @returns {Promise<{server, port:number, url:string, counter, close:()=>Promise<void>}>}
 */
export async function startRelay({ token, stateDir, cap = DEFAULT_DAILY_CAP, port = 0, runner = createCliRunner(), log = () => {}, models } = {}) {
  const counter = createCounter(join(stateDir, 'calls.json'), cap);
  const server = createRelayServer({ runner, counter, token, log, ...(models ? { models } : {}) });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actual = server.address().port;
  return {
    server,
    port: actual,
    url: `http://127.0.0.1:${actual}/v1/messages`,
    counter,
    close: async () => {
      runner.close?.();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.RELAY_TOKEN ?? '';
  if (token.length < 16) {
    console.error('合図(RELAY_TOKEN。16 字以上)が要ります。ふつうは npm run start:claude-code が用意します。');
    process.exit(2);
  }
  const stateDir = process.env.RELAY_STATE_DIR ?? join(HERE, '..', '..', 'web', 'logs', 'claude-code-relay');
  const cap = Number(process.env.RELAY_DAILY_CAP ?? DEFAULT_DAILY_CAP);
  const relay = await startRelay({
    token,
    stateDir,
    cap,
    port: Number(process.env.RELAY_PORT ?? 0),
    log: (o) => console.log(`[${o.at}] #${o.n} ${o.ok ? `済 ${o.ms}ms` : o.refused ? `断った: ${o.refused}` : o.skipped ?? `失敗 ${o.code}`}`),
  });
  console.log(`中継: ${relay.url}(1 日の上限 ${cap} 回・今日これまで ${relay.counter.calls} 回)`);
  const bye = () => relay.close().finally(() => process.exit(0));
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
