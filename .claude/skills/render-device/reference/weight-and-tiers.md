# 重さを測る

(render-device の SKILL.md から移した節。元の文のまま。後ろに meshopt と KTX2 の節を足した)

1. `cd web && npx vite build`
2. 会話サーバーを鍵なしで起動する(測りでは話さない。読み上げの鍵があると、あいづちの声を作りにいくので外す):
   `env -u ELEVENLABS_API_KEY -u ANTHROPIC_API_KEY PORT=8799 HOST=127.0.0.1 timeout 3600 node server/index.mjs &`(止めるのは自分の PID だけ)
3. GPU の札を取って測る: `node scripts/measure-render.mjs --port 8799 --out <J: の上のフォルダ> [--characters yokoso] [--views pc,phone,quest] [--query tier=low|look=2d]`
4. 1 体ずつの JSON・絵・summary.json が出る。表は `docs/重さの表.md` に、測った物だけ書く。
- ページを手で `?perf=1` で開いても、左下に要点の箱が出る(`window.__perf` が JSON)。
- fps は画面の更新(60Hz)で頭打ち。強い GPU では差が出ないので、比べには「描く呼び出し」「三角」「描く 1 回の CPU の時間」を見る。
- 読み込みの大きさは Resource Timing の値。手元のサーバーでは transferSize が 0 のことがあるので、そのときは encodedBodySize で数える(perf.js でそうしてある)。内訳は `bytes.script`(画面の JS)・`bytes.model`(GLB と動き)・`bytes.other`。
- 幅の種類(measure-render.mjs の VIEW_SPECS): pc(1280・密度 1)、phone(390・密度 3・iPhone の名乗り)、quest(1280・密度 1・Quest 3 の名乗り → 段は xr)。どれも「まね」で、実機の速さではない。
- 札の道具は、ほかの流れが GPU を使っている間は「空く見込み」を出して待ってから流す(`--wait` の分まで)。

## 最初のコマ(初めて開いた人がキャラを見るまで)
- `?perf=1` の `timing` に `first_frame_ms`(キャラの入った最初のコマを描き終えた時刻)・`loop_start_ms`(描く輪を回し始めた時刻)・`ready_to_first_frame_ms` がある(2026-11-06 第 4 波)。K6 の平らな 1 行は変えていない(欄を足すなら S6 と docs/metrics.md もいっしょに)。
- **同じブラウザで続けて測ると、描き方の命令(シェーダー)の作り置きが効いて、最初のコマが速く出る。** 初めて開く人の数字は `measure-render.mjs --cold`(1 件ごとに新しいブラウザ)で測る。
- **描く輪(setAnimationLoop)は、キャラを舞台に置いた直後に回す。** 見せ方の用意(VR の有無を調べる createPresentation)・人格の文・`/api/status` を待ってから回していた時は、初めて開くブラウザで最初のコマが 0.6〜1 秒遅れた(1.2〜2.6 秒 → 直して 0.4〜1.1 秒。5 体 × 3 つの幅)。frame() は、まだ無い物(modes・入力・状態)を `?.` で飛ばすので、先に回してよい。
- 遅い回線のまね: `--throttle slow4g`(往復の遅れ 562.5ms・下り 1474.56kbps・上り 675kbps・CPU 4 倍遅い)、`--throttle cpu4`(CPU だけ)。Chrome の CDP(Network.emulateNetworkConditions・Emulation.setCPUThrottlingRate)を、ページを開く前に掛ける。遅い回線では、最初のコマはほぼ「読み込む大きさ ÷ 回線の速さ」で決まる(4.2MB で約 28 秒)。手元のサーバーは圧縮しないので、画面の JS は公開(圧縮あり)より大きく数えている。
- 重い部品は、使う時に読む: カメラの顔の部品(mediapipeSource.js → @mediapipe/tasks-vision)は「はじめる(カメラ)」を押した時に `import()` で読む(画面の JS 1,227KB → 1,070KB、gzip 331KB → 284KB)。`tracking/sources/index.js` からまとめて読むと、使わない物も入るので、main.js は 1 つずつのファイルから読む。
- 札の道具(machine_lock.py run)から npm の命令を起こす時は `npx.cmd`・`npm.cmd`(Windows。`npx` だけだと「ファイルが見つかりません」で止まる)。
- 既定のキャラの確かめは板の道具 `work\S5\tools\default_check.mjs <web> <port> <出力>`(幅 390・400・PC と初めての会話の案内役。木に characters/norrie があれば norrie を、無ければ yokoso を期待する)。

## 話す試験の口(mouth_max)
- `creator/pipeline/web_talk_check.mjs` の `mouth_max` は、setMouth に渡った値の最大。声の鍵が無い時の口は、S3 の直し(w/s3-talk@852731e 以降)で文字送りの予定から作る(文字が出る間 0.35〜0.70)。「ピッ」の音は鳴らすが口の元にしないので、S5 の `speaker.setVoice({ seed })`(ピッの高さと音色)は口の大きさに効かない。
- S3 の直しが dev に無い時は、写しの作業フォルダで合わせて測れる: `git worktree add --detach <写し> w/s5-device` → `git merge --no-ff --no-commit w/s3-talk` → `mklink /J web\node_modules <共有の node_modules>` → 組み立て → 空いた番号でサーバー → 話す試験(GPU の札)。2026-11-06 23:5x: ようこそくん 0.688・みかんちゃん 0.692(合わせ③の dev では 0.26・0.33)。
- 代役のキャラで道を試せる: 写しの木だけに `characters/norrie/character.json`(model・motions・looks.2d を `../yokoso/...` に向けた物)を置くと、既定のキャラ・人格の文(本物)・幅ごとのはみ出しを、主役が届く前に確かめられる。写しの木ごと消す(リポジトリに入れない)。

## 人格の文が無い時
- character.json の `persona` が指すファイルが無い(404)と、前は 404 の文(手元のサーバーは JSON、公開では頁)をそのまま人格として頭脳に渡していた。main.js は `res.ok` で、html と json でない時だけ読む。無ければ空にして、警告を 1 行出す(主役の character.json が S3 の persona.md より先に入った木でも、変な人格にならない)。

## CPU の描画で止める
- 前の道具は既定の起動の引数が `--use-angle=swiftshader`(CPU)だった。PC の CPU を長く占め、数字も実機と合わない。
- 新しく Chrome を使う道具は、必ず `web/src/stage/gpuGuard.js` の `GPU_ARGS` で起動し、`page.goto` の次の行に `await stopIfSoftwareRenderer(page, browser);` を書く。CPU なら閉じて終わりの番号 3 で止まる。戻り値の描画役の名前を結果に残す(vr-check.mjs・measure-render.mjs はそうしてある)。
- 画面なしの Chrome(playwright-core、channel chrome)でも `--use-angle=d3d11 --enable-gpu` で GPU を使えた(2026-11-06、描画役の名前に GPU の名前が出た)。
- 描画役の名前は `WEBGL_debug_renderer_info` の UNMASKED_RENDERER_WEBGL。SwiftShader・llvmpipe・Microsoft Basic Render Driver は CPU。
- 画面のコードに `http://` の住所を書くと privacy の試験が落ちる(住所の頭を取るときは正規表現で)。

## 端末の段(web/src/stage/tiers.js)
- high = PC(今のまま)、mid = スマホ(画素 1.5 倍・毛 6 層)、low = 弱い端末か CPU の描画(1 倍・3 層)、xr = ヘッドセット(1 倍・4 層)。`?tier=`・`?fur=` で決め打ち。
- iPad の Safari は Mac と名乗るので、maxTouchPoints > 1 で見分ける。playwright の isMobile は名乗りを変えないので、試すときは userAgent も iPhone にする。
- 重さの大半は毛の殻(ようこそくんで 96 枚・三角の 8 割)。毛の無いキャラは段を変えても数字が変わらない。
- 測った数(2026-11-06 21:4x、L2): ようこそくんの描く呼び出しは PC 112 → スマホ 76(−32%)→ Quest 64(−43%)、三角は 37.1 万 → 24.5 万 → 20.3 万。毛の無い 4 体(ロボくん・パネルくん・提灯くん・みかんちゃん)と 2D の板は、どの段でも同じ。

## meshopt と KTX2
- **meshopt の解凍は入れた(2026-11-06)**: GLB の読み込み 3 か所(creator/viewer/rigRuntime.js・web/src/character/vrmCharacter.js・web/src/stage/loadPlace.js)は、共通の口 `web/src/character/gltfLoader.js` の `createGltfLoader()` を使う。新しく GLB を読む所も、`new GLTFLoader()` でなくこれを使う。
- 解凍の部品は three に同梱(`three/addons/libs/meshopt_decoder.module.js`)。画面の JS は約 26KB(gzip 約 8KB)増えた。creator/viewer の import map は `three/addons/` を web/node_modules に向けているので、そのまま読める。
- node の試験でも GLB を読める: 絵の無い GLB(ロボくん)は `createGltfLoader().parse(arrayBuffer, '', ok, ng)` で形・骨・シェイプキーまで確かめられる。絵のある GLB は画像の読み込みで DOM が要るので node では読めない。
- 縮める道具(gltfpack・gltf-transform)はまだ無い。部品を足すのは S6 だけ。足すまでは縮めた GLB を作らない(手で量子化などをしない。GLB は S1 の持ち物)。
- KTX2 は入れていない(計画の削る順 4)。変換の道具が無いうちに KTX2Loader(約 37KB)と変換の wasm(約 0.5MB)を足しても軽くならないため。
