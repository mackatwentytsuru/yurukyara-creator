# 2D の道(やり方 A: SVG の部品を板に描いて動かす)

状態: **作り始め(2026-11-06)。** 板のキャラ・まばたき・口 3 形・表情の差し替え・動き(3D と同じ名前)と、意図の列 10 個の試験まで。画面(main.js)にはまだ付いていない。

## 何をするか
- キャラの「中身」(名前・人格・記憶・声)は 3D と共通。2D は見た目の方式の 1 つで、`characters/<id>/2d/` に置く。
- 1 枚の SVG に部品を `<g id>` で分けて描く。部品ごとに小さな絵にして、three の板(平面)に貼り、板を回す・ずらす・つぶす。
- 2D も three の中の板なので、3D と同じ舞台・カメラ・VR の中にそのまま出せる(Quest での見え方は未確認)。

## ファイル
| 場所 | 中身 |
|---|---|
| `web/src/char2d/parts.js` | SVG の部品の切り出し、口 3 形、表情の落とし先、parts.json の点検(three・DOM なし) |
| `web/src/char2d/pose2d.js` | 3D の動き(gestures.js の骨の回転)を、正面から見た 2D の板の動きに直す |
| `web/src/char2d/svg2dCharacter.js` | `Svg2DCharacter`(CharacterBase を継ぐ)。lookAt・setEmotion・setMouth・play・update が 3D と同じ |
| `web/src/char2d/index.js` | ブラウザ用の入口 `createSvg2DCharacter({spec, svg})`。通信はしない |
| `web/src/char2d/intentLocal.js` | 動きの意図(契約 K2)の S2 側の仮の受け手。S5 の `web/src/character/intent.js` が出来たら、そちらを使う |
| `creator/d2/check_parts.mjs` | 部品の点検と、表情を描き足す前後で顔以外が変わっていないかの比べ |
| `characters/yokoso/2d/` | 作例(ようこそくん)。`body.svg`(8KB)と `parts.json` |
| `web/test/char2d_*.test.mjs` | 試験(意図の列 10 個・まばたき・口 3 形・7 表情・部品) |

## SVG の決まり
- 頭の `<svg>` に `xmlns` と `viewBox`。
- 体の部品: `<g id="body">`・`<g id="head">`・`<g id="arm_r">`(キャラの右腕 = 見る人の左)・`<g id="arm_l">`・`<g id="feet">`・`<g id="shadow">` など。名前と箱(box)と回る中心(pivot)と前後(z)は parts.json に書く。`head` は必ず要る(顔は頭に付く)。
- 顔: `<g id="face.<表情>.<枠>">`。枠は `eyes`・`brows`・`mouth_closed`・`mouth_half`・`mouth_open`。
  - 必ず要る: `face.neutral.eyes` と `face.neutral.mouth_closed/half/open`。
  - 描いていない枠は、近い表情(web/src/character/expressionNames.js の決まり)→ neutral の順に落ちる。眉はどこにも無ければ出さない。
  - 目を閉じた絵の表情(happy の ^^ など)は parts.json の `blink.noBlink` に書く(まばたきでつぶさない)。
- 表情を描き足すときは、顔の `<g>` だけを足す。ほかの部品を変えていないことを `check_parts.mjs --base 前の.svg` で確かめる。
- 部品の箱は、ぼかし(filter)のはみ出しまで入れる。

## 確かめ方
```
cd web && node --test test/char2d_parts.test.mjs test/char2d_intent.test.mjs
node creator/d2/check_parts.mjs characters/yokoso/2d
```

## 奥さんの絵から作るとき(絵が届いたら)
- 置き場所: リポジトリの外の入力の置き場(司令室の Q-0059。おすすめの A で進めている: 2D は正面の絵だけ、横と後ろは 3D 用)。仮の id は `tegaki`。
- 手順:
  1. 正面の絵を Claude が見て、部品(頭・体・腕・足・影)と顔(目・口)を読む。元の絵の線と色に合わせて、上の決まりの SVG に描き直す(写真のなぞりではなく、Claude が描く)。
  2. `face.neutral.*` を元の絵の顔のまま描き、ほかの 6 表情は目・眉・口だけを描き足す。
  3. `check_parts.mjs` で問題 0 件、試験の作例を `tegaki` に替えて流す。
  4. 元の絵と並べた絵で、判定役(Claude)に「同じキャラに見えるか」を聞く。最後の見た目は人が見る。
- README に「入力の絵は人(協力者)が描き、許可を得て使用」と書く(S6)。名前を出すか・顔や声を映さないかは本人の答え待ち。
- OBS の録画は触らない(録画中)。

## まだのこと(土 08:00 の判定までに)
- 画面への組み込み: `web/src/character/index.js` で character.json の `looks.2d`(K1)を読み、`createSvg2DCharacter` を呼ぶ 1 か所と、privacy の試験の「確かめ済みの変数の宛先」への 1 行(S5 と S6 への直しの願い。board の S2 の札に書いた)。
- 7 表情と 4 動きの写真(GPU のある描画で。CPU の描画 = SwiftShader では撮らない)。
- 2 体目(奥さんの絵)と VR の中の板(IWER)。
