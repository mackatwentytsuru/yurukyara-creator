# ゆるキャラクリエイター(キャラの柱)

ゆるキャラの絵 1 枚から、3D・骨・顔・動きを作り、`characters/<id>/` に渡す工程です。各段の出来は Claude が絵で見て、足りなければ前の段をやり直します。

## 2 つの道(同じ「絵 1 枚から」)

- **手組み(本命)**: Claude が元の絵を見て部品の一覧(形・色・位置・大きさ)を決め、Blender の Python(`creator/builders/<id>.py`)で数式から一から組み、撮って元の絵と並べて比べ、数字を直す。1 周 16 秒。色むらが出ず、TRELLIS.2 まわりの許諾の問題がなく、VRAM も要らない。骨・顔・動きは同じ道具を使う。
- **AI の 3D 生成(比べ用)**: TRELLIS.2 で形を作り、自分の絵から色を塗る。形は元の絵に近い(輪郭の重なり 88〜96%)が、色むらと許諾が残る。この版は `work\creator_worki_versions\` に置き、リポジトリには入れていない。

一覧(元の絵・手組み・AI 生成)は `creator/samples/*_元の絵と比べ.png`。手組みの 1 周は `sh creator/pipeline/run_built.sh <id> <作業フォルダ> x`。

## 流れ(`creator/pipeline/`、AI 生成の道)

| 段 | 道具 | 内容 | 使う物 |
|---|---|---|---|
| 0 | Codex の画像生成 | 顔なしの絵(目・口・光る点を消した同じ絵) | 外の AI |
| 1 | `p01_prep.py` | 背景を抜く | OpenCV |
| 3 | `p03_trellis.py` | 3D の形だけ作る(約 9〜15 分、VRAM 24〜27GB) | TRELLIS.2(重みは使う人が入手) |
| 4 | `b01_mesh.py` | 高さ・向き・面の数・UV を整える | Blender |
| 5 | `p05_paint.py` | 自分の絵だけから UV に色を塗る(AI なし) | trimesh, OpenCV |
| 6 | `f01_face_atlas.py` | 顔の表(表情 × 口の開き)を描く | Pillow |
| 7 | `b03_rig.py` + `b04_motions.py` | 骨・重み・顔の面・動きを作り GLB に書き出す | Blender |
| 8 | `b06_posecheck.py` + `s02_posesheet.py` | 動きの途中の姿勢を撮って一覧にする(崩れを見つける) | Blender |
| 9 | `b05_render.py` + `s01_sheet.py` | 8 方向の一覧 | Blender |
| 手 | `m00_prims.py` + `creator/builders/<id>.py` + `run_built.sh` | 手組みの形(超楕円体・輪・布の板)を作って、骨・顔・動き・確かめまで 1 周 | Blender |
| 比べ | `s03_compare.py` | 元の絵と作った物を並べ、輪郭の重なり(IoU)を測る | |
| 10 | `pk01_package.py` | `characters/<id>/` に並べて `character.json` を書く | |

骨と重みはキャラごとの `creator/specs/<id>.json`(位置は外接箱に対する割合)で決める。

## `type: "rig"` の character.json(キャラの柱が決めた形)

```json
{
  "id": "f_led", "name": "パネルくん", "model": "model.glb", "type": "rig", "height_m": 0.9,
  "expressions": ["neutral", "happy", "surprised", "sad", "think"],
  "motions": { "idle": "motions/idle.glb", "talk": "...", "wave": "...", "nod": "...", "bow": "...", "jump": "...", "think": "...", "sad": "..." },
  "persona": "persona.md",
  "look":  { "bone": "body", "max_deg": [22, 14], "face_shift": [0.03, 0.025] },
  "mouth": { "kind": "atlas", "mesh": "Face", "cols": 4, "levels": [0.08, 0.3, 0.6] },
  "face":  { "mesh": "Face", "atlas": "face_atlas.png", "cols": 4,
             "rows": ["neutral", "happy", "surprised", "sad", "think", "blink"], "blink_row": "blink" }
}
```

- `model.glb`: 骨つきの体(`Body`)と、体の表面に貼った顔の面(`Face`、顔の表を発光で出す)。
- `motions/*.glb`: 1 ファイル 1 動き。骨の名前は `model.glb` と同じ。30fps。`idle` と `talk` は繰り返し、ほかは 1 回きり。
- 顔: 表の縦 = 表情(最後の行はまばたき)、横 = 口の開き(0〜3)。`setExpression` で縦を、`setMouth` で横を選ぶ。視線は顔の絵を少しずらす(目が先)ことと、体(`look.bone`)を少し回すこと(首が後)で表す。
- 読み込みは `creator/viewer/rigRuntime.js` の `loadRigCharacter(url)`。`web/` の `CharacterBase` を継ぐので、`lookAt / setExpression / setMouth / play / update` は VRM と同じ呼び方。

## 確かめ画面

```bash
python creator/viewer/serve.py 8777
```

http://127.0.0.1:8777/creator/viewer/index.html?c=../../characters/f_led/character.json
