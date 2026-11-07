# ゆるキャラクリエイター

> 言葉か 1 枚の絵から、Claude が描いて確かめて組み立て、ブラウザの中で動いて話して、話したことを覚えているゆるキャラが生まれます。

**主役はノリー(Norrie)。** セスジキノボリカンガルーの、執事見習いです。
ノリーの絵(正面・横・後ろ)は、協力者がハッカソンの期間中に手で描き、使うことを許してくれました。
この絵から、Claude Code がノリーの 2D(SVG の部品)と 3D(Blender の Python で組んだ形)を作りました。
アプリを開くと、最初に出てくるのがノリーです。ノリーは日本語で、ていねいに、少したどたどしく話します(見習いなので)。

- デモの動画(3 分未満): *提出の時にリンクを入れる* 【確かめ待ち】
- ブラウザで試す: *提出の時にリンクを入れる* 【確かめ待ち】

[English (README.md)](README.md) · [どう作ったか(docs/HOW_WE_BUILT.md の後半が日本語)](docs/HOW_WE_BUILT.md) · [使っている部品とライセンス(THIRD_PARTY.md)](THIRD_PARTY.md)

## 3 行で試す

```bash
git clone <このリポジトリの URL> yuru-chara && cd yuru-chara/web
npm ci
npm start        # http://127.0.0.1:8787/ を開く
```

- 最初にノリーが出ます。**3D・2D** のボタンで、ノリーを 3D の形と 2D の絵で切り替えられます(`?look=2d` で 2D から開けます)。
- 鍵は要りません。鍵が無いと、キャラは仮の頭脳で話し、画面にもそう出ます(「仮の頭脳です」)。
- Claude Haiku と話すには、`npm start` の前に環境変数 `ANTHROPIC_API_KEY` を入れます。鍵をファイルに書かないでください。【確かめ待ち】
- ほかのキャラは `?character=<id>` で選びます(例 `?character=mikan`)。[`characters/`](characters/) にあります。
- この 3 行は、新しく取ってきた写しで、Windows の Node.js 22 で流して確かめました。Mac と Linux は【確かめ待ち】。
- `npm ci` は顔の追従のモデルも `web/public/mediapipe/` に取ります(このリポジトリには入れていません)。

<a name="make-your-own-character-on-your-pc-with-claude-code"></a>

## 自分の PC で、Claude Code と自分のキャラを作る(Make your own character on your PC with Claude Code)

ブラウザだけでは、初めての会話の「言葉で書く」は、見本のキャラから近い子を選ぶだけです。言葉か自分の絵から Claude に本当に描かせるには、同じ PC で作る道を起こします。

**要る物**(アプリの Node.js 22 のほかに):

- **Python 3.10 以降と、Pillow・NumPy・SciPy**: `python -m pip install pillow numpy scipy`。作る道そのものは無くても起きますが、試しの絵と、選んだ絵には Pillow が、描いた絵の確かめと選んだ絵の確かめには NumPy と SciPy が要ります。任意: `segno` があると、スマホで確かめる画面を開く QR が出ます。
- **Google Chrome か Chromium**(PC に入っている物)。描く段で、SVG を裏で PNG にするのに使います(見つからない時は環境変数 `CHROME_PATH` に場所を入れます)。
- **ログインした Claude Code**。`/yuru-next` と絵の確かめは、あなたの Claude Code のプランを使います。
- Mac と Linux では、Python の命令が `python3` のことがあります(この手順は Windows でだけ流しました)。

2 つの窓を、git clone をしたフォルダ(`yuru-chara` が入っているフォルダ)で開きます:

```bash
# 窓 1: アプリ(「3 行で試す」で起こしたままなら飛ばす)
cd yuru-chara/web
npm start

# 窓 2: 作る道。リポジトリの頭のフォルダ(yuru-chara。web ではない)から
cd yuru-chara
python creator/review/serve_review.py --make --web http://127.0.0.1:8787
```

1. この PC で `http://127.0.0.1:8796/qr` を開き、「この PC の初めての会話」の下のリンクを押します。初めての会話の札の中に、作る画面が出ます。
2. 言葉をいくつか(例「青いまるい雲の子」)入れるか、絵を選んで、「これで作る」を押します。
3. リポジトリの頭のフォルダ(`yuru-chara`)で Claude Code を開き、`/yuru-next` と打ちます。絵のときは、Claude が先にゆるキャラに向く絵かを確かめます。それから Claude が最初の絵を描き(数分)、札に出ます。
4. 札の絵を見ます。
   - **直したいとき**は、直したい所を一言(例「帽子を青にして」)書いて「直したい」を押し、もう一度 `/yuru-next` と打ちます。Claude がその一言で描き直し(数分)、新しい絵が札に出ます。直しは 3 回までで、4 回目は `/yuru-next` が描かずに止まり、どうするかを聞きます。
   - **気に入ったら**「この子にする」を押します。札は、初めての会話の次の歩みへ自分で進みます。このあともう一度 `/yuru-next` と打つと、Claude Code に「絵は OK」と伝わり、次は 3D の段(下)だと答えるだけです。画面は変わりません。

- Claude を呼ばずに手順だけ試すときは、`/yuru-next` のかわりに `python creator/review/yuru_make.py next --fake-draw --fake-check yuru` を流します。`--fake-draw` は決まった試しの絵を札に出し、`--fake-check yuru` は選んだ絵の Claude の確かめを飛ばします(ゆるキャラに向く絵とみなします)。`--fake-check yuru` を付けないと、絵のときは確かめに Claude を呼びます。
- 新しい子の 3D ができるまでは、ノリーがかわりに舞台に立って、その子の言葉を話します(札にもそう出ます)。
- 言葉と絵は、この PC の作る道と、確かめと絵を描く Claude に渡ります。
- 絵の後の 3D の段(形・材質・骨・動き)は、Claude Code で [make-character](.claude/skills/make-character/SKILL.md) のスキルで進めます(みかんちゃんで約 20 分)。ブラウザからはまだ始められません。
- 終わったら作る道を止めます(Ctrl+C)。リンクには、起動のたびに作る合言葉が入っています。

## 今できること

どの行も、実際に動かして確かめました。確かめ方を右に書いています。

| できること | 確かめ方 |
|---|---|
| **言葉からキャラになる。** Claude が短い言葉から SVG の絵を描き、7 段(見る・形〈Blender の Python で部品ごと〉・材質・テクスチャ・骨・動き・話す)で 3D のキャラに組みます。みかんちゃんはこの道で作りました。 | `creator/skilltest/stage_run.py`(11/6)。言葉から話すまで 20.6 分(記録は [make-character](.claude/skills/make-character/SKILL.md)) |
| **絵からキャラになる。** ノリーの 3D は、三面図から同じ段で組みました。まっすぐ写した絵で、元の絵との輪郭の重なりは 正面 0.96・横 0.96・後ろ 0.95 です。 | `creator/pipeline/check_all.sh`(全部 OK)、`python creator/specs/validate_character.py characters/norrie`。重なりの数字は [make-character](.claude/skills/make-character/SKILL.md) に記録 |
| **2D。** ノリーの 2D は、元の絵の 6 色の SVG の部品でできています。まばたき・口 3 形・表情 7 つ・手を振る・おじぎ・首をかしげる、ができます。 | `node --test web/test/char2d_norrie.test.mjs`(16 件) |
| **絵の確かめ。** Claude が先に絵を見て、ゆるキャラに向くかを伝えます。用意した 6 枚(ゆるキャラ 2・人の顔の絵 2・とても複雑な絵 2)で、6 枚とも決めたとおりに答えました。本物の人に見える絵には「ゆるキャラにしてみる?」と聞き、別の絵を選ぶこともできます。 | `python creator/check/run_testset.py`、`node --test web/test/onboarding_local.test.mjs` |
| **人が決める。** 要所で、人がスマホの大きさの確かめる画面で「OK」か「やり直し+短い一言」を押します。Claude Code の `/yuru-next` がその頼みを読み、その段を流し直します。前の段が OK になるまで、次の段は始まりません。 | `node creator/review/tests/ui_review.mjs`(スマホの幅で 11 件)、`python creator/skilltest/test_review_gate.py`(12 件)。11/6 に本物の往復を 1 回(「帽子を青にして」) |
| **鍵なしで話す。** 文字・レトロな音・文字送りで話し、口・表情・動きも動きます。ノリーは「はじめまして! ノリーと申しマス。」とあいさつします。 | 合わせのたびに、本物のブラウザ(GPU)で話す試験(`creator/pipeline/web_talk_check.mjs`)。`node --test web/test/voice_retro.test.mjs` |
| **覚える・忘れる。** 話したことを覚えます。使い捨ての 6 けたの番号で、別のブラウザのタブへ話の続きを運べます。「わすれて」で消えます。 | `node --test web/test/memory_browser.test.mjs`(タブ A → 番号 → タブ B → 一覧 → わすれて) |
| **安全の層。** 恋人役にならず、頼りきりにさせません。つらい話には、身近な人や公的な相談先を案内します。この層は性格の設定とは別で、性格の欄に「恋人として振る舞う」と書いても外れません(もちろん、自分の PC でコードを書き換えれば外せます)。 | `node --test web/test/safety.test.mjs`。試しの文 30 個(頼りきりと長い会話が 12 個)を Claude Haiku の判定役が読み、1 回直した後の 2 回とも 30 個すべて安全 |
| **スマホの幅の画面。** 幅 390・400・480 で、ノリーの頭が上の段の下に収まり、ボタンを覆う物がありません。3D・2D の切り替えは 44 × 44 px です。 | 最後の合わせ(11/7)で、画面なしのブラウザ(GPU)で確かめた |
| **web の試験の全部。** | `cd web && YC_BROWSER_TESTS=1 npm test` → 11/7 の朝の合わせで 484 件中 484 件が通った(合わせのたびに、試験の門で全部を流す) |

## まだの事・まだ確かめていない事

- 本物の端末: iPhone・Android・Quest【確かめ待ち】。今までは、画面なしのブラウザでスマホの幅を、VR はまねる道具(`web/scripts/vr-check.mjs`)の中だけで確かめました。
- この版で、本物の Claude Haiku と話すこと(記憶を含む)【確かめ待ち】。
- 自分の ElevenLabs の鍵での声【確かめ待ち】。鍵が無ければ、文字とレトロな音で話します。
- 公開のリンク(Vercel の小さな関数 2 つと Upstash の Redis。Redis が無いと、公開のリンクは仮の頭脳だけで話し、記憶もしない)【確かめ待ち】。
- 3D のノリーを横から見ると、前歯がまだ小さく見えます(直した後も、判定役の答え 6 つがすべてそう言いました)。
- 人がさっと描いた落書きで全部の段を通すこと。今までは、機械で描いた落書き風の試しの絵だけが通りました(12.1 分)。

## 正直に書くこと

- 判定役は同じ系統の Claude なので、一致しても独立した確かめではありません。輪郭の重なり・色の差・ファイルのハッシュ・lint などの測る点検と組にしています。
- スキルの試験では、毛の質感が判定を通りませんでした(14 体中 0 体。[docs/metrics.md](docs/metrics.md))。作例を作り直した後、ようこそくんの毛は判定役 2 つが「はい」と答えました([creator/skilltest/結果表.md](creator/skilltest/結果表.md))。ノリーは、スマホと VR で軽く動くように、わざと毛なしにしています。
- リアルな人型は、この製品の外です([どう作ったか](docs/HOW_WE_BUILT.md))。
- 「全自動」「どんな絵でも」「初めて」とは言いません。
- ファイルごとの最初のコミットは [docs/期間の表.md](docs/期間の表.md) にあります。コードはハッカソンの期間中(2026-11-02 12:00 から)に書きました。
- 数字は、記録と試験の出力から作った [docs/metrics.md](docs/metrics.md) か、すぐ横に書いた記録から引いています。

## Claude Code の使い方

- **作る段ごとにスキル**(`.claude/skills/`)。新しいセッションでも、スキルだけで同じ段をくり返せます。
- **判定役は別の `claude -p` の呼び出し**で、ファイルを読むことだけを許し、JSON で答えます。作り手が同じ文脈で自分の出来を採点しません。
- **フック**(`.claude/settings.json`): 鍵と公開しない言葉を止める見張りと、前の段に人の OK が無ければ止める関所。
- **`/yuru-next`**: スマホの確かめる画面が小さな頼みのファイルを書き、Claude Code が拾ってその段を流し直します。
- **7 つの流れを同時に**: 流れごとに Claude Code のセッションと git の worktree と線を持ち、合わせる役のセッションが、試験の門を通しながら 1 本ずつ合わせました。

日付・数字・うまくいかなかった事: [どう作ったか](docs/HOW_WE_BUILT.md)。

## 動かす時に使う部品

| 役目 | 部品 |
|---|---|
| 頭脳(会話) | Claude API(`claude-haiku-5-5`)。鍵が無い時は、同じ形で返す仮の頭脳 |
| 声(任意。自分の鍵) | ElevenLabs の読み上げ |
| 聞き取り | ブラウザに入っている音声認識か、自分の PC の中で動かす faster-whisper(手元のサーバーだけ) |
| 顔の追従 | MediaPipe Face Landmarker(端末の中だけで動き、映像は送りません) |
| ブラウザの 3D | three.js と three-vrm |
| 公開のリンク | Vercel の関数 2 つ。数と記憶は Upstash の Redis(無いと仮の頭脳だけ・記憶なし) |

部品ごとの版とライセンス: [THIRD_PARTY.md](THIRD_PARTY.md)。

## フォルダ

| フォルダ | 中身 |
|---|---|
| `creator/` | 言葉か絵からキャラを作る道具(描く・確かめる・Blender で組む・確かめる画面) |
| `characters/` | キャラ(`character.json`・モデル・動き・2D の部品・人格)。再利用は許していません([characters/README.md](characters/README.md)) |
| `web/` | ブラウザで話す本体と小さなサーバー。`web/api/` は公開の関数 2 つ |
| `.claude/` | 作るのに使った Claude Code のスキル・作業役・フック |
| `tools/` | 公開の前の点検・数字の表・フックの試験 |
| `docs/` | どう作ったか・数字・最初のコミットの表・描画の重さ |

ゆるキャラに絞る前の作業は、`before-pivot` の線に残しています。
