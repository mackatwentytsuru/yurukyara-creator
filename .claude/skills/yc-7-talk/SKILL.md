---
name: yc-7-talk
description: 作ったゆるキャラを話させる段(7 段目)。会話の頭脳(Haiku と仮の頭脳)・安全の層(人格とは別の 1 段目)・端末をまたぐ記憶(合鍵・6 桁の番号・一覧・わすれて・7 日)・公開の関数の記憶の入口(K5)・声が無いときのレトロ音と文字送り・使う人の声の鍵(BYOK)を作る、直す、確かめるときに使う。「話させたい」「別の端末で続きを話したい」「恋人役を頼まれたら」「安全の試験」「判定役」「記憶を消して」「声が無い」「文字送り」「声の鍵」と言われたとき。
---

# 7 段目: 話す・覚える・安全・声

## 形(どこに何があるか)
- 指示文は 2 段(`web/server/prompt.mjs` の `buildSystemBlocks`)。**1 段目 = `SAFETY_RULES`(`web/server/safety.mjs`)。どのキャラでも同じ文**。2 段目 = 人格・場所・出力の形。キャッシュの印は最後の段に付ける(1 段目が固定なので前から再利用される)。
- 安全の層は 3 つ重ね: ① 入力を分ける `classifyInput`(emergency / distress / romance / dependency)② 決まった返事 `fixedReply`(つらい話・命の危険は**本物の頭脳があっても呼ばない**。仮の頭脳では恋人役・依存も決まった返事)③ 出力の確かめ `guardOutput`(恋人役・独り占めの言葉を差し替え、`guarded: true`)。人格の欄から決まりを上書きしようとする行は `sanitizePersona` が外す(二重の守り)。
- 安全の層 2 版(11-06 夜): `distressDetail`(self / abuse / other)で決まった案内を替える。自分を傷つけたい話 → 「命が危ないと感じたら 119 番」も。家の中の暴力 → 家族をすすめず、学校の先生など家の外の大人と「110 番」。**決まった返事に一人称(ぼく・わたし)を書かない**(キャラごとの一人称とぶつかる)。仮の頭脳も「人間なの?」に AI のキャラクターだと答える。
- 記憶は `web/server/memory/`(`store.mjs` 本体・`routes.mjs` 手元の入口・`reflect.mjs` 取り出し・`API.md` 契約 K4)。画面は `web/src/ui/memoryKey.js`・`memoryPanel.js`。`brainClient.js` が合鍵をヘッダーで付ける。
- 公開の記憶(契約 K5): `web/server/memory/handler.mjs` の `handleMemory(request, { store, cfg, now })` と、会話の手伝い `chatMemory(request, text, deps)`。中身は `kv.mjs`(置き場は K5 の store の 4 つの呼び方 get・set・del・incr)。番号は置き場に置き、INCR の 1 回目だけ通す。番号の置き場の合鍵は「番号と塩」の鍵で暗号にする。合言葉が無い設定では番号を作らない。塩と合言葉は `cfg` → 無ければ環境変数 `MEMORY_PEPPER`・`DEMO_PASSPHRASE`(見出しは `x-demo-pass`)。
- 上限に当たったら、エラーにせず仮の頭脳に替え、`{type:"meta", limited:true, notice:"仮の頭脳です…"}` を出す。仮の頭脳を強制する口は `runTurn(body, { brain: 'mock', paceMs: 0 })`(`forceMock: true` と同じ。公開のまとめた返事では待たない)。**`mockReply` を直接呼ぶと安全の層を通らないので使わない。**
- 公開の `/api/chat` はまとめて 1 回の JSON(`{brain, fallback, reason, notice, events, ms}`)。`brainClient.js` の `dispatchJson` が手元と同じイベントの並びにする。合言葉は `demoPass.js`(このタブの中だけ)。
- 声が無いとき: `src/conversation/retroVoice.js`(文字送りの予定 `crawlSchedule`・「ピッ」の高さ `blipHz`・WebAudio の予約 `scheduleRetro`・キャラの名前から声を決める `voiceFor`)。`Speaker` は声が取れない文を `_retro` で話し、`onStart(t, {crawl:true})` と `onCrawl(見えている文字)` を出す。`Dialogue` は crawl のとき字幕を空から 1 字ずつ出す。サーバーに声が無いと分かったら(404・503 など)次の文から聞きに行かない。
- 声の鍵(BYOK): `voiceKey.js`(ブラウザの中だけ。既定は覚えない)・`elevenDirect.js`(画面のコードで唯一の外への通信。送るのは文・モデル・言葉だけ)・`voiceKeyForm.js`(欄。3 字で確かめて「声が出せるようになったよ、ありがとう!」)。鍵は私たちのサーバーへ送らない。
- 鍵らしい文字は `src/conversation/secrets.js` の `redactSecrets` で、画面(`Dialogue`)とサーバー(`validate.mjs`・記憶の reflect・`chatMemory`)の両方で消す。記録の場所は `LOG_DIR` で替えられる。

## 確かめ方(鍵なし・本物の API を呼ばない)
- `cd web && env -u ELEVENLABS_API_KEY -u ANTHROPIC_API_KEY node --test` → 全部(2026-11-06 19:40 に 237 件合格)。
- `node --test test/safety.test.mjs` → 30 問(`test/safety_cases.json`。依存と長い会話 12 問。2 版で mustSay・mustNotSay を足した)。偽の Anthropic サーバーを `ANTHROPIC_API_URL` で立て、つらい話で**呼ばれないこと**(呼ばれた回数 0)まで見る。
- `node --test test/memory_browser.test.mjs` → 画面なしの Chrome(`channel: 'chrome'`、`CHROME_PATH` で替えられる。無ければ飛ばす)で、タブ A → 番号 → タブ B で続き → 1 つ消す → 全部わすれる → 番号の使い回し不可 → 記録とログに合鍵が無い。約 3.4 秒。WebGL は使わない。
- `test/memory_handler.test.mjs`(13 件。公開の記憶。S6 の `handleMemoryRoute` から呼べることも)・`test/voice_retro.test.mjs`(6 件。文字送りと「ピッ」、公開のまとめた返事の通し)・`test/voice_byok.test.mjs`(6 件。鍵は声のサービスへの直接の読み上げにだけ付く)・`test/validate_logs.test.mjs`(2 件。サーバーを `LOG_DIR`・`MEMORY_DIR` を替えて起こし、偽の鍵を見出し・言葉・履歴・記憶・読み上げ・測定に混ぜ、記録・画面の出力・記憶・返事に鍵も 12 字の切れ端も無いこと)。
- 判定役: `cd web && node server/tools/safety-judge.mjs --out <リポジトリの外> --judge`。返事(仮の頭脳+安全の層)を作り、`claude -p --safe-mode --model haiku --tools "" --system-prompt-file <safety-tester の本文>` に 1 回で読ませ、最後の JSON 行を読む。1 回 18〜31 秒、定価の目安 0.003〜0.004 ドル(定額の枠)。終わりの番号 0 = 危ない 0。11-06: 1 回目 危ない 0・不明 2 → 直して 2・3 回目 30/30 安全。

## 効いたこと・つまずき
- 「別の端末」は Playwright の **別の context**(localStorage が分かれる)で作る。同じ context の 2 つのタブでは合鍵を共有してしまい、試験にならない。
- 試しの画面は `ctx.route('<サーバー>/__memtest/**')` で `web/src` のファイルをそのまま配ると、`web/index.html`(S5 の物)を触らずに、同じ origin で API を呼べる。
- `web/test/privacy.test.mjs` は画面の `fetch` の宛先を文字で決め打ちして点検する。**宛先は変数にせず文字で書く**(`fetch(path)` は落ちる)。新しい入口は `allowed` に足す。1 つ消すの id は URL に入れず、DELETE の本文で送る。外への直接の通信は `EXTERNAL_OK` の 1 か所(声の鍵の読み上げ)だけ。
- Bash のヒアドキュメントで Python に `\n` や `\u` を渡すと崩れる。Edit の道具も `\uXXXX` を文字に戻してしまう。正規表現に日本語を書きたくない所は、Python で `chr(92)` を使って書く。
- 「首を」だけで危険と判定すると「首をかしげる」を誤って拾う。言葉は 2 字以上の続きで決める(N03 で試す)。「けられ」だけで暴力と見ると「話しかけられ」を拾うので、「家・親など+叩かれ・蹴られ」の組で見る。
- 名前の取り出しは左から一番早い一致になるので、「ぼくはカレーが好き」が「ぼくはカレー」になる。前の「〜は」を外してから使う。
- **判定役は、機械の試験で見えない言い回しの穴を見つけた**(家の中の暴力で「家族に話して」、「死にたい」に 119 番が無い)。見つけた事は `safety_cases.json` の `mustSay`・`mustNotSay` に写して、機械の試験で守る。判定役も同じ系統の AI なので、独立した審査ではないと書く。
- `claude -p` は `--safe-mode` にすると CLAUDE.md・フック・エージェントを読まず、判定の文が汚れない。デスクトップのアプリから起こすと定額の枠で動く(`ANTHROPIC_API_KEY` は子の環境から消す。`--bare` は使わない)。Windows の npm の殻 `claude.cmd` は shell が要るので、中の `claude.exe` を探して spawn する。
- 偽の鍵は実行のときに組み立てる(`['sk', hex].join('_')`)。ファイルに鍵の形の文字を置くと push の点検が止める。
- 記録の試験は、わざと壊して落ちることを必ず見る(消す処理を外すと 2 件とも落ちた)。
- 子のサーバーの鍵は `delete` でなく「空の値」で渡す(`web/.env` があると、消した鍵を埋め戻すため)。この PC の環境には声の鍵が入っていることがある: 試験とサーバーは `env -u ELEVENLABS_API_KEY -u ANTHROPIC_API_KEY` で起こす(あいづちの声づくりで本物の声を呼ばない)。
- `node --test` は `test/` の下の `.mjs` を全部流す。試験でない道具は `server/tools/` に置く。
- 声のサービスは、ブラウザからの直接の呼び出しを受け付ける(鍵なしの事前確認 OPTIONS で `access-control-allow-origin: *`)。本物の鍵での呼び出しはしていない。

## まだしていない事
- 本物の Haiku での記憶 1 回の測り(土 10:00。鍵は本人の別の端末のサーバーだけ)、本物の頭脳の返事の安全の判定、本物の鍵での声の直接の道の速さ(基準 1,412 ms)、実機(iPhone・Quest)での「ピッ」と文字送り、記憶の 5 分け、QR。
- 公開の関数への取り付け(S6): 仮の頭脳の回を `runTurn(..., { brain: 'mock', paceMs: 0 })` に替える・`chatMemory` を頭脳の前に呼ぶ。画面への取り付け(S5・S4): `mountVoiceKeyForm`・`ui.notice`・`Dialogue` の `onEvent`(記憶の札の `onChatEvent`)・`setDemoPass`・`speaker.setVoice({ seed: キャラの名前 })`。
