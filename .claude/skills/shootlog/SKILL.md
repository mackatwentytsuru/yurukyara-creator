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
- **iPad の最初の起動**: iOS の「ローカルネットワーク」の許可が、最初に PC/Mac へつなぐときに出る。許可待ちの間は送りが全部 `skippedNotReady`(framesSent 0)で、受け手は 0 コマ。**ARKit は回るので、一見は正常に見える**。測定の前に 1 度、本人に許可してもらう(カメラ・マイクの許可も同じ)。測定結果は `stream_table.py` で表にする(`framesSent` と `skippedNotReady` が見える)。Windows の Python で ssh の出力を読むときは `encoding="utf-8"`(日本語を含む JSON で cp932 の読み取りが落ちて、結果が空になった)。
- iPad Pro 11 インチ第 3 世代(M1、iPad13,4)の実測(AR 15 fps・半分の解像度+フル HD 30 fps 18 Mbps+音、LAN 経由、127 秒×3 回続けて): 熱は 3 回とも nominal のまま、端末が送れた率 97.9/97.9/98.0%、実効 29.9〜30.0 fps、17.6 Mbps、遅れ 中央 85〜86・p95 152〜158・最大 357〜507 ms、連番の欠け 0、音の欠け 0。ARKit は 4K 30 fps(fx=3065 px@3840 → 横の画角 64°、35 mm 換算 28.7 mm。iPhone 12 Pro は約 68°)。
- iPad で **AR を 30 fps・解像度そのまま(`fps=30&pr=1.0`)**にしても、127 秒×3 回続けて 熱 nominal、送れた率 97.9/98.0/98.0%、17.7〜17.9 Mbps、遅れ 中央 85〜86 ms、連番の欠け 0、AR の姿勢 約 3700 送(捨 約 78)。iPhone は同じ条件で 100→89→78%・critical に落ちた。AR を 15 fps に落とさなくてよいのは iPad だけ。

## 端末どうしの画質の比べ(11-03 夜、iPad と iPhone を手持ちで)
- 道具: `quality_chart.py make`(絵。5120×1440 のモニターの中央 2560 幅に、色見本 24・星・斜めの縁・日本語の文字・ChArUco 盤)→ `rehearsal/open_image_fullscreen.ps1` で全画面(要:本人の一声。自分で起動した Chrome と http.server の PID だけ止める)→ 端末で `--auto-stream 14 --lock-exposure --iso 50` → Mac で `ffmpeg -f hevc -r 30 -i stream.hevc -vf select=not(mod(n\,10)) -fps_mode passthrough f_%03d.png`(古い ffmpeg では `-vsync` が使えない)→ `quality_chart.py measure/sheet`。
- **露出は ISO を決めて固定する**(`--lock-exposure` だけだと、暗い絵に合わせて明るく固定され、背景が灰色に浮く)。この絵・このモニターでは ISO 50 で白飛び 0%、ISO 100 で 3.7% 飛ぶ。
- **曲がったモニター(ウルトラワイド)では、盤から作った平面の変換が盤から遠い所でずれる**(灰色の標準偏差が 50 になった)。縁・灰色は予測の位置のまわりで直接探す(`edge_width_local`・`flat_noise_local`)。縁の立ち上がりは「絵の 1 画素あたり」に直して比べる(距離が違うため)。
- 結果(手持ち、HEVC フル HD 18 Mbps の受け側のコマ、鮮明な上位 10 コマの中央値): 縁の立ち上がり iPad 3.35 / iPhone 3.39(絵の画素)、雑音 0.34 / 0.31、盤の角 63 / 60 点 → **画質は同等**。違いは画角と距離: 絵 1 画素=コマの 0.52 画素(iPad)/ 0.40(iPhone)で、同じ位置なら iPad のほうが少し狭く(64° 対 68°)大きく写る。限界は端末のレンズよりモニターの表示と HEVC のほうにある可能性が高い。
- 注意: 同時刻の撮影ではない(iPad の数分後に iPhone)。手持ちで角度・距離が違う。色は数字にしていない(曲面で見本の位置がずれるため。目では同程度)。

## 点の自動校正(手で 4 隅を押す代わり。11-04 未明、iPad の実機で確かめた)
- 流れ: LED に `rehearsal/dot_calib.html`(緑の点。1 周 6 秒: 面の全体を 0.4 秒緑=合図 → 0.4 秒消す → 点を 5×3 で 0.3 秒おきに 0.2 秒ずつ → 0.7 秒あける)を出す → アプリを `--ar-on --dot-calib` で起動 → `DotCalibrator.swift` が点を拾ってレイを作り、ページ(`ar_show.js` の solveAlign)が解く。ボタン不要。
- 結果: 置いたままの iPad で、モニターの一部しか写らなくても 14/15 点、残差 0.4〜0.5 cm、yaw は 20.8〜21.0° で安定。解いた枠(`show_led=1` の緑の線)が本物の枠にほぼ重なる。
- 手持ちで動かしたとき(最終形): 15/15 点、レイ 41〜45 本、残差 0.2〜0.3 cm、yaw 11.0〜11.9°。本人の目で「ほぼずれてない」。
- **手持ちで崩れた原因と直し**: 持ち上げると、置いていたときのレイと動いたあとのレイが混ざり、動いている間に上のモニターの派手な壁紙を合図や点と取り違え、残差 17 cm・yaw 91.5° に崩れた。直し: ①色は緑だけ(max(0,128-Cb)+max(0,128-Cr) ≥ 70、Cb と Cr がどちらも 118 未満)②合図は長さ 0.25〜0.6 秒だけ、点は 0.35 秒以下だけ ③点の間にカメラが 3 cm か 2° より動いたレイは捨てる、追跡が normal でないときは全部捨てる、30 秒より古いレイは捨てる ④ページは外れたレイを除いて解き直し、10 点以上・残差 1.5 cm 以下の解だけを採る(悪い解で上書きせず「前の校正を保持」と出す)。
- **最初の「90 度ずれ」の原因は式でなく誤検出だった**: 録画を PC で再生して確かめた(点 0〜9 だけで解くと残差 0.18 cm、距離 1.05 m、LED の向きはカメラに対して 5°)。同じ点を別の姿勢で見たレイの交差は、カメラがほとんど動かないと軸の違いを見分けられない(どの仮説も 0.2 cm)ので、判定は「1 周分の点の格子」と「解いた枠を録画のコマに重ねる」で行う。
- 誤検出を防ぐ決まり: ①点は白でなく緑(白いと、モニターの下端・通知の四角・別のモニターと間違える)②丸くてまとまった塊だけ(面積 6〜400 マス・縦横比 0.6〜1.7・中身 ≥0.55。アイコン・文字は落ちる)③基準(ふだんの色)は候補のマスも遅く更新し、最初のコマで初期化する(更新しないと、明るい所が永久に候補のまま)④番号は数えず、合図が消えてからの時間で決める(見えない点があっても、ずれない)。
- 確かめ方: `--ar-snapshot 秒 --ar-snapshot-every 秒 --ar-snapshot-count N` で、カメラの映像・ページの絵・向きを Documents に書き、PC で画面と同じ切り取りで重ねて見る。レイは `dot_rays.json`。
- 自宅のテスト: `test_center=1`(キャラを面の正面中央に固定し、ショーの時刻を繰り返す)、`show_led=1`(枠・点・机の面・正面の向きの線を重ねる)、`face_w=0.6 face_h=0.28125 led_bottom=0.12 charheight=0.3`(モニターの中央 2560×1200 画素を面に、机を床に)。
- まだ: ①同時に複数の点を出して速くする(点ごとに違う点滅の符号か色)②LED の面が 3 枚のときの扱い(本番は面 A〜C の盤やコマ番号の帯と合わせる)③手で 4 隅を押す校正の「いま開始」のボタンが、iPad ではアプリのボタンに隠れて押せない(画面を白く光らせれば始まる)。
- 向き: アプリは横向き(右)に固定。iPad を逆向きに置くと絵も AR も逆さに見える(位置は合っている)。
- 会場の 3 面: `make_led_dots_video.py`(33 点、1 周 11.4 秒、緑の明るさを 100/60/35% に変えて 3 周 34.2 秒)。ページは `dots=led3&dot_rms=4`。**面 A だけだと舞台の中央の誤差 10 cm、3 面で 2 cm**(13 m・手持ち、`dot_calib_sim.py` の合成データ)。B・C と床の位置は `show/ue/stage_layout.py` の図面の数字で、面ごとの残差(除く前の全部のレイの中央値)で図面との差が見える(面 B が 20 cm 奥で B 3.2 cm)。試験は `dots_page_selftest.py`(本物のページを Chrome で動かす。`window.__arShow.host` から呼ぶ)。
- 点の映像の緑の合図は、ショーのフラッシュと取り違える(輝度だけで見ているので)。ページは、点のレイが届いたらフラッシュで始めた時刻を取り消す。手で始めた時刻は残す。
- 起動の引数の URL は保存しない(前は UserDefaults に残り、試験の URL が本番に残る危険があった)。ページのボタンは WKWebView がタッチを受けないので iPad では押せない → アプリの「AR 開始」のボタン。

## multi_calib を実写で(11-04 未明、iPad 手持ち、モニターに 3 面の盤)
- 手順: `rehearsal/make_monitor_boards.py`(LED の盤の絵をモニターの寸法に。faces_monitor.json)→ 全画面で出す → `--auto-stream 36 --lock-exposure --iso 50` で 36 秒、手持ちでゆっくり動く → `pc_to_frames.py --rx … --out …` → `multi_calib.py --faces … --shoot … --every 6`。
- 結果: 95 視点、再投影 中央値 0.74 px・rms 1.51 px、取り置いた視点 1.50 px(フル HD)。面ごと A 0.37・B 2.00・C 0.74 px。ARKit の姿勢との差 中央値 0.50 cm・0.36°。fx 1545.6(ARKit 1530.0、差 1.0%)。縮尺 0.984。
- 形も合う: 面 B の原点は A から 0.271 m(絵の位置からの計算 0.2705 m)、面の向きは B -8.2°・C -18.3° と曲面のとおりに順に回る(カタログの曲率は未確かめ)。B の残差が大きいのは、幅広の面が曲面で平らでないためと見ている(本物の LED の面は平ら)。
- **`multi_calib.py` は `meta.json` の `intrinsics_scale` を使う**(前は PC に送った記録に 4K の K を当てていた)。(11-04 夜から `pc_to_frames.py` が K を映像の画素に直して書き `intrinsics_scale` は 1.0 になったので、`multi_calib.py` も `shoot_track.py` も同じ約束で読める。)

## 本番の画面(ShootHUD、11-04)
- 層の分け方: 録画・送り・校正の中身は触らず、読むだけの `ShootStatus` と操作の `ShootActions` を間に置く。`ShootHUD.swift` は値を見るだけ。古い部品は消さず「詳細」から出す(4 隅の手の校正など)。
- 画面の割り: 上 52 pt(ステップと 5 つの信号)、映像 1194×672 pt、下 110 pt(親指のボタン)。ボタンは映像に重ねない。録画は右の 92 pt の丸で、録画中も同じ位置。**止めるのは 1.2 秒の長押し**(途中で離すと取り消し)。録画中はステップの移動・詳細を止める。
- **録画ボタンは「Mac への送り」なので、保存の確認を画面に出す**: 受け手が毎秒 `RCV1`(書いたコマ数・MB・空き GB、16 バイト)を返す。5 秒届かない・切れたら赤の「Mac に保存できていません」(受け手を止めて 0.5 秒で出た)。止めるときは送りだけ先に止め(`pauseSending`)、最後の応答を最大 4 秒待ち「保存済み N コマ / 保存を確かめられません」を出す。最初の応答が届くまでは録画の開始からの秒で見る(`ackAge` が無いのを「止まっている」と数えると、始めた直後に誤報が出た)。
- 受け手は `--split-takes` で、つなぐごとに take_001…。つなぎの試しは `PRB1`(テイクを作らず答える)。
- ページのボタンは WKWebView がタッチを受けないので iPad で押せない → アプリの「AR 開始」。起動の引数の URL は保存しない。引数なしの起動が本番で、AR を自動で入れる。
- 超広角はカットごとに切り替え(`switchLens`。ARKit を止める。AR も位置も無し。iPad の中に 4K で保存。広角へ戻すと追跡が戻るまで 5.4 秒、位置の飛び 0.4 mm。固定で測定)。
- 確かめ方(本人の手なし): `ui_check.py`(11 状態の写真と押す物の枠。大きさ・重なり・映像にかからない・録画のボタンの位置)、`ui_roundtrip.py`(本物のボタンの経路で録画 → iPad の送った数 = 応答 = Mac のコマ、受け手を止めたときの警告)。Windows の `python -I` は PYTHON* の環境変数を無視するので、出力の文字コードを utf-8 にしたいときは `-I` を付けない。
- 本人が握って確かめる物(未): 暗い所で親指が届くか、押し間違えないか、眩しくないか。
- ARKit の形式は全部広角(iPad13,4)。超広角の 4K 30 fps は単独で 107.4°。ARKit と同時は不可(割り込みで 0.58 fps)。固定の 1 視点ではレンズを解けない。
- 寄り: 4K からの切り出しは、フル HD の拡大より細かさ 3.4 倍(1 シーンの実測)。今の送りには切り出しの経路が無い。

## 寄り 2 倍と、離れた所からの更新(11-04)
- 寄り: `PCStream.zoom2x`。4K の中央をそのまま送る。K は「元の 4K の画素」の約束を保つため `fx·2, fy·2, (cx−960)·2, (cy−540)·2` で送る。受け手が 0.5 倍して映像の画素にする(`pc_to_frames.py` が frames.jsonl にその値を書く)。実機で細かさ 2.69 倍、127 秒 ×3 で熱は平常。試しは `run_stream_test.py --zoom`。
- 更新: `python place/ios/tools/update_remote.py --check`(状態だけ)→ `--device ipad`(差分を送り、組み立て、入れる)→ 合格したら `--keep`、だめなら `--rollback`。組み立てに失敗すると入れない。Mac の画面がロック中でも署名は通る。USB の許可だけは本人がロックを解いて押す。
- `devicectl` は同じ Wi-Fi でも入れられる(`transportType: localNetwork`)。USB が無くても動いているように見えるので、店の Wi-Fi が端末どうしを通さない時に初めて USB が要る。
- `devicectl device install app` の最後の数行に「App installed」は出ない。`tail` で切らずに全体で確かめる。
- Mac のバイナリの中の日本語は、ssh の引数の grep では合わない。Python でバイト列を数える(`b.count('文字'.encode())`)。
- `ui_roundtrip` の押下の間隔は、確かめる時間(諦めの 6 秒など)と重ねない。

## UE の通しのリハーサル(11-04)
- `rehearsal.py media`(LED の映像を組む)→ `rehearsal.py dots`(点を録る)→ `rehearsal_dots.py`(解いて正解と比べる)、`rehearsal.py cuts`(カットを録る)→ `rehearsal.py sheet`(選ぶ 1 枚と通しの動画)。UE の札を取ってから流す。ポート 8080・8888・9000 を使うので、同時に 1 つだけ。
- UE に流す映像は 2840×620・30p・音なし。5680 幅の H264 は読めず、音の線があると絵が進まない。
- カットの秒は `show_stage.json` の flashes から読む(`at("out", 0, -3.8)`)。値を写さない。
- 点の番号がずれたら録画の止まりを疑う(`ffprobe` の frame の間隔)。1 秒の止まりで 1 つずれる。
- 起動の直後にページをつながない(5 秒待つ)。`__enter__` の失敗でも UE を閉じる。

## 点の校正の結果を Mac のテイクから合成まで届かせる(11-04 夜)
- **つまずき 1: 校正が Mac に届いていなかった**。`ARMonitor` はレイを端末の Documents に書くだけで、受け手の記録にも `pc_to_frames` の meta にも無く、`build_track()` が「4 隅の記録も alignment も無い」で止まった。直し: 新しい電文 `CAL1`(接続の直後・レイの更新(1 秒に 1 回まで)・止める直前。映像と別の列で送る)→ 受け手が `calibration_rays.json` に原子的に書く → `pc_to_frames` が `dots_align.py` で解いて `alignment_A/B/C.json`。
- **つまずき 2: K の縮尺**。`pc_to_frames` は K を 4K の画素のまま書き、`intrinsics_scale 0.5` を meta に書いていたが、`shoot_track.py` はそれを読まない。実測(同じテイクで旧版): 焦点距離 57.47 mm・横の画角 34.78°・主点のずれ [967, 535] px(正しくは 28.73 mm・64.13°・[3.5, −2.5])。直し: K を映像の画素にして書き、`intrinsics_scale` は 1.0、元の縮尺は `source_intrinsics_scale`。
- **世界の ID(`arSessionId`)**: ARKit の世界は、起動と `resetTracking` で変わる。`switchLens`(pause → run し直すだけ)は変わらない。世界が変わったら古いレイを捨てる。受け手は 1 テイクの CAL1 の ID を `sessions` に順に残し、2 通り以上なら(録画の途中で世界が変わった)`pc_to_frames` が使わない。frames の T は世界の ID を持たないので、これが唯一の検出(途中の中断・再追跡が世界を変えるかは未確認)。
- **悪い校正を黙って使わない**: 使えないときは「校正: 使えない — 理由」を出して alignment を書かず(前の実行の `source: "dots"` の alignment が残っていれば消す)、`build_track()` は止まる。理由は 4 つ: ファイルなし・世界の ID 違い・点のレイなし・点 10 未満か残差 4 cm 超。
- **`dots_align.py` は標準ライブラリだけ**(Mac の python3 は 3.9 で numpy が無い)。`ar_show.js` の solveDots/solveAlign の写し。本物のページに同じレイを 4 通り(雑音・外れ 2 割・面 B が 20 cm 奥・雑音大)渡して、yaw 差 0.0000°・位置の差 0.000 cm(合格の線は 0.1°・0.5 cm)。ページは `face === 'A'` のレイだけを使う(アプリは全部 'A' で送る)ので写しも同じ。
- **面ごとの alignment**: ページの LED の座標は 3 面で 1 つの枠。面の座標(左下が原点)への変換は図面(`stage_layout.py`)から作り、面 C は端と端を結ぶ板。このため `shoot_track` の面ごとの残差は図面どおりで 0 になる(面 B が図面からずれても、そこには出ない)。ずれは alignment の `face_residual_cm`(点のレイの面ごとの残差の中央値)で見る。
- **通しの試験**(`calib_handoff_selftest.py`、合成): 位置 中央値 0.15 cm、向き 0.002°、焦点距離 28.73 mm(横の画角 64.13°)、寄り 2 倍は 57.47 mm(34.78°)、主点のずれ [3.5, −2.5](寄り [7, −5])が想定どおり、点 33/33(レイ 64/66)・rms 0.7 cm・面ごと A 0.5・B 0.8・C 0.7 cm。レイなし・世界の ID 違いは理由つきで失敗し、レイの更新は最新が使われる。**ARKit の世界・点の拾いは作り物**なので、実機の通しは未確認。
- 型の確認(Mac、別フォルダ、署名なし): `ue_link_defaults.json` が無いと `xcodegen` の資源で落ちる(リポジトリに無い)。確認用のフォルダに `{}` を置いて通す。
- `DotCalibrator.json()` は 30 秒より古いレイを外す。点の映像は 3 周(約 34 秒)あるので、校正に時間がかかるほど古い点の分が減る。

## 校正の追加(11-04 夜 その 2)
- **つまずき: 最新のレイで良い校正が消える**。`DotCalibrator.json()` は 30 秒より古いレイを外すので、校正のあと誤検出が数本入ると「最新」はその数本だけになる。ページは「前の校正を保持」で正しいのに、Mac の `calibration_rays.json` だけ壊れる。直し: ページの `dots.good` を受けた時に渡してあった JSON を `goodCalibrationJSON` に覚え、CAL1 の rays はそれ(`accepted: true`)。status は前の JSON の判定かもしれないので、渡した直後 0.5 秒は採らない。世界が変わったら良い校正・ページの古い校正も捨てる(`worldChanged` はページの `onCalibReset` も呼ぶ)。
- **別のテイクの校正を借りる**条件は「世界の ID が 1 通りで同じ」だけ。ID が無い・違う物は借りない(試験⑦)。accepted を先に選ぶ(試験⑥: 33 点の accepted でない物より、17 点の accepted の物が選ばれた。位置の誤差 0.38 cm)。
- **超広角の固定カット**は、alignment が無く `build_track()` が止まっていた(試験で確認)。世界は舞台の座標なので、ページの LED の座標から (A_X0, LED_Z_BOTTOM, 0)/100 ずれた平行移動だけで、`dots_align.stage_world_docs` が面ごとの alignment を書く。試験(1.5 px の雑音、13 m): build_track の位置は camera.json と 0.05 cm・正解と 3.3 cm、向き 0.123°、横の画角 104.82°(camera.json と同じ)、主点のずれ 4K の画素で [6, −4]。
- `update_remote.py --rx` で Mac の受け手の道具を更新(`--check` は差だけ)。`pgrep -f` は自分の sh のコマンド行にも当たるので `'[p]c_stream_receiver.py'` と書く。
- **ツールの注意**: Bash の heredoc で Python を渡すと、文字列の中のバックスラッシュ 2 つ + n が本物の改行になり、書き換えた文字列が壊れた(3 回)。バックスラッシュが要る所は `chr(92)` で作るか、Edit で直す。

## 校正を合成へ渡す実機の確かめ(11-04)
- `calib_device_test.py`(点を見ずにレイを読み込ませて、本物の iPad → Mac → pc_to_frames → build_track)。止める直前の CAL1 はボタンの経路だけなので `ui_roundtrip.py` で見る(`--auto-stream` では接続の直後の 1 回)。
- 1 時間の連続: 送れた率 99.93%、欠け 0、熱の最大 serious。2 分の試験は熱を測ったことにならない。
- 受け手の要約の遅れは、端末の時計が途中で補正されると飛ぶ(約 1.8 秒)。遅れを見るときは区間ごとの生の値で見る。
- `run_stream_test.py` の iPad の要約の取り出しは、長い試験だと書き終わる前に走って空になることがある。あとで `devicectl device copy from` で取り直せる。

## 点の映像を本物の iPad で拾う試験(11-04 午後。`real_dots_check.py`、固定の iPad・平らなモニター)
- 道具: `python place/shootlog/real_dots_check.py --out work/_stream/real_dots`(`--selftest` は画面も iPad も使わない)。ArUco の盤を 5 秒(窓は素の Win32、最前面・NOACTIVATE・マウスを通す)→ iPad の映像でカメラに映る画面の範囲 → その中に 4.58:1 の最大の窓で本物の点の映像(`LEDに出す物/点の校正/led_dots_5680x1240_H264.mp4`)を 1 回 → `--lock-exposure --iso 50` で起動し、dot_rays.json を 1 秒おきに取る(30 秒より古いレイは消える)。窓の合計は out の `window_ledger.json` に積み、180 秒・1 回 60 秒を超えない。映像(本人の画面が映る)は終わりに消す。
- **tkinter の窓は、作った瞬間に前面を奪った**(非表示で作っても)。窓は素の Win32(`CreateWindowEx` に最初から WS_EX_NOACTIVATE)で作る。前面のウィンドウは窓を作る前に控え、出している間も同じかを見る。
- 窓の時刻(30 fps、1026 コマ): 1 コマ約 0.9 ms で出せ、遅れ 中央値 1.9 ms・p95 7 ms、1 コマ以上の遅れ 4〜5 回。カメラで見た合図の間隔 11.38・11.44〜11.51 秒(期待 11.4)。緑は ISO 50 で白飛びせず(窓の範囲の平均 RGB: 100% で (3,228,3)、35% でも G 175)。窓は映像の 33%(10682 マス)、点の直径 37〜55 画素(映像)で、アプリの条件(合図 800 マス・点 6 マス以上)に足りる。
- **実機のアプリは点を拾えなかった(2 回とも 0〜1 点/33)。原因の見込み: `DotCalibrator.swift` の `process` で、局所定数 `let total`(その 1 コマの候補マスの数)が、メンバの `total`(点の数。33)を隠している**。点を確定する `k < total` が、「点が消えて 2 コマあとの、候補マスの数」と比べられ、画面に他の緑が無いと 0 に近く、全部捨てられる(自宅の試験では周りの雑音で通っていた)。同じ録画に判定を当てた写し(`emulate_app`)では、`k < 33` なら 66〜79 本、ソースのままなら 1 本。直しは `self.total`(または局所を別名に)。アプリは直していない。
- 写し(直した形)で測った番号: 29〜32/33 点、**周ごとに解くと番号は 100% 正しい**(窓の位置から予想した画素の最も近い点と一致 66/66・79/79 本)。残差は LED で約 9 px、カメラで約 3 px。
- **固定の iPad でも ARKit の世界の向きは周の間で 1.9〜3.5° ずれた**(カメラの画素で 約 50〜90 px)。全部の周を 1 つのホモグラフィーで解くと外れが出る(47/66 本、のち 79/79 本)。周ごとに解くか、校正を 1 周ずつにするのが安全。アプリが点ごとに 3 本(別の周)を持つのは、この点で気をつける(ページは外れを除くが、周の間の向きのずれは雑音より大きい)。
- 点の抜け(4〜5 点)は、点が 0.35 秒より長く続くと見なされる所(続けて光る点がつながる)と合図の時刻の合わない所。

## 仮想 iPad(シミュレーター)の通しの試験(11-04。`place/shootlog/sim/`)
- 目的と線は `docs/仮想iPad_合格の線.md`。UE の撮影はサブ機(ログイン中のセッションの 1 回きりのタスク。ssh の中では GPU が無い)、計算はメイン PC。`sim_selftest.py` は UE なしで通る(まず流す)。
- 流れ: `sim_shoot` で正解のカメラ(手持ちの揺れは実記録)→ `sim_ue run`(サブ機の UE で連番。色のパスは `--jpg`、Matte・Shadow は PNG)→ `sim_pipeline dots|chain`(カメラのまね → ARKit のまね → 受け手 → pc_to_frames → build_track)→ `sim_score`。合成は `show/composite/composite.py`(素材のフォルダ名は Comp_BeautyWith ほか)。
- **取り戻しが遅い**: サブ機 → メイン PC は PNG で約 0.8 MB/s。JPG(品質は UE 5.8 の Python から変えられず既定)+ サブ機の中で tar にすると 1〜4 MB/s。大きな連番は JPG にして、次の撮影と並べて取り戻す。
- **E0(直しなし)の足元の差**(カット 3、広角、中央値 px): 0 分 2.0 / 1 分 18.7 / 2 分 32.6 / 3 分 38.3 / 4 分 44.9 / 5 分 53.1 / 10 分 118.7。10 分まで実測のずれの形、30 分・60 分は 10 分の傾きで伸ばした仮定。**1 分でも線(6 px)の 3 倍**なので、直しなしでは使えない。
- **E1① テイクの頭で点の校正をやり直す**: 経過 1 分 1.7 / 2 分 3.4 / 3 分 5.5 / 4 分 9.5 / 5 分 7.6 px(線は中央値 6 px・p95 15 px)。10 分以上は校正の残差が 4 cm を超えて通らない(36 秒の点の撮影の間にもずれるため)。**テイクの 3 分以内の校正**なら線に入る。4 分が 5 分より悪いのは 1 回の試しの揺れ(約 ±2 px)。
- **E1② 頭と終わりの 2 回の校正から直線で補間**(`place/shootlog/drift_interp.py`。終わりのレイと頭の校正の差から世界の回転を Wahba で推定し、時間に比例して引く): 直しなしの 18〜118 px が 5.7〜15.1 px に下がる(15 件)。6 px の線に入ったのは 1 件(5.7 px)。ずれが直線でなく(1 分あたり 0.29→0.56→0.38→0.43°)、校正の 36 秒の間にもずれるため。**「直しなしよりずっとまし」まで**。線に入れるには校正を 3 分以内の間隔で足す(= ①と同じ)。
- **E1② 映像の動かない物の特徴点**(`track_refine.py`)は、暗い会場の HEVC では内れ点が約 10(UE のきれいな絵では 64)で、要る 25 に届かず測れない。LED の縁で測る試作も、広角のカットでは縁が足りず外れた(0 分で 3.5°)。
- **D の重ね(向きのずれなし)**: 足元 中央値 1.60 px、輪郭の重なり(IoU)中央値 0.92(p5 0.86、最小 0.83)。
- 見比べの判定: 外の判定役は使えなかった(停止と利用上限)ので、作った担当以外の判定は別の読み取りだけの担当に頼んだ(結果は「保留」。位置と縁は合い、床の粒状感と格子の有無が違う)。
- UE の MRQ の PNG は 1920×1080 で約 1.7 MB/コマ。D: の空きが少ないので、連番は J: に置く。
- 舞台の予定を替えるときは環境変数 `SHOW_STAGE=<json のパス>`(`sim/` と `scout/rehearsal.py` が読む。既定は `show/show_stage.json`)。
- `sim_ue.py` は機械名を書かない: 環境変数 `SIM_UE_HOST`(サブ機の ssh の名前)、`SIM_LOCK_SUB`・`SIM_LOCK_MAIN`(札の機械名)、`MACHINE_LOCK_TOOL` を渡す。`--where sub|main`。
- カット 8 の 3 コマ目の真っ白の LED は不具合でなく、リハーサルの LED の映像に足した「出る・戻るの光(0.12 秒)」。`show_stage.json` の flashes の秒に当たる。
