// 読み取り専用の小さな静的配信。web/ の部品を書きかえずに、そのまま ES モジュールで読ませる。
// 使い方: node server.mjs [port]   (既定 8791)。配るのは下の許可リストだけ(.env・鍵は配らない)。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url))); // repo ルート
const PORT = Number(process.argv[2] ?? 8791);
const ALLOW = ['/show/led_browser/', '/web/src/', '/web/node_modules/three/', '/web/node_modules/@pixiv/', '/creator/', '/characters/', '/place/'];
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!ALLOW.some((p) => path.startsWith(p)) || path.includes('..') || /(^|\/)\.env/.test(path)) {
      res.writeHead(404).end('not allowed');
      return;
    }
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(404).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`led_browser server http://127.0.0.1:${PORT} pid=${process.pid}`));
