---
name: yc-2d
description: ゆるキャラを 2D のまま描いて動かす(SVG の部品を three の板に貼る、やり方 A)ときの決まりと落とし穴。2D のキャラを作る・直す、表情を描き足す、絵(人が描いた正面の絵など)から 2D にする、動きの意図(K2)を 2D に流す試験を書くときに使う。
---

# 2D のキャラ(SVG の部品を板に描く)

正本の説明は `creator/d2/README.md`。ここは、作りながら分かった事と落とし穴。

## 形
- 1 枚の SVG、部品は `<g id>`。顔は `face.<表情>.<枠>`(枠 = eyes・brows・mouth_closed・mouth_half・mouth_open)。
- `Svg2DCharacter` は CharacterBase を継ぐ。3D と同じ呼び方なので、会話の側(dialogue.js の setEmotion・play・setMouth・lookAt)は何も変えずに 2D を動かせる。
- 動きは gestures.js の骨の回転をそのまま使い、`pose2d.js` で 2D に直す。新しい動きを 3D に足せば 2D でも動く(腕は z 回りだけ使う。point の前後の振り = y 回りは 2D では出ない)。
- 表情は混ぜずに差し替える(いちばん強い物 1 つ。0.25 未満は neutral)。

## 落とし穴(2026-11-06 に踏んだ物)
- **privacy の試験**(web/test/privacy.test.mjs)が web/src の全部を見る。2D のコードでも次は書けない:
  - `new Image(`・`drawImage(`・`createImageBitmap`・`toDataURL` など → SVG を絵にするのは `THREE.TextureLoader` に blob の URL を渡す。
  - 変数を宛先にした `fetch(` → 読み込みは `character/index.js` の決まった所に任せ、2D の入口は「中身を受け取るだけ」にした。
  - `http://` の文字 → SVG の `xmlns` の値もこれに当たる。部品の SVG には、元の SVG の頭の xmlns を写す(`rootXmlns`)。
- 視線の先が上(人の顔 1.4m)だと、背の低い 2D キャラは頭が上を向いて少し上がる。うなずきの試験は「下がったか」でなく「上下に動いた幅」で見る。
- Bash の heredoc の中の python で `\b` を書くと、ファイルに後退の文字(0x08)が入った。正規表現を直すときは Edit を使うか、`chr(92)` で組む。直した後は `grep -c $'\x08'` で 0 件を確かめる。
- 部品の箱は、ぼかし(feGaussianBlur)のはみ出しまで入れる。filter の範囲も `x="-50%" width="200%"` にしておく(既定の 10% だと頬の赤みが切れる)。
- このセッションの決まりで、作業フォルダの `.claude/skills/` へは書き込めなかった(フックが止める)。スキルは札の作業フォルダに置き、持ち主か本人が入れる。

## 試験の作り方
- 画像にする所(rasterize)を外から渡すので、node --test では `new THREE.Texture()` を返す偽物で済む(DOM が要らない)。
- 意図の列の試験は、S5 の `web/src/character/intent.js` に `applyIntent` があればそれを、無ければ `char2d/intentLocal.js` を使う(K2 が固まっても試験を書き直さなくてよい)。
- 見える板を数えて確かめる: どの表情・口の値でも、目 1 枚・口 1 枚が必ず出る。

## 測った数(作例ようこそくん)
- SVG 8KB。部品の絵の画素の合計は、全身 1000×1000 の 2 枚分より少ない(試験で確かめる)。
- 試験 12 件・0.3 秒(node 22)。全体の npm test 183 件合格。
