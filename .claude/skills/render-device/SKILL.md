---
name: render-device
description: ゆるキャラの 3D の画面を「軽いのにきれい」にする手順。重さの測り(?perf=1・measure-render.mjs)、CPU の描画(SwiftShader)で止める見張り、端末の段(tiers.js)、meshopt と KTX2 の計画。使う場面 - 重さを測る、fps、描く呼び出し、三角の数、スマホで重い、Quest で重い、端末の段、tier、SwiftShader、画面なしの Chrome で撮る、meshopt、KTX2、重さの表。
---

# 軽いのにきれい(描画と端末)

## 重さを測る
1. `cd web && npx vite build`
2. 会話サーバーを鍵なしで起動する(測りでは話さない。読み上げの鍵があると、あいづちの声を作りにいくので外す):
   `env -u ELEVENLABS_API_KEY -u ANTHROPIC_API_KEY PORT=8799 HOST=127.0.0.1 timeout 3600 node server/index.mjs &`(止めるのは自分の PID だけ)
3. GPU の札を取って測る: `node scripts/measure-render.mjs --port 8799 --out <J: の上のフォルダ> [--characters yokoso] [--views pc,phone] [--query tier=low]`
4. 1 体ずつの JSON・絵・summary.json が出る。表は `docs/重さの表.md` に、測った物だけ書く。
- ページを手で `?perf=1` で開いても、左下に要点の箱が出る(`window.__perf` が JSON)。
- fps は画面の更新(60Hz)で頭打ち。強い GPU では差が出ないので、比べには「描く呼び出し」「三角」「描く 1 回の CPU の時間」を見る。
- 読み込みの大きさは Resource Timing の値。手元のサーバーでは transferSize が 0 のことがあるので、そのときは encodedBodySize で数える(perf.js でそうしてある)。

## CPU の描画で止める
- 前の道具は既定の起動の引数が `--use-angle=swiftshader`(CPU)だった。PC の CPU を長く占め、数字も実機と合わない。
- 新しく Chrome を使う道具は、必ず `web/src/stage/gpuGuard.js` の `GPU_ARGS` で起動し、`page.goto` の次の行に `await stopIfSoftwareRenderer(page, browser);` を書く。CPU なら閉じて終わりの番号 3 で止まる。
- 画面なしの Chrome(playwright-core、channel chrome)でも `--use-angle=d3d11 --enable-gpu` で GPU を使えた(2026-11-06、描画役の名前に GPU の名前が出た)。
- 描画役の名前は `WEBGL_debug_renderer_info` の UNMASKED_RENDERER_WEBGL。SwiftShader・llvmpipe・Microsoft Basic Render Driver は CPU。
- 画面のコードに `http://` の住所を書くと privacy の試験が落ちる(住所の頭を取るときは正規表現で)。

## 端末の段(web/src/stage/tiers.js)
- high = PC(今のまま)、mid = スマホ(画素 1.5 倍・毛 6 層)、low = 弱い端末か CPU の描画(1 倍・3 層)、xr = ヘッドセット(1 倍・4 層)。`?tier=`・`?fur=` で決め打ち。
- iPad の Safari は Mac と名乗るので、maxTouchPoints > 1 で見分ける。playwright の isMobile は名乗りを変えないので、試すときは userAgent も iPhone にする。
- 重さの大半は毛の殻(ようこそくんで 96 枚・三角の 8 割)。毛の無いキャラは段を変えても数字が変わらない。

## meshopt と KTX2(計画。まだ入れていない)
- 解凍の部品は three に同梱(`three/examples/jsm/libs/meshopt_decoder.module.js`・`libs/basis/`)。画面の部品は増えない。圧縮の道具(gltfpack・gltf-transform)は package.json に足す必要があり、それは S6 の持ち物。
- 読み込みの口は 3 か所: creator/viewer/rigRuntime.js・web/src/character/vrmCharacter.js・web/src/stage/loadPlace.js。
