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
- Google 公式 `dl.google.com/android/repository/platform-tools-latest-windows.zip`(8,044,989 バイト)を 作業用 PC の `D:	ools\platform-tools\` に展開。adb 1.0.41(Version 37.0.1-15733141)、署名は Google LLC で有効。PATH・設定ファイルは変えていない(`D:	ools\platform-toolsdb.exe` をフルパスで呼ぶ)。C: 472 GB、D: 125 GB の空き。
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
- まとめは `work
esearch_30d\まとめ.md`(リポジトリの外)。写真の色貼りは Open3D / mvs-texturing / xatlas、Wi-Fi 転送は iLiDAR・NeRFCapture、Gaussian Splatting は COLMAP → LichtFeld か nerfstudio → Spark・GaussianSplats3D、テレビの窓は three.js + MediaPipe の非対称視錐台(off-axis)。コードは写さず、使うときは `docs/部品の一覧.md` に載せる。
- 本人の指示: 自宅の部屋の写真・映像は使ってよい。サンプル会場は箱が広く(天井 10 m)LiDAR(約 5 m)では撮れない → 既存の UE の箱を使う / パノラマ / 寸法を測って箱を作る、を提案済み。
