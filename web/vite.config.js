import { defineConfig } from 'vite';

// 開発のときは vite(5173)が画面を配り、API とキャラ・場所のデータは会話サーバー(8787)へ回す。
const API = 'http://localhost:8787';

export default defineConfig({
  // 場所の柱(../place/web)も同じ three を使うよう、1 つにまとめる
  resolve: { dedupe: ['three'] },
  server: {
    fs: { allow: ['..'] },
    host: true,
    port: 5173,
    proxy: { '/api': API, '/characters': API, '/places': API },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
