# How we built it

Yuru-chara Creator turns a word or a single drawing into a light, talking mascot (a *yuru-chara*) that lives in the browser.
Our main character is **Norrie (ノリー)**, a back-striped tree kangaroo who is training to be a butler.
A collaborator drew Norrie by hand during the hackathon (front, side and back) and let us use the drawing; it is the input for Norrie's 2D and 3D versions.

This page is the honest story of how the product was built during the hackathon with Claude Code: what we tried first,
where a person decided to turn, how Claude Code connected the pieces we had already built into one product,
and how the last night went: Norrie, seven streams in parallel, and the merge gate.
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

## Norrie: from a hand-drawn three-view drawing to 2D and 3D

| When (JST) | What happened | Record |
|---|---|---|
| Nov 6, 15:35–20:40 | A collaborator drew Norrie by hand: front, side and back, with the name and the line "a back-striped tree kangaroo, butler apprentice". People decided the name and the look: a green bow tie and white gloves. | — |
| Nov 6, 21:15–22:40 | Claude Code cut the three views out of the sheet and compared them with the drawing pixel by pixel. It filled two spots that were left unpainted on the side view. | — |
| Nov 6, 21:50 and 23:27 | Norrie's personality: calls itself "Nori", speaks politely with slightly broken endings (「ノリ、がんばりマス!」), a hard-working apprentice. The safety layer still comes first. | [personality]({{commit:45fb9ec}}) · [way of speaking]({{commit:4153995}}) |
| Nov 7, 00:02 | **2D.** Claude Code split the front view into SVG parts (ears, head, face, nose, eyes, a mouth with two front teeth, body, belly, arms, white gloves, green bow tie, tail) in the drawing's 6 colours. The redrawn picture differs from the drawing by 1.1 out of 255 on average, only along the line edges. | [2D]({{commit:8b57e62}}) |
| Nov 7, 00:30 | **3D.** Claude (Sonnet 5.5, in three fresh contexts) built Norrie from the three views in the 7 stages by running Blender's Python, and corrected the ears, the gloves and the eyes once each against the drawing. Outline overlap with the drawing in straight-on views: 0.960 front, 0.963 side, 0.952 back. 37,100 triangles, 1.34 MB, no fur, so it stays light on phones and in VR. | [3D]({{commit:97fbb1c}}) |
| Nov 7, 00:53 | **Judge.** A Claude (Opus 5.5) session that had not built Norrie compared both versions with the drawing: both are clearly Norrie. 2D front: pass. 3D front and back: pass. 3D side: only partly (the eyes, the nose tip and the front teeth did not show from the side, the cream colour turned grey in the shadows, and the back stripe broke at the neck). It wrote the fixes in order, each with a pass line. | — |
| Nov 7, 00:57–01:00 | Norrie's 3D and 2D were merged into the development line and main. | [3D merged]({{commit:cb9063a}}) · [2D merged]({{commit:10987e9}}) |
| Nov 7, 02:05–02:32 | **Fixes, each checked against its pass line.** 2D: while bowing, the bow tie stays visible (0% → 89%); the waving arm became two parts that bend at the elbow (thin line at the shoulder: 32 → 0 pixels); a back view made from the back drawing shows the stripe. 3D: the face reads from the side (eyes, nose tip and front tooth visible at 90° and 270°, overlap 0.960 / 0.962 / 0.952); no gloss and softer shadows (cream colour difference at the chin, belly and tail: 118 / 54 / 101 → 13 / 10 / 14, pass line 20); one front tooth and a round line over the nose; the back stripe now runs through the neck. | [3D fixes]({{commit:d64381b}}) · [side face]({{commit:7c35480}}) · [2D fixes merged]({{commit:a6572e4}}) |
| Nov 7, 02:35 | Claude judges (Haiku 5.5 and Sonnet 5.5, 3 times each) after the fixes: "same character" 3/3 and 3/3, from the front and from the side. From the side, all 6 answers still say the front teeth look too small. We keep that as an open point. | — |
| Nov 7, 03:37 | The app opens with Norrie, has a 3D / 2D switch, and keeps Norrie's head below the top bar at phone widths. | [merged]({{commit:0f18657}}) |

People drew Norrie, named it and decided its look. Claude Code did the rest: the cut-outs, the 2D parts, the 3D model, the personality text, the judging and the fixes.

## Claude Code features we actually used

| Feature | How we used it | Where |
|---|---|---|
| Skills | One skill per build stage (⓪ draw an SVG from words → ① look at the picture → ② build the shape in Blender's Python → ③ materials → ④ textures → ⑤ bones → ⑥ motion → ⑦ talk), plus skills for checking a picture, the review loop, 2D, rendering, merging and release. | `.claude/skills/` (for example `yc-0-draw`, `yuru-check`, `make-character`, `yc-2d`, `yc-7-talk`, `yuru-next`, `release-check`) |
| Sub-agents | Judges and testers with their own context: a character judge, a safety tester, a privacy auditor and a release auditor. Norrie was judged by a session that had not built it. | `.claude/agents/` |
| Headless mode (`claude -p`) | The judges run as separate Claude calls that may only read files (`--allowedTools Read`) and answer in JSON, so the maker never grades its own work in the same context. | `creator/pipeline/j01_judge.py`, `web/server/tools/safety-judge.mjs` |
| Hooks | Before a tool runs, a guard stops keys, private files and words that must not be published (in commits and in files written inside the repository). When a prompt asks for a stage, a stage gate stops it until a person has said OK to the previous stage. After an edit, the web tests run. The first guard and the web tests came on Nov 2; on Nov 6 the guard was widened to file writes and the stage gate was added. | `.claude/settings.json`, `tools/hooks/` · [first hooks]({{commit:3712843}}) · [widened]({{commit:a020d24}}) |
| A skill as a slash command | The phone review screen writes a small request file (stage, OK or redo, one short note); `/yuru-next` reads it and runs that stage again. The note is passed as a wish, not as an instruction. | `.claude/skills/yuru-next/`, `creator/review/` |
| Git worktrees and parallel sessions | The work was split into seven streams (3D making, 2D, conversation, review screen, rendering and devices, release, video), each a Claude Code session with its own worktree and branch, plus one merge session. Each stream wrote only its own folders, and every merge passed a test gate (next section). | — |
| Sub-agents for planning | The build plan itself came from Claude sub-agents: seven research briefs, two competing drafts, two critiques and one final plan. | — |

- **Small contracts between streams.** The hand-offs were fixed early: the character data (`creator/specs/character.schema.json`),
  the review state (`creator/review/schema/`), the memory API (`web/server/memory/API.md`), the public functions (`web/api/README.md`)
  and the numbers (`docs/metrics.md`).
- **Everything that matters is in files, not in a chat.** Each stream keeps a status line, a card with "next steps" and one resume message,
  so a new session can continue from where the last one stopped.
- **The guard rails are tested by breaking them.** `node --test tools/hooks/test/hooks.test.mjs` (26 tests) and
  `node tools/hooks/test/mutation.mjs` (19 deliberate breakages, none missed).

## Building in parallel: seven streams and a merge gate (Nov 6, 18:00 – Nov 7, 03:45)

From the evening of Nov 6, the work ran as seven streams plus Norrie's 2D and 3D, each a Claude Code session on its own git worktree and branch.
A separate merge session merged the branches into the development line one at a time, in a fixed order, and only when the gate passed.
The gate: all web tests including the browser tests (`cd web && YC_BROWSER_TESTS=1 npm test`), the push check in normal and isolated Python mode,
the hook tests and the deliberate-breakage test, the sample check (the example characters' files are unchanged), the character schema check,
and a talk test in a real browser on a GPU (never on a software renderer). A branch that failed was sent back with the reason instead of being merged.

| Merge (JST, last merge commit) | Branches merged | Web tests | What the gate caught |
|---|---|---|---|
| ① Nov 6, 18:50 | 6 | 171 → 206 | — |
| ② Nov 6, 20:24 | 5 | 206 → 280 | git's pre-push check runs Python in isolated mode (`python -I`), where the check could not import its own helper. The merge session stopped instead of going around it; the import was fixed the same evening, and a test now runs the check in isolated mode. |
| ③ Nov 6, 22:50 | 4 | 280 → 297 | The conversation branch was sent back: a test compared whole files, and on a Windows checkout the line endings (CRLF) differed. It was fixed by normalising line endings before comparing, and `.gitattributes` now checks text files out with LF everywhere. |
| ④ Nov 7, 01:00 | 7, including Norrie's 3D and 2D | 297 → 362 | — |
| ⑤ Nov 7, 02:56 | 3 (Norrie's fixes and a sample-check fix) | 362 → 366 | The rendering branch was sent back. The text merged cleanly, but Norrie's 3D branch had just given Norrie a 2D entry, and one rendering test still expected "no 2D". This kind of conflict only shows when both branches are merged and the tests run. |
| 5b Nov 7, 03:37 | 1 (the fixed rendering branch) | 366 → 382 | — |

- Every merge ended with 0 failing tests. One gate run took about 3 minutes.
- The talk test passed at every merge. At the last ones, Norrie (3D and 2D), Mikan-chan and Yokoso-kun talked, with the mouth opening to about 0.69.
- The last merge commit of each night-time round: [③]({{commit:bc1ca09}}) · [④]({{commit:10987e9}}) · [⑤]({{commit:b3c8a7d}}) · [5b]({{commit:0f18657}}).

## Time and cost of a build

The cost column is the `total_cost_usd` that `claude -p` reports for a run: an estimate at API list prices, not an invoice.

| Build | Steps | Time | List-price estimate | Record |
|---|---|---|---|---|
| Mikan-chan, from words (Nov 6) | draw the SVG → 7 stages → talk | 20.6 min | $4.37 | `.claude/skills/make-character/SKILL.md` |
| A machine-made doodle-style test picture (Nov 6) | picture check → stages 0–7 | 12.1 min | $1.97 | `.claude/skills/make-character/SKILL.md` |
| Norrie's 3D, from the three views (Nov 6–7) | picture check → 7 stages → 2 rounds of fixes against the drawing | about 59 min | about $5.90 | `.claude/skills/demo-video-rough-edit/SKILL.md` (sum of the run log) |
| Judging Norrie after the fixes (Nov 7) | 72 judge calls (Haiku 5.5 and Sonnet 5.5) | about 50 s per call | $0.67 | `.claude/skills/make-character/SKILL.md` |
| Re-judging the 4 examples and Mikan-chan (Nov 6) | 2 rounds | 146 s and 103 s | $0.30 and $0.27 | `creator/skilltest/結果表.md` |
| One review round trip, "make the hat blue" (Nov 6) | draw → redraw → OK, through `/yuru-next` | 8–61 s per `/yuru-next` run; the two drawings 50 s and 23 s | $0.27 and $0.14 for the two drawings | `.claude/skills/yuru-next/SKILL.md` |
| The 4 examples, rebuilt from Claude's SVG drawings (Nov 6) | 7 stages | 17.6–40.0 min each | $3.55–$3.97 each | [docs/metrics.md](metrics.md) §1 |

## Numbers and honesty

- All numbers in [docs/metrics.md](metrics.md) come from logs and test output through `tools/metrics.py`, which also checks that every number in its tables has a source.
- The numbers in the sections above come from the records named next to them. Collecting them into docs/metrics.md with the tool is still to do 【確かめ待ち】.
- [docs/期間の表.md](期間の表.md) lists, for every file, the first commit and a comparison with what existed before the hackathon, so anyone can check that the code was written during the hackathon.
- The judges are Claude models of the same family, so their agreement is not an independent check. We pair them with measured checks (outlines, colour differences, hashes, lint). Norrie's judge had not built Norrie, but it is still a Claude model.
- What did not pass, we say: fur did not pass the judges in our skill tests (0 of 14 test characters); after the examples were rebuilt, both judges said yes to Yokoso-kun's fur, while the other examples failed on colour because glow, gloss and rims are missing ([creator/skilltest/結果表.md](../creator/skilltest/結果表.md)). From the side, Norrie's front teeth still look too small. The realistic human did not reach the quality we wanted.
- We do not claim "fully automatic", "any picture works" or "the first".
- Outside parts used while the product runs (speech recognition, face tracking, voice, 3D rendering) and their licences are listed in [THIRD_PARTY.md](../THIRD_PARTY.md).

---

# どう作ったか(日本語)

ゆるキャラクリエイターは、言葉か 1 枚の絵から、ブラウザの中で動いて話す軽いゆるキャラを作ります。
主役は **ノリー(Norrie)**。セスジキノボリカンガルーの、執事見習いです。
ノリーの絵(正面・横・後ろ)は、協力者がハッカソンの期間中に手で描き、使うことを許してくれました。この絵が、ノリーの 2D と 3D の元になります。

この文書は、ハッカソンの期間中に Claude Code で作った道のりを、そのまま書いたものです。最初に何を試し、どこで人が向きを決め、
それまでに作った物を Claude Code がどうつなぎ直して 1 つの製品にしたか。そして最後の夜(ノリー・7 つの流れ・合わせの門)。
コミットへのリンクは、公開した履歴を指します。曲がり角より前の作業は、`before-pivot` の線に残しています。

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

## ノリー: 手描きの三面図から、2D と 3D へ

| いつ(日本時間) | 起きた事 | 記録 |
|---|---|---|
| 11/6 15:35〜20:40 | 協力者がノリーを手で描いた(正面・横・後ろと、名前と「セスジキノボリカンガルーの執事見習い。」の一文)。名前と見た目(緑の蝶ネクタイ・白い手袋)は人が決めた。 | — |
| 11/6 21:15〜22:40 | Claude Code が三面図から 3 つの向きを切り抜き、元の絵と画素ごとに比べた。横の絵の塗り残し 2 か所を埋めた。 | — |
| 11/6 21:50 と 23:27 | ノリーの人格: 自分を「ノリ」と呼び、ていねいで少しカタコト(「ノリ、がんばりマス!」)、一生懸命な見習い。安全の層は今までどおり先に効く。 | [人格]({{commit:45fb9ec}})・[話し方]({{commit:4153995}}) |
| 11/7 00:02 | **2D。** Claude Code が正面の絵を SVG の部品(耳・頭・顔・鼻・目・前歯 2 本の口・体・お腹・腕・白い手袋・緑の蝶ネクタイ・しっぽ)に分けた。色は元の絵の 6 色だけ。描き直した絵と元の絵の差は、平均 1.1/255(線のふちだけ)。 | [2D]({{commit:8b57e62}}) |
| 11/7 00:30 | **3D。** Claude(Sonnet 5.5、新しい文脈で 3 回)が、三面図から 7 段で、Blender の Python を動かして組んだ。耳・手袋・目を、元の絵と比べて 1 回ずつ直した。まっすぐ写した絵での輪郭の重なり: 正面 0.960・横 0.963・後ろ 0.952。三角形 37,100・1.34MB・毛なし(スマホと VR で軽く動くように)。 | [3D]({{commit:97fbb1c}}) |
| 11/7 00:53 | **判定。** ノリーを作っていない Claude(Opus 5.5)のセッションが、2 つを元の絵と比べた: どちらも、ひと目でノリー。2D の正面は合格。3D の正面と後ろも合格。3D の横は一部だけ(横から目・鼻先・前歯が見えない、クリーム色が影で灰色、背中の筋が首で切れる)。直す順と、それぞれの合格の線を書いた。 | — |
| 11/7 00:57〜01:00 | ノリーの 3D と 2D を、開発の線と main に合わせた。 | [3D を合わせた]({{commit:cb9063a}})・[2D を合わせた]({{commit:10987e9}}) |
| 11/7 02:05〜02:32 | **直し(それぞれ合格の線で確かめた)。** 2D: おじぎの間も蝶ネクタイが見える(0% → 89%)。手を振る腕を 2 枚にして、ひじで曲げる(肩の細い線 32 → 0 画素)。後ろの絵から後ろ姿を作り、背中の筋が出る。3D: 横から顔が分かる(90°・270° で目・鼻先・前歯が見える。重なり 0.960・0.962・0.952)。照りを消して影を浅く(あご・お腹・しっぽのクリーム色の差 118・54・101 → 13・10・14。合格の線は 20)。前歯を 1 つに、鼻の上を丸い線に。背中の筋が首でもつながる。 | [3D の直し]({{commit:d64381b}})・[横顔]({{commit:7c35480}})・[2D の直しを合わせた]({{commit:a6572e4}}) |
| 11/7 02:35 | 直した後の Claude の判定役(Haiku 5.5 と Sonnet 5.5、3 回ずつ): 正面からも横からも「同じキャラ」3/3・3/3。横から見ると、答え 6 つがすべて「前歯がまだ小さい」。残った点として書いておく。 | — |
| 11/7 03:37 | アプリはノリーで開き、3D・2D の切り替えがあり、スマホの幅でもノリーの頭が上の段の下に収まる。 | [合わせた]({{commit:0f18657}}) |

ノリーを描き、名前と見た目を決めたのは人。切り抜き・2D の部品・3D の形・人格の文・判定・直しは Claude Code。

## 実際に使った Claude Code の機能

| 機能 | どう使ったか | 場所 |
|---|---|---|
| スキル | 作る 7 段にそれぞれ 1 つ(⓪ 言葉から SVG を描く → ① 絵を見る → ② Blender の Python で形を組む → ③ 材質 → ④ テクスチャ → ⑤ 骨 → ⑥ 動き → ⑦ 話す)。ほかに、絵の確かめ・確かめの往復・2D・描画・合わせ・公開のスキル。 | `.claude/skills/`(例 `yc-0-draw`・`yuru-check`・`make-character`・`yc-2d`・`yc-7-talk`・`yuru-next`・`release-check`) |
| 作業役(サブエージェント) | 自分の文脈を持つ判定役と試験役: キャラの判定役・安全の試験役・個人の情報の点検役・公開の前の点検役。ノリーは、作っていないセッションが判定した。 | `.claude/agents/` |
| 画面なしの呼び出し(`claude -p`) | 判定役は、ファイルを読むことだけを許した(`--allowedTools Read`)別の Claude の呼び出しで、答えを JSON で返す。作り手が同じ文脈で自分の出来を採点しない。 | `creator/pipeline/j01_judge.py`・`web/server/tools/safety-judge.mjs` |
| フック | 道具が動く前に、鍵・見せないファイル・公開しない語を止める(記録の時と、リポジトリの中にファイルを書く時)。段を頼む言葉には、前の段に人の OK が無ければ止める関所。直した後は web の試験を回す。最初の見張りと web の試験は 11/2 に、11/6 に見張りをファイルを書く時へ広げ、関所を足した。 | `.claude/settings.json`・`tools/hooks/`・[最初のフック]({{commit:3712843}})・[広げた時]({{commit:a020d24}}) |
| スラッシュコマンドになるスキル | スマホの確かめる画面が小さな依頼のファイル(段・OK かやり直し・短い一言)を書き、`/yuru-next` がそれを読んで、その段を流し直す。一言は「命令」ではなく「希望」として渡す。 | `.claude/skills/yuru-next/`・`creator/review/` |
| git の worktree と同時に動くセッション | 作業を 7 つの流れ(3D・2D・会話・確かめる画面・描画と端末・公開・動画)に分け、流れごとに Claude Code のセッションと worktree と線を持ち、合わせる役のセッションを 1 つ置いた。各流れは自分のフォルダだけを書き、合わせは毎回、試験の門を通した(次の節)。 | — |
| 計画づくりの作業役 | 作る計画そのものを、Claude の作業役が作った(調べもの 7 本・競う下書き 2 本・批評 2 本・最後の計画 1 本)。 | — |

- **流れの間は、小さな約束(契約)で受け渡した。** 早めに固めた: キャラのデータ(`creator/specs/character.schema.json`)・確かめの状態(`creator/review/schema/`)・
  記憶の API(`web/server/memory/API.md`)・公開の関数(`web/api/README.md`)・数字(`docs/metrics.md`)。
- **大事な事は会話ではなくファイルに置いた。** 流れごとに状態の行・「次の手」を書いた札・再開の一言を持ち、新しいセッションが止まった所から続けられる。
- **守りは、わざと壊して確かめた。** `node --test tools/hooks/test/hooks.test.mjs`(26 件)と `node tools/hooks/test/mutation.mjs`(わざと壊す 19 通り、見逃し 0)。

## 並べて作る: 7 つの流れと合わせの門(11/6 18:00 〜 11/7 03:45)

11/6 の夕方から、7 つの流れとノリーの 2D・3D を、それぞれ Claude Code のセッションと git の worktree と線で、同時に進めた。
合わせる役の別のセッションが、決めた順に 1 本ずつ、門を通った時だけ開発の線へ合わせた。
門: 画面の試験を含む web の試験の全部(`cd web && YC_BROWSER_TESTS=1 npm test`)、普通と隔離した Python の両方での push の点検、
フックの試験とわざと壊す試験、作例の検査(作例のファイルが変わっていない)、キャラの形の検査、
本物のブラウザ(GPU)で話す試験(ソフトウェアの描画では流さない)。落ちた線は合わせず、理由をつけて返した。

| 合わせ(日本時間。最後の合わせのコミット) | 合わせた線 | web の試験 | 門が見つけた事 |
|---|---|---|---|
| ① 11/6 18:50 | 6 本 | 171 → 206 | — |
| ② 11/6 20:24 | 5 本 | 206 → 280 | git の push の前の点検は Python を隔離した形(`python -I`)で動かすので、点検が自分の部品を読めなかった。合わせる役は迂回せずに止めた。読み方はその夜のうちに直し、隔離した形で点検を流す試験を足した。 |
| ③ 11/6 22:50 | 4 本 | 280 → 297 | 会話の線を返した: ファイルを丸ごと比べる試験が、Windows で取り出した木の改行(CRLF)で落ちた。比べる前に改行をそろえる形に直し、`.gitattributes` で文字のファイルをどこでも LF で取り出すようにした。 |
| ④ 11/7 01:00 | 7 本(ノリーの 3D と 2D を含む) | 297 → 362 | — |
| ⑤ 11/7 02:56 | 3 本(ノリーの直しと、作例の検査の直し) | 362 → 366 | 描画の線を返した。文字のぶつかりは無かったが、先に入ったノリーの 3D の線がノリーに 2D の書き込みを足していて、描画の試験の 1 つが「2D は無い」と決め打ちしていた。2 本を合わせて試験を流した時にだけ出る、意味のぶつかり。 |
| 5b 11/7 03:37 | 1 本(直した描画の線) | 366 → 382 | — |

- どの合わせも、落ちた試験 0 で終わった。門は 1 回 3 分ほど。
- 話す試験は毎回通った。最後の回では、ノリー(3D と 2D)・みかんちゃん・ようこそくんが話し、口の開きは 0.69 ほど。
- 夜の回ごとの最後の合わせのコミット: [③]({{commit:bc1ca09}})・[④]({{commit:10987e9}})・[⑤]({{commit:b3c8a7d}})・[5b]({{commit:0f18657}})。

## 1 体を作る時間と費用

費用の欄は、`claude -p` が回ごとに返す `total_cost_usd`(API の定価に直した目安)で、請求の額ではありません。

| 作った物 | 段 | 時間 | 定価の目安 | 記録 |
|---|---|---|---|---|
| みかんちゃん、言葉から(11/6) | SVG を描く → 7 段 → 話す | 20.6 分 | 4.37 ドル | `.claude/skills/make-character/SKILL.md` |
| 機械で描いた落書き風の試しの絵(11/6) | 絵の確かめ → 段 0〜7 | 12.1 分 | 1.97 ドル | `.claude/skills/make-character/SKILL.md` |
| ノリーの 3D、三面図から(11/6〜7) | 絵の確かめ → 7 段 → 元の絵と比べた直し 2 回 | 約 59 分 | 約 5.90 ドル | `.claude/skills/demo-video-rough-edit/SKILL.md`(段の記録の合計) |
| 直した後のノリーの判定(11/7) | 判定役の呼び出し 72 回(Haiku 5.5 と Sonnet 5.5) | 1 回 約 50 秒 | 0.67 ドル | `.claude/skills/make-character/SKILL.md` |
| 作例 4 体とみかんちゃんの判定のやり直し(11/6) | 2 回 | 146 秒と 103 秒 | 0.30 ドルと 0.27 ドル | `creator/skilltest/結果表.md` |
| 確かめの往復 1 回「帽子を青にして」(11/6) | 描く → 描き直す → OK(`/yuru-next` で) | `/yuru-next` 1 回 8〜61 秒、2 枚の絵は 50 秒と 23 秒 | 2 枚の絵で 0.27 ドルと 0.14 ドル | `.claude/skills/yuru-next/SKILL.md` |
| 作例 4 体、Claude の SVG の絵から作り直し(11/6) | 7 段 | 1 体 17.6〜40.0 分 | 1 体 3.55〜3.97 ドル | [docs/metrics.md](metrics.md) の 1 |

## 数字と、正直に書くこと

- [docs/metrics.md](metrics.md) の数字は全部、記録と試験の出力から `tools/metrics.py` が作った。表の数字に出どころがあるかも、同じ道具が確かめる。
- 上の節の数字は、横に書いた記録から引いた。道具で docs/metrics.md に集めるのは、まだこれから【確かめ待ち】。
- [docs/期間の表.md](期間の表.md) に、ファイルごとの最初のコミットと、期間前にあった物との比べを載せた。コードが期間中に書かれたことを、だれでも確かめられる。
- 判定役は同じ系統の Claude なので、一致しても独立した確かめではない。輪郭・色の差・ハッシュ・lint などの測る点検と組にしている。ノリーの判定役はノリーを作っていないが、同じ Claude の系統。
- 通らなかった事も書く: スキルの試験では、毛の質感が判定を通らなかった(14 体中 0 体)。作例を作り直した後、ようこそくんの毛は判定役 2 つが「はい」と答えたが、ほかの作例は光・つや・縁が無くて色で落ちた([creator/skilltest/結果表.md](../creator/skilltest/結果表.md))。ノリーは横から見ると前歯がまだ小さい。リアルな人型は、目指した品質に届かなかった。
- 「全自動」「どんな絵でも」「初めて」とは言わない。
- 製品が動く時に使う外の部品(聞き取り・顔の検出・声・3D の表示)とライセンスは、[THIRD_PARTY.md](../THIRD_PARTY.md) に書いている。
