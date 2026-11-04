# 入口の LED の UE のレベル(期間中に作ったショーの UE プロジェクトに足す。途中)

ショーの UE プロジェクト(`show/README.md`。リポジトリの外。Python だけで組む)に、新しいレベル `/Game/_Work_tmp/Entrance/L_Entrance_Interview` を足し、縦長の入口の LED(幅 236 × 高さ 300 cm の比)に人型が等身で立つ絵を、HDMI の LED へ窓で出す形。プロジェクトの設定は変えない(Python の起動の台本は環境変数 `UE_PYTHONPATH` で渡し、`-EntranceKiosk` のときだけ動く)。

| ファイル | 中身 |
|---|---|
| `entrance_config.json` | 設定の 1 か所(キャラの FBX と骨の名前・LED の比・カメラ・UDP のポート・目と首の配分) |
| `build_entrance.py` | 画面なしの UE で: 人型の FBX の取り込み → 材質の作り直し → PoseableMesh の BP → レベル(部屋・光・縦長の画角のカメラ) |
| `entrance_materials.py` | CC の説明ファイル(FBX の横の json)から、不透明・切り抜き・髪(根元 → 毛先の色)・非表示の 4 種の材質を作って当てる |
| `py/init_unreal.py` `py/entrance_runtime.py` | ゲーム中: UDP の v1(視線の橋 `gaze_bridge.py` と同じ形)で首・目、`{"mouth":0〜1}` で顎を動かす。骨の軸に依存しない(部品の座標で回す) |
| `run_entrance.ps1` | 縦長の窓で起動(`pwsh`。`-game -windowed -ResX/-ResY -NoSound -EnablePython`) |
| `entrance_talk.py` | 文字の質問 → `/api/chat`(interview: true)→ 手元の日本語の声で WAV(鳴らさない)→ 音の大きさ → 口を UDP で |
| `gaze_to_ue.py` | 会話サーバーの視線の受け口(`/api/gaze/now`。校正の画面の「狙い」も含む)→ UE へ v1 |

## 動かし方
```
UnrealEditor-Cmd.exe <HackShow.uproject> -run=pythonscript -script=kiosk/ue/build_entrance.py -unattended -nullrhi   # 組む(キャラの差し替えも同じ 1 行)
pwsh -File kiosk/ue/run_entrance.ps1 -WinX <LED の画面の x> -WinY <y> -Log rt.jsonl                              # 縦長の窓
python kiosk/ue/gaze_to_ue.py --server http://127.0.0.1:<会話サーバー>                                              # 視線(校正の画面を使うとき)
python kiosk/ue/entrance_talk.py --server http://127.0.0.1:<会話サーバー> "質問 1" "質問 2"                         # 口
```

## 確かめた事(11-05)
- `-game` の UE でも Python が動く(`-EnablePython`。`UE_PYTHONPATH` の `init_unreal.py` が起動時に読まれる)。毎コマの受け口は約 230 回/秒で回る。
- 視線 az=+30° で、首と頭が 17°、目が 13° 客の右(画面の右)へ向く(正負は合っている)。

## 止まった所(11-05、未解決)
- 人型の CC の FBX を、このプロジェクトの FBX の取り込み(5.8 の Interchange・従来の取り込み・「最初のコマを基準の姿勢」)で入れると、**服(コルセット・ブーツ)が体の中に入って見えず、スカートの裾が飛び散る**。UE は「骨の基準の姿勢が無効」と警告する。Blender で同じ FBX を読むと服は体の外にある(FBX は正しい)。Reallusion の取り込み(CC 専用のプラグイン)では正しく出る。Blender で書き出し直すと骨の位置まで崩れた。
- このため、人型の動画はまだ作っていない(体が出た絵になる)。
