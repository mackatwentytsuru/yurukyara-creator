# devlog 場所

場所の柱(`place/`、`places/`)の作業記録。数字は測った物だけ書く。うまくいかなかった試しも 1 行ずつ残す。

## 2026-11-02

- 15:20 前の作業役が止めた物を確認。`npm test`(place/)9 件通過。`place/tools/shot.py` で `place/web/demo.html` を 4 画面撮って、ブラウザのエラー 0。
- 直した所: 仮キャラの背が `?height=1.2` で 1.128 m になっていた(頭の積み方の計算ミス)。直して 1.200 m、足元 y=0 を測って確認。
- 手作りの試しの部屋 `places/test_room/`(5.0×4.0 m、高さ 2.6 m、入口 x=1.0 に幅 0.9 m、机 1.2×0.7×0.75 m)。GLB は 17,736 バイト。
- Mac の準備を読むだけで確認: macOS 26.6.2、Xcode 27.0(iphoneos SDK 27.0)、署名の証明書 2 件あり、空き 104 GiB。`xctrace` の一覧に本人の iPhone(26.3.1)があった(今は offline)。

### 15:50 調べ(1〜2 時間の調査。全文は司令塔との共有メモ place_research_1〜3)

**1. iPhone の AR**
- iPhone の Safari に WebXR は無い。MDN の browser-compat-data(`api/XRSystem.json`、2026-11-02 に取得)で safari = false、safari_ios はそれの写し。caniuse の iOS 26.6〜27.2 も非対応(調査役が確認)。WebKit ブログ Safari 27.0〜27.2 に iPhone の WebXR の記述なし。https://webkit.org/blog/18515/webkit-features-for-safari-27-2/
- iOS 27 で iPhone に来たのは `<model>` 要素(USDZ を表示するだけ)。AR Quick Look では自作の動きも音声会話も動かせない。
- 代わりの道: Mozilla の WebXR Viewer は 2026-05-13 にアーカイブ済み。8th Wall のホスト型は 2026-02-28 に終了。Needle Go(App Clip 経由)は immersive-ar 対応だが、マイクが動くかは書かれていない。
- **選んだ道: 薄いネイティブアプリ。ARKit(ARSCNView)の背景カメラ+平面検出の上に、透明な WKWebView を重ね、毎フレーム camera の姿勢と投影行列を JS へ送って three.js のカメラを合わせる。** 実機で未検証。落とし穴: ARKit が背面カメラを使うので、顔検出(MediaPipe)は ARKit の顔追跡へ置きかえる必要がある見込み。

**2. Quest 3**
- Meta Quest Browser(今の名前は Horizon Browser、最新リリースノート 152.1・2026-10-02)で immersive-ar(パススルー)と immersive-vr が使える。three.js 標準の `renderer.xr` でよい。
- plane-detection は、部屋のスキャン(Space Setup)済みが前提。hit-test は 40.4(2025-10)から深度 API を使い、スキャンなしで床に置ける(UploadVR 2025-10-10)。mesh-detection は Meta の IWSDK が要求しているが、公式リリースノートには記述が無く、**実機で確かめるまで不明**。
- マイクは、VR/AR に入る前の 2D 画面で getUserMedia を許可しておく作りにする(session 中に許可が出ると session が終わるかは資料が無く、実機で確認)。SpeechRecognition は Quest で無い報告があり、使わない(音声認識はサーバー側)。dom-overlay は immersive-ar で未対応の報告があり、UI は 3D の中に作る。
- 頭の位置: render に渡す camera の `getWorldPosition()` を毎フレーム使う(three.js の WebXRManager.js のソースで確認)。
- HTTPS 必須。開発は USB + `adb reverse`(Meta「Debug Browser content」2026-07-22)か、自己署名 HTTPS。実機は未検証。

**3. LiDAR の撮り方**
- RoomPlan は iPhone 12 Pro で使える(iOS 16 以降、LiDAR 付き全機種。WWDC22 10127)。壁・ドア・窓・床・家具 16 種に category・transform・dimensions が付き、CapturedRoom は Codable なので JSON にできる → `landmarks` の自動生成の元になる。**色は付かない**(USDZ は形だけ、家具は箱)。ステージ・カウンター・スピーカーのカテゴリは無い。
- 広さ: RoomPlan は 1 部屋 9×9 m 目安、複数部屋の合計 186 m² まで(WWDC22・23)。LiDAR は約 5 m(iPad Pro 2020 の Apple 発表。iPhone 12 Pro への適用は推測)。**幅 15 m のホールは保証外**。ホールは「分けて撮る実験を 1 回 → だめならレーザー距離計の実測で箱を手作り」。
- three.js r187 の `USDLoader` は USDZ を直接読める(ソースで確認)。RoomPlan の実ファイルで読めるかは未検証。Blender で開くなら `.mesh` で書き出す。
- 色つきで手早く撮るなら Scaniverse(無料、GLB 書き出し、App Store 表示)。Polycam 無料は GLTF のみ。

**決めたこと**
- 今夜: 本人は Scaniverse で部屋を撮って GLB を出す(色つき)。同時に自分は、RoomPlan で撮って USDZ と JSON を出す自作の iOS アプリ(`place/ios/`)を作る。
- 最終デモ: 自作アプリ(RoomPlan で名前つき、色が要る所は Scaniverse の GLB と重ねる案)。

### 15:35〜16:00 自作の撮影アプリ「場所スキャン」と取りこみの道具
- `place/ios/`: SwiftUI + RoomPlan(`RoomCaptureView`)。撮り終わると `room_mesh.usdz`(.mesh)・`room_parametric.usdz`・`room.json`(CapturedRoom そのもの)・`landmarks_hint.json`(名前・中心・寸法)を Documents/scans/<日時>/ に書き、共有シートで AirDrop できる。API 名は Apple の公式 JSON(developer.apple.com/tutorials/data/documentation/roomplan/…)で確認。
- Mac(Xcode 27.0)で署名なしの型確認 → 初回は `simd` の import 漏れ、2 回目は入れ子の NSCoding クラス名が不安定(`CaptureView.Coordinator`)でエラー。外に出して通った。
- 署名つきの組み立ては `mac_install.command` を ssh から `open` で GUI セッションに出して成功(終了コード 0)。**iPhone 12 Pro(iOS 26.3.1)に場所スキャン(RoomScan)を入れた**。2 回目(床の追加)は iPhone がロック中か圏外で「destination が見つからない」(終了コード 70)。実機で撮影は未実施。
- 変換: Blender 5.2(画面なし)で USDZ → GLB。**PC の「Blender 4.5」フォルダは空で、使えるのは 5.2**。Blender で作った偽の撮影(4×5 m、高さ 2.5 m、床 y=-1.3)で通し試験: GLB の箱 4.10 × 2.55 × 5.10 m(壁の厚み 0.1 を含む寸法どおり)、床の下端 y=-1.35、向きも保たれた。`landmarks.mjs` が名前を日本語にして床を y=0 にそろえ、spawn は床の中心でドアのほうを向く。テスト 14 件通過。ブラウザの試しページに出して、キャラが部屋の中央でドアのほうを向き、ドアまで 2.9 m と案内が出るのを撮って確認。
- 注意: 本物の RoomPlan の USDZ を Blender が同じように読めるかは未確認(偽は Blender 自作の USD)。

### 16:20〜17:00 画面/AR/VR の切りかえと iPhone の殻アプリ「ARステージ」
- `place/web/xr.js` を作り直し: 機能は全部 optional(1 つでも required が使えないと requestSession ごと失敗するため)、`enabledFeatures` に `local-floor` が無ければ `local` に落とす、AR では背景を外して透明にし終わったら戻す、頭の位置は render に渡す camera の `getWorldPosition()`。
- `place/web/nativeAR.js`: iPhone の殻アプリ向け。殻が毎フレーム送るカメラの世界行列と射影行列(16 個ずつ)を three.js のカメラに写す。raycast は殻に聞く。
- テスト 26 件通過(偽の `navigator.xr`・偽の renderer で、機能一覧・床の落とし方・背景の戻し方、姿勢の写し方、変な姿勢の無視、床の優先順)。
- 偽の殻(`window.webkit.messageHandlers.arhost` を差す)で、390×844 のブラウザを使った通し試験 `place/tools/native_ar_check.py` が合格: AR ボタン有効、ready が殻に届く、タップ → raycast → onHit の点 (0.5,-1.2,-2) にキャラが立つ、体が camera の向きへ(yaw -0.165 rad = atan2(-0.5, 3) と一致)、canvas の左上ピクセルの alpha=0(透明)、エラー 0。
- `place/ios/ARStage/`: ARSCNView(カメラ映像と追跡だけ)+ 透明な WKWebView。毎フレーム `viewMatrix(for: .portrait)` の逆行列と `projectionMatrix(for: .portrait, ...)` を送る。水平面の最低の高さを床として送る。マイク/カメラの許可は開いているページのホストにだけ与える。開発中は、開くホストに限って自己署名を信用する。署名なしの型確認は 1 回で成功、署名つきで iPhone 12 Pro に入れた(終了コード 0)。**実機で開いて AR を見るのは未実施。**
- `place/tools/serve_https.mjs`: 開発用 HTTPS サーバー(自己署名、LAN の IP)。Mac から PC のサーバーに届くことを確認(HTTP 200、`.git` は 403)。
- ハマり所: PC の「Blender 4.5」フォルダは空。ARKit の `camera.transform` は横向きのセンサー基準なので、縦持ち用に `viewMatrix(for: .portrait)` を使う(この点は Apple のドキュメントの知識。実機で確かめるまで未検証)。ARKit が背面カメラを占有するため、殻の中では getUserMedia の前面カメラ(MediaPipe の顔検出)が競合する見込み → 会話の柱へ要連絡。

### 17:00〜17:40 部屋の色(案 B: 様式化)
- RoomPlan の面は色も UV も無いので、`place/tools/make_textures.py`(周期つきノイズで描く木目・漆喰・布・ガラス。外の画像は使わない、1 枚約 1 m 四方、計 8 枚で約 1.1 MB)と `place/tools/stylize_room.py`(Blender 画面なし)を書いた。面ごとに、room.json の箱(ドア・窓・家具、向きつき)と面の向き・高さで種類を決め、箱の投影で m 単位に貼る。
- 偽の撮影(30 度回した 4×5 m、table・sofa つき)で通した: 種類の内訳は床 1・壁 38・ドア 1・窓 1・木 13・布 12・その他 18(壁は穴の無い箱なので、ドアと窓は 1 面ずつしか拾えない。本物は穴が開いている)。ブラウザで床の木目・壁の漆喰・ソファの青い布が出るのを撮って確認。GLB は約 0.94 MB。
- 最初は漆喰が雲のように濃すぎたので、むらを弱めた(見て直した)。
- `place.json` に任意の `variants`(見た目の名前 → GLB)を足し、`loadPlace(url, {variant})` と `?variant=` で切りかえる。**共通の決まりに無い追加なので司令塔へ連絡**。写真から色を付ける版(A)は `variants.photo` に足せる。
- 注意: RoomPlan の USDZ に入っているノードの名前・材質は実物で未確認。判定が名前に頼らないのはそのため。

### 17:50 モード切りかえの入口 `place/web/modes.js`(web/ が呼ぶだけで済む形)
- `createPresentation({renderer, scene, camera, place, background, onViewer, onChange})` → `available`・`enter('ar'|'vr')`・`exit()`・`viewerPeople()`・`frame()`。iPhone の殻(native)と Quest(WebXR)と画面を同じ呼び方にした。AR に入ると `<html data-presentation="ar">` とクラス `presentation-ar` が付き、html と body の背景が透明になる(`data-hide-in-ar` の要素は隠れる)。見ている人の頭は、殻では姿勢が来るたび `onViewer(camera)`、WebXR では `modes.frame()` を毎フレーム呼ぶと届く。
- `place/web/modeButtons.js`: 使えるモードのボタンだけを container に出す。
- 会話の柱(web/)の `?source=pose` の窓口と、`setViewer` / `setPeople` で接続できる形(接続そのものは web/ 側の仕事。未接続)。
- テスト 38 件通過。偽の殻の通し試験(`native_ar_check.py`)も modes.js 経由で合格のまま。

### 18:20 AR での位置合わせ(撮った部屋 → 現実の部屋)
- 会話の柱の指摘: AR の世界は起動した位置が原点で、撮った部屋と重ならない。→ 「部屋の目印(水平にいちばん離れた 2 つ、例: 入口・奥の壁)の真下の床を、現実で 2 回タップ」→ 向き(yaw)と位置を最小二乗で解き(`place/web/align.js`、three.js の rotation.y と同じ向き)、`place.setAlignment` で `object3d` を動かす(`place/web/alignFlow.js` が手順と文言)。床の高さは殻が見つけた水平面。
- `loadPlace` に `setAlignment`・`clearAlignment`・`worldFromRoom`・`roomFromWorld`・`describeLandmarksFromWorld` を足した。`spawn` と `landmarks` は部屋の座標のまま。`placeCharacter` は位置合わせ後の世界の spawn に立たせる。
- テスト 44 件(正解の変換を three.js で作って元に戻るか、3 cm のタップのずれでも向きは 2 度以内、点が近すぎる/足りないときの失敗、食い違い 15 cm 超でやり直しを勧める)。偽の殻での通し試験: 25 度回して (1, -1.2, -3) に置いた部屋が、タップ 2 回で yaw 25.00 度・食い違い 0 cm に重なり、入口の世界座標が正解と 1e-4 m 以内で一致、そのあとのタップでキャラが動く。合格。
- 限界: 床の 2 点の位置合わせなので、ARKit のずれ(ドリフト)が出ると少しずつ狂う(未測定)。2 点が近いと向きが不安定(0.5 m 未満は拒否)。実機ではタップの精度に頼る。精度が足りなければ、3 点目、または壁や入口の平面を使う、AR 用の画像マーカーを置く、などを検討する。

## 2026-11-02 外のスキルの抜き出し(司令塔のメモ)を試した
- 実機なしで試せた 5 つだけ試した。効いた: GLB の予算検査(`glbBudget.mjs`)、歩けるかの検査(`clearance.mjs`、偽の撮影で通り、家具で床を分けると不合格になる)、ボタン 44px。元から入っていた: 画素比 2 まで。使えない: USDZ を ZIP で開いて `.usda` を読む(Blender の書く USDZ は `.usdc` 1 つだけ)。
- 実機・本物の部屋が要る物は、スキル place-pipeline の末尾の表に「未試」で残した。
- 試験は偽の撮影だけ。本物の RoomPlan の room.json と USDZ の形は、まだ未確認のまま(`clearance.mjs` も `glbBoxes.mjs` と同じ形の前提)。

### 2026-11-02 夜 本人の実機試験に向けた受け入れの準備
- 作業用 PC のサーバー(PID 88820、8443)が動き続け、`?place=test_room` は 200。ARステージが開く URL は組み立て時に固定(`?place=test_room`)なので、新しく撮った部屋はページ上の「場所」の選び口から開く(`places/index.json`、`placeIndex.mjs`。ingest が作り直す)。作り直し不要。
- `place/tools/receive_scan.mjs`: Mac の ~/Downloads に AirDrop で届いた 4 ファイルを集めて(`mac_collect_scan.py`)作業用 PC へ scp、取りこみまで一発。偽の AirDrop(`room_mesh 2.usdz` の名前重なり)で通し予行 6 秒、予算「採用」・通れる 93%。390 px の画面で選び口を確認。予行の物は全部消した。
- 未確認: 本物の AirDrop が実際に ~/Downloads に 4 つ別々のファイルとして届くか(ShareLink の挙動)。実機で ARステージを開くのも未実施。

### 2026-11-02 夜 Quest をつなぐ道具(adb)を作業用 PC に入れた
- Google 公式 `dl.google.com/android/repository/platform-tools-latest-windows.zip`(8,044,989 バイト)を 作業用 PC の `work\tools\platform-tools\` に展開。adb 1.0.41(Version 37.0.1-15733141)、署名は Google LLC で有効。PATH・設定ファイルは変えていない(`work\tools\platform-tools\adb.exe` をフルパスで呼ぶ)。C: 472 GB、D: 125 GB の空き。
- この時点で、作業用 PC の USB に Quest は見えない(Meta の USB の ID 2833 が無く、`adb devices` も空)。ケーブル・Quest の電源・開発者モードの確認待ち。
- つまずき: 札の種類名は `cpu`(「CPU の重い処理」は通らない)。札を取る前にダウンロードを先に走らせてしまったので、あとから取って返した(小さな作業)。

### 2026-11-02 夜 初めての本物の撮影(iPhone 12 Pro・RoomPlan)を取りこんだ
- AirDrop は 4 ファイル(room_mesh.usdz 83 KB・room_parametric.usdz 40 KB・room.json 129 KB・landmarks_hint.json 5 KB)が別々に ~/Downloads へ届いた。`receive_scan.mjs` で集まった。
- **Blender 5.2 は本物の room_mesh.usdz を読めた**(箱の救済に落ちず)。三角面 404、940 KB。部屋は 4.77 × 4.63 m(床 3.89 × 4.05 m、壁 4、ドア 3、窓 1、物 12)。`room.json` は想定どおり floors/walls/doors/windows/objects、各 `transform`(4x4)と `dimensions`、`category` は `{'floor':{}}` のような入れ子。
- 見つけた不具合と直し: 床の中心にキャラを立たせる既定の立つ位置が、**机の中**だった(余裕 0 m)。`clearance.mjs` に `findOpenSpot`(壁と家具から一番離れた歩ける点)を足し、取りこみ時に塞がっていれば空いた床へ動かし、向きも最初のドアへ直す(`(-0.92, 0.54)` → `(0.27, 1.64)`、余裕 0.71 m)。
- 検査の結果: 予算「採用」。行ける床 83%(家具で分かれている。基準 90% 未満)、ドア 2 枚が幅 0.69・0.72 m で人の幅 0.72 m に足りない・歩いて行けない(参考の情報。AR で見るには関係しない)。
- 見た目: 「素材貼り」が床と一部の壁を木に判定した(wood 136 面)。上から見ると床が茶色の木目で、実物と合うかは本人に確かめてもらう。
- `shot.py` は環境変数 `SHOT_CLEAN=1` で情報欄とボタンを隠せる(部屋を見せる絵用)。
- 撮った原本は `work\scans_in\`(リポジトリの外)。`places/room_1102/` と、それを載せた `places/index.json` は、本人の OK が出るまでコミットしない。

### 2026-11-02 夜 参考リポジトリの調査(本人の依頼「ラスト 30 日で調べて」)
- last30days(DeepSeek 要約)は 4 題とも薄かった(Wi-Fi 転送と Gaussian Splatting は中身なし)。収穫は wesbos/3d-model-anything(LiDAR+写真 → three.js の部屋、★2,632、10-27)の発見。そこで DeepSeek に「URL・ライセンス・最終更新・スターを実際に確かめる」調べ方で 4 題を頼み直し、10 件前後ずつの表を得た。主要 10 件は GitHub API で実在・ライセンス・更新日を私が確認(一致)。
- まとめは `work\research_30d\まとめ.md`(リポジトリの外)。写真の色貼りは Open3D / mvs-texturing / xatlas、Wi-Fi 転送は iLiDAR・NeRFCapture、Gaussian Splatting は COLMAP → LichtFeld か nerfstudio → Spark・GaussianSplats3D、テレビの窓は three.js + MediaPipe の非対称視錐台(off-axis)。コードは写さず、使うときは `docs/部品の一覧.md` に載せる。
- 本人の指示: 自宅の部屋の写真・映像は使ってよい。サンプル会場は箱が広く(天井 10 m)LiDAR(約 5 m)では撮れない → 既存の UE の箱を使う / パノラマ / 寸法を測って箱を作る、を提案済み。

### 2026-11-03 未明 撮影記録(動画+コマごとのカメラ位置・向き・画角)を作った
- 依頼: 本人の「カメラに iPhone を付けてトラッキングして、UE のサンプル会場のどこで、どの画角・何ミリで撮ったかを記録すれば、あとで入れ替えや合体ができる」。
- 3 つ目の iPhone アプリ「撮影記録」(`place/ios/ShootLog/`、識別子は本人のハンドルを含まない `app.sample.hackathon.shootlog`)。ARKit の `capturedImage` を AVAssetWriter(HEVC)へ、同じコマの姿勢・画角・追跡状態を `frames.jsonl` へ。床と LED の 4 隅(十字を合わせてタップ)を校正として `meta.json` に残す。横向き固定、4K30 と最大 fps の形式を画面で選べる(`supportedVideoFormats` の一覧は meta に残る)。
- 署名なしの型確認は 1 回で通り(警告は `contentEdgeInsets` の非推奨のみ)、署名つきも通って、本人の iPhone 12 Pro に入れて起動確認(6 秒後も動作中)。カメラの許可は本人の「許可」待ち。つまずき: iPhone が `unavailable` の間は組み立てが終了コード 70 → 先に `generic/platform=iOS` で署名つきを通し、つながってから `devicectl install` だけ。`grep available` が `unavailable` にも当たる罠。
- PC 側 `place/shootlog/`(Python): `align_led.py`(4 隅のレイ → ARKit 世界→LED の変換。未知数は y 回転+位置の 4 つ)、`export_ue.py`(UE 用 CSV: 位置 cm・Pitch/Yaw/Roll・画角・35mm 換算 mm)、`overlay_room.py`(room.json の窓/ドア/物の 4 隅を LED 代わりに位置合わせ → 動画に部屋の線を重ね、輪郭までの距離を測る)、`led_pnp.py`(保険: 固定カメラの映像で solvePnP)、`receive_shoot.py`(AirDrop の zip → J: に取りこみ)、`selftest.py`。
- 合成データでの確かめ(家の部屋の窓を LED に見立て、仮の ARKit 世界で 10 秒): 変換の復元 位置 0.13 cm・向き 0.034°、角の再投影誤差 0.14〜0.27 px、重ね合わせの輪郭距離の中央値 1.9 px(わざとずらした線は 11.8 px)。solvePnP は最初のコマで正解(0.3 px)、細い線だけの合成映像では LK 追跡が 10 コマ程度で外れ、10 コマごとに指定し直すと中央値 6.8 cm(最大 43 cm)。実映像での追跡は未確認。
- **未確認(実機が要る)**: ARKit の座標の約束どおりに映像と姿勢が合うか、4K で何 fps が出るか・コマが落ちるか、手ぶれ補正やピント合わせで K がどう動くか、暗所で追跡が切れる様子、AirDrop の zip が Mac に届くこと、本人の家での 30 秒の合格確認(重ねた絵とずれの数字)。
- 撮った映像・家の部屋のデータはリポジトリに入れない(`J: の撮影置き場(リポジトリの外)`)。

### 2026-11-03 未明 主カメラが a7 III になった: レンズの歪み・iPhone とのずれ・同期の道具
- 依頼: 本人「スマホを α7-3(24-105)に付けて撮る。LED に点を出してレンズの歪みを測る。歪みは直さずキャラも歪ませる。ゲンロックはなし」。
- 作った物(`place/shootlog/`、Python): `make_led_board.py`(LED に出す ChArUco の盤)、`lens_calib.py` + `lenslib.py`(a7 動画から焦点距離・歪み・UE 用の値・ST マップ)、`apply_distortion.py`(CG に歪みをかける)、`make_sync_pattern.py` + `sync_flash.py`(LED の白フラッシュで 2 台の時刻を合わせる)、`rig_offset.py`(盤を両方で見て、止まっている所から固定のずれと LED の位置を出す)、`export_a7_ue.py`(a7 の各コマのカメラを UE 用 CSV に)、手順 1 枚(`校正の手順.md`)。
- 合成データでの確かめ(3 本とも合格): レンズ(1920×1080、k1=-0.12 など)→ 焦点距離 0.02 px 差、歪みを直した位置の差 平均 0.05 px、ST マップで歪ませた CG の格子と真の歪みの距離 平均 0.39 px。同期(a は 29.97 fps、b は不ぞろい、時計の進みの差と 1.237 s のずれ、フラッシュ 6 回のうち b には 5 回)→ 誤差 最大 15 ms。通し(a7 歪みあり + iPhone の記録に雑音、時刻合わせ誤差 12 ms、止まる所 8 か所)→ ずれ 位置 6.7 mm・向き 0.047°、UE のカメラ位置 平均 1.0 cm(止まっている間 0.7 cm)。
- **未確認(実機・a7 の映像が要る)**: a7 の実映像で盤の角が見つかるか(4K・距離・LED の明るさ)、24-105 の歪み(樽型が強い・ズームで変わる)で係数が安定するか、LED 以外の明るさの変化が同期の検出を邪魔しないか、iPhone の映像の歪み(ARKit の K は歪みなしの近似)がずれの測定に効く量、UE の Lens File に係数を入れたときの向きの規約。
- つまずき: `cv2.imwrite` が日本語のフォルダ名に黙って書かない → `lenslib.imwrite` に。16 コマの動画を OpenCV で読むのに `/tmp` を使うと Python から見えない(Git Bash の仮想パス)。
- LED に出す物と手順は `J: のショー用フォルダ(リポジトリの外)` に置いた(リポジトリの外)。

### 2026-11-03 早朝 UE モニター・予行・写真で部屋に色(PC 側)
- **UE モニター**(撮影記録に「UE」ボタン、スイッチを切れば従来どおり): ARKit の位置・向き・画角を UDP(1 コマ 1 行の JSON)で作業用 PC へ、UE の絵(Pixel Streaming)を WKWebView の全画面に。実機(iPhone 12 Pro + 作業用 PC、UE なし)で、UDP 30 パケット/秒・100 秒超・欠け 1・間隔 33.3 ms(最大 45 ms)、WKWebView は作業用 PC の http の動画を再生、RTCPeerConnection のループバックの映像も受けて 10 秒に約 425 コマの動き検出が届いた。熱は 40 秒の測定で nominal↔fair。**未確認**: UE の Pixel Streaming そのもの、遅れ(ms)の実値(UE が無いので、仕組みの確認までで値は 0.18 の弱い相関)、1 分テスト(アプリが 45 秒ほどで止まり最後まで回らなかった。画面が消える/ほかの操作の可能性)、録画と同時の負荷。公式の Unreal VCam は自前の ARKit を持つので撮影記録と同時には使えない(DeepSeek の調べ、docs で照合)。
- **予行**(ウルトラワイド 5120×1440 を LED の代わりに): `place/shootlog/rehearsal/led_sim.html`(盤・4 隅・同期フラッシュ・短い映像を Space 1 回で自動)と、`rehearsal_analyze.py`(本物の映像で ARKit のドリフト・位置合わせの誤差・iPhone のレンズ・同期・画素の大きさの確かめ)。合成データで動作確認。作業用 PC のメイン画面を全画面にするため、本人の合図待ち。
- **写真で部屋に色**(1 段目): `room_color_project.py`(映像 + ARKit の姿勢 + 窓の 4 隅 → 壁・床のテクスチャ → `room_photo.glb`、variants.photo で `?variant=photo`)。合成の部屋(家具 12 個、ARKit の雑音つき)で見えた所の PSNR 30.5 dB、中央値の差 5/255、見えた割合 25〜50%。ビューアで photo の版が読めた。つまずき: `cv2.remap` の地図が 32767 超で落ちる(512 列に分ける)、家具の箱を縮めて遮りを見ると家具の色が壁に漏れる(大きめに見る)。露出の補正は未。
- 24p/30p の両方で、同期・ずれ・UE カメラ位置の試験が合格(レンズ校正は fps 非依存)。lens_calib に `--fix-principal-point`。

## 2026-11-03 夕 土台の再編: 「箱の見え方」(place/venue/)を期間中の物だけで作った
- 方針: 図面から前に作った UE の箱は使わない。LED 3 面の形はショーの柱が期間中に実測で作った `show/ue/stage_layout.py`(読むだけ)。座席・演者の位置は仮の値(`scenario.json`)。
- 今朝の撮影記録は使える: 03:16 に iPhone 12 Pro で撮った実機の 1 本(4K30、8.9 秒、268 コマ、落ちたコマ 0、追跡が不正常なコマ 0、床+LED の 9 隅を記録済み、UE リンクの UDP 2326 個を送って失敗 0、熱は最大 serious)。モニターを撮った物で、サンプル会場の箱ではない。本人の予行の映像は未着。
- 見え方の計算 `venue.py`(座席の目 → LED の点の線が演者の円柱・舞台の箱に当たるか、見る角度の cos): 手計算との確かめで、影の幅 83.7 cm(手計算 85.5)、影の上の高さ 311 cm(同 305)、舞台の縁に隠れる割合 0.113(`sim_layout.py` の計算 0.111)。
- ブラウザのシミュレーター `place/web/venue_sim.html`: LED の板に絵を貼り(板ごとの UV は stage_layout の割り当てのまま)、座席の目から見る。3 面・中央のへこみ・C の曲がりが出る。
- 座席 2 か所 × 演者 2 通りで、隠れる所の絵と数字を作り、Claude に指摘させた(`claude_review.py`、claude-sonnet-5-5)。座席 1 × 演者 中央では、主役の足元(左ブーツとスカートのすそ)が演者に隠れる(B 面の 4.3%)と、C の右端が斜めすぎる(cos 0.537、今の映像は星だけで困らない)を指摘。数字は計算の値と一致、足元の重なりは赤の絵で確認。4 場面、1 回 8〜12 秒、入力約 4,600・出力 800〜1,150 トークン。
- iPhone の撮影から箱の詳細を読む `scene_reader.py`: コマを選び、Claude が足元の位置を答え、ARKit の姿勢で床へ伸ばす。**合成の撮影(シミュレーターの絵 6 枚、正解の分かる 5 個の置き物)で、5/5 を見つけ、床の位置の誤差は中央値 10.5 cm・最大 18.9 cm**(足元は物の手前の縁を指すので、中心との差を含む)。実写の精度ではない。実機の 03:16 の映像(机とモニター)では、床に立つ物が無いので 0 個(作り話をしなかった)。
- 実写と並べて測る `side_by_side.py`: 合成の「実写」(OpenCV の射影)とシミュレーターのページの盤の角の差が、中央値 0.5〜0.9 px(横 1280 の絵、20 角)。ページの LED の形・絵の貼り方が計算と合っているかの確かめ。**サンプル会場の実写の一致は未測定**。
- つまずき: Playwright は `channel="chrome"` でないと起動しない(headless shell が無い)。最初の Claude の指摘は max_tokens 1500 で JSON が途中で切れた(3000 に、項目を 100 字以内に)。最遠点でコマを選ぶと、同じ位置のコマが重なった(ぼやけの基準を中央値の 6 割に)。Claude の物の種類の答えは揺れる(ポールを rope と答えた)ので、正解との照合は種類でなく位置で。
- 使った API: 画像つきの呼び出し約 25 回、入力約 55,000・出力約 20,000 トークン(CLAUDE_CREDIT_API_KEY)。

## 2026-11-03 夜 土台の再編その 2: 同時の試験・複数カメラ・HEVC の PC 録画・音・複数面の校正(場所の柱)
- **同時試験(iPhone 12 Pro、4K30 録画、各 60 秒、Wi-Fi、UE は 720p/30)**: A 録画のみ・B +UE・C +映像(JPEG)・D 全部・H +HEVC フル HD・I +UE+HEVC、どれも**録画のコマは落ちず(落ち 0)、間隔は 33.3 ms のまま、追跡も切れなかった**。熱は、冷えた状態から始めた回で、A・C・H は fair のまま、**UE の絵を足した B・I は serious**(熱の主犯は UE の絵の受信・表示。符号化と送りではない)。1 巡目の D は直前の B の熱が残って critical で始まった(アプリが動き続けて冷えなかった)ので、アプリを試験ごとに自動で閉じて冷ます(`--exit-after-record`)ようにした。表は `concurrency_report.py`、自動の回しは `run_concurrency.py`(`--auto-record 秒`、ssh で Mac 経由、iPhone から `devicectl` で取り出す)。
- **作業用 PC へ映像**(撮影記録 `PCStream.swift`、受け手 `pc_stream_receiver.py`): 最初は JPEG(960 幅、符号化が平均 123 ms で 9 fps)→ 縮小を VideoToolbox(`VTPixelTransferSession`)にして平均 11〜14 ms・約 15 fps・約 5 Mbps。時計のずれは PING/PONG(PC が問い合わせ、端末が時刻を返す。往復が最小のものから推定)で引き、遅れは中央 92〜106 ms。見かけの遅れが約 0.9 秒で一定だったのは、**端末と PC の時計のずれ**(最小値 902 ms のまま動かなかったので気づいた)。
- **HEVC のハードウェア符号化**(`HEVCEncoder.swift`、VTCompressionSession、低遅れ・B フレームなし・Annex B)で 1920×1080・30 fps・目標 18 Mbps: 実測 17.6 Mbps、PC が 2127 コマを欠けなしで受け、`ffmpeg -f hevc -c copy` で再符号化なしに mp4 にできた(キー 36)。遅れ 中央 130 ms(p95 190〜280 ms)。つまずき: `kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder` は iOS 17.4 以降(iOS では既定がハードウェアなので外した)、`CACurrentMediaTime` は QuartzCore の import が要る。
- **実機の複数カメラ(`--probe-multicam`、AVCaptureMultiCamSession)**: **ARKit が動いている間に別の撮影を始めると ARKit は止まる**(超広角で 0.8 fps、望遠で 0 コマ)。ARKit なしで、2 レンズは **4K30×2**(広角+超広角、広角+望遠、超広角+望遠。hardwareCost 0.57)、3 レンズは **1280×720/30 だけ**(圧 1.05)、LiDAR のカメラ映像+1 レンズは 4K×2。ARKit の録画の形式は広角 1 本だけ(4K の 24/25/30、1920×1440 と 1080p の 30/60)。**ARKit の 4K の横の画角は約 68°(35mm 換算 約 26 mm)**。つまずき: 別のアプリ(CamProbe)はカメラの許可の窓で止まったので、撮影記録(許可済み)の中に組み込んだ。
- **マイク**(`AudioCapture.swift`): AVAudioSession=measurement(自動音量調整なし)、48 kHz、映像と同じホスト時間の時刻つき。録画は video.mov に 24 bit PCM の音声トラック(最初の音は映像の 0.071 秒、30.035 秒、6007 塊・捨て 0)、PC へは AUD1(40.9 秒、欠け 0)。静かな部屋の最大 −48 dBFS。**iPhone の空き容量は 7.2〜7.4 GB(128 GB の端末)**: 4K30 の録画は 3.7 MB/s(1 時間 13.4 GB)なので、**今の空きでは約 33 分**。本番の前に空けるか、フル HD の録画にする。
- **複数面の校正**(`multi_calib.py`、`make_multi_pattern.py`、`timecode.py`、`read_timecode.py`): 面ごとに ID が重ならない盤(ChArUco)を出し、動きながら撮った映像から、レンズ・各面の位置と向きと大きさ・ARKit の座標との変換と縮尺を、バンドル調整(scipy、疎なヤコビアン)で一度に解く。合成(3 面、40 視点、雑音 0.3 px、ARKit は位置 1 cm の雑音+2 cm のずれ): 焦点距離 1399.8(正解 1400)、面の位置の誤差 0.3〜0.6 mm・向き 0.02°、面の大きさを 3% 誤っても 1.0301(正解 1.0300)で回復、ARKit の変換 位置 0.97 cm、再投影 0.42 px。コマ番号の帯(16 ビットの Gray コード、上と下)は、1/60 の露出で画面の切り替わりが混ざっても、ビットの明るさの混ざり具合から**コマの小数まで読める**(合成: 残差 0.08 ms、更新 60.000 Hz、ローリングシャッター 11 ms)。**どれも合成の確かめで、実画面・実機の撮影では未確認**。disguise の公開の説明: LED の xR 校正は白い点で「映像から解いた位置」と「追跡の位置」を比べて変換を解く(共通のゲンロックが必須)。
- 部屋のデモ(案 R): `place/web/room_demo.html`(ARKit の映像の上に VRM を重ね、画面の左右の足元の床を 2 回タップ → 画面から出てきて歩いて戻る)。殻なしのブラウザで確認。実機は未確認。
- 自宅の 3 枚のモニター: 中央 120×33 cm(5120×1440)、上の左 70×40 cm(CC5 使用中)、右の縦 39×70 cm 相当。サンプル会場の A・B・C に見立てると並びと大きさを同時に守れない(C が幅広)ので、校正は面の比率を合わせなくてよい方式にした。モニターの湾曲は実物の C のカーブ(半径約 2.5 m)に合わない。
- つまずき: Bash の heredoc で Swift/Python の `
` が改行になる(Write/Edit の道具か、パッチを書いたファイルで直す)。`devicectl` の転送は iPhone がロックされると `unavailable` になる。`ssh` の Mac では `timeout` が無い。COS を 3 つ並べて投げると 2 つ落ちた(1 つずつ)。
