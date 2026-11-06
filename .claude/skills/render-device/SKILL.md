---
name: render-device
description: ゆるキャラの画面(3D と 2D の板)を「軽いのにきれい」にする手順。重さの測り(?perf=1・measure-render.mjs・K6 の 1 行)、CPU の描画(SwiftShader)で止める見張り、端末の段(tiers.js)、meshopt の解凍の共通の口、2D の板の読み込み(looks)、既定のキャラ(主役ノリー)、動きの意図(K2)、スマホの https の道と Quest の実機の道(USB)、IWER で VR を確かめる、main.js に他の流れの部品を付ける。使う場面 - 重さを測る、最初のコマ、first_frame、読み込みの大きさ、遅い回線、--cold、--throttle、話す試験の口、mouth_max、fps、描く呼び出し、三角の数、スマホで重い、Quest で重い、端末の段、tier、SwiftShader、画面なしの Chrome で撮る、meshopt、KTX2、重さの表、2D の板、looks、?look=2d、既定のキャラ、主役、norrie、動きの意図、applyIntent、https の道、Quest、IWER、vr-check、quest-usb、記憶の札を付ける、初めての会話を付ける、スマホではみ出す。
---

# 軽いのにきれい(描画と端末)

## 重さを測る
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
- `creator/pipeline/web_talk_check.mjs` の `mouth_max` は、setMouth に渡った値の最大。声の鍵が無い時の口は、S3 の直し(w/s3-talk@45fb9ec 以降)で文字送りの予定から作る(文字が出る間 0.35〜0.70)。「ピッ」の音は鳴らすが口の元にしないので、S5 の `speaker.setVoice({ seed })`(ピッの高さと音色)は口の大きさに効かない。
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

## 2D の板と見た目の方式(looks)
- `web/src/character/index.js` の `loadCharacter(url, { look })`: `?look=2d|3d` が先、次に character.json の `looks.default`。3D の形(model)が無く 2D がある時は 2D。2D が読めない時は、3D があれば 3D に戻す(警告だけ)。
- 2D は `looks.2d.parts` の parts.json(無ければ決まりの場所 `2d/parts.json`)と、その中の svg を読む。読み込み(fetch)は character/index.js の中だけで、宛先の変数名は `url`(privacy の試験の決まり)。2D の部品は `import('../char2d/index.js')` で、2D の時だけ読む(8.7KB)。
- `looks.2d.parts` が部品の名前の配列(S1 の K1 の形。みかんちゃん)だと、parts.json が見つからず 3D に戻る。2D の板で出すには S2 の parts.json が要る。
- **2D の部品(2d/parts.json・body.svg)だけが入っても、`characters/<id>/character.json` が無いとキャラは出ない**(既定の順では 404 で次のキャラへ、`?character=<id>` では「読み込めない」)。2D だけで出す最小の形: `{"id","name","looks":{"default":"2d","2d":{"parts":"2d/parts.json"}},"persona":"persona.md"}`。2026-11-07 00:1x、写しの木でこの形のノリー(S2 の 2D・S3 の人格の文)が、既定のキャラ 4/4・話す試験の口 0.692・IWER 19 項目・読み込み 1.20MB・最初のコマ 0.3〜0.4 秒で通った。
- 測った数(GPU・PC と幅 390 と Quest のまね): ようこそくんの 2D は描く呼び出し 17・三角 80・読み込み 1.26MB(ほとんど画面の JS)。3D は 112・37 万・4.19MB。

## 既定のキャラ(主役ノリー)
- 既定のキャラは `DEFAULT_CHARACTERS`(主役 norrie → ようこそくん。`web/src/character/defaults.js`)の順に、読めた物。主役がまだ無い木でも画面は出る(404 が 1 回コンソールに出るのは決まり)。主役の形が読みかけで壊れていても、ようこそくんに戻る。`?character=<id>` を書いた時は、そのキャラだけ(読めなければ理由を出す)。
- 主役の決まり(id と表示の名前)は `MAIN_CHARACTER`(defaults.js)1 か所。初めての会話の案内役(S4 の mountFirstRun の guide)にも、main.js からこれを渡す。
- `character/index.js` は creator/viewer/rigRuntime.js を通して three を読むので、node の試験では読めない(creator/viewer から web/node_modules が見えない)。試験したい決まりは、three を読まない小さな部品(defaults.js の `loadFirstOf` のように、読み込みを引数で渡す形)に出す。試験は `web/test/place_default_character.test.mjs`(主役が入ったら id と 2D か 3D の形を確かめる行も動く)。

## 動きの意図(K2)
- `web/src/character/intent.js` の `applyIntent(character, { emotion, intensity, gesture, gaze, mouth }, { setGaze })`。2D も 3D も同じ 5 つの呼び方(lookAt・setExpression・setMouth・play・update)で受ける。無い表情・動きは近い物へ(INTENT.md の表)。
- 画面(main.js)は毎コマ人を追って lookAt を上書きするので、視線は `ctx.setGaze` に渡す(main.js の setGaze は 'person'・'away'・'landmark:<名前>'・[x,y,z] を受ける)。

## スマホの https の道を確かめる
- 会話サーバーを鍵なしで 127.0.0.1 に立て、Tailscale の https の入口(本人が決めた番号)から開く。PC から `curl -s -o NUL -w "%{http_code} %{size_download}"` で、ページ・`/assets/index-*.js`・`/characters/<id>/character.json`・`model.glb`・`/api/status` が 200 かを見る。
- さらに GPU の Chrome で同じ https の URL を `?perf=1` で開くと、`window.isSecureContext` が true(マイクとカメラが使える)・`__perf.k6.device` が mobile になるのを確かめられる。iPhone の実機は本人。
- 終わったら、自分で起こしたサーバーの PID だけを `taskkill /PID <番号> /T /F` で止める。

## Quest(VR)を確かめる
- まね: `node scripts/vr-check.mjs --port 8799 --character <id> --out <フォルダ> [--query look=2d] [--mic 声.wav]`(GPU の札の中で)。IWER(Meta の WebXR のまね、部品 iwer)を入れた Chrome で、入口 → VR に入る → 立ち位置・床・視線・歩く・スティック・トリガーで話す・文字の板 → 出る、の 19 項目を見る。2026-11-06 21:4x に、ようこそくんの 3D と 2D の板が 19 項目とも通った(1 回 12〜14 秒)。
- 実機: Quest は Tailscale の https の道に入っていないことが多い。USB でつなぎ、`node scripts/quest-usb.mjs --port 8799 --character <id>` を流す(Android の platform-tools の adb を使う。Quest から見て localhost になり、http のままでも安全なページの扱い。ヘッドセットの中で「USB デバッグを許可」を押してもらう)。終わったら `adb reverse --remove tcp:8799`。
- ヘッドセットの名乗り(OculusBrowser・Quest)だと main.js は入口をヘッドセット用にし(「カメラなしで試す」を隠す)、聞き取りはサーバー、マイクの許可は VR に入る前の画面で取る。

## 画面の部品(main.js に付けた物)
- 記憶の札(S3 の mountMemoryPanel)は上の段の「覚えていること」の引き出し(details)。引き出しの中は閉じている間 `innerText` が空になるので、試験では `textContent` で読む。開いている間は `.top:has(.drawer[open])` で「Claude の考え」より手前に出す。
- 会話の入口は全部 `talk()` を通す。会話の側(Dialogue)は `onEvent` でサーバーのイベントを全部渡す(手元のサーバーの流れる形も、公開の関数のまとめた JSON も、brainClient が同じ並びにする)。記憶の一覧は `{type:'memory', added|forgotten}` のイベントで読み直される。返事のあとに読み直す代わりの道は 11/6 第 3 波で外した。引き出しを開いた時の読み直しは残す。
- 仮の頭脳の知らせ(K5)は `/api/status` の brain か、会話のイベントで分かった頭脳が mock の時。理由つきの文はイベントの `notice`(公開の関数の fallback の時に先頭の meta で届く。この meta には brain が無いので、`fallback: true` を見て mock とする。Dialogue は onEvent を呼んでから自分の brain を直すので、main.js の側で覚える)。
- 会話の側の短い知らせ `ui.notice(文)`(鍵らしい文字を送らなかった、など)は #uiNotice に 6 秒。仮の頭脳の知らせと同じ文は重ねない(公開の関数は毎回 notice を送るため)。
- 声が無い時の「ピッ」の高さと音色は、キャラを読んだ後の `speaker.setVoice({ seed: キャラの名前 })` でキャラごとに変わる。声の鍵(BYOK)の声は character.json に voice が入ったら `voiceId` で渡す(今の作例には無い)。合言葉の欄は公開の URL(/api/status が無い)か `?askpass=1` の時だけ出し、合言葉は会話の側の `conversation/demoPass.js` 1 か所に持つ(会話と記憶の通信が見出し x-demo-pass で同じ値を送る。URL に入れない)。
- 初めての会話と性格の画面(S4)は `boot()` の次の 1 行: `import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }))`。#modes に「性格」「はじめての会話」が出る。`?onboard=1` で 7 歩。入口の LED(?led=1)では #modes ごと隠れる。
- 上の段にボタンが増えると、引き出しが右へ押されて、開いた札が幅 390 で画面の右の外へはみ出した。幅 760 以下では `.drawer { position: static }` にして、札を上の段(.top、position: fixed)の左にそろえる。
- `?perf=1` は K6 の平らな 1 行を `PERF {...}` でコンソールに出す。commit は `VITE_COMMIT` を付けて組み立てた時だけ入り、measure-render.mjs が測った木のコミットで埋める。

## 画面を GPU の Chrome で確かめる時の落とし穴
- 入口のゲート(.gate)が画面を覆っている間は、下のボタン(引き出しなど)を押せない(Playwright の click が 30 秒待って落ちる)。先に `#startSim` を押す。
- はみ出しを数える時、閉じた details の中身にも Chrome は位置を返すことがある。`n.closest('details:not([open])')` の中は数えない(summary は数える)。開いた時は別に数える。
- 公開の URL のまねは、Playwright の `page.route` で `/api/status` を 404、`/api/chat` を K5 のまとめた JSON(`{brain, fallback, reason, notice, events, ms}`)にする。合言葉の欄が出ること・会話の見出し x-demo-pass に打った値が付き URL に無いこと・理由つきの知らせが 1 行だけ・返事・記憶の一覧の読み直し(GET /api/memory)を見られる。
- 鍵らしい文字の試しは、偽の文字を実行のときに組み立てる(例 `['ab','cd'].join('').repeat(12)`、48 字の英字)。/api/chat の本文に入っていないこと・短い知らせが出て消えることを見る。
- 点検の道具を `python -I` で流すと PYTHONIOENCODING が効かず、日本語が化ける。`python -I -X utf8 tools/prepush_check.py` で読める。
