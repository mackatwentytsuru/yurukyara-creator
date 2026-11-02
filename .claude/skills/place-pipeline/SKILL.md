---
name: place-pipeline
description: 部屋を iPhone の LiDAR で撮って places/<id>/ にし、ブラウザ・iPhone の AR・Quest 3 の AR/VR で見るまでの手順と落とし穴。place/ や places/ を触るとき、iOS アプリ(場所スキャン・ARステージ)を組み立てて iPhone に入れるとき、撮ったフォルダを取りこむときに使う。
---

# 場所の工程(place/ と places/)

## 全体の流れ
1. iPhone の「場所スキャン」(`place/ios/RoomScan`)で部屋を撮る → `room_mesh.usdz`・`room.json`・`landmarks_hint.json` が出る。AirDrop で Mac へ。
2. Mac から PC へ取る(`scp`)。`node place/tools/ingest_roomscan.mjs <撮ったフォルダ> <id> [表示名] [--plain]` → `room_raw.glb`(Blender 変換のまま)・`room.glb`(種類ごとの素材を貼った版。`--plain` なら raw と同じ)・`place.json`(`variants` に見た目の名前)・`scan/`(撮った物の写し。素材や色を作り直すため)。ブラウザは `?variant=raw|stylized|photo` で見た目を切りかえる。
2b. **本物の USDZ を Blender が読めなかったとき**: `ingest_roomscan.mjs` は自動で、`room.json`(壁・床・ドア・窓・家具の transform と寸法)の箱から GLB を組み立てる(`glbBoxes.mjs`。`--boxes` で強制)。形は箱のままだが、寸法と位置は RoomPlan の値そのもの。ほかの救済(未実装): USDZ は ZIP なので、中が `.usda`(テキスト)なら形を読める(バイナリの `.usdc` は不可。RoomPlan の本物の中身は未確認)、three.js r187 の `USDLoader`(USDC も読めるとソースにある)、ARKit のメッシュを自前で書き出す(`ARMeshAnchor`)。
3. (任意)`node place/tools/name_landmarks.mjs <id> --hint "..."` で Claude が呼び名と案内の一言を付け直す。**お金がかかる API なので、本番で使う前に API 残高の担当へ量を伝える。** 先に `--dry-run` で送る文だけ見る。
4. 見る: `python place/tools/shot.py <出力フォルダ> <id>`(ヘッドレスで 4 画面)。**出力フォルダと id は必ず両方付ける**(付けないと test_room を `place/shots/` に撮って書く)、`python place/tools/native_ar_check.py`(iPhone の殻の偽物で AR を通し試験)。
4b. 取りこみの確かめ: 偽の撮影(`place/testdata/fake_scan`)を `<id>` に取りこんだときは、`node place/tools/check_ingest.mjs <id>` が合格(終了コード 0)になること。素材貼りの有無・床の高さ・ドアを向く spawn・日本語の目印名まで機械で見る。本物の撮影のときは、箱の寸法を巻き尺と比べる。
5. 実機: `node place/tools/serve_https.mjs`(自己署名の HTTPS)→ iPhone の「ARステージ」/ Quest 3 のブラウザで `https://<PCのIP>:8443/place/web/demo.html?place=<id>`。

## 部屋の色(RoomPlan の面は色も UV も無い)
- 今の版 B: `place/tools/make_textures.py`(コードで描く手続き的な素材。外の画像は使わない)→ `stylize_room.py` が面ごとに床・壁・天井・ドア・窓・家具(木・布・その他)を判定して箱の投影で貼る。名前でなく、RoomPlan の箱(room.json)と面の向き・高さで判定する(USDZ の中の名前は未確認のため)。
- 写真から色を付ける版 A(未着手。写真を残す話なので本人の許可待ち): できたら `room_photo.glb` を作り、place.json の `variants.photo` に足す。

## AR で撮った部屋を現実に重ねる
- AR の世界は起動した位置が原点。`alignFlow.js` の手順(目印の真下の床を 2 回タップ)→ `place.setAlignment`。web/ は `createAlignFlow({place, floorY})` を AR に入ったとき作り、onHit の点を `flow.submit` に渡し、`flow.prompt` を画面に出す。重なったあとは、位置の変換に `place.worldFromRoom / roomFromWorld`、案内に `describeLandmarksFromWorld` を使う。
- 通し試験: `python place/tools/native_ar_check.py`(偽の殻。25 度回した部屋が重なるまで見る)。

## 座標の約束(loadPlace.js の先頭にも書いてある)
- m、y が上、右手系。GLB は `scale_m` 倍して m にし、`floor_y` だけ下げて床を y=0 にする。`spawn` と `landmarks` は整えたあとの座標。
- `yaw_deg`: yaw 0 は +z を向く。正が +x のほうへ(上から見て左回り)。`bearingFrom()` の「左へ何度」もこの約束。
- RoomPlan の座標は、原点も向きも撮りはじめた場所しだい。GLB と landmarks を**同じ座標のまま**扱い、床の高さだけ `floor_y` で引く(`landmarks.mjs`)。回さない。

## Mac で iOS アプリを作る
手順と落とし穴は別のスキル `mac-ios-build` にまとめた(型確認 `mac_check.sh`、署名つき `mac_install.command`)。

## 調べて分かったこと(出どころは docs/devlog_場所.md)
- iPhone の Safari に WebXR は無い → ARKit の上に透明な WKWebView の殻(`ARStage`)。姿勢の送り方は `place/web/nativeAR.js` の先頭コメント。縦持ち用に `viewMatrix(for: .portrait)` の逆行列と `projectionMatrix(for: .portrait, …)`。
- Quest 3 は three.js の `renderer.xr` で immersive-ar / immersive-vr。機能は全部 optional で要求し、`session.enabledFeatures` を見て分ける。マイクは入る前の 2D 画面で許可。DOM overlay は使えない。
- RoomPlan は家具 16 種だけ(ステージ・カウンター・スピーカーは無い)、色は付かない、1 部屋 9×9 m 目安。広い会場は保証外。
- PC の「Blender 4.5」フォルダは空。変換は Blender 5.2(`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)。

## 試し方の鉄則
- 実機が無いうちは、偽物で端から端まで通す(`make_fake_scan.py`、偽の殻)。実機で確かめた物と、偽物でだけ確かめた物を、devlog で分けて書く。
- テストは `cd place && npm test`(node の組みこみ)。
- 偽の撮影を端から端まで通す: `blender -b --python place/tools/make_fake_scan.py -- <フォルダ>`(30 度回した 4×5 m の部屋・table と sofa つき)→ `node place/tools/ingest_roomscan.mjs <フォルダ> _fake_scan` → `python place/tools/shot.py <出力> _fake_scan`。終わったら `places/_fake_scan` を消す(コミットしない)。
- 取りこみの確かめに `serve_https.mjs` は要らない(`shot.py` が自分でサーバーを立てて止める)。`serve_https.mjs` は、本人の実機・Quest の試験のときだけ。ポート 8443 は別の試験で使用中のことがあり、触らない(止めるのは自分で起動した PID だけ)。Git Bash の `$!` は Windows の PID と一致しないので、PowerShell の `Get-CimInstance Win32_Process` で CommandLine を見て `taskkill //PID` する。サーバーのログは `place/` の外に出す。
- Blender を画面なしで終えるとき、`blender_mcp.py … unregister` の RuntimeError が出るが無害(PC の Blender に入っているアドオンの後始末)。

## 段下げ試験(2026-11-02、取りこみ)
固定の試験: 偽の撮影 `place/testdata/fake_scan` を `places/_t_<段>/` に取りこむ(`ingest_roomscan.mjs` → `check_ingest.mjs` → `shot.py`)。まっさらな文脈の作業役に、`place/testdata/skill_trials/brief_ingest.md` の依頼文だけで頼み、合否は私が別に `check_ingest.mjs` で判定した。時間と費用は作業役の実測(トークンはその作業役が使った合計。費用は単価でなくトークンで比べた)。

| 段 | モデル / effort | 合否 | 時間 | トークン | 気づいたこと |
|---|---|---|---|---|---|
| 0 | Opus 5.5 / xhigh | 合 | 46.9 秒 | 138,507 | つまずき無し |
| 1 | Opus 5.5 / high | 合 | 37.7 秒 | 129,999 | つまずき無し |
| 2 | Opus 5.5 / medium | 合 | 30.6 秒 | 128,972 | つまずき無し |
| 3 | Sonnet 5.5 / high | 合(小さな失敗) | 51.9 秒 | 130,612 | `shot.py` を引数なしで動かし、範囲外の `place/shots/` に書いた → 手順に「両方付ける」を書き足した |
| 4 | Sonnet 5.5 / medium | 合 | 28.2 秒 | 127,017 | 書き足した後は、つまずき無し |
| 5 | Haiku 5.5 | 合(範囲外の行動) | 100.4 秒 | 154,016 | 頼まれていない `serve_https.mjs` を 8453 番で起動して置いたままにした(私が PID を止めた)。8443 番が塞がっている・Git Bash の PID・ログの置き場でも迷った → 上に書き足した |

結論: **この試験の一番安く動く設定は Sonnet 5.5 の medium**(合格・最短・トークン最少、書き足し後)。Haiku も合格したが、時間が約 3.5 倍、トークンも多く、範囲外の行動があった。Haiku に任せるなら、依頼文に「サーバーを起動しない」を書く。Opus の xhigh・high・medium の差は出なかった(この試験は、手順が書かれていれば難しくない)。
