---
name: render-device
description: ゆるキャラの画面(3D と 2D の板)を「軽いのにきれい」にする手順。重さの測り(?perf=1・measure-render.mjs・K6 の 1 行)、CPU の描画(SwiftShader)で止める見張り、端末の段(tiers.js)、meshopt の解凍の共通の口、2D の板の読み込み(looks)、3D と 2D の見た目の切り替え(このタブだけ覚える)、キャラを上の段と下の帯の間に収める(スマホの幅で頭が段の下に入らない)、入口(製品の名前・主役・初めての訪問の 7 歩・本当の約束・指とマウスの言葉)、字幕に返事の全部を残す、「Claude の考え」の言葉と開いた時の置き直し、?character= ?place= は公開では id だけ、既定のキャラ(主役ノリー)、動きの意図(K2)、スマホの https の道と Quest の実機の道(USB)、IWER で VR を確かめる、main.js に他の流れの部品を付ける。使う場面 - 入口、ゲート、gate-up、初めての訪問、7 歩を出す、yc.onboarded.v1、カメラなしで試す、指でなぞる、touch-action、字幕が消える、最後の 1 文だけ、表情と動き、happy / bow、上の札の言葉、考えの窓が顔に重なる、切り替えが押せない、z-index、公開の URL、外の URL、id だけ、judge.test、見た目の切り替え、2D と 3D を切り替える、sessionStorage、上の段に重なる、頭が隠れる、耳が切れる、Claude の考えが重なる、覚えていることが押せない、44px、--top-h、frameCharacter、topGuard、重さを測る、最初のコマ、first_frame、読み込みの大きさ、遅い回線、--cold、--throttle、話す試験の口、mouth_max、fps、描く呼び出し、三角の数、スマホで重い、Quest で重い、端末の段、tier、SwiftShader、画面なしの Chrome で撮る、meshopt、KTX2、重さの表、2D の板、looks、?look=2d、既定のキャラ、主役、norrie、動きの意図、applyIntent、https の道、Quest、IWER、vr-check、quest-usb、記憶の札を付ける、初めての会話を付ける、スマホではみ出す、VR(Quest)で開く、QR、QR コードスキャナー、Quest で開く、questLink、segno、ウェブローンチ、Meta Quest に送る、Quest に送る、WEB_LAUNCH、open_url、許可する、許可の帯、没入体験を開く、requestSession が返らない、InvalidStateError、2 回押し、xrWait、modes.pending、マイクの許可を待たない、VR で見るの案内、仮の頭脳なので、参考の値、latencyNote、ノリーの呼び名、テレビ表示、テレビに映す、AirPlay、画面ミラーリング、?tv=1、tvMode、tv-mode、テレビで大きく、3 m 先から読める字幕、もどる、よこむき、tvTopLimit、tvBtn。
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

## キャラのいちばん上と上の段のすき間は、画面の高さの 6%(2026-11-07 S5w11c。本人「頭が切れちゃってる」)
- 起きた事: 動画 v0.8 の 0:08(PC 1280×720 の会話の画面)で、ノリーの耳が上で切れた。PC では上の段(左上)も「Claude の考え」(右)もキャラの横の範囲に重ならないので `topGuard` が 0 を返し、全身の見せ方(頭の上 9%)のまま耳が画面の上の端の近く(上から約 22px・上の段の下の端は 94px)まで出ていた。動画は上に帯(版の名前)を重ねるので、そこで切れて見えた。
- 気づけなかった訳: layout_check の「頭のすき間」は**キャラに横で重なる段**からの長さで、PC では重なる段が無いので画面の上の端からの長さ(35〜40px)を測っていた。決まりは「上の段の線(横いっぱい)から」で測る。
- 決まり(司令塔): どの場面でも(入口・初めての訪問の 7 歩の札を開いた時と閉じた後・話している時・手を振る・おじぎ・跳ねる、2D と 3D、作例の全部)、キャラのいちばん上(耳を含む)≥ 上の段の下の端 + 画面の高さの 6%。その中でキャラはできるだけ大きく。
- 直し方(framing.js・main.js・scene.js・rigRuntime.js):
  - `framing.js` の `TOP_CLEAR_FRACTION = 0.06`・`topClearance(viewH)`(小さくても 8px)・`topLimit({ bar, side, panels, left, right, clear, panelGap })`。上の段 `.top .chip, .top .top-row > *` は**横の位置にかかわらず**数える。スマホで段の下の行になる畳んだ見出し `#thoughtToggle` は横に重なる時だけ同じすき間。開いた窓(考え・QR の箱)は重なる時だけ 8px(自分で開いた物なので小さくてよい)。
  - `scene.js` の `frameCharacter` は前と同じ 2 回置き(1 回目の上の端が線より上なら、線から置き直す)。1 回目の上の端は、箱を**動きで上へ出る分だけ上へ伸ばして**から画面へ写す。
  - 頭の上の余白は `topPad(character.motionRise, 置き直しか)`: 置き直す時は「動きの出っ張り + 0.03」(下限 0.03)、置き直さない時は前の 0.09 より小さくしない。測れないキャラ(VRM・2D の板)は前の 0.09。足元の下は前の 0.09 のまま。
  - 遠近: 頭がキャラの真ん中の面より前にあると、帯の計算(真ん中の面)より上に写る(1 回目の確かめで、余白 0.09 の時に計算より約 13px 上)。置き直した後に、止まった形のいちばん上の点(`character.topPoints`、高い順に 40 点。読み込みで測る)を動きの分だけ上げて画面へ写し、線より上なら差の分だけ帯の上を下げて置き直す(2 回まで。scene.js の `pointsTop`)。箱の 8 つの角で確かめると、体の前の角が上へ出て(PC で約 40px)キャラが要らないほど小さくなる。
  - 動きの出っ張りは rig の読み込みで測る(`creator/viewer/rigRuntime.js` の `measureMotionRise`)。動き(idle・talk・一回きり)ごとに 12 の時刻を別の AnimationMixer で骨へ当て、止まった形の上の側の点(高い順の 60 点 + 間引いた 900 点)と全体から間引いた 300 点の高さを、骨の行列を時刻ごとに 1 回だけ作って自前で骨に乗せて測る(`getVertexPosition` は点ごとに行列を掛けて遅い)。終わったら mixer を止めて捨て、全部の節の位置・向き・大きさを戻す。結果は止まった形の高さに対する割合。
- 跳ねる子: ちょうちんくん・パネルくんの `jump` は止まった形より大きく上へ出る(1 回目の確かめで、余白 0.09 のままだと上の段の線より上へ 30〜66px)。決め打ちの余白ではどちらかが切れるか、全員が小さくなるので、キャラごとに測った出っ張りで決める。
- 落とし穴: three r187 の `Box3.setFromObject` は SkinnedMesh の `boundingBox` を最初の 1 回だけ計算して持つ(読み込みの時の止まった形)。動きは箱に入らない。形の点(getVertexPosition)で測る確かめも、その 1 コマだけ。**動きの間は描いた形で測る**。
- 結果(確認台、Intel UHD D3D11): 直す前 PC 1280×720 のノリー 3D −72px・2D −58px・390 の 3D 24px(決まり 51px)→ 直した後 52〜57px・70px・57px。キャラの高さ PC 3D 470 → 355px、390 3D 396 → 366px。動きの出っ張り: ノリー 0.029・ようこそくん 0.026・ロボくん 0.025・みかんちゃん 0.018・ちょうちんくん 0.401・パネルくん 0.395(jump。12 の時刻だけだと 0.385・0.379 で、パネルくんが PC で 1.2px 足りなかった)。測る時間 26〜103ms(読み込みの時に 1 回)。確かめ: ノリー 7 つの大きさ × 3D・2D 14/14・ほかの子 12/12・`YC_BROWSER_TESTS=1 npm test` 572/572・合わせの門の画面 12/12(話す・手を振る・おじぎの間も)。
- 測り方(本当に描いた形): `work\S5\tools\head_gap_check.mjs <web> <port> <出力> --set main|others|quick`(と layout_check.mjs の `r.silhouette`)。舞台のキャラだけを残して(`scene.traverse` でキャラの下でない Mesh・Points・Line・Sprite を隠す)、同じカメラで透明の `WebGLRenderTarget`(画面の CSS の大きさ)に描き、`readRenderTargetPixels` で alpha > 24 の行のいちばん上を読む(板の行 0 は下の端)。描く間だけ `renderer.xr.enabled = false`、終わったら描き先・消す色・隠した物を全部戻す。DOM に覆われていても形は測れる(画面の写真の差では、上の段に隠れた耳が測れない)。入口・7 歩の札を開いた時と閉じた後・話している間・`character.play('wave' | 'bow' | 'jump' …)` の間を 0.12 秒ごとに。
- **残り(S5w11e で見つけた。まだ直していない)**: 幅 390・3D で 7 つのステップの札を開いた時、上の段の線から 48px(画面の 5.7%、決まり 50.6px)。直す前の木(合わせ⑪c の木)でも同じ(同じ機械で交互に 3 回ずつ)。札が下半分を覆い、上の線と札の間の帯が `MIN_USABLE`(30%)より狭くなるので、キャラが帯の真ん中に画面の 30% の高さで置かれ、上へ約 3px はみ出す。直すなら `fitBand` で、帯が `MIN_USABLE` より狭い時は上の線にそろえる(はみ出しは札の裏へ)。落ちが「直しのせいか」は、開発の線の同じ木と交互に流して先に分ける。

## 見た目の切り替え(3D と 2D。2026-11-07 第 5 波)
- 3D と 2D の両方があるキャラだけ、上の段に `#lookSwitch`(「見た目」+「3D」「2D」の 2 つのボタン、aria-pressed、押す所 44px)を出す。スマホの幅では、畳んだ「Claude の考え」の見出しの右に `position: fixed` で置く(上の段の行を増やさない。考えを開いても切り替えは窓より手前で押せる。第 7 波)。AR(data-hide-in-ar)・VR の間・入口の LED・ヘッドセット・`?perf=1` では出さない。
- 両方あるかは `availableLooks(character)`(character/index.js): 3D は model があれば。2D は `looks.2d.parts` が文字(S2 の parts.json の場所)なら見に行かずにあり、`looks` はあるが `2d` が無い時は決まりの場所 `2d/parts.json` を 1 回 GET で見る(ノリーは合わせ⑤から looks.2d が書いてあるので見に行かない)(content-type が json の 200 だけ)。前の形(looks が無い。ロボくん・パネルくん・提灯くん)と、2d が部品の名前の並びだけ(みかんちゃん。板の部品の表が無い)は見に行かない(404 をコンソールに出さない)。
- 替える時は `loadCharacter(lookSource.url, { ...app.tierOverrides, look })` で読み、舞台の object3d を入れ替え、`app.character` と `dialogue.character` を替え、置き直す。読んだ物は Map に持ち、2 回目からはすぐ替わる。会話・記憶・人格の文はキャラの id が同じなのでそのまま。
- **舞台の子が替わるたびに作り直す(S5w9。S4 の頼み・CRITux2 高 1 の残り)**: `swapCharacter(next)`(見た目の切り替え・S4 の初めての会話の見本の子・案内役に戻す、の全部が通る 1 つの口)の最後と起動の最後で `refreshLookSwitch(next)` を呼び、今の子に合わせて出す・隠す・aria-pressed を合わせる。控えの鍵は `lookKey(id, look)`(`characterKey` = character.json の id。three を読まない looks.js)。**前は最初の子で 1 回だけ作り、控えの鍵が見た目だけだったので、見本の子(ようこそくん)で 2D → 3D と押すと最初の子(ノリー)の 3D が戻り、閉じた後のノリーで 2D を押すとようこそくんの 2D が出た。** 出せる見た目は子ごとに 1 回だけ調べて覚える。調べている間(2d/parts.json を見に行く子だけ)は隠し、調べ終わる前に子が替わったら古い答えは捨てる(回の番号)。押す受け口は 1 回だけ付ける。読んでいる間に S4 が子を替えたら、その子は替えない。URL の `?look=` を書き換えるのは最初に出した子の時だけ。S4 の `html.fr-guest #lookSwitch { display: none }`(見本の子の間は隠す)は、この作り直しが入った後に S4 が外す約束(外すまでは hidden 属性が S5 の決め・display が見え方)。
- 選んだ方は、このタブだけで覚える: `sessionStorage` の `yc.look.<character.json の id>`(読み書きは try/catch。使えないブラウザでは覚えないだけ)。順は `?look=` → このタブで選んだ物 → `looks.default`。`?look=` が URL にある時は、押した時に `history.replaceState` で選んだ方へ書き換える(読み込み直しても同じ)。別のタブ・新しい文脈では既定に戻る。
- 決まりは three を読まない `web/src/character/looks.js`(試験 `web/test/place_look_switch.test.mjs`。今の木のキャラの looks の形と、index.html・style.css の形も見る)。
- **今の木のキャラを見る試験は、読んだ character.json から期待を作る(決め打ちしない)。** character.json はほかの流れ(主役・S1)の持ち物で、合わせの順で先に変わる。2026-11-07 合わせ⑤: 主役の流れがノリーの looks に `2d` を足しただけで、文字のぶつかり 0 のまま `'probe'` の決め打ちが落ちた(意味のぶつかり。382 件中 1 件)。直し方は「looks.2d があれば `'yes'`・無ければ `'probe'`」。決まりの答え(主役は 2D を出せる)は残し、形の違いだけを読んで合わせる。試す前に、looks.2d を外した写し(structuredClone して delete)でも期待と looks.js の答えが合うのを 1 行の node で見る。

## 入口(ゲート)と初めての訪問(2026-11-07 第 7 波。点検 CRITux 2・10・15・24)
- 入口のカードは「ゆるキャラクリエイター」(title も)・案内役(主役なら「案内するのは主役のノリー。協力者が手で描いた、セスジキノボリカンガルーの執事見習いです」、ほかの子ならその子の名前)・本当の約束(声が使える時だけ「声と文字で答えます」、それ以外は「文字で答えます。声は、声の鍵があるときだけ出ます」。決めるのは `/api/status` の `tts.available` を読んだ後の `fillGate()`)。公開の URL には読み上げの関数が無いので、声は使う人の鍵(7 歩目)だけ。
- **案内役の 1 行は、キャラを読んだすぐ後に書いてから見せる(S5w9。M8b 4)**: boot で `app.character = character; app.characterId = id;` と同じ流れ(await を挟まない)で `fillGuide()` を呼び、主役でない子ならその子の名前を textContent で書いて、`<html>` に `guide-ready` を付ける。それまでは `html:not(.guide-ready) .gate-guide { visibility: hidden }`(場所は空けたまま。JS が来る前も効く)。前は状態(/api/status)を読んだ後の fillGate で書いていたので、`?character=mikan` を遅い端末(内蔵 GPU の PC・CPU 6 倍遅いまね)で開くと HTML の初めの文「案内するのは主役のノリー…」が先に見え、練習の道具も読み急いだ。**道具は textContent で読むので、見えない間も文は残る。見え方は visibility まで見る。**
- **入口が開いている間は、上の段と「Claude の考え」を隠す**: `<html class="gate-up">`(JS の前から効く)と `html.gate-up:not(.fr-open) .top, … #thought { visibility: hidden }`。visibility なので高さの測り(--top-h・topGuard)は変わらない。外すのは `gateClosed()` だけ(#startSim・#startCam が通った時)。S4 の 7 歩が入口を消して出ている間(`html.fr-open`)は出す。前は入口の板の裏で 9 個が見えるのに押せなかった。
- **初めての訪問なら、入口を閉じた直後に 7 歩**: `web/src/stage/firstVisit.js` の `shouldOpenFirstRun({ params, storage: localStorage, doneKey, headset })`。印 `yc.onboarded.v1`(S4 が「終えた」「あとで」で書く)が無ければ出す。出さない: `?onboard=0`・`?onboard=1`(読み込んだ時に出ている)・**`?auto=0`(確かめの道具が付ける。web_talk_check・talk-through・measure-render・layout_check は付けているので変わらない)**・LED・自動で始める・ヘッドセット・`?perf=1`。覚える所が使えないブラウザは初めてとみなす。S4 の startOnboarding は 2 回目を何もしないので、S4 が自前で出しても重ならない。
- ボタンの言葉: 何をするか(大)+どう動くか(小、`.btn-sub`)。カメラは「カメラを使って始める」(マイクを言わない。マイクは「声で話す」の時だけ、と下の注に書く)。カメラなしは「カメラなしで試す」のまま(**web_talk_check.mjs などが `getByText('カメラなしで試す')` で押すので、この言葉は残す**)+スマホ「画面を指でなぞると、その向きを見ます」/PC「マウスを動かすと、その向きを見ます」(`matchMedia('(pointer: coarse)')`)。下の注と上の札も同じ言葉。
- **指でなぞる向きを本当に効かせるには、舞台に `touch-action: none`**。無いと、Chrome のタッチ(CDP の `Input.dispatchTouchEvent` の touchStart → touchMove)で SimSource の faces が 0 のまま(直す前 0 → 直した後 1)。
- 上の札の言葉(CRITux 18): 「人 0」→「見えている人 0 人」、カメラの道「GPU 60fps」→「オン」、カメラなし「マウスで試し中」→「なし」(tracking/ の info の言葉は持ち主が無いので、main.js の updateChips で言い換える)。考えの下は「返事が始まるまで 0.3 秒(仮の頭脳なので、参考の値)・目安は 1.2 秒以内」(後ろの一言は第 11 波から仮の頭脳の回だけ。下の第 11 波の節)。札の文字を長くすると幅 390 で 3 行になりキャラが小さくなるので、短い言葉にする(2 行のまま)。

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
- 主役は自分のことも「ノリー」と呼ぶ(11/7 本人。伸ばす棒の無い呼び名は書かない。呼び名でない言葉・id の norrie・ファイルの名前はそのまま)。試験の見本の文は、S3 の人格の文の直しと同じ形で、呼び名の所だけを伸ばす棒つきの「ノリー」に替える(文のほかは替えない。文字送りの途中を探す所も同じ)。自分の場所の確かめは `git grep -n -P "\x{30CE}\x{30EA}(?!\x{30FC}|\x{30CE}\x{30EA})" -- <自分の場所>` で 0 件(式に呼び名をそのまま書くと、その行が自分に当たるので、文字の番号で書く)。
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
- S4 が 7 歩の途中で見本の子を読み込み直しなしで出し、終わったら主役に戻すための入口: `app.swapCharacter`(見た目の切り替えと同じ関数)と `app.readPersona(character)`(boot と同じ確かめで persona.md を読む。fetch の宛先の変数は `character.personaUrl` のまま。privacy の試験の決まり)。README の作る道の節へのリンクは index.html の `<link rel="help" hreflang="ja">` 1 つ(S4 の readGuideUrl が hreflang="ja" を先に読み、そのまま開く。src の JS には http(s):// を書かない)。第 9 波から README.md が日本語なので、行き先は `…/blob/HEAD/README.md#自分の-pc-でclaude-code-と自分のキャラを作る`(見出し「自分の PC で、Claude Code と自分のキャラを作る」の GitHub の印。英字は小文字・「、」などの記号は消す・空白は「-」。S6 は見出しの文字を変えない約束。英語の印 `<a name="make-your-own-character-on-your-pc-with-claude-code">` も両方の README にある)。リンクの形は `web/test/place_first_visit.test.mjs` が見る。README と印が合うかは S6 の `work\S6\w9\readme_anchor_check.mjs <木>`(3 本の仮の合わせの木で 56/56)。
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

## 「VR(Quest)で開く」の QR(2026-11-07 第 10 波。本人の案)
- **作る前に公式を読む**: Meta のリリースノート(meta.com/help/quest/172903867975450)の Horizon OS v2.9(2026-10-19 の週から順に配る。PTC は 9-28 の週)に、Quest 3・3S の QR コードスキャナー(クイック設定・カメラのアプリ・検索・声で開く)。**読み取った URL をどう開くかは書いていない**(実機で確かめる)。別の端末のブラウザから Quest のブラウザへ https の URL を送る公式の入口は「ウェブローンチ」(developers.meta.com の Web Launch。`oculus.com/open_url/?url=<URL エンコード>`)。リリースノートの頁は畳みの中身を JS で出すので WebFetch では読めない(ブラウザの道具で開き、版の見出しの + を押してから本文を読む。言語を選ぶ小窓は「Cancel」)。
- 入口: 上の段の `#questLink`(index.html。ボタン 44px、言葉は QR の印と「VR」だけ、aria-label と title は「VR(Quest)で開く」、箱の 1 行目にも出す)→ `#questLinkBox`(.top の子、absolute)に QR と URL。**上の段に足す物は幅 60px 足らずに保つ**: 長い言葉(約 150px)にしたら、PC 1280 で見た目の切り替えがキャラの横の範囲(ノリーは左の端 約 530px)まで押し出され、topGuard でキャラが段の下へ置き直されて 2 割小さくなった(頭の上の端 36 → 133px。layout_check の PC の「上の段の下」が 0 → 94 になったので気づいた)。決まりは three も DOM も読まない `web/src/stage/questLink.js`(`questLinkPlan`・`questTarget`・`isPrivateHost`)、部品は `ui/panel.js` の `mountQuestLink`、つなぐのは main.js の `setupQuestLink`(見せ方を調べた後。immersive-vr が使える・ヘッドセット・LED・自動で始める・`?perf=1` では出さない)。幅 390 で上の段は 1 行のまま(性格・はじめての会話・覚えていること・VR)。
- QR に入れるのは `origin + pathname` と、id の形の `?character=`(主役で URL に無い時は付けない)と `?look=`(両方の見た目がある子か、URL にある時)だけ。合言葉・番号・鍵・ほかの ? と # は入れない。この PC・家の中のアドレス(localhost・*.localhost・127/8・10/8・172.16/12・192.168/16・169.254/16・100.64/10・fc00::/7・fe80::/10・.local・.internal・.lan・.home.arpa・点の無い名前)では QR の代わりに 1 行。*.ts.net はだれでも公開の名前を持てるので公開と同じ扱い。
- 重ならない形: 箱は `.top` の左下に absolute(absolute の子は `.top` の高さ = `--top-h` を変えない)。`max-height: calc(45dvh − 上の端 − --top-h − 22px)` と QR の大きさ `clamp(96px, min(44vw, 45dvh − 上の端 − --top-h − 64px), 186px)`(PC は 220px まで)で箱の下の端を framing.js の上限(45%)より上に止め、TOP_GUARD に `#questLinkBox:not([hidden])` を足して ResizeObserver で置き直す → キャラは箱の下(PC は横に重ならないので動かない)。「覚えていること」とは同時に開かない(開いた方がもう一方を閉じる)。7 歩の札(`html.fr-open`)の間は CSS で隠し、MutationObserver で閉じる。閉じるのはボタン・箱を押す・外(document の pointerdown を捕まえる)・Escape(ボタンへ戻る)。
- QR は画面の中で作る: `web/src/stage/qrCode.js`(バイトの形・誤りの直し M・版 1〜10・自動のマスク)。初めて開いた時に `import()` で読む(別の塊 4.8KB・gzip 2.2KB)。SVG は DOM で作り、文字は textContent だけ。
- **segno の見本と同じマスにする落とし穴**: ① 語の区切りまでの 0 を、ちょうど区切りの時も 8 つ足す(segno の write_padding_bits。入る数を超えた分は捨てる。読む側は終わりの 0000 で止まるので、どちらでも同じ文に読める)② マスクの点は、形式の情報・版の情報の所と暗いマスを明るい(0)まま数え、同点は番号の小さい方 ③ segno は `boost_error=False`(既定は誤りの直しを勝手に上げる)・`mode='byte'`・UTF-8 のバイトを渡す。違った時は segno の `encoder.evaluate_mask` と `make_final_message` を差し替えて、中の点と語を書き出して比べる(1 件目で語の並びの違いが出た)。見本は `web/test/vr_qr_segno.json`(作り方 `vr_qr_segno_make.py`、npm test は Python を使わない)。
- **画面のコードに `http(s)://` の文字を書くと web/test/privacy.test.mjs が落ちる**(コメントは数えない。持ち主は S5 でない)。SVG の名前空間(w3.org)も当たるので、index.html のボタンの印の `<svg>` の `namespaceURI` から読む。ウェブローンチの入口は、第 11 波で本人の答えにより画面に入れた(questLink.js の `WEB_LAUNCH` の 1 か所だけ。privacy の試験の例外 1 行と組。下の第 11 波の節)。
- 確かめ: 板の `work\S5\tools\vr_qr_check.mjs <リポジトリ> <出力>`(確認台。公開の URL のまねは `--host-resolver-rules=MAP yuru.test 127.0.0.1` の `http://yuru.test:<番号>`。http は安全なページでないので `navigator.xr` が無い → immersive-vr のまねは `addInitScript` で `Navigator.prototype.xr` の getter)。上の段の行を比べる相手は「見えている」押す所(`?memory=0` では「覚えていること」が隠れて上の端が 0 になる)。QR の絵は要素ごと切り出し、手元の PC の OpenCV(`work\S5\tools\qr_decode.py`、cv2.QRCodeDetector)で読み返して期待の URL と比べる(画面の中の作り方と別の読み手)。

## 「Meta Quest に送る」と、VR・AR の「許可する」待ち(2026-11-07 第 11 波。本人の答えと実機の Quest 3)
- **「Meta Quest に送る」(公式のウェブローンチ)**: 公式の頁 developers.meta.com/horizon/documentation/web/web-launch(2026-07-22 更新。WebFetch で読めた)の決まり = 入口 `https://www.oculus.com/open_url/` に、送る https の URL を `url=` で(例の JS は `new URL(入口)` → `searchParams.set("url", target)`)・**https だけ**・押す所に Meta Quest の名前。ログインや組の要否は頁に無いので、画面にも README にも言わない。作り: `questLink.js` の `WEB_LAUNCH`(画面のコードの外の住所はこれ 1 つ)と `webLaunchUrl(target)`(https でない・名前と合言葉・# は null)。`questLinkPlan` は https の時だけ `launch` を返す(この PC・家の中のアドレス・Quest の中・http では無い = QR と同じ所で隠れる)。panel.js の `sendLink` は `<a class="ql-send">` を textContent で作り、`target="_blank"`・`rel="noopener noreferrer"`・`referrerPolicy="no-referrer"`(Referer にこの頁の URL = 合言葉や番号が入りうる物を載せない)・押しても箱を閉じない(click で stopPropagation。箱の click は閉じる決まりのため)・44px。
- **privacy.test.mjs(持ち主 S3)の例外と組で入れる**: 試験の正規表現が拾う文字は引用符の手前まで = ちょうど `https://www.oculus.com/open_url/`(`?url=` を文字に足さない)。S3 が `EXTERNAL_OK` に `'stage/questLink.js': 'https://www.oculus.com/open_url/'` の 1 行。**S5 だけを入れると 1 件落ちる**ので、札と頼みの紙(`work\S5\頼み_S3_w11.md`)に文字そのものを先に書いて渡す。自分の確かめは、試験の写しを板の一時のフォルダに置き、SRC を自分の木の src に向けて例外の行を足したまねで流す(リポジトリの試験は書き換えない)。S5 の試験(vr_qr_link)も「questLink.js のコードの外の住所は WEB_LAUNCH だけ」を見る。
- **https の公開のまね(TLS なし)**: Playwright の `context.route('https://yuru.test/**')` で、Node の `fetch` で手元の http のサーバーから取った答えを `route.fulfill({status, headers, body})` で返す(`route.fetch({url})` は同じ scheme しか替えられない。Node の fetch は圧縮を解くので content-encoding・content-length の見出しを外す)。https なので `navigator.xr` があり、XR の実行環境がある PC では immersive-vr が使えると答えて入口が隠れることがある → `addInitScript` で `Navigator.prototype.xr` を undefined(iPhone の Safari と同じ扱い)。`https://www.oculus.com/**` も route で止めて小さな頁を返し、押した時の新しいタブの URL と Referer の有無を見る(外へ出ない)。道具 `work\S5\tools\vr_w11_check.mjs`(第 10 波の vr_qr_check.mjs に send_<幅>・send_click_390 を足した版。幅 390・400・480・PC・PC の高さ 670。長い名前の公開の URL のまね `https://<長い名前>.example`(.example は名前が引けない決まりの名前)でも、URL が折り返して「Meta Quest に送る」が箱の中を送らないと見えない形にならないかを見る。PC の箱の文字の列は 260px(220px では、高さ 670 の PC で長い URL の時に箱の上限 45% を越える見込みだった))。QR の読み返しは `work\S5\tools\qr_decode_w11.py <出力>`(OpenCV。期待は json の expected か target)。
- **VR・AR の「許可する」待ち**: 実機の Quest 3 は、押すとブラウザの下に「…ジェスチャーコントロールとボディトラッキングを使用した没入体験を開くことを許可しますか? [許可しない] [許可する]」の帯を出し、答えるまで `requestSession` が返らない(エラーも時間切れも無い)。もう一度押すと `InvalidStateError: There is already an active, immersive XRSession.`。IWER のまねでは出ない。直し: modes.js の `enter` は頼んでいる途中なら同じ約束を返す(`modes.pending`)。modeButtons.js は押した時から、入るか断られるまで全部のボタンを disabled・aria-busy にして `onWait(mode)` → main.js が `#xrWait`(画面の真ん中、`XR_WAIT_TEXT`「ブラウザの下の『許可する』を押してください」、ヘッドセットでは 30px)。入った・断られた時に `onWait(null)`。断られた時(NotAllowedError・SecurityError)は「VR に入れませんでした(ブラウザで許可されませんでした)」。iPhone の殻の AR(ar_kind native)はブラウザが聞かないので出さない。
- **ヘッドセットの「VR で見る」の案内はマイクの答えを待たない**: 実機で、マイクの許可の窓に答えないと `listener.start()`(getUserMedia)が返らず、案内が出なかった。`ui.align(VR_GUIDE)` を `await toggleMic()` の前に出し、答えの後は「まだ案内が出ている・VR を頼んでいない・画面のまま・マイクが使えなかった」時だけ「マイクなしで進めます。…」に替える。VR を頼んだら上の案内は消す(真ん中の知らせだけ)。入口の前の帯は、ヘッドセットなら「マウスの向きに」でなく位置の文。
- **まねで確かめる(IWER の門)**: init script で IWER を入れた後、`navigator.xr.requestSession` を包み、本物の頼みは押した時に出して答えだけ止める(`window.__xrq.allow()`・`deny()`。頼んだ回数を数え、本物の頼みの InvalidStateError も拾う)。`navigator.mediaDevices.getUserMedia` も同じく門にする(`window.__mic.allow()`・`deny()`)。聞き取りの部品(faster-whisper)の無い確認台では `/api/status` の stt が無いので、route で `stt.available` だけ true にして返す(ヘッドセットはサーバーで聞き取る道)。そういう確認台では、scripts/vr-check.mjs の 19 項目のうちマイクの 2 つ(「入る前: マイクが 2D の画面で許可され…」「出る: …マイクは続く」)は直す前の木でも落ちる(機械の違い。直す前の木で同じ 2 つが落ちるのを見てから言う)。画面は Quest のブラウザの窓と同じ 1280×670。道具 `work\S5\tools\xr_wait_check.mjs`(wait_vr・deny_vr・wait_ar・mic_denied)。
- **確かめていない事を画面で言わない**: QR の横の文 `SCAN_HOW` は「…で、この画面の URL を読み取れます。」(読み取った後に Quest のブラウザで開くかは公式に無く、本物の Quest でも未確認。README の同じ所も【確かめ待ち】)。本物の Quest で開くのを確かめたら「開きます」に戻してよい(試験 vr_qr_link が「開きます」を止めているので、その 1 行も一緒に直す)。
- **「返事が始まるまで」の後ろの一言**: panel.js の `latencyNote(entry, { fakeBrain })`。「(仮の頭脳なので、参考の値)」は記録の brain が mock の回か、記録に brain が無く会話のイベントで仮と分かった回だけ。本物の頭脳が声なしで答えた回は付けない(前は `valid`(本物の頭脳と声)でない回は全部「仮の頭脳か声なしなので」で、本物の Haiku の録画にも出た)。声の有無は上の札「声」が出す。

## GPU の機械が埋まっている時は、別の機械の確認台で確かめる(2026-11-07 S5w9)
- 確認台の repo は読むだけ。そこから自分の写しを作る(`git clone --no-checkout <確認台の repo> <写し>`、node_modules は確認台の物へジャンクション、`web\public\mediapipe` は写す)。新しいコミットは `git bundle create x.bundle <確認台にある頭>..<線>`(差分だけ。100KB ほど)→ scp → 写しで `git fetch <bundle> <ref>:refs/remotes/<名前>/tip` → checkout。直す前の木も別の写しにすると、同じ道具で前と後を比べられる(命令の形は板の S5 の第 9 波の道具: setup の ps1・run の py)。
- .ps1 は UTF-8 の BOM を付ける(Windows PowerShell 5.1 は BOM の無い日本語を化かす)。ssh の命令に `$` も `&` も書かない(確認台の ssh は PowerShell 5.1。台本の中に書き、scp で送って `-File` で動かす)。
- bundle の土台は、確認台の repo に本当にあるコミットにする(`git cat-file -e <id>^{commit}` を台本で確かめる。第 10 波では確認台の repo の頭が d3a2f9c で、b702004・c30e6d3 は無かった → `d3a2f9c..<線>` で 160KB)。
- 札は `machine_lock.py run --machine <確認台> --kind cpu --procs 4 --who <流れ> --job <中身> --minutes 50 --wait 45 -- ssh -n -o BatchMode=yes <確認台> "python -X utf8 <台本>"`(ほかの流れが使っている間は順番を待つ。終わると自動で返る)。描画役は内蔵 GPU の D3D11(SwiftShader ではない)。所要: 組み立て 2 秒・w9_check 43 秒・layout_check 58 秒・`YC_BROWSER_TESTS=1 npm test` 65 秒。
- 遅い端末のまねは CDP の `Emulation.setCPUThrottlingRate`(6)。見え方の確かめは、開く前に `page.addInitScript` で requestAnimationFrame ごとに(描くたび)要素の visibility と textContent を記録する(MutationObserver は描く前にも動くので、人に見えた物と合わない)。直す前の木で落ちるのを先に見る(S5w9: ノリーが 806ms・838ms に見えた)。
- 3 本の仮の合わせ(参照を動かさない): `T1=$(git merge-tree --write-tree A B)` → `C1=$(git commit-tree $T1 -p A -p B -m tmp)` → `T2=$(git merge-tree --write-tree $C1 C)` → `git archive $T2 | tar -x -C <板の一時のフォルダ>` → node_modules をジャンクションで借りて `node --test`。**消す前にジャンクションを `cmd /c rmdir` で外す**(外さずに消すと、借りた先の中身まで消える)。

## テレビ表示と「テレビに映す」(2026-11-07 S5w11e。本人「iPhone にあるものを AirPlay で、テレビにすぐパンって映せるようにしたい」)
- **ウェブの頁は画面ミラーリング(AirPlay)を自分では始められない**(頁から呼べる口が無い)。画面がするのは 2 つだけ: ① 大きく見せる「テレビ表示」(`html.tv-mode`。上の段のボタンか `?tv=1`)② iPhone・iPad で手順を見せる「テレビに映す」(コントロールセンターをひらく → 「画面ミラーリング」をおす → テレビをえらぶ。子どもにも読める言葉と、大きな「テレビ表示にする」)。手順の言葉は Apple の公式の頁(support.apple.com/ja-jp/102661「AirPlay を使って iPhone や iPad からビデオをストリーミングする/画面をミラーリングする」、2026-05-20 公開。11/7 に WebFetch で読んだ)と同じ: 新しい機種は右上の隅から下へ・古い機種は下から上へ →「画面ミラーリング」→ リストからテレビ → テレビに出たパスコードを入れる → やめる時は同じ所の「ミラーリングを停止」。頁の住所は画面のコードに書かない(privacy の試験)。
- 決まりは three も DOM も読まない `web/src/stage/tvMode.js`(`tvPlan`・`appleMobile`・`tvCaptionPx`・`tvBottomReserve`・`castSteps`・`castNote`)。iPadOS 13 からの Safari は Mac と同じ名乗りなので、**`navigator.maxTouchPoints > 1` の Mac を iPad とみなす**。iPhone の中のほかのブラウザ(CriOS など)も手順は同じ(OS のコントロールセンター)。ヘッドセット・`?led=1`・`?autostart=1`・`?perf=1` では出さず、`?tv=1` も読まない。`?tv=1` では 7 つのステップの札を自分から出さない(firstVisit.js の NO_AUTO)。
- **上の段を隠すと、11c の前と同じく topGuard が 0 になり耳が画面の上の端まで出る**: テレビ表示の線は framing.js の `tvTopLimit`(上の段が無くても画面の上の端から 6%。隅の「もどる」・縦持ちの一言はキャラの横に重なる時だけ、その下から)。
- 字幕は画面の高さの 6%(3 m 先・50 型(画面の高さ 約 62cm)で 約 3.7cm = 見る角度 約 0.7 度。下限 24px・上限 120px)。キャラの下に字幕 2 行分 + 箱の余白 + 下の端の間を `stage.state.bottomInset` に足す(main.js の `fitBottom`、テレビ表示の時だけ。`--tv-cap` も入れる)。箱は 3 行まで、前の文(cap-prev)は出さない。
- 全画面は**押した時(使う人の操作の中)だけ**頼む(上の段のボタン・「テレビ表示にする」・`?tv=1` の入口のボタン)。iPhone の Safari には要素の全画面の口が無い(無ければ何もしない)。`screen.orientation.lock('landscape')` は全画面の中でしか効かない端末があるので、全画面の後に試して断られても何もしない。縦持ちは CSS の `@media (orientation: portrait) and (pointer: coarse)` で「よこむきにすると、テレビに大きくうつります」。
- 入力の帯を隠すので、**声で話すなら先にマイクのボタン**(マイクは押した時だけ使う約束。勝手に入れない)。手順の箱の注意に 1 行。注意書きは、カメラかマイクを使っている間は残す(`.privacy.off:not(.mic)` を隠す。`.mic` は updatePrivacy が聞き取りの間に付ける)。
- 上の段にボタンを足す時は、**幅 390 で上の段の行が増えないか**を、本物と同じ「覚えていること」ありの形でも測る(`?memory=0` では「覚えていること」が隠れて行に余りがあり、1 回目の確かめでは通った。覚えていることありでは 1 行増えて上の段が 114 → 166px)。直し: 幅 640 までは入口を `position: fixed` で、畳んだ「Claude の考え」の見出しと同じ行・見た目の切り替えの左へ(右の位置は main.js の `placeTvButton` が切り替えの幅を ResizeObserver で測って `--tv-right`)。幅 420 までは切り替えの飾りの字「見た目」を隠して見出しとのすき間を空ける(幅 390 で見出しの字の右 127px・入口の左 200px)。考えを開いた時の見出しの右の空け方(`padding-right`)も入口の分を足す(同じ強さの `:has` の決まりは後ろが勝つ)。見せる言葉は幅 640 まで「テレビ」、それより広いと名前(「テレビ表示」・「テレビに映す」)。
- **見出しの行に置いた物は、上の線(TOP_BAR)でなく TOP_SIDE(横に重なる時だけ)で数える**: 横いっぱいに数えると、見た目の切り替えが無い子(作例)でその行が線になり、キャラが 1 行分下がる。
- 確かめの道具: 板の `work\S5\tools\tv_check.mjs <web> <port> <出力>`(サーバーは呼ぶ側が起こす)。PC 1920×1080・1280×720 は上の段から と `?tv=1` から、Android 390、iPhone 390(覚えていることあり・なし)・iPhone 横 844×390 は「テレビに映す」→ 手順 →「テレビ表示にする」、ヘッドセットのまね(`?headset=1&tv=1`)。描いた形(キャラだけを透明の板に描いて alpha を読む)で、大きさ(PC は画面の高さの 55% 以上)・上のすき間 6%(話している間も)・字幕の字 6%・字幕が顔を隠さない・「もどる」で元の置き方に戻る、幅 640 までは入口が見出し・切り替え・上の段と重ならない(考えを開いても)、を見る。入力の帯は隠れていても `composer.requestSubmit()` で話せる。
- **真ん中は、キャラの原点(足元の真ん中)を画面へ写して見る**: しっぽのある子(ノリー)は描いた形の箱の真ん中が片側へ 17px(幅 390 の 4.4%)ずれ、「箱の真ん中が幅の 3% 以内」は落ちた。原点は 0px(カメラは原点を見ている)。箱の真ん中は 6% 以内で見る。
- 結果(GPU の機械の下見と確認台): PC 1920×1080 でノリーの高さ 約 710px(画面の 66%)・上のすき間 82〜96px(7.6〜8.9%)・字幕 65px、1280×720 で 約 465px(65%)・すき間 55〜64px・字幕 44px、iPhone 390 で 約 500px(59%)・字幕 51px、iPhone 横 844×390 で 243px(62%)・字幕 24px。
- **確かめのサーバーの番号を決め打ちしない**: 8871 を、1 回目の後(18:45)に別の処理(ほかの流れ)が取っていて、2 回目は自分のサーバーが EADDRINUSE で起きず、全場面が「キャラが出ない」で落ちた。台本で空いた番号を OS に選ばせる(PowerShell は `[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)` → `.LocalEndpoint.Port`)。人の処理(番号を持つ PID)は止めない。

## 第 12 波の直し: VR の声かけ・スマホの声の失敗・横の端・札の上(2026-11-07 S5w12。V1・Q3・P1・L1・CRITsec3)
- **VR の声かけ**: ヘッドセットでは「見ている人」= Quest の頭で、VR の間ずっと 2.2 m 以内にいる。「近づいたら声をかける」の冷却 90 秒だけだと、居るだけで 90 秒ごとに名乗り直す(実測 3.5 分で 3 回)。直し: ① `talk()` の入口で、どの入口(文字・声・ボタン・近づき・トリガー)の会話でも `presence.greetedAt` と `lastTalkAt` を書く ② VR(`xr.isPresenting && modes.mode === 'vr'`)に入った時だけ `vrGreetPending = true`(1 回で下ろす・入り直せばまた 1 回)③ 声をかける条件に「本人の声を聞いている間(voiceActive・transcribing)でない」「最後の会話から 60 秒」。時計は `performance.now()/1000` にそろえる(XR の rAF の時刻とは基準が違う)。
- **トリガー**: マイクが聞いている間は何も送らない(`onVrSelect` が `listener.listening` なら return)。マイクが使えない時だけ「こんにちは」を送り、板の状態の言葉に「マイクなし(トリガー = こんにちは)」と出す。
- **試しの場所は送らない**: `?place=` が無い時の `SAMPLE_PLACE`(受付・スタッフの部屋)と VR の中は、会話に `place: undefined` を渡す(サーバーの validate は `{}` に直す)。「スタッフさんに聞いてみて」の元だった。
- **声かけの回は前の返事を空にする**: 声かけ(`trigger: 'approach'`)は dialogue が `userSaid` を呼ばないので、`replyParts` が前の回の後ろに足されて板に同じ文が 6 回出た。`talk()` で `ui.userSaid('')` を先に呼ぶ。VR に入る時も板の `user/reply/error` を空にする。
- **「許可する」の知らせは遅らせて出す**: 許可を覚えた端末は 0.4 秒で VR に入るので、押してすぐ出すと一瞬だけ出て消える。`mountModeButtons({ waitDelayMs: 900 })` で、900ms たっても入れない時だけ出す(試験は 0 を渡して従来どおり)。
- **`.gate button` の `display: grid` は `[hidden]` に勝つ**: ヘッドセットで `startSim.hidden = true` にしても「カメラなしで試す」が見えていた(属性だけ見る vr-check は通る)。`.gate button[hidden] { display: none; }` を足す。ほかの `hidden` を使う所も、`display` を書いた規則と同じ詳しさで `[hidden]` の規則を持つ。
- **声で話すが失敗した時は、字幕の上の `#uiNotice` に日本語で**(畳まれた「Claude の考え」の中でなく): `stage/micNotice.js` の `micUnavailableText`(https でない・mediaDevices が無い。押す前に言う)と `micFailureText`(NotAllowed・NotFound・NotReadable・日本語の文はそのまま・それ以外は決まった文。英語の `err.message` は出さない)。どれも「文字ならこのまま話せます」と添える。
- **入口のボタンは HTML で最初から `disabled` + 「読み込んでいます…」**: JS が動くまで(遅い 4G で約 7 秒)押せそうで押せない。`boot()` の最後で `camSub` を戻して有効にする。
- **スマホの文字は 14px 以上**(S5 の style.css は 10〜13px を 14px へ。S4 の styles.js は別)。幅 320 の入力の列が 343px になったのは `.bottom` が `display: grid` で列が中身の幅まで広がるため: `grid-template-columns: minmax(0, 1fr)`。左右の安全域は `max(12px, env(safe-area-inset-left/right))`。低い画面(高さ 500px 未満。横向き・キーボードで縮んだ画面)は上の札の列・注意書き・よくある質問を隠し、字幕は 2 行まで。
- **羽・腕が横の端で切れる(幅 390・430 のちょうちんくん)**: `halfWidth` は箱の真ん中の面での幅。遠近で手前に出た羽の角は画面ではもっと広く写る。`frameCharacter`(全身)の最後に、箱の 8 つの角を画面へ写して左右 1.5% より外に出る時は `wScale` を広げて置き直す(最大 3 回。小さくなるだけなので頭のすき間は広がる)。
- **字幕・札の余白**: 下の帯の上に出る字幕と札の分は、80px 固定でなく画面の高さの 16%(96〜140px)。スマホで「はじめての会話」の札(`.fr-sheet`・下から出る・幅 720 未満)が開いている間は、札の上の端までを下の限りにして、見本の子を札の上に全身で出す(`cardInset()`。札の大きさは ResizeObserver で見る)。タブレット(幅 641〜1180)の開いた「Claude の考え」は画面の高さの 30% まで(長いと子が窓の下へ押されて小さく低くなる)。
- **`*.ts.net` は QR にも Meta へ送るリンクにも出さない**: 機械と tailnet の名前が出る。`isPrivateHost` に `ts.net` を足す(1 行のまま)。撮影で箱を映す時は公開の URL か例の名前で開く。
- **試験の見本の住所は、その場で組み立てる**: 公開前の履歴の書き換えの規則が、書いたままの 192.168.… や `<名前>.tail<16進>.ts.net` を伏せ字に言い換え、試験が落ちる(S6 の patch)。`const ip = (...p) => p.join('.')`。
- **ssh の .ps1 に日本語を書かない**(BOM が無いと cp932 で読まれ、コメントの 2 バイト目が改行を食って `param(...)` が壊れた)。
- **上の段に字や言葉を足すと、行が増えてキャラが小さくなる**(第 12 波の実測): 札の列を 12 → 14px、「VR」→「Quest で開く」にしただけで、幅 390 の上の段が 56px 高くなり、390×664 のキャラの高さが 210 → 177px、頭のすき間が 49 → 34px(決まり 39.8px)に悪化した。字や言葉を変えたら、**必ず幅 390 の `l1_audit.mjs --sizes ph390x664,ph390x844` で行の数とすき間を測る**。直し: 幅 640 までは札の列を 1 行で流し(`flex-wrap: nowrap; overflow-x: auto`)、ボタンの横の余白を 14 → 10px・間を 6px に(`.top .quest-link-btn` のように `.top` を付けて、後ろに書かれた同じ詳しさの規則に負けない)。結果: 上の段が元の高さに戻り、390×844 の立った高さ 306 → 340px。
- **羽(止まった箱の外へ振れる)**: 止まった箱で幅を決めても、ちょうちんくんの羽は話す間に箱の外へ出て 430×932 の両端で切れた(箱の角を画面へ写す確かめは通る)。横に広い子(幅 > 高さの 0.8 倍)は最初から幅を 15% 広く見込み、確かめの余白は片側 5%。本当は羽の振れ幅を読み込みで測って足すのがよい(L1 の直し方の案。12b 以降)。
- **確かめの順**: 木を `git archive HEAD --format=zip` で確認用の別の PCへ送り(`Expand-Archive`・node_modules はジャンクション)、`s5w12_run.py` の段(build・tv・gap_quick・l1・l1s)を `machine_lock.py run --machine pc2 --kind cpu --procs 4` で包んで流す。L1 の全 84 場面は 13 分、6 つの大きさ(スマホ 4・iPad 2)は 5.6 分。前後の比べは `L1/tools/l1_audit_md.py <フォルダ> <md> before after`(フォルダに l1_before.json = 前の結果を、使う大きさだけに絞って置く)。台本は `work/S5/w12/`・`scratchpad/k12/`(s5w12_run.py・s5w12_pc2.sh・s5w12_setup.ps1)。
