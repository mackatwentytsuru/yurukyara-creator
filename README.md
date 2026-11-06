# Yuru-chara Creator

> Draw it in a word or a picture; Claude turns it into a light, talking yuru-chara that remembers you.

**Meet Norrie (ノリー)**, our main character: a back-striped tree kangaroo who is training to be a butler.
A collaborator drew Norrie by hand during the hackathon (front, side and back) and let us use the drawing.
That drawing is the input for Norrie's 2D and 3D versions, and Norrie guides you through our demo video.

[日本語の説明 (README.ja.md)](README.ja.md) · [How we built it](docs/HOW_WE_BUILT.md)

## Try it in 3 lines

```bash
git clone <this repository's URL> yuru-chara && cd yuru-chara/web
npm ci
npm start        # then open http://localhost:8787/
```

- No API key is needed. Without one, the character talks with a stand-in brain, and the screen says so.
- To talk with Claude Haiku, set `ANTHROPIC_API_KEY` as an environment variable before `npm start`. Never write keys into files.
- Choose a character with `?character=<id>`. The examples are in [`characters/`](characters/).
- Tested with Node.js 22. `npm ci` also downloads the face-tracking model into `web/public/mediapipe/` (it is not stored in this repository).

## What it does

1. **In:** a few words (for example "a little red lantern") or one drawing.
2. **Check:** Claude looks at a picture first and tells you whether it fits a yuru-chara. A realistic photo of a person or a very complex picture is flagged, and you can choose another picture.
3. **Make:** Claude Code draws an SVG from the words, then builds the character stage by stage: shape (Blender's Python), materials, textures, bones, motion and talk. A 2D version is made from SVG parts and moves as it is.
4. **A person checks:** at the key stages a person presses "OK" or "redo + one short note", also from a phone.
5. **Talk:** in the browser, with text and a retro sound with typewriter text, or with a voice if you add your own voice key.
6. **Remember:** the character keeps what you told it, and a short one-time code carries the conversation to another device. "Forget it" deletes it.

## Honest notes

- The judges are Claude models of the same family, so their agreement is not an independent check; we pair them with measured checks.
- Fur and fabric texture did not pass the judges (0 of 14). Realistic humans are out of scope (see [How we built it](docs/HOW_WE_BUILT.md)).
- We do not claim "fully automatic", "any picture works" or "the first".
- Every file's first commit is listed in [docs/期間の表.md](docs/期間の表.md); the code was written during the hackathon (from 2026-11-02 12:00 JST).
- The numbers we quote come from [docs/metrics.md](docs/metrics.md), which is built from logs and test output.

## Parts used while it runs

| Role | Part |
|---|---|
| Brain (talk) | Claude API (`claude-haiku-5-5`). Without a key: a stand-in brain in the same format |
| Voice (optional, your own key) | ElevenLabs text to speech |
| Speech to text | The browser's built-in speech recognition, or faster-whisper running on your own PC |
| Face tracking | MediaPipe Face Landmarker (runs on the device; video is not sent) |
| 3D in the browser | three.js and three-vrm |

## Folders

| Folder | What is inside |
|---|---|
| `creator/` | Tools that turn a word or a picture into a character (drawing, checks, Blender builders, review screen) |
| `characters/` | The characters (`character.json`, models, motions, persona). Not licensed for reuse; see [characters/README.md](characters/README.md) |
| `web/` | The browser app and its small server; `web/api/` holds the two public functions |
| `.claude/` | Claude Code skills, sub-agents and hooks used to build this |
| `tools/` | Release checks, metrics and hook tests |

The work from before the turn to yuru-chara is kept on the `before-pivot` branch.
