# 撮影記録(ShootLog)

iPhone で動画を撮りながら、コマごとの **カメラの位置・向き・画角(ARKit)** を記録する。
あとで UE の仮想サンプル会場の中のカメラを、実際の撮影と同じ位置・画角・焦点距離で動かして、合体や入れ替えができるようにするためのもの。

## 撮る人の手順(スマホで読める 5 行)
1. 「撮影記録」を開いて、カメラを許可。iPhone を**横**に持つ(レンズが左側)。
2. 床に十字を向けて「床を記録」。
3. LED の**左上→右上→右下→左下**(客席から見て)に十字を合わせ、そのつど「隅を記録」(画面タップでも同じ)。
4. 「● 録画開始」→ 撮る →「■ 停止」。校正のあと、アプリを閉じない・画面を消さない。
5. 「共有(AirDrop)」で Mac へ。

右上で LED の面数・解像度・オートフォーカスを選べる(変えると校正はやり直し)。
「露出・色・ピント固定(1/60)」を入れると、シャッター 1/60・ホワイトバランス・ピントを固定し、ISO はスライダーで決める(録画中は変えられない)。画面に白飛びの割合(%)が出る。固定した値は meta.json の `exposureAtStart` / `exposureAtEnd`(同じなら途中で動いていない)。

## 出るもの(iPhone の Documents/shoots/<日時>/ と、共有の shoot_<日時>.zip)
| ファイル | 中身 |
|---|---|
| `video.mov` | 映像(HEVC、ARKit が出す向きのまま=横。回していない) |
| `frames.jsonl` | 1 コマ 1 行。`i`(コマ番号=映像の i コマ目)・`t`(ARKit の時計)・`pts`(映像の秒)・`T`(カメラ→世界 4x4)・`K`([fx,fy,cx,cy] 画素)・`track`/`ok`(追跡の状態。`ok:false` は位置を信用しない)・`exp`(露出秒) |
| `meta.json` | 端末・OS・選んだ形式と取れる形式の一覧・校正(床、LED 4 隅のレイ)・イベント(追跡が切れた時刻など)・統計(コマ数、捨てたコマ)・座標の約束 |

座標の約束は `shootlib.py` の先頭と meta.json の `conventions`。

## PC 側の道具(`place/shootlog/`、Python)
```
python receive_shoot.py                                   # Mac に AirDrop で届いた zip を $SHOOTLOG_DEST/<日時>/ に取りこむ(リポジトリの外)
python align_led.py <撮影> --led-size <横m> <縦m>          # LED の 4 隅 → ARKit 世界→LED の変換(alignment.json)
python export_ue.py <撮影> --ue-origin X Y Z --ue-yaw 度   # UE のカメラ位置(cm)・向き・画角・焦点距離の CSV
python overlay_room.py <撮影> --room <room.json> --led-from window:0   # 動画に部屋の線を重ねる+ずれの数字
python led_pnp.py --video ... --led-size ... --corners "tl=x,y ..."    # 保険: 追跡が切れたとき solvePnP で出す
python selftest.py                                        # 合成データで計算を確かめる
```

### 主カメラが a7 のとき(レンズの歪み・ずれ・同期)。手順は `校正の手順.md`
```
python make_led_board.py --face-px 1280 1240 --out-dir <出力>     # LED に出す ChArUco の盤(A 面)と board_A.json
python make_sync_pattern.py --out sync_flash.mp4                  # LED に流す同期用のフラッシュ映像
python sync_flash.py --a <a7> --b <iPhone video.mov> --b-shoot <撮影> --out sync.json   # 2 台の時刻合わせ
python lens_calib.py --video <a7> --board board_A.json --out-dir lens/                  # 焦点距離・歪み・ST マップ
python rig_offset.py --a7-video <a7> --lens lens/lens.json --iphone-shoot <撮影> --board board_A.json --sync sync.json --out-dir rig/
python export_a7_ue.py ...                                        # a7 の各コマの UE のカメラ位置・画角の CSV
python apply_distortion.py lens/ <CG> <出力>                      # CG に a7 と同じ歪みをかける(歪みは直さない)
python lens_selftest.py / sync_selftest.py / rig_selftest.py      # 合成データでの確かめ
```
合成データでの結果: 歪みの係数 0.4 px 以内、同期の誤差 15 ms(a7 の 1/2 コマ)、iPhone と a7 のずれ 位置 7 mm・向き 0.05°。実機は撮影後。
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

## 点の校正の結果を Mac のテイクから合成まで届かせる(11-04)
アプリで LED の点(33 点)を見せて校正してから録ると、結果が人の手なしで `shoot_track.build_track()` まで通る。
- アプリ → 受け手: 新しい電文 `CAL1`("CAL1" / JSON の長さ u32 / UTF-8 の JSON `{"arSessionId":"…","rays":[点のレイ…] か null}`)。テイクの接続の直後・レイが更新されたとき(1 秒に 1 回まで)・止める直前に送る。受け手はテイクのフォルダの `calibration_rays.json` に原子的に書く(最新が勝つ。`sessions` に見た世界の ID を順に残す)。
- `arSessionId`: ARKit の世界が変わる(起動・`resetTracking`)たびに作り直す。レンズの切り替えは世界が続くので同じ。変わると古いレイは捨てる(Documents の `dot_rays.json` は `{"arSessionId","rays"}` の形)。
- `pc_to_frames.py`: `calibration_rays.json` を `dots_align.py` で解いて `alignment_A/B/C.json`(`source: "dots"`、`rms_cm`、面ごとの残差、点の数)を書く。無い・世界の ID が途中で変わった・点が 10 未満・残差が 4 cm 超のときは、理由を「校正: 使えない — …」と出して書かない(`meta.json` の `calibration_source` にも残る)。
- **frames.jsonl の K は video.mp4 の画素**(`intrinsics_scale` は 1.0、受け手の 4K の画素からの縮尺は `source_intrinsics_scale`)。`shoot_track.py`・`multi_calib.py`・`shootlib.K` が同じ約束で読める。
- Mac の `~/sample_work/rx/` には `pc_to_frames.py` のほかに `dots_align.py` と `show/ue/stage_layout.py`(同じフォルダに)を置く。標準ライブラリだけで動く(Mac の python3 は 3.9 で numpy が無い)。
- 試す(本人の手なし):
```
cd place/shootlog
python calib_handoff_selftest.py     # 通し: 合成のカメラ → HEV1+CAL1 → 受け手 → pc_to_frames → build_track → 正解と比べる(広角・寄り 2 倍・レイなし・世界の ID 違い・更新)
python dots_align_selftest.py        # dots_align.solve が本物のページ(ar_show.js)と同じ答えか(要 python place/ios/tools/make_arsite.py)
python dots_align.py <calibration_rays.json> [--out <撮影フォルダ>]   # 受け手の記録 1 つを解く
```
- 実機で校正の道を試す(点を見ずに): レイの JSON(配列か `{"rays":[…]}`)をアプリの Documents に入れ、`--test-calib-json <ファイル名>` で起動する。本番(引数なし)の動きは変わらない。
- 未確かめ: 実機(iPad)で点を見せて校正 → 録る → Mac で直す → 合成、の通し。

### 校正の追加(11-04 夜 その 2)
- **良い校正を後の悪いレイで上書きしない**: アプリは、ページの status の `dots.good == true` のとき(ページに渡した直後 0.5 秒の status は採らない)渡してある JSON を覚え、CAL1 の `rays` にはそれを入れる(`accepted: true`)。無ければ最新(`accepted: false`)。`latestDots` は最新のレイの本数。世界が変わる・やり直しで消す。受け手の `calibration_rays.json` に `accepted`・`latest_dots` が入る。
- **同じ世界の別のテイクの校正を借りる**: `pc_to_frames.py` は、そのテイクの校正が使えない(レイなし・点不足・残差超え)とき、同じ親フォルダの `take_*` のうち世界の ID が 1 通りで同じ物を解き、合格した物(accepted を先に、次に点の数)を使う。使ったテイクの名前は meta.json の `calibration_source.borrowed_from` と標準出力に出る。世界の ID が違う・途中で変わった・そのテイクの ID が分からない(ファイルが無い)ときは借りない。
- **超広角の固定カット**: `uw_fixed_camera.py --shot` が `alignment_A/B/C.json`(世界が舞台の座標なので面の位置は図面どおり)も書く。`build_track()` が読める。`--curved`(自宅のモニターの試し)では書かない。
- **Mac の受け手の道具を更新**: `python place/ios/tools/update_remote.py --rx --check`(差だけ)、`--rx`(変わった物だけ `~/sample_work/rx/` へ写し、Mac の python3 で `pc_to_frames.py --help`・`dots_align` の読み込み・`pc_stream_receiver.py --help` を確かめる)。動いている受け手は再起動するまで古いコードのまま。
- 試す: `python calib_handoff_selftest.py`(⑥ 借りる・⑦ 世界の ID 違いは借りない を含む)、`python uw_fixed_selftest.py`(固定カットの alignment → build_track)。
