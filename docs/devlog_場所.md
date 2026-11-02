# devlog 場所

場所の柱(`place/`、`places/`)の作業記録。数字は測った物だけ書く。うまくいかなかった試しも 1 行ずつ残す。

## 2026-11-02

- 15:20 前の作業役が止めた物を確認。`npm test`(place/)9 件通過。`place/tools/shot.py` で `place/web/demo.html` を 4 画面撮って、ブラウザのエラー 0。
- 直した所: 仮キャラの背が `?height=1.2` で 1.128 m になっていた(頭の積み方の計算ミス)。直して 1.200 m、足元 y=0 を測って確認。
- 手作りの試しの部屋 `places/test_room/`(5.0×4.0 m、高さ 2.6 m、入口 x=1.0 に幅 0.9 m、机 1.2×0.7×0.75 m)。GLB は 17,736 バイト。
- Mac の準備を読むだけで確認: macOS 26.6.2、Xcode 27.0(iphoneos SDK 27.0)、署名の証明書 2 件あり、空き 104 GiB。`xctrace` の一覧に「作者悠生のiPhone (2) (26.3.1)」があった(今は offline)。

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
