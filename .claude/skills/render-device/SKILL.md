---
name: render-device
description: ゆるキャラの画面(3D と 2D の板)を「軽いのにきれい」にする手順。重さの測り(?perf=1・measure-render.mjs・K6 の 1 行)、CPU の描画(SwiftShader)で止める見張り、端末の段(tiers.js)、meshopt の解凍の共通の口、2D の板の読み込み(looks)、3D と 2D の見た目の切り替え(このタブだけ覚える)、キャラを上の段と下の帯の間に収める(スマホの幅で頭が段の下に入らない)、入口(製品の名前・主役・初めての訪問の 7 歩・本当の約束・指とマウスの言葉)、字幕に返事の全部を残す、「Claude の考え」の言葉と開いた時の置き直し、?character= ?place= は公開では id だけ、既定のキャラ(主役ノリー)、動きの意図(K2)、スマホの https の道と Quest の実機の道(USB)、IWER で VR を確かめる、main.js に他の流れの部品を付ける。使う場面 - 入口、ゲート、gate-up、初めての訪問、7 歩を出す、yc.onboarded.v1、カメラなしで試す、指でなぞる、touch-action、字幕が消える、最後の 1 文だけ、表情と動き、happy / bow、上の札の言葉、考えの窓が顔に重なる、切り替えが押せない、z-index、公開の URL、外の URL、id だけ、judge.test、見た目の切り替え、2D と 3D を切り替える、sessionStorage、上の段に重なる、頭が隠れる、耳が切れる、Claude の考えが重なる、覚えていることが押せない、44px、--top-h、frameCharacter、topGuard、重さを測る、最初のコマ、first_frame、読み込みの大きさ、遅い回線、--cold、--throttle、話す試験の口、mouth_max、fps、描く呼び出し、三角の数、スマホで重い、Quest で重い、端末の段、tier、SwiftShader、画面なしの Chrome で撮る、meshopt、KTX2、重さの表、2D の板、looks、?look=2d、既定のキャラ、主役、norrie、動きの意図、applyIntent、https の道、Quest、IWER、vr-check、quest-usb、記憶の札を付ける、初めての会話を付ける、スマホではみ出す。
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

## 上の段と下の帯の間に収める(スマホの幅。2026-11-07 第 5 波)
- 上の段(上の札・見せ方のボタン・覚えていること・見た目の切り替え・「Claude の考え」の見出し)はスマホの幅で 3〜4 行(幅 390 で下の端 約 180px)になる。前はキャラの見せ方が下の帯しか避けず、幅 390・400・480 で 2D と 3D のノリーの頭と耳が段の下に入った(形の点の上の端と段の下の端のすき間 −76〜−90px)。
- 直し方: `scene.js` の `frameCharacter` は、1 回置いてキャラの箱の横の範囲を画面へ写し、`state.topGuard(left, right)`(main.js が渡す。横に重なる上の段の下の端 + 8px)より上にキャラの上の端があれば、段の下から置き直す。2 回目はキャラが小さくなるだけなので、横に重なる段は増えない。計算(帯に収める高さと真ん中のずらし)は three を読まない `web/src/stage/framing.js` の `fitBand`・`guardBottom`(試験 `web/test/place_frame_band.test.mjs`)。直した後は すき間 +44〜+51px、PC は変わらない(左上の段がキャラに横で重ならない)。
- カメラの見る高さ = キャラの真ん中の高さ + shift × 見える高さ。shift = (上の段 − 下の帯) ÷ 2 ÷ 画面の高さ(下の帯だけの時は前の式と同じ)。上の段は画面の 45%、下の帯は 50% までで切り、キャラの帯は 3 割は残す(横向きのスマホ)。
- 全身の時は、キャラの実際の幅(原点から遠い側の 2 倍 × 1.04。しっぽが片側だけ長くても両側を空ける)も画面の幅に入れる。画角は毎回 28 度から計算する(前は部屋の中で広げた画角を次の計算に持ち越していた)。
- 上の段の高さが変わったら置き直す: `.top` を ResizeObserver で見て `--top-h` を書き(「Claude の考え」の top に使う)、続けて置き直す。始めると札が 2 行になる・ボタンが増える時に効く。覚えていることの引き出しの中身は、使う人が開いた時だけの重なりなので数えない。**「Claude の考え」を開いた窓は数える**(下の「考えの窓」)。
- 「Claude の考え」は幅 960 まで `top: calc(max(12px, env(safe-area-inset-top)) + var(--top-h, 64px) + 8px)`。決め打ちの `+ 76px` では、札が 2 行になった時に考えの見出しが「覚えていること」などに重なって押せなかった(S4 の撮影の練習 M12・M13)。
- 押す所は 44px: `.top .place-mode-button, .top .drawer > summary` と `.thought-head`。S4 の「性格」「はじめての会話」は `place-mode-button fr-launch` で、S4 の JS が後から入れる `.fr-launch { min-height: 40px }`(1 つのクラス)が勝つので、`.top` を前に付けて強くする。summary は `line-height: 18px` と上下 12px で 44px(flex にしない。古い Safari の details の動きを変えない)。

## 見た目の切り替え(3D と 2D。2026-11-07 第 5 波)
- 3D と 2D の両方があるキャラだけ、上の段に `#lookSwitch`(「見た目」+「3D」「2D」の 2 つのボタン、aria-pressed、押す所 44px)を出す。スマホの幅では、畳んだ「Claude の考え」の見出しの右に `position: fixed` で置く(上の段の行を増やさない。考えを開いても切り替えは窓より手前で押せる。第 7 波)。AR(data-hide-in-ar)・VR の間・入口の LED・ヘッドセット・`?perf=1` では出さない。
- 両方あるかは `availableLooks(character)`(character/index.js): 3D は model があれば。2D は `looks.2d.parts` が文字(S2 の parts.json の場所)なら見に行かずにあり、`looks` はあるが `2d` が無い時は決まりの場所 `2d/parts.json` を 1 回 GET で見る(ノリーは合わせ⑤から looks.2d が書いてあるので見に行かない)(content-type が json の 200 だけ)。前の形(looks が無い。ロボくん・パネルくん・提灯くん)と、2d が部品の名前の並びだけ(みかんちゃん。板の部品の表が無い)は見に行かない(404 をコンソールに出さない)。
- 替える時は `loadCharacter(lookSource.url, { ...app.tierOverrides, look })` で読み、舞台の object3d を入れ替え、`app.character` と `dialogue.character` を替え、置き直す。読んだ物は Map に持ち、2 回目からはすぐ替わる。会話・記憶・人格の文はキャラの id が同じなのでそのまま。
- 選んだ方は、このタブだけで覚える: `sessionStorage` の `yc.look.<character.json の id>`(読み書きは try/catch。使えないブラウザでは覚えないだけ)。順は `?look=` → このタブで選んだ物 → `looks.default`。`?look=` が URL にある時は、押した時に `history.replaceState` で選んだ方へ書き換える(読み込み直しても同じ)。別のタブ・新しい文脈では既定に戻る。
- 決まりは three を読まない `web/src/character/looks.js`(試験 `web/test/place_look_switch.test.mjs`。今の木のキャラの looks の形と、index.html・style.css の形も見る)。
- **今の木のキャラを見る試験は、読んだ character.json から期待を作る(決め打ちしない)。** character.json はほかの流れ(主役・S1)の持ち物で、合わせの順で先に変わる。2026-11-07 合わせ⑤: 主役の流れがノリーの looks に `2d` を足しただけで、文字のぶつかり 0 のまま `'probe'` の決め打ちが落ちた(意味のぶつかり。382 件中 1 件)。直し方は「looks.2d があれば `'yes'`・無ければ `'probe'`」。決まりの答え(主役は 2D を出せる)は残し、形の違いだけを読んで合わせる。試す前に、looks.2d を外した写し(structuredClone して delete)でも期待と looks.js の答えが合うのを 1 行の node で見る。

## 入口(ゲート)と初めての訪問(2026-11-07 第 7 波。点検 CRITux 2・10・15・24)
- 入口のカードは「ゆるキャラクリエイター」(title も)・案内役(主役なら「案内するのは主役のノリー。協力者が手で描いた、セスジキノボリカンガルーの執事見習いです」、ほかの子ならその子の名前)・本当の約束(声が使える時だけ「声と文字で答えます」、それ以外は「文字で答えます。声は、声の鍵があるときだけ出ます」。決めるのは `/api/status` の `tts.available` を読んだ後の `fillGate()`)。公開の URL には読み上げの関数が無いので、声は使う人の鍵(7 歩目)だけ。
- **入口が開いている間は、上の段と「Claude の考え」を隠す**: `<html class="gate-up">`(JS の前から効く)と `html.gate-up:not(.fr-open) .top, … #thought { visibility: hidden }`。visibility なので高さの測り(--top-h・topGuard)は変わらない。外すのは `gateClosed()` だけ(#startSim・#startCam が通った時)。S4 の 7 歩が入口を消して出ている間(`html.fr-open`)は出す。前は入口の板の裏で 9 個が見えるのに押せなかった。
- **初めての訪問なら、入口を閉じた直後に 7 歩**: `web/src/stage/firstVisit.js` の `shouldOpenFirstRun({ params, storage: localStorage, doneKey, headset })`。印 `yc.onboarded.v1`(S4 が「終えた」「あとで」で書く)が無ければ出す。出さない: `?onboard=0`・`?onboard=1`(読み込んだ時に出ている)・**`?auto=0`(確かめの道具が付ける。web_talk_check・talk-through・measure-render・layout_check は付けているので変わらない)**・LED・自動で始める・ヘッドセット・`?perf=1`。覚える所が使えないブラウザは初めてとみなす。S4 の startOnboarding は 2 回目を何もしないので、S4 が自前で出しても重ならない。
- ボタンの言葉: 何をするか(大)+どう動くか(小、`.btn-sub`)。カメラは「カメラを使って始める」(マイクを言わない。マイクは「声で話す」の時だけ、と下の注に書く)。カメラなしは「カメラなしで試す」のまま(**web_talk_check.mjs などが `getByText('カメラなしで試す')` で押すので、この言葉は残す**)+スマホ「画面を指でなぞると、その向きを見ます」/PC「マウスを動かすと、その向きを見ます」(`matchMedia('(pointer: coarse)')`)。下の注と上の札も同じ言葉。
- **指でなぞる向きを本当に効かせるには、舞台に `touch-action: none`**。無いと、Chrome のタッチ(CDP の `Input.dispatchTouchEvent` の touchStart → touchMove)で SimSource の faces が 0 のまま(直す前 0 → 直した後 1)。
- 上の札の言葉(CRITux 18): 「人 0」→「見えている人 0 人」、カメラの道「GPU 60fps」→「オン」、カメラなし「マウスで試し中」→「なし」(tracking/ の info の言葉は持ち主が無いので、main.js の updateChips で言い換える)。考えの下は「返事が始まるまで 0.3 秒(仮の頭脳か声なしなので、参考の値)・目安は 1.2 秒以内」。札の文字を長くすると幅 390 で 3 行になりキャラが小さくなるので、短い言葉にする(2 行のまま)。

## 字幕に返事の全部を残す(CRITux 12)と「表情と動き」の言葉(CRITux 9)
- 会話の側(S3 の Dialogue)の呼び方は変えずに、panel.js の `createCaptionFlow()`(DOM を触らない。試験 `web/test/place_caption_flow.test.mjs`)で決める: `say(文)` の後の `caption('' か 文の頭)` は返事の続き(前の文を小さく `.cap-prev`、今の文を `.cap-now`)、`caption(null, ms)` は話し終わり → 返事の全部を `.settled` で次の会話まで残す(前は 1.2 秒で消え、最後の 1 文しか読めなかった)、`caption(null)`(取り消し=次の会話の始まり)と使う人の言葉は片づけ。**返事の続きかどうかは「今の文の頭と同じか」で見分ける**(聞き返しの知らせは別の文なので、返事に混ぜない)。
- 字幕は `max-height: 34vh; overflow-y: auto; line-break: strict`(小さい「ョ」で行を始めない)。幅 390 で 3 文(62 字)は約 100px で、ノリーの足の下に収まった。
- 「表情と動き」は `actWords(ev)`: 「うれしい・おじぎ・あなたを見る」。K2 の 7 つの表情・動き 13(rig の sad・idle・talk を含む)・視線(person・away・landmark:<名前>)。知らない名前も中の名前を出さず「この子の表情」「この子の動き」。

## 考えの窓(CRITux 21)
- スマホで「Claude の考え」を開くと、窓が顔と見た目の切り替えに重なり、切り替えが押せなかった。直し方: ① TOP_GUARD に `#thought:not(.collapsed)` を足し、`#thought` を ResizeObserver で見て置き直す(開いている間はキャラを窓の下へ。開いた窓の高さはスマホで決め打ちにして、返事のたびにキャラが動かないようにする)。② スマホで開いた窓の高さは `calc(45dvh − 上の端 − --top-h − 20px)`(vh の行の後に dvh の行)。**framing.js の上の段の上限(画面の 45%)と同じ所で止めないと、上限で切られて頭が窓の下に入る**。③ 重なり順: `.top` z-index 5 > `.thought` 4。**切り替えは .top(position: fixed)の子なので、切り替えだけに z-index を付けても効かない(.top が重なりの箱を作る)。親の .top に付ける。** 開いた見出しの右は `body:has(#lookSwitch:not([hidden]))` で 172px 空ける。
- 結果(幅 390、GPU の Chrome): 直す前 窓の下の端 314・頭 219(重なる)・切り替え 3D/2D とも押せない → 直した後 窓の下の端 368・頭 395・切り替え押せて替わる(3D・2D とも)。キャラは開いている間だけ小さくなる(高さ 384 → 223px)。

## ?character= と ?place= は公開では id だけ(CRITsec F5)
- `web/src/character/urlSpec.js`: `pickSpec(値, { allowPath })`。id(`^[a-z0-9_]{1,32}$`)はいつでも読む。パス・URL はこのページをこの PC の中(localhost・127.0.0.1・[::1]・*.localhost)で開いた時だけ(`isLoopbackPage`。家の中の番号や tailnet の名前は誰でも持てるので「公開」と同じ)。読まなかった時は入口の `#gateStatus` に知らせ(書かれた値は写さない)、主役と試しの場所を出す。main.js は `?character=`(`?char=`)と `?place=` の両方をこれに通す。
- **公開の URL のまねは、Chrome を `--host-resolver-rules=MAP judge.test 127.0.0.1` で別に起こし、`http://judge.test:<port>/?character=<別の場所の URL>` を開く**(ページの名前が 127.0.0.1 でなくなる)。直す前は、外の place.json を取りに行って CORS で落ち、画面ごと「キャラを読み込めませんでした: Failed to fetch」。直した後は、外への通信 0・知らせ 2 行・ノリーが出る。`?character=yokoso`(id)は公開でも読める。

## 第 7 波の確かめの道具
- `node work\S5\tools\w7_check.mjs <web> <port> <出力> [--only gate,thought,reply,act,public,touch]`: 入口(390・PC。初めての訪問 → 7 歩 → あとで → 読み込み直して 2 回目)・考えの窓(390 × 3D・2D。開いた時の重なりと切り替え)・字幕(話し終わって 2.6 秒後に全部の文が出ているか)・表情と動き(英字が無いか)・公開の URL のまね・指でなぞる。直す前と後を同じ道具で撮り、json を比べる(この道具は合否を出さない)。GPU の札の中で。
- 新しい試験は、直す前の木の写し(`git worktree add --detach <写し> <前のコミット>`、新しい部品と試験だけ写す)で流して落ちるのを見る(第 7 波: 24 件中 6 件が落ちた)。写しは `git worktree remove --force` で消す。

## 声のサーバーの有無を読み上げに渡す(CRITux 25 の公開の側。2026-11-07 S5w7b)
- main.js の `refreshStatus()` は、`/api/status` を読んだ後(読めなかった時も)に `speaker.setServerVoice(Boolean(app.status?.tts?.available))` を呼ぶ(起動の 1 回と 15 秒ごと)。公開の URL(`/api/status` も `/api/tts` も無い)と声の鍵の無いサーバーでは、読み上げは初めから文字送りと「ピッ」で話し、`/api/tts` を 1 回も聞かない(console に 404 が出ない)。声の鍵のあるサーバーは今までどおり。読めなかった後にまた読めたら、この知らせで止めた分だけ戻す(429 などサーバーが答えた理由は残す。speaker.js の決まり)。
- 試験: 動きは S3 の `web/test/voice_server_off.test.mjs`、main.js の形は `web/test/place_server_voice.test.mjs`(直す前の main.js では 1 件落ちる)。画面では、鍵なしのサーバーで初めての訪問の 7 歩を 6 秒話させても `/api/tts` 0 回(下の first_visit_check が数える)。

## 撮影の前の用意(2026-11-07 S5w7b。撮影サーバー 8799)
- 順: 自分の線へ `git merge yurukyara-dev`(**合わせの後も司令塔のスキルのコミットで先へ進む。取り込んだ id を報告に書く**)→ CPU の札で `npx.cmd vite build`(サーバーは web/dist を配る。組み立て直さないと古い画面のまま)→ 確かめ(下)→ 撮影サーバー → https の入口。
- **default_check・layout_check・first_visit_check はサーバーを起こさない。** 道具ごとに空いた番号(8841〜8844 など)で鍵なしのサーバーを `start_server.mjs` で起こし、終わったらその PID だけを止める(続けて同じサーバーを使うと記憶の合鍵の上限で 429)。撮影サーバー(8799)では確かめを流さない(撮影の記憶のフォルダに試しの合鍵が増える)。https の入口だけは 8799 を通るので、流すと合鍵が 1 文脈に 1 つ増える(中身は空。7 日で消える)。
- **layout_check と default_check は `?auto=0` で開くので、初めての訪問の 7 歩は出ない。** 撮影の端末と同じ「何も付けない URL・初めてのブラウザ」は `node work\S5\tools\first_visit_check.mjs <web> <port> <出力> [--origin https://<スマホの入口>:8444]` で見る: 入口(製品の名前・7 歩の知らせ・7 歩はまだ出ていない)→「カメラなしで試す」→ 7 歩(7 つ・案内役ノリー)→ あとで(入口に戻らない・印 later)→ 読み込み直して 2 回目は出ない、と `/api/tts` の回数・404 の数。合否を出す(2/2 で合格)。
- 撮影サーバーの札: `machine_lock.py acquire --kind cpu --procs 1 --minutes 180`(手動の札は 180 分が上限)。**同じ who と kind でもう一度 acquire すると、その時から延びる**(新しい札は増えない)。`hold --watch-pid` は札の道具が前で待ち続けるので、裏で流せない時は使わない。

## 2D の板と見た目の方式(looks)
- `web/src/character/index.js` の `loadCharacter(url, { look, lookMemory })`: `?look=2d|3d` が先、次にこのタブで選んだ物(lookMemory = sessionStorage)、次に character.json の `looks.default`。3D の形(model)が無く 2D がある時は 2D。2D が読めない時は、3D があれば 3D に戻す(警告だけ)。返すキャラには `lookSource`(元の URL と character.json)が付く。
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
- 初めての会話と性格の画面(S4)は `boot()` の次で `firstRunReady = import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }))`(返り値の api を覚える。印の名前は S4 の `DONE_KEY` を使う)。#modes に「性格」「はじめての会話」が出る。`?onboard=1` で読み込んだ時に 7 歩。初めての訪問なら入口の後に main.js が `api.start()`(下の「入口」)。入口の LED(?led=1)では #modes ごと隠れる。
- S4 が 7 歩の途中で見本の子を読み込み直しなしで出し、終わったら主役に戻すための入口: `app.swapCharacter`(見た目の切り替えと同じ関数)と `app.readPersona(character)`(boot と同じ確かめで persona.md を読む。fetch の宛先の変数は `character.personaUrl` のまま。privacy の試験の決まり)。README の作る道の節へのリンクは index.html の `<link rel="help">`(S4 が href を読む。src の JS には http(s):// を書かない)。
- 上の段にボタンが増えると、引き出しが右へ押されて、開いた札が幅 390 で画面の右の外へはみ出した。幅 760 以下では `.drawer { position: static }` にして、札を上の段(.top、position: fixed)の左にそろえる。
- `?perf=1` は K6 の平らな 1 行を `PERF {...}` でコンソールに出す。commit は `VITE_COMMIT` を付けて組み立てた時だけ入り、measure-render.mjs が測った木のコミットで埋める。

## 画面を GPU の Chrome で確かめる時の落とし穴
- 入口のゲート(.gate)が画面を覆っている間は、下のボタン(引き出しなど)を押せない(Playwright の click が 30 秒待って落ちる)。先に `#startSim` を押す。
- はみ出しを数える時、閉じた details の中身にも Chrome は位置を返すことがある。`n.closest('details:not([open])')` の中は数えない(summary は数える)。開いた時は別に数える。
- 公開の URL のまねは、Playwright の `page.route` で `/api/status` を 404、`/api/chat` を K5 のまとめた JSON(`{brain, fallback, reason, notice, events, ms}`)にする。合言葉の欄が出ること・会話の見出し x-demo-pass に打った値が付き URL に無いこと・理由つきの知らせが 1 行だけ・返事・記憶の一覧の読み直し(GET /api/memory)を見られる。
- 鍵らしい文字の試しは、偽の文字を実行のときに組み立てる(例 `['ab','cd'].join('').repeat(12)`、48 字の英字)。/api/chat の本文に入っていないこと・短い知らせが出て消えることを見る。
- 点検の道具を `python -I` で流すと PYTHONIOENCODING が効かず、日本語が化ける。`python -I -X utf8 tools/prepush_check.py` で読める。
- (第 5 波)鍵の無いサーバーでは、あいづちの声が 0 種類で「あいづち」の札が出ず、上の札が 1 行のまま。本物のサーバーでは 2 行になって重なる。確かめでは「カメラなしで試す」の後に `window.__app.speaker.fillers = Array.from({ length: 5 }, () => ({ text: '', samples: new Float32Array(1), ms: 1 }))` で札を出す(板の道具 `work\S5\tools\layout_check.mjs` の `--fillers 5`。既定で出す)。
- (第 5 波)キャラの「見えている上の端」は、箱の 8 つの角を写すと遠近で角が上へ出る(PC で 40px ほど上)。確かめでは形の点(`getVertexPosition` で骨の動きも入る)を間引いて写す。見せ方の計算(frameCharacter)は箱で控えめに測ってよい。
- (第 5 波)1 つのサーバーに新しい文脈を続けて 10 回ほど開くと、記憶の合鍵を作る回数の上限(1 分あたり)で 429 がコンソールに出る。記憶を見ない確かめは `?memory=0` で開く。
- (第 5 波)GPU の札(--kind gpu)は、ほかの流れの動画の生成(--kind video)と同時に使えない。待つ間に CPU だけの仕事(試験・点検・コミット・札)を進める。Bash の道具は 10 分で裏へ回るので、長く待つ命令は裏で流し、終わりを待ってから報告する。
- (第 5 波)重なりと頭の位置と切り替えの確かめ: `node work\S5\tools\layout_check.mjs <web> <port> <出力> [--switch] [--only single|switch|others]`。幅 390・400・480・PC × 2D・3D で「覚えていること」が開くか・押せない所・44px 未満・頭のすき間・切り替えの有無、切り替え(押す → 読み込み直し → 戻す → 別の文脈)、ほかのキャラ(ようこそくん あり・みかんちゃん なし・ロボくん なし)を見て、絵と layout_check.json を出す。
