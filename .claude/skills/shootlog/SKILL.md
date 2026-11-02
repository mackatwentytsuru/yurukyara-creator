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
