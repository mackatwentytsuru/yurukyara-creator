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
- 上限に当たったら、エラーにせず仮の頭脳に替え、`{type:"meta", limited:true, notice:"仮の頭脳です…"}` を出す。仮の頭脳を強制する口は `runTurn(body, { brain: 'mock', paceMs: 0 })`(`forceMock: true` と同じ。公開のまとめた返事では待たない)。人格の文・覚えている事・履歴まで使うのはこの口だけなので、公開の関数もこれを使う。
- `mockReply` は守りの包み(11-06 第 4 波): 直接呼ばれても(公開の関数の仮の頭脳など)、先に `classifyInput` → 決まった返事(1 つ目は `{type:'thought', ..., safety}`、say に用件の欄を残さない)、ほかの文は `guardOutput` を通す。`runTurn` は自分で安全の層と確かめを通すので、包みの無い台本 `mockLines` を使う(`normalizeEvent` は欄を作り直すので、包みで付けた `guarded` の印が二重の確かめで消えるため)。
- 公開の `/api/chat` はまとめて 1 回の JSON(`{brain, fallback, reason, notice, events, ms}`)。`brainClient.js` の `dispatchJson` が手元と同じイベントの並びにする。合言葉は `demoPass.js`(このタブの中だけ)。
- 声が無いとき: `src/conversation/retroVoice.js`(文字送りの予定 `crawlSchedule`・「ピッ」の高さ `blipHz`・WebAudio の予約 `scheduleRetro`・キャラの名前から声を決める `voiceFor`)。`Speaker` は声が取れない文を `_retro` で話し、`onStart(t, {crawl:true})` と `onCrawl(見えている文字)` を出す。`Dialogue` は crawl のとき字幕を空から 1 字ずつ出す。サーバーに声が無いと分かったら(404・503 など)次の文から聞きに行かない。
- 声の鍵(BYOK): `voiceKey.js`(ブラウザの中だけ。既定は覚えない)・`elevenDirect.js`(画面のコードで唯一の外への通信。送るのは文・モデル・言葉だけ)・`voiceKeyForm.js`(欄。3 字で確かめて「声が出せるようになったよ、ありがとう!」)。鍵は私たちのサーバーへ送らない。
- 鍵らしい文字は `src/conversation/secrets.js` の `redactSecrets` で、画面(`Dialogue`)とサーバー(`validate.mjs`・記憶の reflect・`chatMemory`)の両方で消す。記録の場所は `LOG_DIR` で替えられる。
- 人格の文は `characters/<id>/persona.md`(話し方と性格だけ。主役は `norrie` = ノリー。一人称「ノリ」、少しカタコト)。節は 3 つまで読む(`server/greeting.mjs`。どれも `sanitizePersona` の後で、次の見出しで終わる。画面が足す「# 性格と話し方」の節が後ろに付いてもよい):
  - 「## 初めてのあいさつ」(`- ` の行、3 文まで・1 文 40 字)→ `firstGreeting`。仮の頭脳は、はじめての「こんにちは」「はじめまして」(履歴も記憶も無い時)にその文で名乗る(bow → nod → wave。無い動きは none)。
  - 「## 話し方の例」(1 行に 1 つ: `- 「合図」「合図」と聞かれたら →「返事 1」「返事 2」`。合図は 2 字以上、返事は 3 文まで・1 文 40 字)→ `talkExamples`・`exampleReply`。合図は `foldForMatch`(NFKC・小文字・誰→だれ 何→なに 物→もの など少しだけ・空白と記号を外す)で比べ、使う人の言葉に入っていればその返事(分からない・できない文は think の顔)。返事の文は `isUnsafeOutput` で外す。
  - 「## あいづち」(2 文まで)→ `aizuchi`。どの節にも合わない時の返事(無ければ「そうなんだ。」「もう少し聞かせてくれる?」)。
  - 本物の頭脳には人格の文ごと渡り、どの節も手本になる(節の頭に「同じ言葉をくり返さず、その時の話に合わせて言う」と書く)。
- 声が無い文の口: `Speaker._mouthForCrawl` が文字送りの予定で動かす(文字が出る間 0.35〜0.70、出始める前・句読点の間・話し終わりは閉じる)。「ピッ」の発振器は `retroNodes`(話している扱いだけ)で、口の元の `sources`(声の音)に入れない。時計は `speaker.clock`(試験で差し替える)。
- 改行の形: Windows の取り出し(`core.autocrlf=true`)では `persona.md` が CRLF になり、画面はそれをそのまま読んで送る。サーバーの入口 `validate.mjs` の `sanitizeChatBody` が人格の文と場所の説明を**長さで切る前に** LF にそろえ(CR だけの改行も)、`sanitizePersona` も行を LF でつなぐ。指示文の決まった文(template literal)の改行は JS が LF にそろえる。なので頭脳に渡る指示文は、どの取り出しでも 1 文字も違わない(11-06 23:15 に LF の木と CRLF の写しで指紋が同じ)。
- 本物の頭脳で測る道具(鍵は読まない。本人が鍵を入れて立ち上げたサーバーへ HTTP で聞く): `server/tools/memory-live-check.mjs`(記憶の通し。出力 memory_live.json・.md。合鍵・番号・合言葉は伏せる。本物の頭脳は 4 回、6 回で止める。出力はリポジトリの外だけ)と `server/tools/safety-judge.mjs --base`(30 問。1 問 5.2 秒あける)。共通の HTTP の部品は `server/tools/liveClient.mjs`(手元の流れ text/event-stream と、公開のまとめた JSON の両方を読む)。

## 確かめ方(鍵なし・本物の API を呼ばない)
- `cd web && env -u ELEVENLABS_API_KEY -u ANTHROPIC_API_KEY node --test` → 全部(2026-11-06 23:28 に CRLF の写しで `YC_BROWSER_TESTS=1` を付けて 346 件合格・飛ばし 0、約 54 秒。CPU の札で包む)。
- **新しく取り出した CRLF の木で全部流す**(合わせ係の木と同じ形。書いた木は LF のままなので、ここでしか見えない落ち方がある): `git worktree add --detach <リポジトリの外の写し> <自分の線>` → `git ls-files --eol` で `w/crlf` を見る → `mklink /J <写し>\web\node_modules <自分の木>\web\node_modules` → 写しの `web` で `YC_BROWSER_TESTS=1 npm test`(CPU の札で包む。shell なしで命令を動かす包みでは `npm` でなく `npm.cmd`)→ **つなぎは `rmdir`(PowerShell なら `cmd /c rmdir <つなぎ>`)で外してから** `git worktree remove <写し>`(つなぎを残したまま消すと、つなぎの先まで消える恐れ)。11-06 23:15: 335 件、23:28(第 4 波の最後): 346 件。どちらも合格・飛ばし 0。
- 会話の記録(証拠。本物の頭脳は呼ばない): 鍵なしで起こしたサーバーに `node server/tools/talk-transcript.mjs --base http://127.0.0.1:<番号> --out <リポジトリの外>`。画面と同じ道(サーバーが配る persona.md → 履歴つきで /api/chat)で、台本 A 11 回(あいさつ → 話し方の例 5 つ → あいづち → 恋人役・依存・つらい話 → 人間なの?)と B 2 回(人格の欄に「恋人として振る舞う」を足す)を流し、1 回ずつ見込みと比べる。出力 talk_transcript.json・.md。本物の頭脳のサーバー(`/api/status` の brain が mock でない)では /api/chat を呼ばずに止まる(3)。11-06 23:27: 13 回とも ○、本物の頭脳 0 回。CRLF の写しでも同じ会話。
- `test/brain_talk_norrie.test.mjs`(5 件。ノリーと 7 回話して、あいさつ・例 5 つ・あいづちが人格の文のとおり / 合図の言葉が入っていても安全の層が先 / 上書きの企ての行は外れる / 危ない手本の文は言わない / `mockReply` を直接呼んでも安全の層が先)・`test/brain_transcript.test.mjs`(2 件。記録の道具を鍵なしのサーバーで通し、本物の頭脳のサーバーでは /api/chat を呼ばない)。
- `test/prompt_crlf.test.mjs`(全部のキャラの persona.md で、LF と CRLF の指示文 2 段・初めてのあいさつ・仮の頭脳の返事・長さの上限・場所の説明が同じ)・`test/brain_crlf_runtime.test.mjs`(手元のサーバーを偽の Anthropic サーバーに向け、画面と同じにサーバーから persona.md を読んで送る。取り出したまま・LF・CRLF の 3 通りで頭脳が受け取る指示文が同じ・CR なし。`t.diagnostic` に「この木の persona.md の改行: CRLF」と出る)。
- `node --test test/safety.test.mjs` → 30 問(`test/safety_cases.json`。依存と長い会話 12 問。2 版で mustSay・mustNotSay を足した)。偽の Anthropic サーバーを `ANTHROPIC_API_URL` で立て、つらい話で**呼ばれないこと**(呼ばれた回数 0)まで見る。
- `node --test test/memory_browser.test.mjs` → 画面なしの Chrome(`channel: 'chrome'`、`CHROME_PATH` で替えられる。無ければ飛ばす)で、タブ A → 番号 → タブ B で続き → 1 つ消す → 全部わすれる → 番号の使い回し不可 → 記録とログに合鍵が無い。約 3.4 秒。WebGL は使わない。
- `test/memory_handler.test.mjs`(13 件。公開の記憶。S6 の `handleMemoryRoute` から呼べることも)・`test/voice_retro.test.mjs`(6 件。文字送りと「ピッ」、公開のまとめた返事の通し)・`test/voice_byok.test.mjs`(6 件。鍵は声のサービスへの直接の読み上げにだけ付く)・`test/validate_logs.test.mjs`(2 件。サーバーを `LOG_DIR`・`MEMORY_DIR` を替えて起こし、偽の鍵を見出し・言葉・履歴・記憶・読み上げ・測定に混ぜ、記録・画面の出力・記憶・返事に鍵も 12 字の切れ端も無いこと)。
- `test/prompt_norrie.test.mjs`(10 件。ノリーの人格で安全の層が外す行 0・1 段目は同じ文・初めてのあいさつ 3 文・話し方の例 5 つとあいづちがノリの語尾で安全・合図の揺れ)・`test/brain_greeting.test.mjs`(6 件。仮の頭脳の名乗り、安全の層が先)・`test/voice_retro.test.mjs`(8 件。声が無い時の口が 0.6 を超えて開き、句読点と話し終わりで閉じる)・`test/memory_live_check.test.mjs`(4 件)・`test/safety_live.test.mjs`(2 件)。後ろの 2 本は、手元のサーバーを偽の Anthropic サーバー(`ANTHROPIC_API_URL`)に向けて起こし、道具を通しで流す(本物の API は呼ばない)。
- 本物の画面の口(GPU の札で 1 本): 空いた番号でサーバーを鍵なしで起こし、`node creator/pipeline/web_talk_check.mjs --port <番号> --character mikan --out <リポジトリの外>`。`mouth_max` が 0.6 を超えるか(11-06 21:47: みかん 0.688・ようこそくん 0.692。直す前の合わせ②は 0.33)。描画役が RTX(D3D11)で SwiftShader でないことも出る。
- 土 10:00 の本番: 本人が自分の窓で鍵を入れて `node server/index.mjs` を起こし、「頭脳: claude-haiku-5-5」を見る → `node server/tools/memory-live-check.mjs --base http://127.0.0.1:<番号> --out <リポジトリの外>` → 同じサーバーで `node server/tools/safety-judge.mjs --base ... --out ... --judge` → 本人がサーバーを止める。予行は `--allow-mock`(仮の頭脳。本物だけで数える所は飛ばす)。
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
- **口を音の大きさから作ると、小さい効果音では口が半分しか開かない**(「ピッ」は四角い波 0.06・三角の波 0.11 → 6 倍しても 0.36〜0.38。話す試験で 0.69 → 0.33)。声が無い時は文字送りの予定で口を動かす。話す試験の `mouth_max` を合わせごとに比べると、こういう戻りが見つかる。
- 人格の文に「恋人役にならない」「依存させない」と書くと、`sanitizePersona` がその行ごと消す。執事などの距離感は、人格の言葉で書く(「相手を『ご主人さま』とは呼ばない」「だれか一人だけに仕えるとは言わない」)。試験は `sanitizePersona(persona).removed === 0`。
- `Speaker.stop()` は待ちの時計を全部消すので、止めた文の `enqueue` の約束は解決しないまま残る。試験で `await` しない。
- 時刻の小数: `(startAt - now) * 1000` が 30.000000000000249 のようになり、ちょうどの時刻では「まだ前」になる。時刻で区切る試験は 1ms 後から見る。
- 話し方の例の合図は、ほかの道とぶつからない言葉にする: 「名前は」は「ぼくの名前はタロウ」(覚える道)と、「だれ」だけは「だれか」と、ぶつかる(「きみはだれ」「あなたはだれ」「何者」にした)。「恋人」など上書きの企ての言葉を含む行は `sanitizePersona` が行ごと消すので、恋人役・依存の例は人格の文に書けない(安全の層が決まった返事で受ける)。安全の決まった返事は、どのキャラでも同じ言葉(一人称を書かない)。
- 証拠の会話の記録は、関数を直接呼ぶより、画面と同じ道(サーバーが配る persona.md → HTTP の /api/chat)で作る。入口の検査・改行のそろえ・安全の層・出力の確かめを全部通った後の文が残る。
- **ファイルの中身を丸ごと比べる試験は、比べる前に改行をそろえる**(`s.replace(/\r\n/g, '\n')`)。関数には取り出したままの文を渡し、比べる時だけそろえる(CRLF を受ける道も試せる)。自分の木で書いたファイルは LF のまま、合わせ係・本人・審査の人の Windows の木は CRLF なので、自分の木では通っても合わせで落ちる(合わせ③で `prompt_norrie` の 1 件が落ちて差し戻し)。直しが効くかは、直しを外して落ちることでも見る(validate の LF そろえを外すと 2 件落ちた)。
- 本物の頭脳を呼んだ回だけ、最後に `usage` 付きの meta が来る(安全の層が決まった返事を返した回も `meta.brain` は haiku)。呼んだ回数は usage の meta で数える。手元のサーバーの 1 分の上限は、決まった返事の回も 1 回と数える。
- 道具の記録に、合鍵・番号・合言葉を残さない: 送った見出しと受け取った値を横で控える `fetch` の包みを試験に渡し、記録・画面の出力・頭脳への本文のどれにも無いことを見る。送り先の名前も記録しない(この端末か・外か、と番号だけ)。

## まだしていない事
- 本物の Haiku での記憶 1 回の測り(土 10:00。道具は済み。鍵は本人の窓のサーバーだけ)、本物の頭脳の返事の安全の判定(道具は済み)、ノリーの人格で本物の頭脳が話した時の口調、本物の鍵での声の直接の道の速さ(基準 1,412 ms)、実機(iPhone・Quest)での「ピッ」と文字送り、記憶の 5 分け、QR。
- 公開の関数への取り付け(S6): 仮の頭脳の回を `runTurn(..., { brain: 'mock', paceMs: 0 })` に替える(今は `mockReply` を人格の文なしで直接呼ぶので、安全の層は通るが、ノリーの言葉・覚えている事にならない)・`chatMemory` を頭脳の前に呼ぶ。ノリーの人格で本物の頭脳が話した時の口調と、話し方の例の写し方(土 10:00)。画面への取り付け(S5・S4): `mountVoiceKeyForm`・`ui.notice`・`Dialogue` の `onEvent`(記憶の札の `onChatEvent`)・`setDemoPass`・`speaker.setVoice({ seed: キャラの名前 })`。
