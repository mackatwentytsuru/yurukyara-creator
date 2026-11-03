---
name: shootlog
description: iPhone で動画を撮りながら、コマごとのカメラの位置・向き・画角(ARKit)を記録し、PC で LED の座標・UE のカメラ位置に変えて、仮想サンプル会場と合体できるようにする。アプリ「撮影記録」(place/ios/ShootLog)と、PC の道具(place/shootlog/)。撮影記録・カメラトラッキング・ARKit の姿勢と intrinsics・LED 4 隅の位置合わせ・solvePnP の保険を扱うときに使う。
---

# 撮影記録(カメラの位置・向き・画角を動画と一緒に記録)

詳しい使い方は `place/shootlog/README.md`。ここは「やり方の要点」と「はまった所」。

## 作りの要点
- アプリ(SwiftUI + UIKit、`place/ios/ShootLog/`)は ARSession の `ARFrame.capturedImage`(YpCbCr)をそのまま `AVAssetWriter`(HEVC)に渡し、同じコマの `camera.transform` / `intrinsics` / `trackingState` を frames.jsonl に 1 行書く。映像に書いたコマだけ記録するので、行番号 = 映像のコマ番号。
- 画像は ARKit が出す横向き(ホームバーが右 = `landscapeRight`)のまま回さない。アプリも横向き固定にして、画面と映像の見た目を一致させる。回すと K(画角)の前提が崩れる。
- 解像度は `ARWorldTrackingConfiguration.supportedVideoFormats`。iOS 16 以降は `recommendedVideoFormatFor4KResolution`(4K 30fps)。解像度・fps・オートフォーカスを変えると追跡が再開されて原点が変わるので、校正はやり直し。
- delegateQueue を専用の直列キューにして、書き込みはそこで。メインスレッドで 4K を書くとコマが落ちる。`isReadyForMoreMediaData` が false のコマは捨てて数える(meta の droppedFrames)。
- 校正(床と LED の 4 隅)は録画前に同じセッションの中で。世界の原点が録画まで変わらないこと。隅のレイ(カメラ位置と十字の向き)を記録し、PC で「角の予想位置とレイの距離」を最小にして LED の向きと位置を解く(`align_led.py`)。重力に合わせた世界なので、未知数は y まわりの回転と位置の 4 つだけ。

## 座標の約束(取り違えやすい所)
- ARKit のカメラは +x が右、+y が上、−z が前。K の画素は左上原点、y 下向き。`u = cx + fx·X/(−Z)`、`v = cy − fy·Y/(−Z)`。
- OpenCV のカメラは y 下・z 前なので、solvePnP の結果は `diag(1,−1,−1)` で ARKit 流に直す(`led_pnp.py`)。
- LED の座標は「客席から見て左下が原点、x が右、y が上、z が客席側」。UE への変換は `led_to_ue_matrix`(UE は左手系・cm)。ロールの符号は UE で実測して合わせ済み(2026-11-03)。

## はまった所(型確認と合成テストで分かったこと)
- `ARCamera.intrinsics` は `[0][0]=fx`、`[1][1]=fy`、`[2][0]=cx`、`[2][1]=cy`(列が先)。
- 署名つきの組み立ては GUI のセッションが要る(`mac-ios-build`)。iPhone が `unavailable` の間は終了コード 70。先に `generic/platform=iOS` で署名つきの組み立てだけ通しておくと、iPhone がつながった時点で `devicectl device install app` だけで入る。`grep available` は `unavailable` にも当たる → `[[:space:]]available([[:space:]]|$)` で探す。
- ssh の `nohup … &` は ssh を閉じると止まる(Mac では)。待ち受けは別の方法で。
- LK 追跡の角(`led_pnp.py`)は、細い線だけの合成映像では 10 コマ以上持たなかった。実映像では持つかもしれないが、保険としては「定期的に指定し直す」前提にする。

## 確かめ方
- 合成データ: `python place/shootlog/selftest.py` → 位置 0.1 cm・向き 0.03°・重ね合わせの輪郭距離が小さい。座標の計算の取り違えを見つけるだけ。ARKit の約束そのものは実機の撮影で確かめる。
- 実機: 家の部屋の窓を「LED」に見立てて 30 秒撮り、`overlay_room.py` の `edge_median_px` が `baseline_median_px`(わざとずらした線)より十分小さいこと、時間がたっても増えないことを見る。

## a7(主カメラ)+ iPhone のとき
- LED に出す物は ChArUco の盤(`make_led_board.py`)。LED の 1 画素 = 4 mm(パネル 32×16 cm = 80×40 画素)で、盤の角の LED 座標(m)は画素位置から決まる。IDS つきなので一部が画面から出ても使える。四角は遠くから撮るなら大きく(64 cm 以上。a7 の 4K で 10 m 先だと 32 cm の四角は読めない)。
- レンズ校正は `cv2.calibrateCameraExtended`。同じ撮影の動いている間は歪み、止まっている間(2 秒)は iPhone とのずれに使う。a7 のカメラ内の「歪曲収差補正」と手ぶれ補正は切(入っていると校正の前提が崩れる)。
- 歪みは直さず CG にかける: a7 と同じ fx・fy のピンホールで CG を描き(歪みで画面の外にはみ出す分だけ広く)、ST マップ(`st_map`)で歪みをかける。
- 時刻合わせ: LED の白いフラッシュの立ち上がり(明るさが中間値を横切る時刻、コマ間は直線補間)を対にして一次式を当てる。フラッシュが片方に写らなくても連続部分で対にできる。
- ずれは止まっている所だけで測る(時刻の誤差が効かない)。盤から測った iPhone の姿勢で LED の位置も出せ(`alignment_board.json`)、角のタップより正確。
- OpenCV の `cv2.imwrite` は日本語のフォルダに書けない(黙って何も書かない)。`lenslib.imwrite`(imencode + write_bytes)を使う。HEVC は `cv2.VideoCapture` で読めるが、Git Bash の `/tmp` は Python から見えない。
- LED シミュレータ(`place/shootlog/rehearsal/led_sim.html`): canvas は devicePixelRatio を掛けた実ピクセルで作り、盤は `drawImage(board,0,0)` で 1:1。切り替えは次の rAF で行い、時刻は Date.now() で `__timeline` に残す。
- 起動 `open_led_sim.ps1` は専用プロファイル + `--kiosk --app` + http.server(8090)。Windows PowerShell 5 は BOM 無し UTF-8 の日本語が化けるので、.ps1 は BOM 付きで保存する。
- 四角い面を貼った GLB は `shootlog/glb_quads.py`(標準 + numpy)。glTF の UV は左上が原点なので、画像の上端が v=0(左下=(0,1)、左上=(0,0))。PNG は zlib + CRC32 で自前に書ける。
- Node の GLTFLoader.parse は、`globalThis.self` と `createImageBitmap` を仮に足さないとテクスチャで落ちる(形・数の確認だけならこれで足りる)。

## 写真で部屋に色を貼る(1 段目、PC 側)
- `room_color_project.py`: 壁・床の面ごとにテクセルの 3D 位置を出し、映像のコマ(ARKit の姿勢 + 窓/ドアの 4 隅での位置合わせ)に投影して色を取る。重み = cos²/距離²×端で下げる、を 3 乗して足す。家具の箱は**大きめ(+3 cm)**に見て遮りを除く(RoomPlan の箱は実物とずれ、縁の色が混ざるため。縮めると家具の色が壁に漏れた)。
- `cv2.remap` の地図は幅・高さが 32767 まで。点の列(数十万)は 512 列の 2 次元にして渡す(`sample_bilinear`)。
- 合成の部屋(家具 12 個)で、見えた所の PSNR 30.5 dB(雑音なしのなめらかな模様は 40 dB)。見えた割合は歩く道しだいで 25〜50%(家具の後ろは見えない)。露出の違いは直していない。
- WKWebView は WebRTC(RTCPeerConnection)の映像を受けて再生できた(同じページ内のループバックの試験で、10 秒に約 425 コマの動き検出が届いた)。UE の Pixel Streaming そのものは未確認。

## 同時に動かす・PC へ送る・複数カメラ・音(11-03 夜の実機の学び)
- 録画(4K30、ARKit の ARFrame を AVAssetWriter)に、UE の絵(WKWebView)・位置の UDP・縮小映像の送り(JPEG/HEVC)を足しても、**録画のコマは落ちなかった**(iPhone 12 Pro、各 60 秒)。熱を上げる主犯は **UE の絵の受信・表示**(冷えた状態から B/I だけ serious)。熱の比べは、試験ごとにアプリを閉じて冷ます(`--exit-after-record`)。アプリが動いたまま置くと次の試験が critical で始まる。
- 縮小は **VideoToolbox の `VTPixelTransferSession`**(CPU/CIImage で 4K を縮めると符号化が 120 ms 超)。HEVC は `VTCompressionSession`(RealTime、AllowFrameReordering=false、`EnableLowLatencyRateControl`、`kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder` は iOS 17.4 以降なので付けない)で Annex B にして送る(キーフレームに VPS/SPS/PPS)。受け側は再符号化なしで `ffmpeg -f hevc -r 30 -i stream.hevc -c copy out.mp4`。
- **時計**: 端末と PC の時計は数百 ms ずれることがある(見かけの遅れが 0.9 秒で一定 → 時計のずれ)。PC が PING(サーバー時刻)、端末が PONG(同じ時刻+端末の時刻)を返し、往復が最小のものから offset を出す。映像の「撮った時刻」は、ARFrame.timestamp(端末の起動からの秒)と systemUptime の差から epoch ms にする。
- **ARKit は 1 つの背面カメラ(広角)を独占**: 録画の形式は広角 1 本だけ(4K の 24/25/30 など)。ARKit が動いている間に別の AVCaptureSession で超広角を動かすと ARKit が止まる(0.8 fps/0 コマ)。ARKit なしなら AVCaptureMultiCamSession で 2 レンズ 4K30×2(hardwareCost 0.57)、3 レンズは 1280×720/30 だけ(圧 1.05)。`supportedMultiCamDeviceSets` と各形式の `isMultiCamSupported` を端末で読み、`hardwareCost`/`systemPressureCost` が 1.0 を超える組み合わせは不可。新しい確認用アプリを別に作ると、カメラの許可の窓で止まる(許可は人が押す)ので、許可済みのアプリの中に起動引数(`--probe-multicam`)で組み込む。
- **音**: `AVAudioSession` を `.record`/`.measurement`(自動音量調整なし)、`AVCaptureSession`(`automaticallyConfiguresApplicationAudioSession = false`)+`AVCaptureAudioDataOutput`。音の PTS は**ホスト時間 = ARFrame.timestamp と同じ時計**なので、映像の最初のコマの時刻を引くだけで揃う(`CMSampleBufferCreateCopyWithNewTiming`)。書き込みは映像と同じ直列キューで。video.mov は 24 bit PCM の音声トラックにできた。マイクの許可は初回に窓が出る(出ている間は音が来ない)。
- **iPhone の空き**: 4K30 の録画は約 3.7 MB/s(1 時間 13.4 GB)。`volumeAvailableCapacityForImportantUsage` を録画の頭で meta に書く。実測 7.2〜7.4 GB(約 33 分)。
- **自動の試験**: `run_concurrency.py` が、Mac 経由で `xcrun devicectl device process launch <bundle> --auto-record 60 --exit-after-record …` → `devicectl device info files`(Documents/shoots の一覧)→ `devicectl device copy from`(撮影フォルダ)→ scp。iPhone がロックされると `unavailable` で入れ直せない。ssh の Mac には `timeout` が無い。
- 複数面の校正は `multi_calib.py`(scipy `least_squares` の疎なヤコビアン。面ごとに回転 3・移動 3・大きさ 1、ARKit→基準の変換 7、視点ごとに 6)。面の大きさを未知数にして事前の幅 2% を置くと、モニターの寸法の誤差(3%)が直る。コマ番号の帯は Gray コードで、露出の間に切り替わって明るさが混ざったビットから小数のコマが読める。

## AR モニター(端末の中でカメラの映像の上にキャラを重ねる)と LED の校正の映像
- 作り: 透明な `WKWebView`(`isOpaque=false`)に three.js のページを載せ、毎 ARFrame の姿勢を `evaluateJavaScript` で送る(ARStage と同じ約束 `window.__arhost.onPose(world16, proj16, ts)`)。`viewMatrix(for:)` と `projectionMatrix(for:viewportSize:)` には**画面の向き(.landscapeRight)と WKWebView の大きさ**を渡す(映像を `resizeAspectFill` で出すのと同じ切り取りになる)。JS の呼び出しは主スレッド。詰まったら最新だけ送る(`inFlight`)。
- ショーの時刻はフラッシュで: ARFrame の `capturedImage` の輝度(plane 0)を 32×18 点で平均し、ゆっくり動くベースラインより 25 以上上がった立ち上がりを検出(3 秒は再検出しない)。検出した時刻は ARFrame.timestamp(frames.jsonl の `t` と同じ時計)。実機で 23.000 秒周期のフラッシュを数 ms で検出。
- 世界 ← LED の変換は、4 隅の「十字の先のレイ」から、回転(y 回り)を総当たり+黄金分割、移動は最小二乗の閉じた式で解ける(4 未知数)。JS でも十分速い。
- 熱: 「画面にもう 1 枚の絵を描き続ける」(UE の絵の受信・AR の three.js)が主因。録画・縮小映像の符号化・HEVC 送りは fair のまま。熱を下げる: 描く fps(`fps`)と解像度(`pr`)、殻の姿勢を送る頻度。
- 校正の映像を作るとき: 面ごとに ID の範囲を分ける。**画素が縦横で違う面は、正方形の盤を作ってから縦だけ縮める**(OpenCV の `generateImage` に非正方形の大きさを渡すと小さな正方形が中央に出る)。角の「数」だけでなく「位置」(面→画像のホモグラフィーの対角が 1.0 か)で確かめる。LED の絵が重なって映る範囲(A と B の 957〜1279、B と C の 3039〜3345)は使わない。
- コマ番号の帯(Gray コード 16 ビット)は、1/60 の露出で切り替わりが混ざっても、混ざったビットの明るさの割合からコマの小数まで読める(実カメラで B と C が 0.4 ms で一致)。

## 録画を PC(Mac)に送る形の熱と欠け(11-03 深夜の実測、iPhone 12 Pro、127 秒×3 回続けて)
- HEVC フル HD 18 Mbps+音だけ(AR なし): 3 回とも ARKit のコマの 100% が PC に届く(30.0 fps・17.7 Mbps・遅れ 87〜99 ms)。熱は serious のまま。
- AR モニターを 30 fps で描く: 100% → 89% → 78%、critical。**AR を 15 fps・解像度半分(`fps=15&pr=0.5`)にして PC への送りは 30 fps のまま**: 端末が ARKit のコマに対して送れた割合は 97.4%/96.8%/97.9%(捨てたのは最大 1.3%、受け手の連番の欠けは 0。3 回目は critical で始まっても落ちず。ただし critical ではビットレートが 17.6 → 8.6 Mbps に下がる)。**率は「端末が送ったコマ ÷ 同じ窓の ARKit コマ」で出す**。受け手のコマ数(つながってから切れるまで、約 2.5 秒長い)を端末の窓の ARKit 数で割ると 100% を超える(3893/3884)ので、受け手の数は欠け(連番の抜け)の確認にだけ使う。熱の主因は「描画する画面」。
- iPhone→Mac は Tailscale で直接つながる(IPv6/LAN)。TCP の 17.6 Mbps に問題なし。WKWebView は Tailscale の IP の http を ATS が拒み、自己署名 https は TLS エラーだったので、ページはアプリに同梱(`ARSiteScheme.swift`)。

## 機器が Mac から見えないとき(11-03 夜、iPad で実測した切り分け)
- 症状: USB には見える(`system_profiler SPUSBHostDataType`、IOKit に device がある)のに、`idevice_id -l` が空・`devicectl` が unavailable・`ideviceinfo` が not found。IOKit では `!registered, !matched`(ドライバが付かず configuration が選ばれない)。
- **原因は 2 つ重なっていた**: ① Mac が画面ロック・画面スリープ(`ioreg -n Root -d1 -a | grep CGSSessionScreenIsLocked` が 1、`screencapture` が真っ黒)。② **Mac に「このアクセサリの接続を許可しますか」の表示が出て、許可待ちだった**。**画面が消えた(ロックされた)Mac では、この許可の表示が出ていても誰も気づけない**。Mac を開錠すると表示が見え、許可すると iPad 側にも「このコンピュータを信頼」が出る → 許可で通る。ssh からは直せない(パスワード・許可の操作は私には出来ない)。
- 先に Mac 側でやること: `ioreg -n Root -d1 -a | grep -c CGSSessionScreenIsLocked`、GUI セッション(`open x.command`)から `screencapture -x` で画面を撮る(真っ黒ならロック/スリープ)、`caffeinate -dis -t 14400` を GUI セッションで起動して画面スリープを防ぐ(自分で起動した PID)。zsh では `log` が組み込みなので `/usr/bin/log show …` と書く。
- 通ったあと: `devicectl` が「The device must be paired」と言う場合は、`idevicepair validate` が SUCCESS でも **CoreDevice 側のペアが外れている**ので `xcrun devicectl manage pair --device <UDID>` で張り直す(iPad の操作は不要だった)。最初の自動インストールは、通った直後に走ると失敗する(接続が整っていない)ので、見張りは「出た → 20 秒待つ → 入れる」にするとよい。
- iPad(M1 iPad Pro、iPad13,4)で動かすための設定: `TARGETED_DEVICE_FAMILY: '1,2'`、横向きは `UISupportedInterfaceOrientations_iPad`、`UIRequiresFullScreen: YES`(project.yml の ShootLog)。iPad は Tailscale に入っていないと LAN(Mac は 192.168.x.x)で受ける。
