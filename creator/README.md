# ゆるキャラクリエイター(キャラの柱)

ゆるキャラの絵 1 枚から、3D・骨・顔・動きを作り、`characters/<id>/` に渡す工程です。各段の出来は Claude が絵で見て、足りなければ前の段をやり直します。

## はじめかた

このリポジトリを Claude Code で開いて、「この絵を話すキャラにして」と頼みます。スキル `talking-character` が、環境を調べて(`creator/setup/doctor.py`)、作って、検査して、別の目で判定して、会話の画面で話させるところまで進めます。鍵は聞きません。

## 2 つの道(同じ「絵 1 枚から」)

- **手組み(本命)**: Claude が元の絵を見て部品の一覧(形・色・位置・大きさ)を決め、Blender の Python(`creator/builders/<id>.py`)で数式から一から組み、撮って元の絵と並べて比べ、数字を直す。1 周 16 秒。色むらが出ず、AI の 3D 生成 まわりの許諾の問題がなく、VRAM も要らない。骨・顔・動きは同じ道具を使う。
- **AI の 3D 生成(開発中の比べだけ。提出物のコードには含まない)**: AI で形を作り、自分の絵から色を塗る。形は元の絵に近い(輪郭の重なり 88〜96%)が、色むらと許諾が残る。この版はリポジトリには入れていない。

一覧(元の絵・手組み・AI 生成)は `creator/samples/*_元の絵と比べ.png`。手組みの 1 周は `sh creator/pipeline/run_built.sh <id> <作業フォルダ> x`。

## 流れ(`creator/pipeline/`)

| 段 | 道具 | 内容 | 使う物 |
|---|---|---|---|
| 6 | `f01_face_atlas.py` | 顔の表(表情 × 口の開き)を描く | Pillow |
| 7 | `b03_rig.py` + `b04_motions.py` | 骨・重み・顔の面・動きを作り GLB に書き出す | Blender |
| 8 | `b06_posecheck.py` + `s02_posesheet.py` | 動きの途中の姿勢を撮って一覧にする(崩れを見つける) | Blender |
| 9 | `b05_render.py` + `s01_sheet.py` | 8 方向の一覧 | Blender |
| 手 | `m00_prims.py` + `creator/builders/<id>.py` + `run_built.sh` | 手組みの形(超楕円体・輪・布の板)を作って、骨・顔・動き・確かめまで 1 周 | Blender |
| 比べ | `s03_compare.py` | 元の絵と作った物を並べ、輪郭の重なり(IoU)を測る | |
| 10 | `pk01_package.py`・`pk04_install.py` | `characters/<id>/` に並べて `character.json` を書く | |
| 検査 | `check_all.sh` | 形式・予算・埋まりと浮き・抜け・ブラウザ・視線を 1 回で。直すたびの様子は `check/history/` に残る | Blender・Chrome |
| 判定 | `j01_judge.py` | 作り手以外の目で、同じキャラか・色・部分を判定(既定は新しい文脈の Claude) | claude |
| 話す | `web_talk_check.mjs` | 会話の画面で読み込み・返事・口・表情か動きを確かめる | Chrome |

骨と重みはキャラごとの `creator/specs/<id>_built.json`(位置は外接箱に対する割合)で決める。

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
