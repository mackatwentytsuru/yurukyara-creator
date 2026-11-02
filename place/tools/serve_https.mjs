// 開発用の HTTPS サーバー(リポジトリの根を配る)。iPhone の殻アプリと Quest 3 のブラウザは、
// マイクと WebXR のために安全なオリジン(HTTPS)が要る。自己署名の証明書を最初の 1 回だけ作る。
//   node place/tools/serve_https.mjs [ポート=8443] [ホスト名か IP(証明書に入れる。既定は PC の LAN の IP)]
// 証明書は place/.certs/ に置く(gitignore)。ARステージは、開くはずのホストに限って自己署名を信用する。
// Quest 3 のブラウザでは最初に警告が出るので「詳細設定 → 進む」。
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const certDir = join(here, '..', '.certs');
const port = Number(process.argv[2] ?? 8443);

function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal && /^(192\.168\.|10\.)/.test(n.address)) return n.address;
    }
  }
  return '127.0.0.1';
}
const host = process.argv[3] ?? lanIp();

mkdirSync(certDir, { recursive: true });
const keyPath = join(certDir, `${host}.key`);
const crtPath = join(certDir, `${host}.crt`);
if (!existsSync(keyPath)) {
  // subjectAltName に IP を入れないと、Chrome 系は証明書を受け付けない
  const san = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? `IP:${host}` : `DNS:${host}`;
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', keyPath, '-out', crtPath,
    '-subj', `/CN=${host}`, '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  console.log('自己署名の証明書を作った(30 日):', crtPath);
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.vrm': 'model/gltf-binary',
};

const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(crtPath) }, (req, res) => {
  const url = new URL(req.url, `https://${host}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root) || file.includes('.git') || file.includes('.certs') || file.includes('.env')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`https://${host}:${port}/place/web/demo.html  (止めるのは Ctrl+C)`);
});
