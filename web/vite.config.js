import { defineConfig } from 'vite';

// 開発のときは vite(5173)が画面を配り、API とキャラ・場所のデータは会話サーバー(8787)へ回す。
const API = 'http://localhost:8787';

export default defineConfig({
  // three を 1 つにまとめる(src/stage の AR の部品も同じ three を使う)
  resolve: { dedupe: ['three'] },
  server: {
    fs: { allow: ['..'] },
    host: true,
    port: 5173,
    proxy: { '/api': API, '/characters': API },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
