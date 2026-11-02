# 撮影記録(ShootLog)

iPhone で動画を撮りながら、コマごとの **カメラの位置・向き・画角(ARKit)** を記録する。
あとで UE の仮想サンプル会場の中のカメラを、実際の撮影と同じ位置・画角・焦点距離で動かして、合体や入れ替えができるようにするためのもの。

## 撮る人の手順(スマホで読める 5 行)
1. 「撮影記録」を開いて、カメラを許可。iPhone を**横**に持つ(レンズが左側)。
2. 床に十字を向けて「床を記録」。
3. LED の**左上→右上→右下→左下**(客席から見て)に十字を合わせ、そのつど「隅を記録」(画面タップでも同じ)。
4. 「● 録画開始」→ 撮る →「■ 停止」。校正のあと、アプリを閉じない・画面を消さない。
5. 「共有(AirDrop)」で Mac へ。

右上で解像度とオートフォーカスを選べる(変えると校正はやり直し)。

## 出るもの(iPhone の Documents/shoots/<日時>/ と、共有の shoot_<日時>.zip)
| ファイル | 中身 |
|---|---|
| `video.mov` | 映像(HEVC、ARKit が出す向きのまま=横。回していない) |
| `frames.jsonl` | 1 コマ 1 行。`i`(コマ番号=映像の i コマ目)・`t`(ARKit の時計)・`pts`(映像の秒)・`T`(カメラ→世界 4x4)・`K`([fx,fy,cx,cy] 画素)・`track`/`ok`(追跡の状態。`ok:false` は位置を信用しない)・`exp`(露出秒) |
| `meta.json` | 端末・OS・選んだ形式と取れる形式の一覧・校正(床、LED 4 隅のレイ)・イベント(追跡が切れた時刻など)・統計(コマ数、捨てたコマ)・座標の約束 |

座標の約束は `shootlib.py` の先頭と meta.json の `conventions`。

## PC 側の道具(`place/shootlog/`、Python)
```
python receive_shoot.py                                   # Mac に AirDrop で届いた zip を work\shoots\<日時>\ に取りこむ
python align_led.py <撮影> --led-size <横m> <縦m>          # LED の 4 隅 → ARKit 世界→LED の変換(alignment.json)
python export_ue.py <撮影> --ue-origin X Y Z --ue-yaw 度   # UE のカメラ位置(cm)・向き・画角・焦点距離の CSV
python overlay_room.py <撮影> --room <room.json> --led-from window:0   # 動画に部屋の線を重ねる+ずれの数字
python led_pnp.py --video ... --led-size ... --corners "tl=x,y ..."    # 保険: 追跡が切れたとき solvePnP で出す
python selftest.py                                        # 合成データで計算を確かめる
```
必要: numpy・scipy・opencv-python。

## 合格の確かめ方(家の部屋)
家の部屋の窓(`room_1102` の room.json の windows[0]、1.53×1.31 m)を「LED」の代わりにして 30 秒撮る。
`receive_shoot.py` → `overlay_room.py <撮影> --room places/room_1102/scan/room.json --led-from window:0`。
出力 `overlay/overlay_XXXX.png`(重ねた絵)と `report.json`(`corner_reprojection_px` と `edge_median_px` / `baseline_median_px`)を見る。

## わかっていること・わかっていないこと
- 合成データでは位置 0.1 cm・向き 0.03° で一致(座標の約束の取り違えを見つけるテスト。ARKit の約束そのものは実機で確かめる)。
- ARKit が手ぶれ補正や自動ピント合わせで画角をどう変えるかは、コマごとの K を記録するので事後に分かる(実機で確かめる)。
- 暗い会場で追跡が切れたときは `track`/`ok` に残り、meta の events に時刻が出る。そのコマは `led_pnp.py` の結果で補う。
- `led_pnp.py` の角の追跡(Lucas–Kanade)は動きが速いと外れる。外れる前に `--reseed-file` で指定し直す。
