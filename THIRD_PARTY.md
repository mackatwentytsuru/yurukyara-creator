# Third-party parts and licences

This file lists the outside parts that the product uses while it runs, the tools used to build and test it, and the outside assets stored in this repository, with their licences.
npm versions are the ones locked in [`web/package-lock.json`](web/package-lock.json) (checked on 2026-11-07); Python versions are the ones installed on the PC that built the characters.
日本語の要約は末尾にあります。

## 1. Runs in the browser (bundled into the web app by `npm run build`)

| Part | Version | Licence | Copyright and source | Used for |
|---|---|---|---|---|
| three | 0.187.0 | MIT | © 2010–2026 three.js authors · https://github.com/mrdoob/three.js | Drawing the 3D characters |
| @pixiv/three-vrm, with @pixiv/three-vrm-core, -materials-mtoon, -materials-hdr-emissive-multiplier, -materials-v0compat, -node-constraint, -springbone and the @pixiv/types-vrm* packages | 3.5.5 | MIT | © 2019–2026 pixiv Inc. · https://github.com/pixiv/three-vrm | Loading VRM characters, expressions and gaze |
| @mediapipe/tasks-vision (JavaScript and WebAssembly; `npm ci` copies the wasm files to `web/public/mediapipe/wasm/`) | 1.2.0 | Apache-2.0 (the package's licence field; the package ships no licence file) | Google · https://github.com/google-ai-edge/mediapipe | Face tracking on the device |
| MediaPipe Face Landmarker model (`face_landmarker.task`, float16, version 1) | 1 | See the model cards (Face Mesh V2 and Blendshape V2) 【確かめ待ち】 | Google · https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker | Where faces are and how wide mouths open. `npm ci` downloads it from Google's model storage; it is not stored in this repository |
| Vite (a small module-preload helper ends up in the built files) | 8.3.5 | MIT | © 2019–present VoidZero Inc. and Vite contributors · https://github.com/vitejs/vite | Loading the app's code chunks |

The build carries these notices: `vite build` writes `licenses.txt` next to the page (name, version, licence and licence text of each part inside the build, including Vite's small loader helpers, and the full Apache 2.0 text), and each JavaScript file that contains these parts starts with a one-line comment pointing to it (checked in `web/dist/` on 2026-11-07; `node --test web/api/_test/build_licenses.test.mjs`). On the public link it will be at `/licenses.txt` 【確かめ待ち】.

## 2. Services called over the network

| Service | When | Terms |
|---|---|---|
| Claude API (Anthropic Messages API, `claude-haiku-5-5`) | Only when `ANTHROPIC_API_KEY` is set; otherwise a stand-in brain answers | Anthropic's Commercial Terms and Usage Policy · https://www.anthropic.com/legal |
| ElevenLabs text to speech | Only when you add your own ElevenLabs key | ElevenLabs Terms of Service · https://elevenlabs.io/terms-of-use, and the rules for the voices [below](#elevenlabs-voices) |
| Speech recognition built into the browser | When you talk by voice in a browser that has it. Some browsers send the audio to their maker's online service | The browser's own terms |
| Meta Web Launch (Meta's page that sends a link to a Quest's browser) | Only when you press 「Meta Quest に送る」, which appears only on https pages. Meta's page opens in a new tab with this screen's URL (only the address, the character id and 3D or 2D); no referrer is sent | Meta's own terms, on that page · how it works: https://developers.meta.com/horizon/documentation/web/web-launch/ |
| Vercel (the public link: static pages and two functions) | Only for the public link 【確かめ待ち】 | Vercel's terms · https://vercel.com/legal/terms |
| Upstash Redis (counts and memory for the public link) | Only when connected in Vercel 【確かめ待ち】 | Upstash's terms · https://upstash.com/trust/terms.pdf |

<a name="elevenlabs-voices"></a>

### ElevenLabs voices: the rules that apply (read on 2026-11-07)

The app speaks aloud only with the viewer's own ElevenLabs key: either typed into the browser, where it stays in that browser and goes only to ElevenLabs with the text to be read (never to our server), or, on your own PC, given to the local server as the environment variable `ELEVENLABS_API_KEY`. The public link has no voice key of its own. The default voices are Japanese voices from the ElevenLabs Voice Library, chosen by voice id: one for the boy's role and one for the girl's role ([README, "Voices"](README.en.md#voices)).

| ElevenLabs document (last updated) | What it says | What it means here |
|---|---|---|
| [Terms of Service](https://elevenlabs.io/terms-of-use) (2026-10-09) | On the free plan, the Services may be used only for non-commercial purposes (§1(c)(i)); paid plans may be used commercially, still under the Prohibited Use Policy (§1(c)(ii)). As between the user and ElevenLabs, the user keeps the rights in the Output (§4(c)(ii)). | Whoever adds a key uses their own ElevenLabs account, plan and terms. |
| [Voice Library](https://elevenlabs.io/docs/eleven-creative/voices/voice-library) (documentation) | "Voice Library voices are not available via the API to free tier users." A voice's owner can stop sharing it: with a notice period (30 days to 2 years) it stays usable for that period; without one, access ends at once. Owners can also turn on live moderation, set a custom rate, or block free users. | A free-tier key cannot play the default voices. A default voice stops working if its owner stops sharing it; the character then talks with text and the retro sound until another voice id is set (a 「- 声の id:」 line in the personality text, or `ELEVEN_VOICE_MALE` / `ELEVEN_VOICE_FEMALE` on the local server). |
| [OEM Terms](https://elevenlabs.io/oem-terms) (2025-02-28) | Bundling the Services into your own product for your own end users needs a business agreement; customers on the Free, Starter, Creator and Pro plans are "expressly prohibited" from making the Services available that way. | This is why the app never shares one account: there is no voice key on our side, and each viewer brings their own. |
| [Prohibited Use Policy](https://elevenlabs.io/use-policy) (2026-10-09) | Accounts are for people aged 18 or over, and apps "directed at individuals under 18" are prohibited (§1). Do not impersonate a real person's voice without consent (§3). Disclose AI interaction where the law requires it or where not doing so would materially mislead, and do not remove ElevenLabs watermarks, metadata or other provenance signals (§10). No commercial use on a free plan (§12). | The voice needs the viewer's own ElevenLabs account. We clone no one's voice; we use only voices that their owners share in the Voice Library. The README and this file say that the voices are AI voices made with ElevenLabs. |
| [Voice Library Addendum](https://elevenlabs.io/vla) (2026-03-06) | Terms for people who share their own voices in the Voice Library. | Does not apply: we share no voice. |

- The demo video's voices: made through the ElevenLabs API with Voice Library voices, on the team's own account. The voice names and the plan's commercial terms: 【確かめ待ち】 (added at submission).

## 3. Runs on your own PC (not bundled)

| Part | Version | Licence | Source | Used for |
|---|---|---|---|---|
| Node.js | 22 | MIT and others | https://nodejs.org | The local server and the tests |
| faster-whisper, with CTranslate2 | 1.2.1, 4.8.3 | MIT, MIT | https://github.com/SYSTRAN/faster-whisper | Optional speech to text on the local server (`web/server/stt_worker.py`). Not used by the public link |
| Whisper `small` model, converted for faster-whisper | — | MIT | Downloaded by faster-whisper on first use | Same as above |
| Blender | 5.2 | GPL-2.0-or-later. What you make with Blender belongs to you (Blender's licence page) | https://www.blender.org/about/license/ | Building the 3D characters (`creator/`), run as a tool. Not bundled |
| Python | 3.10 | PSF License | https://www.python.org | The creator tools |
| NumPy | 2.2.6 | BSD-3-Clause | https://numpy.org | The creator tools (shapes, image comparison) |
| Pillow | 12.2.0 | MIT-CMU | https://python-pillow.org | The creator tools (images, check sheets) |
| SciPy | 1.15.3 | BSD-3-Clause | https://scipy.org | The creator tools (picture check, image comparison) |
| OpenCV (opencv-python-headless or opencv-contrib-python) | 5.0.0.93 | Apache-2.0 | https://opencv.org | Turning Norrie's drawing into 2D parts (`creator/d2/from_drawing/`) |
| segno | 1.6.6 | BSD-3-Clause | https://github.com/heuer/segno | The QR code on the review page (`creator/review/serve_review.py`) |

The creator's check sheets use fonts already installed on the PC; no font files are stored in this repository.

## 4. Used only to build and test (not shipped)

| Part | Version | Licence | Source | Used for |
|---|---|---|---|---|
| Vite | 8.3.5 | MIT | https://github.com/vitejs/vite | Dev server and build |
| Its build parts: rolldown 1.2.16 (MIT), lightningcss 1.33.0 (MPL-2.0), postcss 8.5.32 (MIT) and small helpers (MIT, ISC, BSD-3-Clause, Apache-2.0) | — | as listed | `web/package-lock.json` | Bundling and minifying |
| playwright-core | 1.64.1 | Apache-2.0 | © Microsoft Corporation · https://github.com/microsoft/playwright | Headless-browser tests and screenshots |
| iwer (Immersive Web Emulation Runtime), with gl-matrix (MIT) and webxr-layers-polyfill (Apache-2.0) | 2.7.0 | MIT | © Meta Platforms, Inc. and affiliates · https://github.com/meta-quest/immersive-web-emulation-runtime | Checking the VR entry without a headset |

## 5. Outside assets stored in this repository

| Asset | Where | Licence | Source |
|---|---|---|---|
| Poly Haven "Polar Fleece" (3 texture images) | `creator/viewer/assets/fleece/` | CC0 | https://polyhaven.com/a/polar_fleece |
| Poly Haven "Curly Teddy Natural" (4 texture images, 1K) | `creator/viewer/assets/curly_teddy_natural/` | CC0 | https://polyhaven.com/a/curly_teddy_natural |
| ambientCG "Fabric 034" (4 texture images, 1K) | `creator/viewer/assets/fabric034/` | CC0 1.0 | https://ambientcg.com/view?id=Fabric034 |

These are used for the fur and cloth looks in the browser. Poly Haven and ambientCG say that no credit is required; we give it anyway.

## 6. Made during the hackathon (not third-party)

- **Characters** (`characters/`): the models, motions, 2D parts and personalities were made during the hackathon with Claude Code. Norrie's design is the collaborator's hand drawing, used with permission; the drawing itself is not stored in this repository. The characters are not covered by the MIT License and are not licensed for reuse ([characters/README.md](characters/README.md)).
- **Sounds**: the retro sound effects are made in code while the app runs (Web Audio). There are no audio files.
- **Ideas we read, with no code copied**: the public Claude skills in https://github.com/anthropics/skills (Apache-2.0), for how `yc-0-draw` draws an SVG: decide the style first, keep to 4–6 colours, refine instead of adding, and pair the drawing with a checker.
- Parts that only the older work on the `before-pivot` branch used are listed in [docs/部品の一覧.md](docs/部品の一覧.md).
- The licence of this repository's own code: the MIT License ([LICENSE](LICENSE)). The characters are not covered and are not licensed for reuse (the "Not covered" part of [LICENSE](LICENSE), and [characters/README.md](characters/README.md)).

---

## 日本語の要約

- **ブラウザで動く部品**(組み立てで中に入る): three(MIT)、@pixiv/three-vrm とその仲間(MIT)、@mediapipe/tasks-vision(Apache-2.0)、顔のモデル `face_landmarker.task`(Google の配布物。使用条件はモデルカードで確かめる【確かめ待ち】。`npm ci` で取り、リポジトリには入れない)、Vite の小さな読み込みの部品(MIT)。
- 組み立て(`vite build`)が、ページの隣に `licenses.txt`(中に入った部品ごとの名前・版・ライセンスと本文。Vite の小さな読み込みの部品も含む。Apache 2.0 は全文)を置き、部品の入った JS の頭に、その場所を示す 1 行の注を足します(2026-11-07 に `web/dist/` で確かめた。`node --test web/api/_test/build_licenses.test.mjs`)。公開のリンクでは `/licenses.txt` で読めます【確かめ待ち】。
- **外のサービス**: Claude API(鍵がある時だけ)、ElevenLabs(自分の鍵を入れた時だけ)、ブラウザの音声認識、Meta のウェブローンチ(「Meta Quest に送る」を押した時だけ。https の頁の時だけ出る。送るのは、この画面の場所とキャラの id と 3D・2D だけ)、Vercel と Upstash(公開のリンクだけ【確かめ待ち】)。
- **ElevenLabs の声の決まり**(2026-11-07 に読んだ。上の表に出どころのリンク): 声は、見る人が自分の鍵を入れた時だけ出ます(ブラウザに入れた鍵は、そのブラウザの中だけで使い、読み上げる文と一緒に ElevenLabs にだけ届きます。私たちのサーバーには届きません。自分の PC では、手元のサーバーの環境変数 `ELEVENLABS_API_KEY` でも使えます)。公開のリンクには、私たちの声の鍵はありません。既定の声は、声のライブラリの日本語の声(男の子の役と女の子の役)です。
  - 利用規約: 無料の枠は商用でない使い方だけ・有料の枠は商用に使える(禁止の決まりは守る)・作った音の権利は使った人に残る。
  - 声のライブラリ: 無料の枠の鍵では、ライブラリの声を API で使えない。声の持ち主が共有をやめると、知らせの期間(30 日〜2 年)の後か、期間が無ければすぐに使えなくなる。その時、キャラは文字とレトロな音で話す(人格の文の「- 声の id:」の行か、手元のサーバーの環境変数 `ELEVEN_VOICE_MALE`・`ELEVEN_VOICE_FEMALE` で、別の声に替えられる)。
  - OEM の決まり: 自分の製品に組み込んで、ほかの人に使わせるには、事業の契約が要る(Free・Starter・Creator・Pro の枠では禁止)。だから、このアプリは 1 つのアカウントを分け合わず、見る人が自分の鍵を使う。
  - 禁止の決まり: アカウントは 18 歳から・18 歳未満に向けたアプリは禁止・実在の人の声をまねない・法律が求める時や、言わないと人を大きく誤らせる時は AI だと伝える・ElevenLabs の透かしやメタデータを消さない・無料の枠で商用に使わない。このアプリは、だれの声もまねて作っていません(ライブラリで持ち主が共有している声だけ)。README とこのファイルで、声が ElevenLabs の AI の声だと書いています。
  - デモの動画の声: チームのアカウントで、ライブラリの声を API で使って作りました。声の名前とプランの商用の扱いは【確かめ待ち】(提出の時に書く)。
- **自分の PC で動かす物**: Node.js、faster-whisper と Whisper の small の型(MIT。手元のサーバーだけ)、Blender 5.2(GPL。道具として使うだけで、作った物は作った人の物)、Python と NumPy・Pillow・SciPy・OpenCV・segno。
- **作る・試す時だけ使う物**: Vite、playwright-core(Apache-2.0)、iwer(MIT)。
- **リポジトリに入れている外の素材**: Poly Haven の 2 つと ambientCG の 1 つの布の絵(どれも CC0)。
- **期間中に作った物**: キャラ(ノリーの絵は協力者の手描きで、許可を得て使用。絵そのものはリポジトリに入れていない。キャラの再利用は許可しない)、レトロな音(コードでその場で作る)。
- このリポジトリのコードは MIT ライセンスです([LICENSE](LICENSE))。キャラは MIT に含まず、再利用を許可しません([LICENSE](LICENSE) の「Not covered」と [characters/README.md](characters/README.md))。
