// 手元の PC で、公開のリンク(Vercel)の形をまねる試しのサーバー(本物の Vercel ではない)。
// - web/dist を、web/vercel.json の見出し(CSP など)つきで配る。無いファイルは 404(Vercel と同じく、画面へは落とさない)
// - /api/chat と /api/memory(/<下の道>)を web/api の関数で答える(vercel.json の書き換えと同じく、下の道は ?sub= にする)
// 鍵は使わない: 呼ぶ側が ANTHROPIC_API_KEY などを外してから読む(csp_browser_check.mjs)。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.ico': 'image/x-icon',
};

/** vercel.json の見出しの決まりのうち、この道に当たる物を全部まとめる(source は /(.*) の形だけを読む) */
export function vercelHeaders(config, path) {
  const out = {};
  for (const rule of config.headers ?? []) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '(.*)')}$`);
    if (re.test(path)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

const readAll = (req) =>
  new Promise((ok, fail) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });

/**
 * @param {{dist?:string, port?:number, host?:string}} [o]
 * @returns {Promise<{base:string, close:()=>Promise<void>, hits:Map<string,number>}>}
 */
export async function startVercelLocal({ dist = join(WEB, 'dist'), port = 0, host = '127.0.0.1' } = {}) {
  const config = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
  const chat = await import(pathToFileURL(join(WEB, 'api', 'chat.mjs')).href);
  const memory = await import(pathToFileURL(join(WEB, 'api', 'memory.mjs')).href);
  const root = resolve(dist);
  const hits = new Map(); // 道ごとの呼ばれた回数と返事の番号(中身は記録しない)
  const count = (path, status) => hits.set(`${path} ${status}`, (hits.get(`${path} ${status}`) ?? 0) + 1);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}`);
    const headers = vercelHeaders(config, url.pathname);
    try {
      const isChat = url.pathname === '/api/chat';
      const isMemory = url.pathname === '/api/memory' || url.pathname.startsWith('/api/memory/');
      if (isChat || isMemory) {
        const mod = isChat ? chat : memory;
        const fnUrl = url.pathname.startsWith('/api/memory/') ? new URL(`/api/memory?sub=${encodeURIComponent(url.pathname.slice(12))}`, url) : url;
        const handler = mod[req.method];
        if (!handler) {
          count(url.pathname, 405);
          res.writeHead(405, headers).end();
          return;
        }
        const h = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') h.set(k, v);
        h.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readAll(req);
        const response = await handler(new Request(fnUrl, { method: req.method, headers: h, body }));
        const out = { ...headers };
        response.headers.forEach((v, k) => (out[k] = v));
        count(url.pathname, response.status);
        res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = resolve(root, `.${rel}`);
      if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
        count(url.pathname, 404);
        res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      count(url.pathname, 200);
      res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    } catch {
      count(url.pathname, 500);
      res.writeHead(500, headers).end('error');
    }
  });
  await new Promise((ok) => server.listen(port, host, ok));
  const base = `http://${host}:${server.address().port}`;
  return { base, hits, close: () => new Promise((ok) => server.close(() => ok())) };
}
