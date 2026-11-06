# How we built it

Yuru-chara Creator turns a word or a single drawing into a light, talking mascot (a *yuru-chara*) that lives in the browser.
This page is the honest story of how it was built during the hackathon with Claude Code: what we tried first, where a person
decided to turn, and how Claude Code connected the pieces we had already built into one product.
Commit links point to the published history. The work from before the turn is kept on the `before-pivot` branch.

## The turn: from realistic humans to yuru-chara

| When (JST) | What happened | Record |
|---|---|---|
| Nov 2, 14:25 | We started with three pillars: making characters, placing them in real spaces, and showing them on a stage. | [commit]({{commit:94f3649}}) |
| Nov 2, 16:04 | On the first day a simple mascot already moved in the browser: 3D body, bones, a face sheet and 8 motions. | [commit]({{commit:0bf93ef}}) |
| Nov 2, 16:41 | Building the shape part by part with Blender's Python became the main route for mascots. | [commit]({{commit:b68ffd1}}) |
| Nov 3–4 | Even so, we kept looking for a way to make a **realistic human**: a realistic person in Character Creator 5, matching a 3D head to a photo by measurement only, and an anime-style human. | [realistic]({{commit:45f7f9d}}) · [head matching]({{commit:c2db7d6}}) · [anime style]({{commit:f10db35}}) |
| Nov 6, 11:52 | **A person decided to stop the realistic human completely and focus on yuru-chara.** The main line was trimmed to the yuru-chara creator only. This was the biggest turn of the project. | [the turn]({{commit:007e795}}) · [last commit before it]({{commit:fd7f245}}) |
| Nov 6, 12:04–13:03 | After the turn, every judge became Claude, and Claude redrew the original pictures of the four examples as SVG; the four were rebuilt from those drawings. | [judges]({{commit:1c1eff5}}) · [redrawn]({{commit:7fb739d}}) |

Why yuru-chara: they stay light enough to run in a browser, on a phone and in a VR headset, and they feel friendly.
A realistic human was heavy in every direction we measured: shape, materials, expressions, motion, quality, time.
The turn was a choice about direction, not a give-up: the same effort now goes into finish, warmth, lightness, speed and the range of devices.

Nothing we built for the human was wasted. Claude Code reconnected it into the product:
the part-by-part 3D building, the materials, the voice and conversation, the browser renderer and the tests.

> AI widened what was possible, a person chose the direction, and Claude Code connected the work we had built into a product.

## How Claude Code works in this project

- **Seven stages as skills.** ⓪ draw an SVG from words → ① look at the picture → ② build the shape in Blender's Python →
  ③ materials → ④ textures → ⑤ bones → ⑥ motion → ⑦ talk. Each stage is a skill in `.claude/skills/`
  (for example `yc-0-draw`, `yuru-check`, `make-character`, `yc-2d`, `yc-7-talk`, `yuru-next`).
- **A person checks the key steps, also from a phone.** The review screen (`creator/review/`) has "OK" and "redo + one short note".
  Pressing a button writes a small request file, and `/yuru-next` in Claude Code picks it up and runs the stage again.
- **Hooks as guard rails** (`tools/hooks/`, tested by breaking them on purpose):
  a stage gate stops a stage until a person has said OK to the previous one;
  a secret and word guard stops keys, private files and words that must not be published, before a commit and before writing a file inside the repository;
  the web tests run after an edit.
- **Seven streams in parallel.** The work was split into streams (3D making, 2D, conversation, review screen, rendering and devices,
  release, video), each in its own git worktree and branch, plus one merge role (also a Claude Code session). Each stream wrote only its own folders.
  The hand-offs between streams were fixed early as small contracts: the character data (`creator/specs/character.schema.json`),
  the review state (`creator/review/schema/`), the memory API (`web/server/memory/API.md`), the public functions (`web/api/README.md`)
  and the numbers (`docs/metrics.md`).
- **Everything that matters is in files, not in a chat.** Each stream keeps a status line, a card with "next steps" and one resume message,
  so a new session can continue from where the last one stopped.

## Numbers and honesty

- All numbers come from logs and test output through `tools/metrics.py`; see [docs/metrics.md](metrics.md).
- The judges are Claude models of the same family, so their agreement is not an independent check. We pair them with measured checks (outlines, hashes, lint).
- What did not pass, we say: fur and fabric texture did not pass the judges (0 of 14), and the realistic human did not reach the quality we wanted.
- We do not claim "fully automatic", "any picture works" or "the first".
- Outside parts used while the product runs (speech recognition, face tracking, voice, 3D rendering) are listed with their licenses in the README.

---

# どう作ったか(日本語)

ゆるキャラクリエイターは、言葉か 1 枚の絵から、ブラウザの中で動いて話す軽いゆるキャラを作ります。
この文書は、ハッカソンの期間中に Claude Code で作った道のりを、そのまま書いたものです。最初に何を試し、どこで人が向きを決め、
それまでに作った物を Claude Code がどうつなぎ直して 1 つの製品にしたか。コミットへのリンクは、公開した履歴を指します。
曲がり角より前の作業は、`before-pivot` の線に残しています。

## 曲がり角: リアルな人型から、ゆるキャラへ

| いつ(日本時間) | 起きた事 | 記録 |
|---|---|---|
| 11/2 14:25 | 3 本の柱(キャラを作る・実際の場所に置く・舞台で見せる)で始めた。 | [コミット]({{commit:94f3649}}) |
| 11/2 16:04 | 初日に、もうゆるキャラがブラウザで動いていた(3D の体・骨・顔の表・8 つの動き)。 | [コミット]({{commit:0bf93ef}}) |
| 11/2 16:41 | ゆるキャラは、Blender の Python で部品ごとに組む道を本命にした。 | [コミット]({{commit:b68ffd1}}) |
| 11/3〜4 | それでも、**リアルな人型**を作る道を探し続けた(Character Creator 5 での写実の人、写真に合わせて頭を計算だけで寄せる道具、アニメ調の人)。 | [写実]({{commit:45f7f9d}})・[頭の合わせ]({{commit:c2db7d6}})・[アニメ調]({{commit:f10db35}}) |
| 11/6 11:52 | **人が「リアルな人型はきっぱりやめて、ゆるキャラに絞る」と決めた。** 本流をゆるキャラクリエイターだけに整えた。いちばんの曲がり角。 | [曲がり角]({{commit:007e795}})・[その直前]({{commit:fd7f245}}) |
| 11/6 12:04〜13:03 | 曲がり角の後、判定役を全部 Claude にし、作例 4 体の元の絵を Claude が SVG で描き直して、その絵から 4 体を作り直した。 | [判定役]({{commit:1c1eff5}})・[描き直し]({{commit:7fb739d}}) |

なぜゆるキャラか: ブラウザ・スマホ・VR のゴーグルで動くほど軽く、親しみやすいから。
リアルな人型は、形・材質・表情・動き・品質・時間のどれを見ても重かった。
曲がり角は「あきらめ」ではなく向きの選び直しで、同じ力を、仕上がり・親しみ・軽さ・速さ・使える端末の幅に向けた。

人型のために作った物は、無駄になっていません。Claude Code が製品につなぎ直しました
(部品ごとの 3D の組み立て・材質・声と会話・ブラウザの表示・試験)。

> AI が可能性を広げ、人が向きを決め、Claude Code が積み上げた技術をつないで製品にした。

## この製品での Claude Code の使い方

- **7 段をスキルにした。** ⓪ 言葉から SVG を描く → ① 絵を見る → ② Blender の Python で形を組む → ③ 材質 → ④ テクスチャ → ⑤ 骨 → ⑥ 動き → ⑦ 話す。
  段ごとに `.claude/skills/` のスキルがある(例 `yc-0-draw`・`yuru-check`・`make-character`・`yc-2d`・`yc-7-talk`・`yuru-next`)。
- **要所は人が確かめる。スマホからも。** 確かめる画面(`creator/review/`)に「OK」と「やり直し+短い一言」がある。
  押すと小さな依頼のファイルができ、Claude Code の `/yuru-next` が拾って、その段を流し直す。
- **フックで守る**(`tools/hooks/`。わざと壊して試験が落ちる事まで確かめた):
  前の段に人の OK が無ければ次の段に進ませない関所、鍵・見せない物・公開しない語を、記録の前とリポジトリの中のファイルを書く前に止める見張り、
  直した後に web の試験を回すフック。
- **7 つの流れを同時に進めた。** 3D・2D・会話・確かめる画面・描画と端末・公開・動画に分け、流れごとに git の worktree と線を持ち、
  合わせる役(これも Claude Code のセッション)を 1 つ置いた。各流れは自分のフォルダだけを書いた。流れの間の受け渡しは、早めに小さな約束(契約)にした:
  キャラのデータ(`creator/specs/character.schema.json`)・確かめの状態(`creator/review/schema/`)・記憶の API(`web/server/memory/API.md`)・
  公開の関数(`web/api/README.md`)・数字(`docs/metrics.md`)。
- **大事な事は会話ではなくファイルに置いた。** 流れごとに状態の行・「次の手」を書いた札・再開の一言を持ち、新しいセッションが止まった所から続けられる。

## 数字と、正直に書くこと

- 数字は全部、記録と試験の出力から `tools/metrics.py` が作った([docs/metrics.md](metrics.md))。
- 判定役は同じ系統の Claude なので、一致しても独立した確かめではない。輪郭・ハッシュ・lint などの測る点検と組にしている。
- 通らなかった事も書く: 布や毛の質感は判定が通らなかった(14 中 0)。リアルな人型は、目指した品質に届かなかった。
- 「全自動」「どんな絵でも」「初めて」とは言わない。
- 製品が動く時に使う外の部品(聞き取り・顔の検出・声・3D の表示)は、使用条件とともに README に書いている。
