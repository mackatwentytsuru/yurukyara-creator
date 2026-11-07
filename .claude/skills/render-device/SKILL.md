---
name: render-device
description: ゆるキャラの画面(3D と 2D の板)を「軽いのにきれい」にする手順。重さの測り(?perf=1・measure-render.mjs・K6 の 1 行)、CPU の描画(SwiftShader)で止める見張り、端末の段(tiers.js)、しつかん(3D の材質の切り替え。いつもの・ぬの・け・つるつる)、meshopt の解凍の共通の口、2D の板の読み込み(looks)、3D と 2D の見た目の切り替え、キャラを上の段と下の帯の間に収める(頭が切れない・すき間は画面の高さの 6%)、来場者の上の段(はなす・かえる・もっと)、入口(製品の名前・初めての訪問の 7 歩・指とマウスの言葉)、字幕に返事の全部を残す、考えの窓、?character= ?place= は公開では id だけ、既定のキャラ(主役ノリー)、動きの意図、スマホの https の道と Quest の実機の道、IWER で VR を確かめる、VR の QR と「Meta Quest に送る」、テレビ表示、絵の引き伸ばし、キーボード、カメラの入・切、小窓(マイクとスピーカー・アップデート)、かわいい仕草の層、main.js に他の流れの部品を付ける。使う場面 - 入口、ゲート、gate-up、初めての訪問、7 歩、yc.onboarded.v1、カメラなしで試す、指でなぞる、touch-action、字幕が消える、表情と動き、考えの窓が顔に重なる、切り替えが押せない、z-index、公開の URL、id だけ、見た目の切り替え、2D と 3D、sessionStorage、上の段に重なる、頭が隠れる、耳が切れる、44px、--top-h、frameCharacter、topGuard、重さを測る、最初のコマ、first_frame、mouth_max、fps、描く呼び出し、スマホで重い、Quest で重い、端末の段、tier、SwiftShader、画面なしの Chrome で撮る、meshopt、KTX2、重さの表、looks、?look=2d、既定のキャラ、norrie、applyIntent、https の道、Quest、IWER、vr-check、記憶の札を付ける、初めての会話を付ける、スマホではみ出す、VR(Quest)で開く、QR、questLink、Meta Quest に送る、許可する、requestSession が返らない、テレビ表示、テレビに映す、AirPlay、?tv=1、tvMode、しつかん、ぬの、け、つるつる、絵が細長い、引き伸ばし、キーボードで隠れる、マイクとスピーカーの窓、アップデートの印、かわいい仕草の層、カメラの入・切、上の段が 3 つ、はなす、かえる、もっと、戻るボタン。
---

# 軽いのにきれい(描画と端末)

この SKILL.md は入口だけ(いつ使うか・外せない決まり・手順・確かめ・落とし穴)。くわしい中身は `reference/` に元の文のまま移してある。必要な節だけ開く。

## 使う時
- 画面(3D・2D・上の段・入口・字幕・窓・VR・テレビ)の重さ・置き方・見え方を作る・直す・測る時。
- 「頭が切れる」「押せない」「重なる」「小さく写る」「細長い」「声が出ない画面」「Quest で開けない」などの相談。

## 外せない決まり
1. **描く確かめは GPU の Chrome だけ。** 新しい道具は `web/src/stage/gpuGuard.js` の `GPU_ARGS` で起動し、`page.goto` の次の行に `await stopIfSoftwareRenderer(page, browser);`。CPU の描画(SwiftShader・llvmpipe)なら終わりの番号 3 で止まる。
2. **見た目は全部の端末で同じ。** 端末の段(high/mid/low/xr)が変えるのは描く倍率と毛の準備だけ。しつかんの既定は全部の端末で「ぬの」。決める順は `?shitsukan=` → 押した物 → このブラウザの覚え(`yc.shitsukan.v1`)→ character.json の `looks.3d.material` → ぬの。
3. **しつかんの描き方**: 材質は差しかえた物の中だけ(色の変換も)。`renderer.toneMapping` と `scene.environment` は触らない。物が落とす影の絵とすき間の陰(SSAO)は使わない(54 → 18 fps に落ちた)。毛は使う人が選んだ時だけ。数字の正本は `shitsukan.js` の `LOOKS`・`LIGHT`。
4. **頭を切らない**: どの場面でも、キャラのいちばん上(耳を含む)≥ 上の段の下の端 + 画面の高さの 6%(`framing.js` の `TOP_CLEAR_FRACTION`)。その中でキャラはできるだけ大きく。動きの出っ張りは読み込みで測り、動きの間は「描いた形」で測る(箱では測れない)。
5. **絵は箱の大きさに毎コマ合わせる**(`syncSize()`)。窓の resize だけに頼ると、箱だけ変わった時に引き伸ばされる。
6. **上の段に字や言葉を足すと、行が増えてキャラが小さくなる。** 変えたら必ず幅 390 の高さ 664〜844 で行の数とすき間を測る。足す物は幅 60px 足らずに保つ。字を大きくしたら、その字を使う箱は「一番低い画面 × 一番長い文」で測り直す。
7. **来場者の上の段は 3 つ(はなす・かえる・もっと)**(UW5)。隠すのは入れ物だけにし、中の `[hidden]` を上書きする `display` を書かない。段を開く・閉じるたびに `fitBottom()`。段(`.top`)に `overflow` を付けない。 開いたら先に話す声かけは、初めての訪問では はじめての会話の札が閉じた後に出す(同時に出すと、あいさつが 2 つ重なり声も重なる)。
8. **公開の URL では `?character=` と `?place=` は id だけ**。外への通信の宛先は文字で書き、画面のコードに `http(s)://` を書かない(`privacy.test.mjs`)。SVG の名前空間も同じ。外の住所は `EXTERNAL_OK` の 2 か所だけ。
9. **カメラは使う人が決める**(入る前に 1 行の知らせ・入っている間は印・いつでも切れる・絵は話しかけた回だけ 1 枚)。VR の「Meta Quest に送る」は https のときだけ。確かめていない事は画面で言わない(QR の文は「読み取れます」まで)。
10. **`hidden` 属性は、同じ詳しさの `[hidden] { display: none }` が無いと `display` に負ける**(ヘッドセットで隠したはずのボタンが見えた)。

## 手順(直す時の流れ)
1. 測る: `npx vite build` → 会話サーバーを鍵なし・空いた番号で起こす → 札を取って `measure-render.mjs`(幅は pc・phone・quest)。初めて開く人の数字は `--cold`(1 件ごとに新しいブラウザ)で。
2. 直す: 置き方は `framing.js`(three を読まない)と `scene.js`、上の段・窓は `main.js` の専用の塊と `style.css`、材質は `shitsukan*.js`。決まりは three を読まない小さな部品に出して node の試験で見る。
3. 直す前の木(写し)で同じ試験が落ちることを見る。
4. 本物の画面(GPU の Chrome)で 幅 390・400・480・PC × 3D・2D × 入口・7 歩の札・話している間・手を振る・おじぎ を撮る。数字で比べる(頭のすき間・重なり・44px・縦横の比)。
5. 全部の試験: `YC_BROWSER_TESTS=1 npm test`(組み立ての後)。WebGL を描く 1 件だけは GPU の札で。
6. 学んだ事を合う節に足す(合う節が無ければ新しい節)。

## 確かめ(最低限)
- 重さ: `?perf=1`(左下の箱・`window.__perf`)・`docs/重さの表.md` に測った物だけ。fps は 60Hz で頭打ちなので、比べるのは描く呼び出し・三角・1 コマの CPU。
- 置き方: 板の道具 `layout_check.mjs`・`head_gap_check.mjs`・`tv_check.mjs`(合否の数字つき)。上の段が 3 つになった後は、押す前に「かえる」「もっと」を開く版を使う(UW5 の写し)。
- 窓と引き伸ばし: `stage_size_browser.test.mjs`、`audio-update-check.mjs`、`vr_w11_check.mjs`。
- VR: `scripts/vr-check.mjs`(IWER で 19 項目)。実機の Quest は USB(`quest-usb.mjs`)。
- 公開前: `tools/prepush_check.py` と `tools/name_check.py`(新しいファイルは先に `git add`)。

## つまずきやすい所(特に効いたもの)
- 同じブラウザで続けて測ると、作り置きで最初のコマが速くなる。初めての人の数字は新しいブラウザで。
- ゲート(`.gate`)が画面を覆っている間は下のボタンを押せない。先に `#startSim`。
- `translate: 0` など、値が 0 でも `position: fixed` の基準を作り変える物は、`html.kb-open` の下にだけ書く。
- 札の名前を `rec` にすると、注意書きの点の規則に当たってつぶれた。新しい名前は style.css を全部 grep してから。
- 窓は body の直下に置いて浮かせる。窓の高さには上限がある(下の端は 画面の高さ × 0.7 − 下の帯まで)。窓を下の帯の中に入れる案はだめだった。
- 3D のキャラの縦横の比は、待機の動きで 4〜5% 動く。比べる時は動きを止めるか、14 回測って幅の中で見る。
- 本物の iPhone の Safari と GPU の Chrome は違う。確かめは両方で(シミュレーターでは WebDriver の長押しが選択になるので JS の click)。
- 点検の道具を `python -I` で流すと日本語が化ける(`-X utf8`)。ssh で流す .ps1 は BOM つき・日本語を書かない。
- 確かめのサーバーの番号を決め打ちしない(OS に空きを選ばせる)。人の PID は止めない。
- 2 つの出し手が同じ瞬間に動かないかは、時刻つきの記録で見る(16ms の差で字幕と札が両方出た)。

## 参照ファイル(1 行ずつ)
- [reference/weight-and-tiers.md](reference/weight-and-tiers.md): 重さを測る・最初のコマ・話す試験の口・CPU の描画で止める・端末の段・meshopt と KTX2。
- [reference/shitsukan.md](reference/shitsukan.md): しつかん(上の段の切り替え・毛・数字・共通の落とし穴・確かめ方・上の段が混む時)。前の `?real=1` は今の仕組みに合わせて直した。
- [reference/layout-top-and-frame.md](reference/layout-top-and-frame.md): 上の段と下の帯の間に収める・頭のすき間 6%・来場者の上の段 3 つ(UW5)・押すだけの例・戻るボタン。
- [reference/characters-looks-default.md](reference/characters-looks-default.md): 見た目の切り替え(3D・2D)・2D の板と looks・既定のキャラ・動きの意図。
- [reference/gate-captions-public.md](reference/gate-captions-public.md): 入口と初めての訪問・字幕・考えの窓・公開では id だけ・声のサーバーの有無・第 7 波の道具。
- [reference/checks-and-shooting.md](reference/checks-and-shooting.md): 撮影の前の用意・スマホの https・GPU の Chrome の落とし穴・別の機械の確認台。
- [reference/main-parts.md](reference/main-parts.md): main.js に付けた画面の部品(記憶の札・仮の頭脳の知らせ・声・初めての会話)。
- [reference/vr-quest.md](reference/vr-quest.md): Quest(VR)の確かめ・「VR で開く」の QR・「Meta Quest に送る」・「許可する」待ち。
- [reference/tv-mode.md](reference/tv-mode.md): テレビ表示と「テレビに映す」。
- [reference/wave12-fixes.md](reference/wave12-fixes.md): 第 12 波の直し(VR の声かけ・スマホの声の失敗・横の端・札の上)。
- [reference/stretch-keyboard-windows.md](reference/stretch-keyboard-windows.md): 絵の引き伸ばし・キーボード・窓の戻る操作・低い PC の VR の箱。
- [reference/camera-switch.md](reference/camera-switch.md): カメラの入・切と印。
- [reference/sheet-windows.md](reference/sheet-windows.md): 小窓(マイクとスピーカー・アップデート)と上の段の印。
- [reference/cute-layer.md](reference/cute-layer.md): かわいい仕草の層。
