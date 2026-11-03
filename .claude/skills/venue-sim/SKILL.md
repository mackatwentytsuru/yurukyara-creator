---
name: venue-sim
description: LED 会場(サンプル会場)の「座席からの見え方」を、期間中に作った形(show/ue/stage_layout.py)で確かめる。座席の目 → LED の各点の遮り・見る角度の計算、ブラウザのシミュレーター、Claude による見え方の指摘、iPhone の撮影から箱の中の物の位置を読む scene_reader、実写との並べ比べ。見え方・座席・演者の立ち位置・LED の重なり・箱の詳細を扱うときに使う。
---

# 箱の見え方(place/venue/)

詳しい使い方は `place/venue/README.md`。ここは「やり方の要点」と「はまった所」。

## 決まり
- 図面から前に作った UE の箱は使わない・見せない。LED の形は `show/ue/stage_layout.py` を読むだけ(数字を写さない)。座席・演者の位置は `scenario.json` の仮の値。
- 比べていない精度は言わない。座席の位置が仮のうちは「この席でこう見える」と言わない。実写との一致は、実写で `side_by_side.py` を流すまで未測定。
- Claude の指摘は絵と数字にあることだけ。安全に関わる指摘は断定せず、人が判断する(`needs_human`)。

## 座標
- stage_layout の座標: cm、x 右(客席から)、y 客席、z 上(左手系の書き方)。three(m)へは `(x, z, y)`。物理の向き(右・上・客席)は保たれ、鏡写しにならない。
- LED の座標(撮影記録): x 右・y 上・z 客席(右手系)。three と軸が同じなので、LED の原点(A 面なら (A_X0, 0, LED_Z_BOTTOM)の cm)を足すだけで three のカメラになる(`side_by_side.three_matrix`)。
- ARKit のカメラ(+x 右・+y 上・−z 前、T は列順 16 個)と three のカメラは同じ約束。シミュレーターの `cameraInfo()` はそのまま ARKit 形式の T・K を返す。

## 計算
- 遮りは、目 → LED の点の線分が、垂直な円柱(演者)・箱(舞台)に当たるか(`venue.py`、numpy)。円柱は 2 次方程式 + z の区間、箱はスラブ法。手計算(真正面の座席・真ん中の演者)と 6 %以内で合う。
- 板が重なる絵の x(A の 957〜1279 と B)があるので、面ごとの帯で見せる(`venue_report.py`)。

## Claude の画像読み(`claude_api.py`)
- キーは環境変数 `CLAUDE_CREDIT_API_KEY_2` → `CLAUDE_CREDIT_API_KEY`。表示しない。画像は JPEG 85・横 1100〜1568。
- max_tokens は 3000 以上(考える分が出力に数えられる。1500 だと JSON が途中で切れた)。「項目は多くて 4 件、各 100 字以内」と書くと収まる。
- 位置は「画像の横縦 0〜1000」で答えさせると、足元の位置が床の上 10〜20 cm の誤差で出た(合成の絵、`scene_reader_selftest.py`)。足元が見えない物は null にさせ、位置を作らせない。
- 物の種類(kind)の答えは揺れる(ポールを rope と答えた)。正解との照合・まとめは種類でなく位置で。
- 床に立っていない物(机・モニター)しか写らない映像では 0 個を返した(作り話をしない)。

## 実写との並べ(`side_by_side.py`)
- 測る 3 つ: photo_vs_calc(ARKit の姿勢 + 位置合わせの計算)、sim_vs_calc(ページが計算と合うか)、photo_vs_sim。盤が写っていなければ null。
- Playwright は `channel="chrome"` + `--use-angle=swiftshader`(headless shell が無い)。`python -m http.server` はリポジトリの根で自分が起動し、終わりに自分の PID だけ止める。
- ページへ渡す絵は repo の外にあるので、`place/web/_*.png` に一時コピーして、終わりに消す。
