# キオスク(入口の案内。文字で聞いて、見本のキャラが店の記憶から答える)

お店の入口に置く案内画面。**まず文字で、頭脳(Claude Haiku)が正しく答えるところまで**作り、声(STT・TTS)は後から差し込む。

## 動かす

```bash
# 見本の記憶で(実在の店ではない)
cd web
SHOP_MEMORY_FILE=../kiosk/memory/sample/venue.json node server/index.mjs     # 鍵は ANTHROPIC_API_KEY(環境変数。書き込まない)
# → http://127.0.0.1:8787/kiosk/        ?talk で最初から会話の画面、?idle=5 で待ち受けに戻る時間を変える
```

本物の記憶を使うときは、`SHOP_MEMORY_FILE=../kiosk/memory/private/venue.json`(git に入らない)。

## 中身

| 場所 | 役目 |
|---|---|
| `memory/` | 店の記憶。事実(出どころ・取得日・確度つき)・今日のデータ・見本のキャラの設定・知らないときの答え方を分ける([memory/README.md](memory/README.md)) |
| `web/` | 画面(待ち受け→会話)。依存なしの HTML+JS。サーバーの `/kiosk/` が配る |
| `eval/` | 質問 88 件の試験。本物の頭脳に聞いて、合否を機械で判定([eval/run.mjs](eval/run.mjs)) |
| `config.json` | 画面と試験が同じ設定(キャラ・場面・待ち受けの時間)で聞くための共通の設定 |

頭脳・店のデータのつなぎ口・決まりは、`web/server/` と `.claude/skills/shop-guide/` を使う(画面と試験で、同じ物)。

## 声の入出力

`web/io.js` が `window.KioskIO` を作る(画面より先に読まれる)。聞き取りは既存の `Listener`、読み上げは `Speaker`(`/api/tts`、ElevenLabs)をそのまま使う(`/kiosk/conv/` で渡す)。

- 聞き取り: ブラウザ内蔵(Web Speech)が使えればそれ、無ければサーバーの `/api/stt`。`?stt=server` で強制。声のボタンで始まり、もう一度押すと止まる。話している間の確定文字は捨てる(自分の声を聞き返さない)。
- 読み上げ: 返事を 1 文ずつ。割り込み(新しい質問・待ち受けへ戻る)で止まる。鍵が無い・上限のときは音なしで字幕だけ。
- `?voice=0` で声を付けない(文字だけ)。ベンダーを替えるときは、`io.js` の `createKioskIO` だけを差し替える。
- 確認: サーバーを起動して `node kiosk/tools/io_smoke.mjs <アドレス>`(ヘッドレス Chrome。偽のマイク・偽の読み上げで、つなぎ込みだけを見る)。実機のマイク・実際の声は未確認。

## まだつながっていないもの

- スタッフへの通知(画面の「スタッフを呼ぶ」は表示だけ)
- 今日のデータ(ショー・出演者・空席)の本物の提供元(いまは `web/server/shop/sample.json`)
