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

The built files do not yet carry these licence notices themselves (checked in `web/dist/` on 2026-11-07). They must be added before the public link goes live 【確かめ待ち】.

## 2. Services called over the network

| Service | When | Terms |
|---|---|---|
| Claude API (Anthropic Messages API, `claude-haiku-5-5`) | Only when `ANTHROPIC_API_KEY` is set; otherwise a stand-in brain answers | Anthropic's Commercial Terms and Usage Policy · https://www.anthropic.com/legal |
| ElevenLabs text to speech | Only when you add your own ElevenLabs key | ElevenLabs Terms of Service · https://elevenlabs.io/terms-of-use |
| Speech recognition built into the browser | When you talk by voice in a browser that has it. Some browsers send the audio to their maker's online service | The browser's own terms |
| Vercel (the public link: static pages and two functions) | Only for the public link 【確かめ待ち】 | Vercel's terms · https://vercel.com/legal/terms |
| Upstash Redis (counts and memory for the public link) | Only when connected in Vercel 【確かめ待ち】 | Upstash's terms · https://upstash.com/trust/terms.pdf |

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

- **Characters** (`characters/`): the models, motions, 2D parts and personalities were made during the hackathon with Claude Code. Norrie's design is the collaborator's hand drawing, used with permission; the drawing itself is not stored in this repository. The characters are not licensed for reuse ([characters/README.md](characters/README.md)).
- **Sounds**: the retro sound effects are made in code while the app runs (Web Audio). There are no audio files.
- **Ideas we read, with no code copied**: the public Claude skills in https://github.com/anthropics/skills (Apache-2.0), for how `yc-0-draw` draws an SVG: decide the style first, keep to 4–6 colours, refine instead of adding, and pair the drawing with a checker.
- Parts that only the older work on the `before-pivot` branch used are listed in [docs/部品の一覧.md](docs/部品の一覧.md).
- The licence of this repository's own code: decided by the owner before publishing 【確かめ待ち】.

---

## 日本語の要約

- **ブラウザで動く部品**(組み立てで中に入る): three(MIT)、@pixiv/three-vrm とその仲間(MIT)、@mediapipe/tasks-vision(Apache-2.0)、顔のモデル `face_landmarker.task`(Google の配布物。使用条件はモデルカードで確かめる【確かめ待ち】。`npm ci` で取り、リポジトリには入れない)、Vite の小さな読み込みの部品(MIT)。
- 組み立てた中身には、まだこの表示が入っていません。公開のリンクを開く前に入れます【確かめ待ち】。
- **外のサービス**: Claude API(鍵がある時だけ)、ElevenLabs(自分の鍵を入れた時だけ)、ブラウザの音声認識、Vercel と Upstash(公開のリンクだけ【確かめ待ち】)。
- **自分の PC で動かす物**: Node.js、faster-whisper と Whisper の small の型(MIT。手元のサーバーだけ)、Blender 5.2(GPL。道具として使うだけで、作った物は作った人の物)、Python と NumPy・Pillow・SciPy・OpenCV・segno。
- **作る・試す時だけ使う物**: Vite、playwright-core(Apache-2.0)、iwer(MIT)。
- **リポジトリに入れている外の素材**: Poly Haven の 2 つと ambientCG の 1 つの布の絵(どれも CC0)。
- **期間中に作った物**: キャラ(ノリーの絵は協力者の手描きで、許可を得て使用。絵そのものはリポジトリに入れていない。キャラの再利用は許可しない)、レトロな音(コードでその場で作る)。
- このリポジトリのコードのライセンスは、公開の前に本人が決めます【確かめ待ち】。
