---
name: place-pipeline
description: 部屋を iPhone の LiDAR で撮って places/<id>/ にし、ブラウザ・iPhone の AR・Quest 3 の AR/VR で見るまでの手順と落とし穴。place/ や places/ を触るとき、iOS アプリ(場所スキャン・ARステージ)を組み立てて iPhone に入れるとき、撮ったフォルダを取りこむときに使う。
---

# 場所の工程(place/ と places/)

## 全体の流れ
1. iPhone の「場所スキャン」(`place/ios/RoomScan`)で部屋を撮る → `room_mesh.usdz`・`room.json`・`landmarks_hint.json` が出る。AirDrop で Mac へ。
2. Mac から PC へ取る(`scp`)。`node place/tools/ingest_roomscan.mjs <撮ったフォルダ> <id> [表示名]` → `places/<id>/room.glb` と `place.json`。
3. (任意)`node place/tools/name_landmarks.mjs <id> --hint "..."` で Claude が呼び名と案内の一言を付け直す。**お金がかかる API なので、本番で使う前に API 残高の担当へ量を伝える。** 先に `--dry-run` で送る文だけ見る。
4. 見る: `python place/tools/shot.py <出力> <id>`(ヘッドレスで 4 画面)、`python place/tools/native_ar_check.py`(iPhone の殻の偽物で AR を通し試験)。
5. 実機: `node place/tools/serve_https.mjs`(自己署名の HTTPS)→ iPhone の「ARステージ」/ Quest 3 のブラウザで `https://<PCのIP>:8443/place/web/demo.html?place=<id>`。

## 座標の約束(loadPlace.js の先頭にも書いてある)
- m、y が上、右手系。GLB は `scale_m` 倍して m にし、`floor_y` だけ下げて床を y=0 にする。`spawn` と `landmarks` は整えたあとの座標。
- `yaw_deg`: yaw 0 は +z を向く。正が +x のほうへ(上から見て左回り)。`bearingFrom()` の「左へ何度」もこの約束。
- RoomPlan の座標は、原点も向きも撮りはじめた場所しだい。GLB と landmarks を**同じ座標のまま**扱い、床の高さだけ `floor_y` で引く(`landmarks.mjs`)。回さない。

## Mac で iOS アプリを作る(`place/ios/`、xcodegen)
- ssh では `export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH` が要る。送る先は `~/sample_work/place_ios`。
- 型確認だけ: `sh place/ios/tools/mac_check.sh [RoomScan|ARStage]`(署名なし、1 分ほど)。
- 署名つきで iPhone に入れる: **GUI のセッションでないと通らない**。`scheme.txt`・`team.txt`・`device_id.txt`(・ARStage は `url.txt`)を置き、`ssh pc3 'open ~/sample_work/place_ios/mac_install.command'`。`install.done` が 0 なら成功。チーム ID は `security find-certificate -c "Apple Development: …" -p | openssl x509 -noout -subject` の OU。
- iPhone がロック中・圏外だと「destination が見つからない」で終了コード 70。`xcrun devicectl list devices` で `available (paired)` を確かめてから。
- 落とし穴: `simd` は `import simd` が要る。`RoomCaptureViewDelegate` は NSCoding を求めるので、入れ子のクラスにすると「unstable name」で失敗する(外に出す)。

## 調べて分かったこと(出どころは docs/devlog_場所.md)
- iPhone の Safari に WebXR は無い → ARKit の上に透明な WKWebView の殻(`ARStage`)。姿勢の送り方は `place/web/nativeAR.js` の先頭コメント。縦持ち用に `viewMatrix(for: .portrait)` の逆行列と `projectionMatrix(for: .portrait, …)`。
- Quest 3 は three.js の `renderer.xr` で immersive-ar / immersive-vr。機能は全部 optional で要求し、`session.enabledFeatures` を見て分ける。マイクは入る前の 2D 画面で許可。DOM overlay は使えない。
- RoomPlan は家具 16 種だけ(ステージ・カウンター・スピーカーは無い)、色は付かない、1 部屋 9×9 m 目安。広い会場は保証外。
- PC の「Blender 4.5」フォルダは空。変換は Blender 5.2(`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`)。

## 試し方の鉄則
- 実機が無いうちは、偽物で端から端まで通す(`make_fake_scan.py`、偽の殻)。実機で確かめた物と、偽物でだけ確かめた物を、devlog で分けて書く。
- テストは `cd place && npm test`(node の組みこみ)。
