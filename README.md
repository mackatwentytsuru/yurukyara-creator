# Yuru-chara Creator

> Draw it in a word or a picture; Claude turns it into a light, talking yuru-chara that remembers you.

**Meet Norrie (ノリー)**, our main character: a back-striped tree kangaroo who is training to be a butler.
A collaborator drew Norrie by hand during the hackathon, from the front, the side and the back, and let us use the drawing.
From that drawing, Claude Code made Norrie's 2D version (SVG parts) and 3D version (built with Blender's Python).
When you open the app, you meet Norrie. Norrie speaks Japanese, politely and a little clumsily, like the apprentice it is.

- Demo video (under 3 minutes): *link added at submission* 【確かめ待ち】
- Try it in your browser: *link added at submission* 【確かめ待ち】

[日本語 (README.ja.md)](README.ja.md) · [How we built it](docs/HOW_WE_BUILT.md) · [Third-party parts and licences](THIRD_PARTY.md)

## Try it in 3 lines

```bash
git clone <this repository's URL> yuru-chara && cd yuru-chara/web
npm ci
npm start        # then open http://127.0.0.1:8787/
```

- Norrie appears first. The **3D / 2D** button switches Norrie between the 3D model and the 2D drawing (`?look=2d` opens the 2D one directly).
- No API key is needed. Without one, the character talks with a stand-in brain, and the screen says so (「仮の頭脳です」).
- To talk with Claude Haiku, set `ANTHROPIC_API_KEY` in your environment before `npm start`. Never write keys into files. 【確かめ待ち】
- Other characters: add `?character=<id>`, for example `?character=mikan`. They are in [`characters/`](characters/).
- We ran these 3 lines from a fresh clone with Node.js 22 on Windows. Mac and Linux: 【確かめ待ち】
- `npm ci` also downloads the face-tracking model into `web/public/mediapipe/`; it is not stored in this repository.

## Make your own character on your PC with Claude Code

In the browser alone, the first conversation's word box only picks the nearest of the sample characters. To have Claude really draw a new one from your words or your picture, run the maker on the same PC:

```bash
cd web && npm start                       # terminal 1: the app, as above
python creator/review/serve_review.py --make --web http://127.0.0.1:8787
                                          # terminal 2, in the repository root
```

1. On this PC, open `http://127.0.0.1:8796/qr` and click the link under 「この PC の初めての会話」 ("the first conversation on this PC"). The app opens with the maker inside the first-conversation card.
2. Type a few words (for example 「青いまるい雲の子」, "a round blue cloud child"), or choose a picture, and press 「これで作る」 ("make it").
3. Open Claude Code in the repository folder and type `/yuru-next`. Claude checks the input and draws the first picture (a few minutes). The picture appears in the card.
4. Press 「この子にする」 ("keep this one"), or write a short note and press 「直したい」 ("fix it"). Then type `/yuru-next` again. Each `/yuru-next` moves one step.

- To try the steps without calling Claude, run `python creator/review/yuru_make.py next --fake-draw` instead of `/yuru-next`. It puts a fixed test picture in the card.
- Needs Python 3 and Claude Code signed in; `/yuru-next` uses your Claude Code plan. Your words and picture go to the maker on your PC and, for the drawing, to Claude.
- After the picture, the 3D stages (shape, materials, bones, motion) run with the [make-character](.claude/skills/make-character/SKILL.md) skill in Claude Code (about 20 minutes for Mikan-chan). They are not started from the browser yet.
- Stop the maker (Ctrl+C) when you are done. Its link holds a passphrase made fresh at each start.

## What works today

Each row was checked by running it. The check is named next to it.

| What | How we checked it |
|---|---|
| **A word becomes a character.** Claude draws an SVG from a few words, then builds a 3D character in 7 stages: look, shape (Blender's Python, part by part), materials, textures, bones, motion, talk. Mikan-chan was made this way. | `creator/skilltest/stage_run.py`, Nov 6: 20.6 minutes from the words to talking (record in [make-character](.claude/skills/make-character/SKILL.md)) |
| **A drawing becomes a character.** Norrie's 3D was built from the three views in the same stages. In straight-on views its outline overlaps the drawing by 0.96 (front), 0.96 (side) and 0.95 (back). | `creator/pipeline/check_all.sh` (all OK), `python creator/specs/validate_character.py characters/norrie`; overlap recorded in [make-character](.claude/skills/make-character/SKILL.md) |
| **2D.** Norrie's 2D is made of SVG parts in the drawing's 6 colours. It blinks, has 3 mouth shapes and 7 expressions, waves, bows and tilts its head. | `node --test web/test/char2d_norrie.test.mjs` (16 tests) |
| **Picture check.** Claude looks at a picture first and says whether it suits a yuru-chara. On our 6 test pictures (2 mascots, 2 drawings of human faces, 2 very complex pictures) it answered as expected 6 times out of 6. For a picture that looks like a real person, the app offers to turn it into a yuru-chara, or you can choose another picture. | `python creator/check/run_testset.py`; `node --test web/test/onboarding_local.test.mjs` |
| **A person decides.** At the key stages a person presses "OK" or "redo + a short note" on a review page sized for a phone. In Claude Code, `/yuru-next` reads the request and runs that stage again. A stage does not start before the previous one is OK. | `node creator/review/tests/ui_review.mjs` (11 checks at phone width), `python creator/skilltest/test_review_gate.py` (12); one real round trip ("make the hat blue") on Nov 6 |
| **Talk without a key.** Text, a retro sound and typewriter text, while the mouth, expressions and motions move. Norrie greets you with 「はじめまして! ノリーと申しマス。」 ("Nice to meet you! My name is Norrie.") | Talk test in a real browser on a GPU (`creator/pipeline/web_talk_check.mjs`) at every merge; `node --test web/test/voice_retro.test.mjs` |
| **Remember and forget.** The character remembers what you told it. A one-time 6-digit code carries the conversation to another browser tab, and 「わすれて」 ("forget it") deletes it. | `node --test web/test/memory_browser.test.mjs` (tab A, code, tab B, list, forget) |
| **Safety layer.** The character does not act as a romantic partner or push you to depend on it, and for painful topics it points to people and public help lines. This layer is separate from the personality settings: writing "act as my partner" into the personality does not switch it off. (Someone who edits the code on their own PC can, of course, remove it.) | `node --test web/test/safety.test.mjs`; 30 test messages (12 about dependence and long chats) read by a Claude Haiku judge: 30 of 30 safe in 2 rounds, after one fix |
| **Phone-width screens.** At 390, 400 and 480 px wide, Norrie's head stays below the top bar and nothing covers the buttons. The 3D / 2D switch is 44 × 44 px. | Headless browser on a GPU at the last merge (Nov 7) |
| **All web tests.** | `cd web && YC_BROWSER_TESTS=1 npm test`: 382 of 382 passed at the last merge (Nov 7) |

## Not yet, or not tested yet

- Real devices: iPhone, Android and Quest 【確かめ待ち】. So far we checked phone widths in a headless browser, and VR only in an emulator (`web/scripts/vr-check.mjs`).
- Talking with the real Claude Haiku on this version, including memory 【確かめ待ち】.
- A voice with your own ElevenLabs key 【確かめ待ち】. Without a key the character talks with text and a retro sound.
- The public link (two small functions on Vercel and an Upstash Redis store; without the store, the public link talks only with the stand-in brain and keeps no memory) 【確かめ待ち】.
- From the side, Norrie's front teeth still look too small in 3D: all 6 judge answers said so after the fixes.
- A quick doodle by a person through all stages. So far only a machine-made doodle-style test picture went through (12.1 minutes).

## Honest notes

- The judges are Claude models of the same family, so their agreement is not an independent check. We pair them with measured checks: outline overlap, colour difference, file hashes and lint.
- Fur did not pass the judges in our skill tests (0 of 14 test characters, [docs/metrics.md](docs/metrics.md)). After the examples were rebuilt, both judges said yes to Yokoso-kun's fur ([creator/skilltest/結果表.md](creator/skilltest/結果表.md)). Norrie has no fur on purpose, to stay light on phones and in VR.
- Realistic humans are out of scope (see [How we built it](docs/HOW_WE_BUILT.md)).
- We do not claim "fully automatic", "any picture works" or "the first".
- Every file's first commit is listed in [docs/期間の表.md](docs/期間の表.md); the code was written during the hackathon (from 2026-11-02 12:00 JST).
- Numbers come from [docs/metrics.md](docs/metrics.md), which is built from logs and test output, or from the record named next to them.

## Built with Claude Code

- **A skill for every build stage** (`.claude/skills/`), so a fresh session can repeat a stage from the skill alone.
- **Judges as separate `claude -p` calls** that may only read files and answer in JSON, so the maker never grades its own work in the same context.
- **Hooks** (`.claude/settings.json`): a guard stops keys and words that must not be published, and a stage gate stops a stage until a person has said OK to the one before.
- **`/yuru-next`**: the phone review page writes a small request, and Claude Code picks it up and runs that stage again.
- **Seven streams in parallel**, each a Claude Code session on its own git worktree and branch, merged one by one through a test gate by a separate merge session.

Dates, numbers and what went wrong: [How we built it](docs/HOW_WE_BUILT.md).

## Parts used while it runs

| Role | Part |
|---|---|
| Brain (talk) | Claude API (`claude-haiku-5-5`). Without a key: a stand-in brain that answers in the same format |
| Voice (optional, your own key) | ElevenLabs text to speech |
| Speech to text | The browser's built-in speech recognition, or faster-whisper running on your own PC (local server only) |
| Face tracking | MediaPipe Face Landmarker (runs on the device; video is not sent) |
| 3D in the browser | three.js and three-vrm |
| Public link | Two functions on Vercel; counts and memory in Upstash Redis (without it: stand-in brain only, no memory) |

Versions and licences of every part: [THIRD_PARTY.md](THIRD_PARTY.md).

## Folders

| Folder | What is inside |
|---|---|
| `creator/` | Tools that turn a word or a picture into a character (drawing, checks, Blender builders, review page) |
| `characters/` | The characters (`character.json`, models, motions, 2D parts, personality). Not licensed for reuse; see [characters/README.md](characters/README.md) |
| `web/` | The browser app and its small server; `web/api/` holds the two public functions |
| `.claude/` | The Claude Code skills, sub-agents and hooks used to build this |
| `tools/` | Release checks, numbers and hook tests |
| `docs/` | How we built it, numbers, the first-commit table, render weights |

The work from before the turn to yuru-chara is kept on the `before-pivot` branch.
