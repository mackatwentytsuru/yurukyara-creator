# ショーのステージ(試しの土台)

何か: 3 面の LED ウォールがあるステージを、エンジン付属の基本の形と、ここで新しく書いた Python だけで UE 5.8 に組み、Movie Render Queue で撮る物。プロジェクトは `work/ue_show/HackShow/`(リポジトリの外)。テンプレートも既存の資産も使わない。

## フォルダ

| 場所 | 中身 |
|---|---|
| `project/make_project.py` | `.uproject` と `Config/` を書く |
| `media/make_pictures.py` | LED の絵(5680×1240)を Pillow と numpy で描き、mp4(2840×620)にする。出力は `work/ue_show/media/` |
| `ue/stage_layout.py` | 寸法・LED の面の割り当て・カメラ(UE に依存しない) |
| `ue/build_stage.py` | 入口。材質・キャラ・レベル・シーケンス・撮影設定を全部作り直す(資産は消さず、上書きで使い回す) |
| `blender/merge_motion.py` `blender/inspect_glb.py` | 胴と顔を 1 つのメッシュにし、動きと一緒に 1 本の GLB にする(元のファイルは読むだけ)。中身の表示 |
| `ue/try_motion_import.py` | 動きの glb をそのまま取り込む試し(失敗の記録用) |
| `run/ue_py.sh` `run/render_cut.sh` `run/build_then_render.sh` | UE を動かす |
| `check/measure_cuts.py` `check/make_sheet.py` | 明るさ・継ぎ目の測定、確認シート |
| `ue/build_sim.py` `ue/sim_layout.py` `run/render_sim.sh` `run/render_sim.py` | シミュレーター: 全編の映像と音を、LED だけが光るレベル `L_Sim` に流し、3 つのカメラで撮る |
| `motion/` `led_browser/show_vrm_track.mjs` | 踊り: 外の素材の動き(Fab で購入した KAWAII ANIMATIONS 100。ファイルはリポジトリに入れない)を VRM へ移し、曲の拍に並べる。期間中に作ったのは、この移しかえと配置の道具。`dump_motion_ue.py` → `retarget_clips.py` → `assemble_track.py` → `render_show.mjs --dance-track <頭> --no-zoom` |
| `run/sample_into_ue.sh` `ue/make_motion_glb.py` `ue/import_motion_glb.py` | LED の絵と同じ動きのキャラを UE へ: 描画ページの骨の数字(揺れ物と顔の形まで)を VRM に足して GLB にし、合成とリアルタイムの 2 つのプロジェクトへ入れる。案の差し替えはこの 1 行 |
| `check/make_sim_test.py` `check/measure_sim_sync.py` `check/make_sim_sheet.py` | シミュレーターの同期のテスト素材、ずれの測定、3 案の並べ絵 |

## 動かし方

```sh
python show/project/make_project.py
blender -b -t 4 --factory-startup -P show/blender/merge_motion.py -- model.glb work/ue_show/media/motion_try/f_led_motion.glb motions/wave.glb motions/idle.glb motions/jump.glb
python show/media/make_pictures.py <キャラの絵の png>
sh show/run/build_then_render.sh Cut1_StandWide Cut2_StandClose Cut3_LedCharacter Cut4_DoorOpen Check_Grid Check_Background Check_NoCharacter Move_DoorOpens Move_Wave
python show/check/measure_cuts.py
python show/check/make_sheet.py <出力の jpg>
ffmpeg -framerate 30 -i <render>/Move_DoorOpens/Move_DoorOpens.%04d.png -an -c:v libx264 -crf 16 -pix_fmt yuv420p -map_metadata -1 <出力の mp4>
```

全編のシミュレーター(`build_stage.py` を 1 度動かしたあと。素材の差し替えもこの 1 行):

```sh
sh show/run/render_sim.sh <映像> <show_mix.wav> <出力フォルダ>            # 全編、Cam1〜3.mp4
sh show/run/render_sim.sh <映像> <show_mix.wav> <出力フォルダ> --range 27 37 --cams 2   # 一部だけ
python show/check/make_sim_sheet.py <出力フォルダ> <並べ絵の jpg> --at 2
```

撮影の記録と実写の合成(`show/composite/`):

```sh
python show/ue/import_shoot.py <撮影フォルダ> <シーケンス名>      # 記録 → Cine Camera のキー。面ごとの残差と切れた秒を報告
python show/composite/solve_tripod.py <動画か写真> <12 点の json> --out <撮影フォルダ>   # 三脚の保険。同じ形の記録を作る
python show/composite/sync_by_led.py <実写> <元の LED 映像>      # 音の無い実写が全編の何秒かを出す
python show/composite/make_fake_shoot.py <撮影フォルダ>          # 正解の分かる合成の記録
python show/composite/render_comp.py <撮影フォルダ> <LED の映像のフォルダ> <出力> --show-start 30    # 素材を撮る
python show/composite/fake_phone.py <連番> <mp4>                 # 実写の代わりにする(本物の実写では要らない)
python show/composite/composite.py <連番の親> <実写> <出力の連番> --first 390 --last 600
python show/composite/measure_comp.py <撮影フォルダ> <連番の親> <comp_config.json>   # 足と目印の画素の誤差、ロールの符号
python show/composite/build_demo.py <連番の親> <実写> <合成の連番> <音> <出力 mp4>
python show/composite/mix_final.py <合成の mp4 か連番> <実写の音> <show_mix.wav> <出力 mp4> --start <全編の秒>   # 実写の音(声と響き)と元の音を、ずれと伸びを測って混ぜ、-14 LUFS・-1 dBTP 以下で付ける。耳では未確認
python show/composite/test_mix_final.py                           # 偽の実写音(遅れ・残響・雑音・0.1% 伸び)で誤差 10 ms 以内を確かめる
python show/composite/lens_render.py <lens_calib の出力> --out-dir <出力> --width 1920   # 主点を真ん中に直して UE で描く大きさと ST マップ。render_comp と composite の --stmap へ
python show/composite/focal_options.py <出力の jpg> --video <LED> --wav <音> --out-dir <作業>   # 焦点距離の案の表と 3 枚
python show/composite/make_distort_sheet.py ...                  # 歪みあり・なしの比べ
# make_fake_shoot・make_chain_trial・make_calib_trial・fake_phone は試し専用
```

## LED の全編を 1 行で作る(`run/build_led_full.py`、11-04)

背景(閉じた緞帳・開いた世界)→ 計算の効果 → UE のキャラの層(透明つき・影・映り込み)→ 左右のアップ → 重ね → 原版 → 書き出し → 確認シート → 検査を、1 行で流す。秒は全部 timeline・stage・cues から読む(コードに秒は無い)。行き来は何回でもよい。

```sh
work/AI/venv-sep/Scripts/python.exe -X utf8 show/run/build_led_full.py \
  --timeline <timeline.json> --stage show/show_stage.json --cues <cues.json> \
  --closed <閉じた緞帳の png か動画> --open <開いた世界の png か動画> --plates <stage_plates.py の出力> \
  --character sample_show60 --version sample3_3 --out <作業の置き場>
```

- 段: `bg`(動画の背景を継ぎ目の見えないループに)→ `ue`(UE の層を撮る)→ `post`(透明の割り戻し)→ `head`・`tail`(本編の外の待ち・同期のフラッシュ・黒。今の全編と同じブラウザの描画のキャラなし)→ `body`(重ね。20 秒ずつ区切る)→ `master`(頭 + 重ね + 尾の ProRes)→ `deliver`(LED 用 5680x1240 H.264 音あり、UE 用 2840x620 H.264 音なし)→ `sheet` → `check`(`check/check_led_full.py`)。
- できた段は飛ばす。止まっても同じ 1 行で続きから。やり直しは `--redo <段>`、一部だけは `--stages <段>`。
- 背景の差し替え: `--closed` か `--open` を替えるだけ。キャラの層と頭は使い回す(背景ごとに `body/<指紋>/`)。
- キャラの撮り直し: `--character <資産名>`(層は `layers/<資産名>/`)。
- 試し: `--scale 0.125 --every 4 --skip-ue`(小さな絵・間引き・キャラの層なし)。
- 曲を替える 1 行(`run/song_to_show.sh`)の最後をこれにするには `LED_BUILDER=full LED_CLOSED=… LED_OPEN=… LED_PLATES=… LED_OUT=…`。
- 校正の盤: timeline に `calib` の区間があれば `--calib-video` で差しこむ(`splice_calib.py`)。
- 検査で今の全編と頭・尾を比べるときは `--compare-head <今の全編の mp4>`、ブラウザ版の枠と比べるときは `--ref-boxes <character_box.json>`(足 1212 の古い版なら `--ref-foot-shift -14`)。
- 置き場の作業: `plan.json`(秒の全部)、`stages.json`(段ごとの秒と容量)、`check.json`、`出す物/`。同じ置き場で 2 本を並べて流さない。

LED から舞台へ跳び出す(11-04。`motion/hop.py`):

```sh
python show/motion/make_show_plan.py ... [--hop-form left_front|front] [--no-hop]   # 「出る」ごとに跳びが自動で入る(既定 左手前)
python show/motion/test_hop.py                                                     # 試験(今の曲と song1 の timeline があればそれでも)
python show/motion/foot_heights.py --track <並べた動き> --vrm <.vrm> --start 54.8 --count 276 --out foot.json   # 合成の --foot-height
python show/composite/composite.py ... --exit <踏み切り> <現れきり> --exit-lift 12 --exit-hop 0 --exit-land <宙の山> --foot-height foot.json
```

- 秒の決まり: 着地 = 「出る」の 0.3 秒後より後の最初の拍。踏み切り = その 2 拍前(0.8 秒に近い整数の拍)。動きは JumpForJoy の 1 回目の跳びを秒だけ縮めて使う。
- stage の `hops` に踏み切り・着地・LED の薄れの秒が入る。`led_character` は踏み切りで終わり(舞台のキャラはそこから出る)、LED の絵(`led_plan.hop_extended`、`fx_plan.hop_at`)はキャラを薄れ終わりまで動いたまま残す。
- 舞台の位置は宙の間だけ一定の速さで動き、着地した場所で歌い続ける。前へ歩くのは歩く動きと同じ 0.867 m/s。

## 今の状態

- できている: LED 3 面に mp4 が映る、面の境目が絵の境目に合う、扉が左右に開く(静止と 5 秒の動き)、キャラが舞台に立つ。
- キャラを隠すカットでは、床下へ動かしている(`Visibility` のトラックが効かないため。`docs/devlog_ショー.md`)。
- キャラは骨で動く(`Move_Wave`)。顔の絵のコマを途中で変えるのは、まだ試していない。
