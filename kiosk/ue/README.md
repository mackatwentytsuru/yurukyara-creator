# 入口の LED の UE のレベル(期間中に作ったショーの UE プロジェクトに足した新しいレベル)

ショーの UE プロジェクト(`show/README.md`。リポジトリの外。Python だけで組む)に、新しいレベル `/Game/_Work_tmp/Entrance/L_Entrance_Interview` を足し、縦長の入口の LED(幅 236 × 高さ 300 cm の比)に人型が等身で立つ絵を、HDMI の LED へ窓で出す形。プロジェクトの設定は変えない(Python の起動の台本は環境変数 `UE_PYTHONPATH` で渡し、`-EntranceKiosk` のときだけ動く)。アセットはリポジトリに入れない(このフォルダの台本で作り直せる)。

| ファイル | 中身 |
|---|---|
| `entrance_config.json` | 設定の 1 か所(キャラの元の FBX・UE が読む GLB・骨の名前・LED の比・カメラ・UDP のポート・目と首の配分) |
| `cc_fbx_to_glb.py` | Blender(画面なし)で、CC の FBX → UE 用の GLB。骨の枠とメッシュの枠を揃え、腕を下ろした姿勢を基準にし、口(`V_*`)とまばたき(`C_Blink*`)の形だけ残し、1 つのメッシュにまとめ、骨の親の回転と縮尺を焼き込む |
| `build_entrance.py` | 画面なしの UE で: 人型の取り込み(GLB は Interchange、.fbx なら従来の取り込み)→ 材質の作り直し → PoseableMesh の BP → レベル(部屋・光・縦長の画角のカメラ) |
| `entrance_materials.py` | CC の説明ファイル(FBX の横の json)から、不透明・切り抜き・髪(根元 → 毛先の色)・非表示の 4 種の材質を作って当てる。GLB のときは絵を説明ファイルの場所から直接取り込む |
| `py/init_unreal.py` `py/entrance_runtime.py` | ゲーム中: UDP の v1(視線の橋 `gaze_bridge.py` と同じ形)で首・目、`{"mouth":0〜1}` で顎を動かす。骨の軸に依存しない(部品の座標で回す) |
| `run_entrance.ps1` | 縦長の窓で起動(`pwsh`。`-game -windowed -ResX/-ResY -NoSound -EnablePython`) |
| `entrance_talk.py` | 文字の質問 → `/api/chat`(interview: true)→ 手元の日本語の声で WAV(鳴らさない)→ 音の大きさ → 口を UDP で |
| `gaze_to_ue.py` | 会話サーバーの視線の受け口(`/api/gaze/now`。校正の画面の「狙い」も含む)→ UE へ v1 |
| `run_ue_pass.py` `calib_flow_pass.py` `compose_ue_pass.py` | 通しの録画(① 録画の客を追う ② 4 往復で口 ③ 床の 6 点の校正 ④ 校正後に同じ録画を追う)と、1 本の動画への合成 |

## 動かし方
```
blender -b --factory-startup -P kiosk/ue/cc_fbx_to_glb.py                                                     # FBX → GLB(約 1 分。設定の source_fbx → fbx)
UnrealEditor-Cmd.exe <HackShow.uproject> -run=pythonscript -script=kiosk/ue/build_entrance.py -unattended -nullrhi   # 組む(約 4 分。キャラを替えたら ENTRANCE_REIMPORT=1)
pwsh -File kiosk/ue/run_entrance.ps1 -ResX 1180 -ResY 1500 -WinX <LED の画面の x> -WinY <y> -Log rt.jsonl           # 縦長の窓
python kiosk/ue/gaze_to_ue.py --server http://127.0.0.1:<会話サーバー>                                              # 視線(校正の画面を使うとき)
python kiosk/ue/entrance_talk.py --server http://127.0.0.1:<会話サーバー> "質問 1" "質問 2"                         # 口
```
- **キャラの差し替え**(例: 次の版の FBX): `entrance_config.json` の `character` の `source_fbx`・`cc_json`・`fbx`(GLB の置き場)・`name` を替え → 上の 1 行目と 2 行目(`ENTRANCE_REIMPORT=1`)。骨の名前が同じなら、ほかは変えない。
- 親の材質の式を変えたときは `ENTRANCE_REMAKE_MASTERS=1` を付けて組む。

## 別の機械(HDMI で LED に出す機械)で動かす
組んだ機械から、次の物だけを写す(ショーのプロジェクトの写しがあっても、別のフォルダにする。ショーのアセットは使わない):
```
<先>\HackShow\HackShow.uproject, Config\                 ← プロジェクトの殻
<先>\HackShow\Content\_Work_tmp\Entrance\             ← 入口のレベル一式(約 460 MB。エンジンの基本の形のほかは参照しない)
<先>\kiosk_ue\  ← py\・entrance_config.json・entrance_talk.py・gaze_to_ue.py
<先>\tools\ue_link\haruka_wav.ps1                         ← entrance_talk.py が ../tools/ue_link から読む
<先>\start_entrance_ue.cmd                                ← このフォルダの物(エンジンの場所・解像度・窓の位置を先頭で直す)
```
- 起動は `start_entrance_ue.cmd`(PowerShell 7 が無くても動く。`-game -windowed -ForceRes -EntranceKiosk -EnablePython -NoSound`、DDC は `-ddc=InstalledNoZenLocalFallback -LocalDataCachePath=<保存先>`)。初回はシェーダーとテクスチャの組み立てで長い(11-05 に別の機械で、起動から受け口が動くまで約 3.6 分。首 ±19°・目 ±13°・顎が動き、正常に閉じた)。窓が画面より大きいとはみ出すので、LED を別の画面にして `WINX/WINY` で置く。
- 会話サーバーと `gaze_to_ue.py`・`entrance_talk.py` は同じ機械で動かす(UE の受け口は 127.0.0.1 だけを聞く)。`entrance_talk.py` は numpy が要る。
- 画面のある利用者のセッションで起動する(ssh の中から起動しても窓は出ない。1 回きりの予約タスクを Interactive で使う)。

## 確かめた事(11-05)
- 人型(CC の FBX・骨 124 本)が、服(コルセット・手袋・ブーツ・スカート)を着た姿で、腕を下ろして縦長の窓に等身で立つ。
- 視線 az=+30° で首と頭が 17〜18°、目が 12〜13° 客の右へ。el=−10° で下へ。口の値 1 で顎が開く(向きの正負は合っている)。毎コマの受け口は約 260 回/秒。
- 最終の人型(`human_final`。骨・口の形の名前は前の版と同じ)への差し替えは、設定の 4 か所(`name`・`source_fbx`・`cc_json`・`fbx`)を替えて 1・2 行目を流すだけで通った(FBX → GLB 約 14 秒、組むのは約 1 分)。首 ±19°・目 ±13°・顎も前の版と同じ値で動く。別の機械へは `Content\_Work_tmp\Entrance` のうち新しいキャラのフォルダと、レベル・材質の上の段だけを写せばよい(約 480 MB。2 回目の起動はシェーダーの保存先が温まっていて、受け口が動くまで約 40 秒)。
- 通し(録画の客は CG の合成、声は鳴らさない): 顔 99.3%、4 往復で質問から口が動くまで 1.9〜2.6 秒、校正で同じ録画の向きの誤差(中央値)12.9° → 0.7°、校正に使わない 25 点で 11.2° → 1.8°(90% 点 16.1° → 4.0°)。

## 分かった事(つまずき)
- **CC の FBX は、骨の枠がメッシュに対して X 軸まわりに 90° 回った形で入っている**(FBX の姿勢で打ち消してあるので Blender の画面では正しく見える)。UE の FBX の取り込み(Interchange・従来・最初のコマの姿勢)は打ち消さないので、服が体の中に入り、スカートの裾が飛び、腕が伸びる。`cc_fbx_to_glb.py` でメッシュを骨の枠へ回してから GLB にすると直る。
- UE の glTF の取り込みは、メッシュごとに別の骨つきメッシュを作る(→ Blender で 1 つにまとめる)。骨の親(Armature)の縮尺 0.01 を残すと、人型が 1/100 になる(→ 焼き込む)。
- 材質: `SkeletalMesh.materials` の要素は写しなので、書き換えたら配列へ書き戻す。親の材質に「骨つきメッシュ・形で使う」の印が無いと、`-game` では既定の白い材質に落ちる(エディタでは自動で付くので気づきにくい)。直接取り込んだ絵が仮想テクスチャになると、親の材質の絵の枠と合わない。

## 未(正直に)
- 髪が灰色に見える(CC の根元 → 毛先の色が出ていない。根元の絵の当たり方の確認が要る)。手袋も灰色。スカートの薄布(シフォン)に穴が見える所がある。
- 本物の人の顔・店の明るさ・レンズのゆがみ・HDMI の LED の実機での見え方は未確認。会場のシミュレーターの入口の LED に映した見え方は撮っていない。
