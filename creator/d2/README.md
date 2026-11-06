# 2D の道(やり方 A: SVG の部品を板に描いて動かす)

状態: **主役ノリーの 2D ができた(2026-11-06)。** 板のキャラ・まばたき・口 3 形・表情の差し替え・動き(3D と同じ名前)・動きの意図(契約 K2)の試験。会話の画面(main.js)では `?look=2d`(または character.json の `looks.default: "2d"`)で 2D になる(読み込みは S5 の `web/src/character/index.js`)。

## 何をするか
- キャラの「中身」(名前・人格・記憶・声)は 3D と共通。2D は見た目の方式の 1 つで、`characters/<id>/2d/` に置く。
- 1 枚の SVG に部品を `<g id>` で分けて描く。部品ごとに小さな絵にして、three の板(平面)に貼り、板を回す・ずらす・つぶす。
- 2D も three の中の板なので、3D と同じ舞台・カメラ・VR の中にそのまま出せる。

## ファイル
| 場所 | 中身 |
|---|---|
| `web/src/char2d/parts.js` | SVG の部品の切り出し、口 3 形、表情の落とし先、parts.json の点検(three・DOM なし) |
| `web/src/char2d/pose2d.js` | 3D の動き(gestures.js の骨の回転)を、正面から見た 2D の板の動きに直す |
| `web/src/char2d/svg2dCharacter.js` | `Svg2DCharacter`(CharacterBase を継ぐ)。lookAt・setEmotion・setMouth・play・update が 3D と同じ |
| `web/src/char2d/index.js` | ブラウザ用の入口 `createSvg2DCharacter({spec, svg})`。通信はしない |
| `web/src/char2d/intentLocal.js` | 意図の形をそろえる仮の版(K2 の正本は `web/src/character/intent.js`。試験はそちらを使う) |
| `creator/d2/check_parts.mjs` | 部品の点検と、表情を描き足す前後で顔以外が変わっていないかの比べ |
| `creator/d2/preview.html` | 2D のキャラを 1 体だけ描く確かめの画面(`?live=1` で動く) |
| `creator/d2/record_preview.mjs` | GPU の Chrome で 1 コマずつ進めて撮る(`--stills` で 14 枚、`--video 10` で 10 秒の動画) |
| `creator/d2/from_drawing/` | 手描きの正面の絵から、部品に分けた SVG を作る台本(主役ノリー用) |
| `characters/yokoso/2d/` | 作例(ようこそくん)。`body.svg`(8KB)と `parts.json` |
| `characters/norrie/2d/` | 主役ノリー。協力者の手描きの正面の絵から(`body.svg` 87KB・`parts.json`) |
| `web/test/char2d_*.test.mjs` | 試験(意図の列 10 個・まばたき・口 3 形・7 表情・部品。ノリーは色と部品と前歯も) |

## SVG の決まり
- 頭の `<svg>` に `xmlns` と `viewBox`。
- 体の部品: `<g id="body">`・`<g id="head">`・`<g id="arm_r">`(キャラの右腕 = 見る人の左)・`<g id="arm_l">` など。名前と箱(box)と回る中心(pivot)と前後(z)は parts.json に書く。`head` は必ず要る(顔は頭に付く)。部品の中を、さらに `<g id>` で分けてよい(ノリーの `ear_r`・`glove_r` など)。
- 顔: `<g id="face.<表情>.<枠>">`。枠は `eyes`・`brows`・`mouth_closed`・`mouth_half`・`mouth_open`。
  - 必ず要る: `face.neutral.eyes` と `face.neutral.mouth_closed/half/open`。
  - 描いていない枠は、近い表情(web/src/character/expressionNames.js の決まり)→ neutral の順に落ちる。眉はどこにも無ければ出さない。
  - 目を閉じた絵の表情(happy の ^^ など)は parts.json の `blink.noBlink` に書く(まばたきでつぶさない)。
- 表情を描き足すときは、顔の `<g>` だけを足す。ほかの部品を変えていないことを `check_parts.mjs --base 前の.svg` で確かめる。
- 部品の箱は、ぼかし(filter)のはみ出しまで入れる。

## parts.json の項目(足した物)
- `faceLayers: [{ "id": "muzzle", "box": [...] }]` … 顔の上の動かない部品(鼻など)。表情では替えず、目と口と一緒に動く(頭が横を向いて顔の部品がずれた時に、口と鼻がはなれない)。頭の板より手前・目と口より奥。
- `arms.front` … 腕を頭の前に出す角度(ラジアン、既定 1.0)。`false` なら出さない(ノリーは、あごの線の上に袖が出ないように)。
- `gains` … 動きの効き(`pose2d.js` の `DEFAULT_GAINS` を上書き)。ノリーは `arm 0.7`・`faceParallax 0.3`(腕が長く、鼻と口が顔の真ん中にあるため)。
- 部品の絵の透けは、そのまま(`premultiplyAlpha` は使わない)。SVG の絵では透けを掛けても効かず、鼻のピンクのまわりに白い輪が出た(GPU で 3 通り比べた)。線の無いふち(大きく回した袖のふち)には、うすい暗い筋が少し出る。

## 確かめ方
```
cd web && node --test test/char2d_parts.test.mjs test/char2d_intent.test.mjs test/char2d_norrie.test.mjs
node creator/d2/check_parts.mjs characters/norrie/2d
# 見た目(GPU の札を取ってから。CPU の描画なら止まる)
node creator/d2/record_preview.mjs --parts characters/norrie/2d/parts.json --out <フォルダ> --stills
node creator/d2/record_preview.mjs --parts characters/norrie/2d/parts.json --out <フォルダ> --video 10 --mp4 <出力.mp4>
```

## 手描きの絵から作る(主役ノリー、2026-11-06)
- 入力: 協力者が描いた三面図の正面(背景を抜いた PNG。リポジトリの外の入力の置き場)。2D は正面だけを使う。入力の絵は人(協力者)が描き、許可を得て使っている。
- 決まり: **元の絵の色と形を変えない(よくしようとしない)。** 色は元の絵の 6 色だけ(焦げ茶・クリーム・黒・白・ピンク・緑)。ふつうの顔(黒い丸い目・前歯 2 本の口)は元の絵のまま。表情を足す時も、目・眉・口だけを同じ線と色で描く。
- やり方: 輪郭と色は絵からなぞり、部品の分け方・隠れた所・表情は Claude が決めて描いた。
  1. `python creator/d2/from_drawing/regions.py <正面の絵.png> <作業フォルダ>` … 6 色の領域に分け、黒い線を近い領域へ半分ずつ配る(領域 19 個)。
  2. `python creator/d2/from_drawing/norrie_masks.py <作業フォルダ>` … 部品のマスク。しっぽ・体(胴・お腹)・腕(袖・手袋)・蝶ネクタイ・頭(耳・頭・顔)・鼻・目・口。腕の下・頭の下・手袋の下の隠れた所も埋め、手袋の下はお腹のふちの線をなめらかにつなぐ。
  3. `python creator/d2/from_drawing/norrie_svg.py <作業フォルダ> characters/norrie/2d` … なめらかな path にして SVG と parts.json を書く(同じ入力なら、同じ物ができる)。
  4. 確かめ: 上の試験と点検。元の絵と画素で比べる(SVG を描いて、元の絵との差を見る)。
- 測った数: 元の絵との差は平均 1.1/255。違うのは線のふちの 1〜2 画素(0.8% の画素)。SVG 87KB。部品の板 6 枚+鼻 1 枚+顔の差し替え 28 枚。
- 落とし穴:
  - 塗りの領域は線の真ん中まであるので、そのままなめらかにすると、線の外へ 1〜3 画素はみ出す。塗りだけ 2 画素縮める。
  - 鼻の線と口を別の部品に切ると、つなぎ目に細いすき間が見える。切る所で 5 画素重ねる。縦の線の幅(9)も口の形の中で合わせる。
  - 腕を大きく回すと、袖のふち(線が無い)が胴の上に出て、うすい暗い筋が見える(手を振る時だけ。1 倍ではほとんど見えない)。

## まだのこと
- 腕はひじで曲がらない(1 枚の板)。手を振ると、腕は横へ上がる。
- 横と後ろの絵は 2D では使っていない(3D で使う)。
- Quest の中の板の見え方は、作例の 2D でだけ確かめた(S5)。
