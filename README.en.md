[日本語](README.md) · **English**

# Yuru-chara Creator

> Draw it in a word or a picture; Claude turns it into a light, talking yuru-chara that remembers you.

A shop's mascot, a town's guide, a family's own character: the drawing is often there, but making it move and talk took 3D modelling, rigging, animation, voice and dialogue work, and time. Here Claude takes that on; a person only presses "OK" or "redo + a short note" at the key steps.

**Meet Norrie (ノリー)**, our main character: a back-striped tree kangaroo who is training to be a butler.
A collaborator drew Norrie by hand during the hackathon, from the front, the side and the back, and let us use the drawing.
From that drawing, Claude Code made Norrie's 2D version (SVG parts) and 3D version (built with Blender's Python).
When you open the app, you meet Norrie. Norrie speaks Japanese, politely and a little clumsily, like the apprentice it is.
**The app's screens are in Japanese only** (buttons, steps and messages); there is no English mode.

- Demo video (under 3 minutes): *link added at submission* 【確かめ待ち】
- Try it in your browser: *link added at submission* 【確かめ待ち】

[How we built it](docs/HOW_WE_BUILT.en.md) · [Third-party parts and licences](THIRD_PARTY.md) · [Licence (code: MIT; characters excluded)](#license)

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

## What works today

Each row was checked by running it. The check is named next to it.

| What | How we checked it |
|---|---|
| **A word becomes a character.** Claude draws an SVG from a few words, then builds a 3D character in 7 stages: look, shape (Blender's Python, part by part), materials, textures, bones, motion, talk. Mikan-chan was made this way. | `creator/skilltest/stage_run.py`, Nov 6: 20.6 minutes from the words to talking (record in [make-character](.claude/skills/make-character/SKILL.md)) |
| **A drawing becomes a character.** Norrie's 3D was built from the three views in the same stages. In straight-on views its outline overlaps the drawing by 0.96 (front), 0.96 (side) and 0.95 (back). | `creator/pipeline/check_all.sh` (all OK), `python creator/specs/validate_character.py characters/norrie`; overlap recorded in [make-character](.claude/skills/make-character/SKILL.md) |
| **2D.** Norrie's 2D is made of SVG parts in the drawing's 6 colours. It blinks, has 3 mouth shapes and 7 expressions, waves, bows and tilts its head. | `node --test web/test/char2d_norrie.test.mjs` (16 tests) |
| **Picture check.** Claude looks at a picture first and says whether it suits a yuru-chara. On our 6 test pictures (2 mascots, 2 drawings of human faces, 2 very complex pictures) it answered as expected 6 times out of 6. For a picture that looks like a real person, the app offers to turn it into a yuru-chara, or you can choose another picture. | `python creator/check/run_testset.py`; `node --test web/test/onboarding_local.test.mjs` |
| **A person decides.** At the key stages a person presses "OK" or "redo + a short note" on a review page sized for a phone. In Claude Code, `/yuru-next` reads the request and runs that stage again. A stage does not start before the previous one is OK. | `node creator/review/tests/ui_review.mjs` (11 checks at phone width), `python creator/skilltest/test_review_gate.py` (12); one real round trip ("make the hat blue") on Nov 6 |
| **A fix changes only what you asked for.** After a redraw, the new picture is compared with the previous one, part by part, by colour and count. If something you did not ask for changed, Claude redraws once more; if it still differs, the picture is shown with the note 「頼んでいない所も変わりました」 ("parts you did not ask for changed too"). | `python -m unittest discover creator/review/tests -p "test_*.py"` (46 tests); one real run with Claude on Nov 7, 「葉っぱを大きく」 ("make the leaf bigger") on Mikan-chan's picture: 31 seconds, only the leaf grew, and the body colour, its 12 parts and the name stayed the same |
| **Talk without a key.** Text, a retro sound and typewriter text, while the mouth, expressions and motions move. Norrie greets you with 「はじめまして! ノリーと申しマス。」 ("Nice to meet you! My name is Norrie.") | Talk test in a real browser on a GPU (`creator/pipeline/web_talk_check.mjs`) at every merge; `node --test web/test/voice_retro.test.mjs` |
| **Choose the voice role.** 「声の役」 (voice role) on the 「性格」 (personality) screen offers おまかせ, 男の子 (boy) and 女の子 (girl); the character speaks aloud only with your own ElevenLabs key ([Voices](#voices)). | `node --test web/test/voice_role.test.mjs web/test/voice_role_server.test.mjs web/test/onboarding_voice_role.test.mjs` (20 tests); on Nov 7, against a stand-in voice service, choosing a role on the screen changed the voice requested |
| **Remember and forget.** The character remembers what you told it. A one-time 6-digit code carries the conversation to another browser tab, and 「わすれて」 ("forget it") deletes it. | `node --test web/test/memory_browser.test.mjs` (tab A, code, tab B, list, forget) |
| **Safety layer.** The character does not act as a romantic partner or push you to depend on it, and for painful topics it points to people and public help lines. This layer is separate from the personality settings: writing "act as my partner" into the personality does not switch it off. (Someone who edits the code on their own PC can, of course, remove it.) | `node --test web/test/safety.test.mjs`; 30 test messages (12 about dependence and long chats) read by a Claude Haiku judge: 30 of 30 safe in 2 rounds, after one fix |
| **Phone-width screens.** At 390, 400 and 480 px wide, and on a short 390 × 670 screen, Norrie's head stays below the top bar and nothing covers the buttons. The 3D / 2D switch is 44 × 44 px. | Headless browser on a GPU at the last merge (Nov 7) |
| **VR on a Quest 3.** In a real Quest 3 browser we checked Norrie on the screen and, after 「許可する」 ("allow"), Norrie in VR ([Open it on a Quest 3](#open-it-on-a-quest-3)). | A real Quest 3 on Nov 7 (developer connection). The 「VR(Quest)で開く」 box: `node --test web/test/vr_qr_link.test.mjs web/test/vr_xr_wait.test.mjs` (17 tests); the VR entry also in an emulator, `web/scripts/vr-check.mjs` |
| **All web tests.** | `cd web && YC_BROWSER_TESTS=1 npm test`: 574 of 574 passed at the merge on the evening of Nov 7 (the test gate runs them at every merge) |

## Not yet, or not tested yet

- Real devices: iPhone and Android 【確かめ待ち】. So far we checked phone widths in a headless browser. On a Quest 3 we checked only that a real Quest browser shows the screen and enters VR. Opening it from the QR code or 「Meta Quest に送る」, and talking inside VR: 【確かめ待ち】 (the VR entry is also checked in an emulator, `web/scripts/vr-check.mjs`).
- Talking with the real Claude Haiku on this version, including memory 【確かめ待ち】.
- A voice with your own ElevenLabs key, and switching between the boy's and the girl's voice 【確かめ待ち】. Without a key the character talks with text and a retro sound.
- The public link (two small functions on Vercel and an Upstash Redis store; without the store, the public link talks only with the stand-in brain and keeps no memory) 【確かめ待ち】.
- From the side, Norrie's front teeth still look too small in 3D: all 6 judge answers said so after the fixes.
- A quick doodle by a person through all stages. So far only a machine-made doodle-style test picture went through (12.1 minutes).

## Honest notes

- The judges are Claude models of the same family, so their agreement is not an independent check. We pair them with measured checks: outline overlap, colour difference, file hashes and lint.
- Fur did not pass the judges in our skill tests (0 of 14 test characters, [docs/metrics.md](docs/metrics.md)). After the examples were rebuilt, both judges said yes to Yokoso-kun's fur ([creator/skilltest/結果表.md](creator/skilltest/結果表.md)). Norrie has no fur on purpose, to stay light on phones and in VR.
- Realistic humans are out of scope (see [How we built it](docs/HOW_WE_BUILT.en.md)).
- We do not claim "fully automatic", "any picture works" or "the first".
- Every file's first commit is listed in [docs/期間の表.md](docs/期間の表.md); the code was written during the hackathon (from 2026-11-02 12:00 JST).
- Numbers come from [docs/metrics.md](docs/metrics.md), which is built from logs and test output, or from the record named next to them.

## Built with Claude Code

- **An entry skill for the 7 stages, and skills for the stages** (`.claude/skills/`, 18 in all). The entry, [make-character](.claude/skills/make-character/SKILL.md), holds the order and the check commands; drawing from words, the picture check, reading a picture, 2D, talking and the human review round trip each have their own skill. A fresh session can repeat a stage from the skill alone.
- **Judges as separate `claude -p` calls** that may only read files and answer in JSON, so the maker never grades its own work in the same context.
- **Sub-agents** (`.claude/agents/`): a character judge, a safety tester, a privacy auditor and a release auditor.
- **Hooks** (`.claude/settings.json`): a guard stops keys and words that must not be published, a stage gate stops a stage until a person has said OK to the one before, and the web tests run after each edit.
- **`/yuru-next`**: the phone review page writes a small request, and Claude Code picks it up and runs that stage again.
- **Fast Claude Haiku talks; Claude Code on your PC builds.** The conversation needs quick replies, so it uses Haiku; drawing and building take time to think, so they run in Claude Code on the PC.
- **Seven streams in parallel**, each a Claude Code session on its own git worktree and branch, merged one by one through a test gate by a separate merge session.

Dates, numbers and what went wrong: [How we built it](docs/HOW_WE_BUILT.en.md).

<a name="voices"></a>

## Voices: おまかせ, 男の子 or 女の子

- Every character has a voice role, boy (男の子) or girl (女の子), chosen automatically from the character: a line 「- 声: 男の子」 or 「- 声: 女の子」 in its personality text (`characters/<id>/persona.md`); without one, a guess from the way it calls itself or its name (〜くん, 〜ちゃん); failing that, girl. Norrie is a butler apprentice, so its role is 男の子.
- On the 「性格」 (personality) screen, 「声の役」 (voice role) in the 「声」 (voice) group offers **おまかせ** (the character's own role), **男の子** (boy) and **女の子** (girl).
- The character speaks aloud only with your own ElevenLabs key (API key). Enter it at step 7, 「声」 (voice), of 「はじめての会話」 (the first conversation). The key is used only inside this browser and is never sent to our server. Without a key, the character talks with text and a retro sound.
- The default voices are Japanese voices from ElevenLabs' Voice Library, one for each role. ElevenLabs says that Voice Library voices are not available through the API on the free tier. The ElevenLabs rules that apply are summed up in [THIRD_PARTY.md](THIRD_PARTY.md#elevenlabs-voices).
- To use another voice, add a line 「- 声の id: <ElevenLabs voice id>」 to the personality text (it is used when the character speaks in its own role). On the local server, the default voice of each role can also be changed with the environment variables `ELEVEN_VOICE_MALE` and `ELEVEN_VOICE_FEMALE`.

<a name="open-it-on-a-quest-3"></a>

## Open it on a Quest 3

- On a PC or a phone, press 「VR」 in the top bar. A box, 「VR(Quest)で開く」 ("open in VR (Quest)"), shows a QR code of this screen, its URL and 「Meta Quest に送る」 ("send to Meta Quest"). The URL holds only this screen's address, the character id and 3D or 2D (no passphrase, memory code or key).
- **QR code**: Quest 3 and 3S can read it with their QR code scanner (from Meta Horizon OS v2.9; open it from Quick Settings or the Camera app). Whether the Quest browser then opens the page: 【確かめ待ち】
- **「Meta Quest に送る」**: opens Meta's official Web Launch page in a new tab, which sends this screen's URL to the Quest browser. Meta allows this for https URLs only (the public link), so it appears only on https. For anything about your Meta account, follow Meta's page. 【確かめ待ち】
- On this PC (`127.0.0.1`) or at a home network address, the box shows one line saying that a Quest cannot open it, instead of the QR code and 「Meta Quest に送る」. Inside the Quest browser the box does not appear.
- In the Quest browser, press 「VR で見る」 ("view in VR"). The middle of the screen says 「ブラウザの下の『許可する』を押してください」 ("press 'allow' at the bottom of the browser"); press the browser's 「許可する」 ("allow"), and Norrie appears in VR.
- On Nov 7 we checked, in a real Quest 3 browser, Norrie on the screen and, after 「許可する」, Norrie in VR. That time we opened the page through a developer connection, not with the QR code or 「Meta Quest に送る」.

<a name="make-your-own-character-on-your-pc-with-claude-code"></a>

## Make your own character on your PC with Claude Code

> 日本語の手順: [README.md の同じ節](README.md#make-your-own-character-on-your-pc-with-claude-code)(アプリの画面は日本語だけです)

In the browser alone, the first conversation's word box only picks the nearest of the sample characters. To have Claude really draw a new one from your words or your picture, run the maker on the same PC.

**What you need** (on top of Node.js 22 for the app):

- **Python 3.10 or later with Pillow, NumPy and SciPy**: `python -m pip install pillow numpy scipy`. The maker itself starts without them, but the test picture and every chosen picture need Pillow, and the checks of a drawing and of a picture need NumPy and SciPy. Optional: `segno` draws the QR code for opening the review page on a phone.
- **Google Chrome or Chromium** on the PC. The drawing step turns the SVG into a PNG with it in the background (set `CHROME_PATH` if it is not found).
- **Claude Code, signed in.** `/yuru-next` and the picture check use your Claude Code plan.
- On Mac and Linux the Python command may be `python3` (we ran these steps on Windows only).

Open two terminals in the folder where you ran `git clone` (the folder that holds `yuru-chara`):

```bash
# Terminal 1: the app (skip this if it is still running from "Try it in 3 lines")
cd yuru-chara/web
npm start

# Terminal 2: the maker, from the repository root (yuru-chara, not web)
cd yuru-chara
python creator/review/serve_review.py --make --web http://127.0.0.1:8787
```

1. On this PC, open `http://127.0.0.1:8796/qr` and click the link under 「この PC の初めての会話」 ("the first conversation on this PC"). The app opens with the maker inside the first-conversation card.
2. Type a few words (for example 「青いまるい雲の子」, "a round blue cloud child"), or choose a picture, and press 「これで作る」 ("make it").
3. Open Claude Code in the repository root (`yuru-chara`) and type `/yuru-next`. For a picture, Claude first checks that it suits a yuru-chara. Then Claude draws the first picture (a few minutes), and it appears in the card.
4. Look at the picture in the card:
   - **To change it**, write a short note (for example 「帽子を青にして」, "make the hat blue") and press 「直したい」 ("fix it"). Then type `/yuru-next` again: Claude draws it again from your note (a few minutes), and the new picture appears in the card. You can ask for changes 3 times; at the 4th, `/yuru-next` stops and asks you how to go on.
   - **When you like it**, press 「この子にする」 ("keep this one"). The card goes on to the next step of the first conversation by itself. Typing `/yuru-next` once more only tells Claude Code that the picture is OK, and it answers that the 3D stages come next (below). Nothing changes on the screen.

- To try the steps without calling Claude, run `python creator/review/yuru_make.py next --fake-draw --fake-check yuru` instead of `/yuru-next`. `--fake-draw` puts a fixed test picture in the card, and `--fake-check yuru` skips Claude's check of a chosen picture (it treats the picture as a good yuru-chara picture). Without `--fake-check yuru`, a picture still goes to Claude for the check.
- Until a new character has its own 3D, Norrie stands on the stage in its place and speaks its words; the card says so.
- Your words and picture go to the maker on your PC and, for the check and the drawing, to Claude.
- After the picture, the 3D stages (shape, materials, bones, motion) run with the [make-character](.claude/skills/make-character/SKILL.md) skill in Claude Code (about 20 minutes for Mikan-chan). They are not started from the browser yet.
- Stop the maker (Ctrl+C) when you are done. Its link holds a passphrase made fresh at each start.

## Parts used while it runs

| Role | Part |
|---|---|
| Brain (talk) | Claude API (`claude-haiku-5-5`). Without a key: a stand-in brain that answers in the same format |
| Voice (optional, your own key) | ElevenLabs text to speech (by default, Japanese voices from the Voice Library: a boy's and a girl's) |
| Speech to text | The browser's built-in speech recognition, or faster-whisper running on your own PC (local server only) |
| Face tracking | MediaPipe Face Landmarker (runs on the device; video is not sent) |
| 3D in the browser | three.js and three-vrm |
| Sending to a Quest (optional) | Meta's Web Launch (only when you press 「Meta Quest に送る」, and only on https pages) |
| Public link | Two functions on Vercel; counts and memory in Upstash Redis (without it: stand-in brain only, no memory) |

Versions and licences of every part: [THIRD_PARTY.md](THIRD_PARTY.md).

## Folders

| Folder | What is inside |
|---|---|
| `creator/` | Tools that turn a word or a picture into a character (drawing, checks, Blender builders, review page) |
| `characters/` | The characters (`character.json`, models, motions, 2D parts, personality). Not covered by the MIT License and not licensed for reuse; see [characters/README.md](characters/README.md) |
| `web/` | The browser app and its small server; `web/api/` holds the two public functions |
| `.claude/` | The Claude Code skills, sub-agents and hooks used to build this |
| `tools/` | Release checks, numbers and hook tests |
| `docs/` | How we built it, numbers, the first-commit table, render weights |

The work from before the turn to yuru-chara is kept on the `before-pivot` branch.

<a name="license"></a>

## Licence

- **Code**: the MIT License ([LICENSE](LICENSE)).
- **Characters** (Norrie and the sample characters): not covered by the MIT License, and not licensed for reuse. You may look at them, and use them unchanged inside this app to try it out. The full list is under "Not covered" in [LICENSE](LICENSE) and in [characters/README.md](characters/README.md).
- Norrie's design is a collaborator's hand drawing, used with permission. The drawing itself is not in this repository.
- Third-party parts keep their own licences; they are listed in [THIRD_PARTY.md](THIRD_PARTY.md), together with the ElevenLabs rules for the voices.
