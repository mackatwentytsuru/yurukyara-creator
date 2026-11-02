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

## 今の状態

- できている: LED 3 面に mp4 が映る、面の境目が絵の境目に合う、扉が左右に開く(静止と 5 秒の動き)、キャラが舞台に立つ。
- キャラを隠すカットでは、床下へ動かしている(`Visibility` のトラックが効かないため。`docs/devlog_ショー.md`)。
- キャラは骨で動く(`Move_Wave`)。顔の絵のコマを途中で変えるのは、まだ試していない。
