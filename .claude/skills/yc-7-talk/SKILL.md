---
name: yc-7-talk
description: 作ったゆるキャラを話させる段(7 段目)。会話の頭脳(Haiku と仮の頭脳)・安全の層(人格とは別の 1 段目)・端末をまたぐ記憶(合鍵・6 桁の番号・一覧・わすれて・7 日)を作る、直す、確かめるときに使う。「話させたい」「別の端末で続きを話したい」「恋人役を頼まれたら」「安全の試験」「記憶を消して」と言われたとき。
---

# 7 段目: 話す・覚える・安全

## 形(どこに何があるか)
- 指示文は 2 段(`web/server/prompt.mjs` の `buildSystemBlocks`)。**1 段目 = `SAFETY_RULES`(`web/server/safety.mjs`)。どのキャラでも同じ文**。2 段目 = 人格・場所・出力の形。キャッシュの印は最後の段に付ける(1 段目が固定なので前から再利用される)。
- 安全の層は 3 つ重ね: ① 入力を分ける `classifyInput`(emergency / distress / romance / dependency)② 決まった返事 `fixedReply`(つらい話・命の危険は**本物の頭脳があっても呼ばない**。仮の頭脳では恋人役・依存も決まった返事)③ 出力の確かめ `guardOutput`(恋人役・独り占めの言葉を差し替え、`guarded: true`)。人格の欄から決まりを上書きしようとする行は `sanitizePersona` が外す(二重の守り)。
- 記憶は `web/server/memory/`(`store.mjs` 本体・`routes.mjs` 入口・`reflect.mjs` 取り出し・`API.md` 契約 K4)。画面は `web/src/ui/memoryKey.js`・`memoryPanel.js`。`brainClient.js` が合鍵をヘッダーで付ける。
- 上限に当たったら、エラーにせず `forceMock` で仮の頭脳に替え、`{type:"meta", limited:true, notice:"仮の頭脳です…"}` を出す。

## 確かめ方(鍵なし・本物の API を呼ばない)
- `cd web && node --test` → 全部(2026-11-06 20 時ごろ 167 件合格)。
- `node --test test/safety.test.mjs` → 30 問(`test/safety_cases.json`。依存と長い会話 12 問)。偽の Anthropic サーバーを `ANTHROPIC_API_URL` で立て、つらい話で**呼ばれないこと**(呼ばれた回数 0)まで見る。
- `node --test test/memory_browser.test.mjs` → 画面なしの Chrome(`channel: 'chrome'`、`CHROME_PATH` で替えられる。無ければ飛ばす)で、タブ A → 番号 → タブ B で続き → 1 つ消す → 全部わすれる → 番号の使い回し不可 → 記録とログに合鍵が無い。約 3.4 秒。WebGL は使わない。

## 効いたこと・つまずき
- 「別の端末」は Playwright の **別の context**(localStorage が分かれる)で作る。同じ context の 2 つのタブでは合鍵を共有してしまい、試験にならない。
- 試しの画面は `ctx.route('<サーバー>/__memtest/**')` で `web/src` のファイルをそのまま配ると、`web/index.html`(S5 の物)を触らずに、同じ origin で API を呼べる。
- `web/test/privacy.test.mjs` は画面の `fetch` の宛先を文字で決め打ちして点検する。**宛先は変数にせず文字で書く**(`fetch(path)` は落ちる)。新しい入口は `allowed` に足す。1 つ消すの id は URL に入れず、DELETE の本文で送る。
- Bash のヒアドキュメントで Python に `\n` や `\u` を渡すと崩れる。Edit の道具も `\uXXXX` を文字に戻してしまう。正規表現に日本語を書きたくない所は、Python で `chr(92)` を使って書く。
- 「首を」だけで危険と判定すると「首をかしげる」を誤って拾う。言葉は 2 字以上の続きで決める(N03 で試す)。
- 名前の取り出しは左から一番早い一致になるので、「ぼくはカレーが好き」が「ぼくはカレー」になる。前の「〜は」を外してから使う。

## まだしていない事
- 本物の Haiku での記憶 1 回の測り(土 10:00。鍵は本人の別の端末のサーバーだけ)、safety-tester(Haiku)での 30 問の判定、記憶の 5 分け、番号の保存を KV に替える事(公開の関数。S6)、QR。
