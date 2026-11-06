# How we built it

Yuru-chara Creator turns a word or a single drawing into a light, talking mascot (a *yuru-chara*) that lives in the browser.
Our main character is **Norrie (ノリー)**, a back-striped tree kangaroo who is training to be a butler.
A collaborator drew Norrie by hand during the hackathon (front, side and back) and let us use the drawing; it is the input for Norrie's 2D and 3D versions.

This page is the honest story of how the product was built during the hackathon with Claude Code: what we tried first,
where a person decided to turn, and how Claude Code connected the pieces we had already built into one product.
Commit links point to the published history. The work from before the turn is kept on the `before-pivot` branch.

## The turn: from realistic humans to yuru-chara

| When (JST) | What happened | Record |
|---|---|---|
| Nov 2, 14:25 | We started with three pillars: making characters, placing them in real spaces, and showing them on a stage. | [commit]({{commit:94f3649}}) |
| Nov 2, 16:04 | On the first day a simple mascot already moved in the browser: 3D body, bones, a face sheet and 8 motions. | [commit]({{commit:0bf93ef}}) |
| Nov 2, 16:41 | Building the shape part by part with Blender's Python became the main route for mascots. | [commit]({{commit:b68ffd1}}) |
| Nov 3–4 | Even so, we kept looking for a way to make a **realistic human**: a realistic person in Character Creator 5, matching a 3D head to a photo by measurement only, and an anime-style human. | [realistic]({{commit:45f7f9d}}) · [head matching]({{commit:c2db7d6}}) · [anime style]({{commit:f10db35}}) |
| Nov 6, 11:52 | **A person decided to stop the realistic human completely and focus on yuru-chara.** The main line was trimmed to the yuru-chara creator only. This was the biggest turn of the project. | [the turn]({{commit:007e795}}) · [last commit before it]({{commit:fd7f245}}) |
| Nov 6, 12:04–13:03 | After the turn, we made Claude the only judge, and Claude redrew the original pictures of the four examples as SVG; the four were rebuilt from those drawings. | [judges]({{commit:1c1eff5}}) · [redrawn]({{commit:7fb739d}}) |

Why yuru-chara: they stay light enough to run in a browser, on a phone and in a VR headset, and they feel friendly.
A realistic human was heavy in every direction we measured: shape, materials, expressions, motion, quality, time.
The turn was a choice about direction, not a give-up: the same effort now goes into finish, warmth, lightness, speed and the range of devices.

Nothing we built during the hackathon for the human was wasted. Claude Code reconnected it into the product:
the part-by-part 3D building, the materials, the voice and conversation, the browser renderer and the tests.

> AI widened what was possible, a person chose the direction, and Claude Code connected the work we had built into a product.

## Who did what

- **People** chose the direction (the turn above), drew the input picture (the collaborator), press "OK" or "redo" at the key stages, and decide what is published.
- **Claude Code** wrote the code and the tests, draws SVGs from words, looks at pictures, builds the shapes by running Blender's Python, judges the results, and merged the parallel work.

## Claude Code features we actually used

| Feature | How we used it | Where |
|---|---|---|
| Skills | One skill per build stage (⓪ draw an SVG from words → ① look at the picture → ② build the shape in Blender's Python → ③ materials → ④ textures → ⑤ bones → ⑥ motion → ⑦ talk), plus skills for checking a picture, the review loop, merging and release. | `.claude/skills/` (for example `yc-0-draw`, `yuru-check`, `make-character`, `yc-2d`, `yc-7-talk`, `yuru-next`, `release-check`) |
| Sub-agents | Judges and testers with their own context: a character judge, a safety tester, a privacy auditor and a release auditor. | `.claude/agents/` |
| Headless mode (`claude -p`) | The judges run as separate Claude calls that may only read files (`--allowedTools Read`) and answer in JSON, so the maker never grades its own work in the same context. | `creator/pipeline/j01_judge.py`, `web/server/tools/safety-judge.mjs` |
| Hooks | Before a tool runs, a guard stops keys, private files and words that must not be published (in commits and in files written inside the repository). When a prompt asks for a stage, a stage gate stops it until a person has said OK to the previous stage. After an edit, the web tests run. The first guard and the web tests came on Nov 2; on Nov 6 the guard was widened to file writes and the stage gate was added. | `.claude/settings.json`, `tools/hooks/` · [first hooks]({{commit:3712843}}) · [widened]({{commit:a020d24}}) |
| A skill as a slash command | The phone review screen writes a small request file (stage, OK or redo, one short note); `/yuru-next` reads it and runs that stage again. The note is passed as a wish, not as an instruction. | `.claude/skills/yuru-next/`, `creator/review/` |
| Git worktrees and parallel sessions | The work was split into seven streams (3D making, 2D, conversation, review screen, rendering and devices, release, video), each a Claude Code session with its own worktree and branch, plus one merge session. Each stream wrote only its own folders. | — |
| Sub-agents for planning | The build plan itself came from Claude sub-agents: seven research briefs, two competing drafts, two critiques and one final plan. | — |

- **Small contracts between streams.** The hand-offs were fixed early: the character data (`creator/specs/character.schema.json`),
  the review state (`creator/review/schema/`), the memory API (`web/server/memory/API.md`), the public functions (`web/api/README.md`)
  and the numbers (`docs/metrics.md`).
- **Everything that matters is in files, not in a chat.** Each stream keeps a status line, a card with "next steps" and one resume message,
  so a new session can continue from where the last one stopped.
- **The guard rails are tested by breaking them.** `node --test tools/hooks/test/hooks.test.mjs` (26 tests) and
  `node tools/hooks/test/mutation.mjs` (19 deliberate breakages, none missed).

## Numbers and honesty

- All numbers in [docs/metrics.md](metrics.md) come from logs and test output through `tools/metrics.py`, which also checks that every number in its tables has a source.
- [docs/期間の表.md](期間の表.md) lists, for every file, the first commit and a comparison with what existed before the hackathon, so anyone can check that the code was written during the hackathon.
- The judges are Claude models of the same family, so their agreement is not an independent check. We pair them with measured checks (outlines, hashes, lint).
- What did not pass, we say: fur and fabric texture did not pass the judges (0 of 14), and the realistic human did not reach the quality we wanted.
- We do not claim "fully automatic", "any picture works" or "the first".
- Outside parts used while the product runs (speech recognition, face tracking, voice, 3D rendering) are listed in the README.

---

# どう作ったか(日本語)

ゆるキャラクリエイターは、言葉か 1 枚の絵から、ブラウザの中で動いて話す軽いゆるキャラを作ります。
主役は **ノリー(Norrie)**。セスジキノボリカンガルーの、執事見習いです。
ノリーの絵(正面・横・後ろ)は、協力者がハッカソンの期間中に手で描き、使うことを許してくれました。この絵が、ノリーの 2D と 3D の元になります。

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
| 11/6 12:04〜13:03 | 曲がり角の後、判定役を Claude だけにし、作例 4 体の元の絵を Claude が SVG で描き直して、その絵から 4 体を作り直した。 | [判定役]({{commit:1c1eff5}})・[描き直し]({{commit:7fb739d}}) |

なぜゆるキャラか: ブラウザ・スマホ・VR のゴーグルで動くほど軽く、親しみやすいから。
リアルな人型は、形・材質・表情・動き・品質・時間のどれを見ても重かった。
曲がり角は「あきらめ」ではなく向きの選び直しで、同じ力を、仕上がり・親しみ・軽さ・速さ・使える端末の幅に向けた。

期間中に人型のために作った物は、無駄になっていません。Claude Code が製品につなぎ直しました
(部品ごとの 3D の組み立て・材質・声と会話・ブラウザの表示・試験)。

> AI が可能性を広げ、人が向きを決め、Claude Code が積み上げた技術をつないで製品にした。

## だれが何をしたか

- **人**は、向きを決めた(上の曲がり角)。元の絵を描いた(協力者)。要所で「OK」か「やり直し」を押す。何を公開するかを決める。
- **Claude Code** は、コードと試験を書き、言葉から SVG を描き、絵を見て、Blender の Python を動かして形を組み、出来を判定し、並べて進めた作業を合わせた。

## 実際に使った Claude Code の機能

| 機能 | どう使ったか | 場所 |
|---|---|---|
| スキル | 作る 7 段にそれぞれ 1 つ(⓪ 言葉から SVG を描く → ① 絵を見る → ② Blender の Python で形を組む → ③ 材質 → ④ テクスチャ → ⑤ 骨 → ⑥ 動き → ⑦ 話す)。ほかに、絵の確かめ・確かめの往復・合わせ・公開のスキル。 | `.claude/skills/`(例 `yc-0-draw`・`yuru-check`・`make-character`・`yc-2d`・`yc-7-talk`・`yuru-next`・`release-check`) |
| 作業役(サブエージェント) | 自分の文脈を持つ判定役と試験役: キャラの判定役・安全の試験役・個人の情報の点検役・公開の前の点検役。 | `.claude/agents/` |
| 画面なしの呼び出し(`claude -p`) | 判定役は、ファイルを読むことだけを許した(`--allowedTools Read`)別の Claude の呼び出しで、答えを JSON で返す。作り手が同じ文脈で自分の出来を採点しない。 | `creator/pipeline/j01_judge.py`・`web/server/tools/safety-judge.mjs` |
| フック | 道具が動く前に、鍵・見せないファイル・公開しない語を止める(記録の時と、リポジトリの中にファイルを書く時)。段を頼む言葉には、前の段に人の OK が無ければ止める関所。直した後は web の試験を回す。最初の見張りと web の試験は 11/2 に、11/6 に見張りをファイルを書く時へ広げ、関所を足した。 | `.claude/settings.json`・`tools/hooks/`・[最初のフック]({{commit:3712843}})・[広げた時]({{commit:a020d24}}) |
| スラッシュコマンドになるスキル | スマホの確かめる画面が小さな依頼のファイル(段・OK かやり直し・短い一言)を書き、`/yuru-next` がそれを読んで、その段を流し直す。一言は「命令」ではなく「希望」として渡す。 | `.claude/skills/yuru-next/`・`creator/review/` |
| git の worktree と同時に動くセッション | 作業を 7 つの流れ(3D・2D・会話・確かめる画面・描画と端末・公開・動画)に分け、流れごとに Claude Code のセッションと worktree と線を持ち、合わせる役のセッションを 1 つ置いた。各流れは自分のフォルダだけを書いた。 | — |
| 計画づくりの作業役 | 作る計画そのものを、Claude の作業役が作った(調べもの 7 本・競う下書き 2 本・批評 2 本・最後の計画 1 本)。 | — |

- **流れの間は、小さな約束(契約)で受け渡した。** 早めに固めた: キャラのデータ(`creator/specs/character.schema.json`)・確かめの状態(`creator/review/schema/`)・
  記憶の API(`web/server/memory/API.md`)・公開の関数(`web/api/README.md`)・数字(`docs/metrics.md`)。
- **大事な事は会話ではなくファイルに置いた。** 流れごとに状態の行・「次の手」を書いた札・再開の一言を持ち、新しいセッションが止まった所から続けられる。
- **守りは、わざと壊して確かめた。** `node --test tools/hooks/test/hooks.test.mjs`(26 件)と `node tools/hooks/test/mutation.mjs`(わざと壊す 19 通り、見逃し 0)。

## 数字と、正直に書くこと

- [docs/metrics.md](metrics.md) の数字は全部、記録と試験の出力から `tools/metrics.py` が作った。表の数字に出どころがあるかも、同じ道具が確かめる。
- [docs/期間の表.md](期間の表.md) に、ファイルごとの最初のコミットと、期間前にあった物との比べを載せた。コードが期間中に書かれたことを、だれでも確かめられる。
- 判定役は同じ系統の Claude なので、一致しても独立した確かめではない。輪郭・ハッシュ・lint などの測る点検と組にしている。
- 通らなかった事も書く: 布や毛の質感は判定が通らなかった(14 中 0)。リアルな人型は、目指した品質に届かなかった。
- 「全自動」「どんな絵でも」「初めて」とは言わない。
- 製品が動く時に使う外の部品(聞き取り・顔の検出・声・3D の表示)は、README に書いている。
