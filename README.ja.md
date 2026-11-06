# ゆるキャラクリエイター

> 言葉か 1 枚の絵から、Claude が描いて確かめて組み立て、ブラウザの中で動いて話して、話したことを覚えているゆるキャラが生まれます。

**主役はノリー(Norrie)。** セスジキノボリカンガルーの、執事見習いです。
ノリーの絵(正面・横・後ろ)は、協力者がハッカソンの期間中に手で描き、使うことを許してくれました。
この絵がノリーの 2D と 3D の元になり、デモの動画ではノリーが案内します。

[English (README.md)](README.md) · [どう作ったか(docs/HOW_WE_BUILT.md の後半が日本語)](docs/HOW_WE_BUILT.md)

## 3 行で試す

```bash
git clone <このリポジトリの URL> yuru-chara && cd yuru-chara/web
npm ci
npm start        # http://localhost:8787/ を開く
```

- 鍵は要りません。鍵が無いと、キャラは仮の頭脳で話し、画面にもそう出ます。
- Claude Haiku と話すには、`npm start` の前に環境変数 `ANTHROPIC_API_KEY` を入れます。鍵をファイルに書かないでください。
- キャラは `?character=<id>` で選びます。作例は [`characters/`](characters/) にあります。
- Node.js 22 で試しました。`npm ci` は顔の追従のモデルも `web/public/mediapipe/` に取ります(このリポジトリには入れていません)。

## できること

1. **入れる:** 短い言葉(例「赤い小さな提灯」)か、絵 1 枚。
2. **確かめる:** Claude が先に絵を見て、ゆるキャラに向くかを伝えます。リアルな人の写真やとても複雑な絵には印が付き、別の絵を選べます。
3. **作る:** Claude Code が言葉から SVG を描き、段ごとに組み立てます(形は Blender の Python・材質・テクスチャ・骨・動き・話す)。2D の版は、SVG の部品のまま動きます。
4. **人が確かめる:** 要所で人が「OK」か「やり直し+短い一言」を押します。スマホからも押せます。
5. **話す:** ブラウザの中で、文字とレトロな音と文字送りで話します。自分の声の鍵を入れると声でも話します。
6. **覚える:** 話したことを覚え、短い使い捨ての番号で、別の端末へ話の続きを運べます。「わすれて」で消えます。

## 正直に書くこと

- 判定役は同じ系統の Claude なので、一致しても独立した確かめではありません。測る点検と組にしています。
- 布や毛の質感は、判定が通りませんでした(14 中 0)。リアルな人型は、この製品の外です([どう作ったか](docs/HOW_WE_BUILT.md))。
- 「全自動」「どんな絵でも」「初めて」とは言いません。
- ファイルごとの最初のコミットは [docs/期間の表.md](docs/期間の表.md) にあります。コードはハッカソンの期間中(2026-11-02 12:00 から)に書きました。
- 数字は [docs/metrics.md](docs/metrics.md) から引きます。記録と試験の出力から作った表です。

## 作る段とスキル

| 段 | 中身 | スキル・道具 |
|---|---|---|
| ⓪ 絵を描く | 言葉から SVG を描く(言葉の入口のときだけ) | `.claude/skills/yc-0-draw` |
| 確かめ | ゆるキャラに向く絵か | `.claude/skills/yuru-check` |
| ①〜⑥ | 絵を見る・形・材質・テクスチャ・骨・動き | `.claude/skills/make-character`・`hand-built-character`、`creator/` |
| ⑦ 話す | 声・字幕・口・表情・記憶 | `.claude/skills/yc-7-talk`・`talking-character`、`web/` |
| 2D | SVG の部品を板に描いて動かす | `.claude/skills/yc-2d` |
| 人の確かめ | スマホの「OK」「やり直し」を受けて段を流し直す | `.claude/skills/yuru-next`、`creator/review/` |

## 動かす時に使う部品

| 役目 | 部品 |
|---|---|
| 頭脳(会話) | Claude API(`claude-haiku-5-5`)。鍵が無い時は、同じ形で返す仮の頭脳 |
| 声(任意。自分の鍵) | ElevenLabs の読み上げ |
| 聞き取り | ブラウザに入っている音声認識か、自分の PC の中で動かす faster-whisper |
| 顔の追従 | MediaPipe Face Landmarker(端末の中だけで動き、映像は送りません) |
| ブラウザの 3D | three.js と three-vrm |

## フォルダ

| フォルダ | 中身 |
|---|---|
| `creator/` | 言葉か絵からキャラを作る道具(描く・確かめる・Blender で組む・確かめる画面) |
| `characters/` | キャラ(`character.json`・モデル・動き・人格)。再利用は許していません([characters/README.md](characters/README.md)) |
| `web/` | ブラウザで話す本体と小さなサーバー。`web/api/` は公開の関数 2 つ |
| `.claude/` | 作るのに使った Claude Code のスキル・作業役・フック |
| `tools/` | 公開の前の点検・数字の表・フックの試験 |

ゆるキャラに絞る前の作業は、`before-pivot` の線に残しています。
