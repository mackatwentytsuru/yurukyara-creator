[日本語](HOW_WE_BUILT.md) · **English**

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
