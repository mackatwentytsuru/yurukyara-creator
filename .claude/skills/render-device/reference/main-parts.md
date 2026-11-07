# 画面の部品(main.js に付けた物)

(元の文のまま)

- 記憶の札(S3 の mountMemoryPanel)は上の段の「覚えていること」の引き出し(details)。引き出しの中は閉じている間 `innerText` が空になるので、試験では `textContent` で読む。開いている間は `.top:has(.drawer[open])` で「Claude の考え」より手前に出す。
- 会話の入口は全部 `talk()` を通す。会話の側(Dialogue)は `onEvent` でサーバーのイベントを全部渡す(手元のサーバーの流れる形も、公開の関数のまとめた JSON も、brainClient が同じ並びにする)。記憶の一覧は `{type:'memory', added|forgotten}` のイベントで読み直される。返事のあとに読み直す代わりの道は 11/6 第 3 波で外した。引き出しを開いた時の読み直しは残す。
- 仮の頭脳の知らせ(K5)は `/api/status` の brain か、会話のイベントで分かった頭脳が mock の時。理由つきの文はイベントの `notice`(公開の関数の fallback の時に先頭の meta で届く。この meta には brain が無いので、`fallback: true` を見て mock とする。Dialogue は onEvent を呼んでから自分の brain を直すので、main.js の側で覚える)。
- 会話の側の短い知らせ `ui.notice(文)`(鍵らしい文字を送らなかった、など)は #uiNotice に 6 秒。仮の頭脳の知らせと同じ文は重ねない(公開の関数は毎回 notice を送るため)。
- 声が無い時の「ピッ」の高さと音色は、キャラを読んだ後の `speaker.setVoice({ seed: キャラの名前 })` でキャラごとに変わる。声の鍵(BYOK)の声は character.json に voice が入ったら `voiceId` で渡す(今の作例には無い)。合言葉の欄は公開の URL(/api/status が無い)か `?askpass=1` の時だけ出し、合言葉は会話の側の `conversation/demoPass.js` 1 か所に持つ(会話と記憶の通信が見出し x-demo-pass で同じ値を送る。URL に入れない)。
- 初めての会話と性格の画面(S4)は `boot()` の次で `firstRunReady = import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }))`(返り値の api を覚える。印の名前は S4 の `DONE_KEY` を使う)。#modes に「性格」「はじめての会話」が出る。`?onboard=1` で読み込んだ時に 7 歩。初めての訪問なら入口の後に main.js が `api.start()`(下の「入口」)。入口の LED(?led=1)では #modes ごと隠れる。
- S4 が 7 歩の途中で見本の子を読み込み直しなしで出し、終わったら主役に戻すための入口: `app.swapCharacter`(見た目の切り替えと同じ関数)と `app.readPersona(character)`(boot と同じ確かめで persona.md を読む。fetch の宛先の変数は `character.personaUrl` のまま。privacy の試験の決まり)。README の作る道の節へのリンクは index.html の `<link rel="help" hreflang="ja">` 1 つ(S4 の readGuideUrl が hreflang="ja" を先に読み、そのまま開く。src の JS には http(s):// を書かない)。第 9 波から README.md が日本語なので、行き先は `…/blob/HEAD/README.md#自分の-pc-でclaude-code-と自分のキャラを作る`(見出し「自分の PC で、Claude Code と自分のキャラを作る」の GitHub の印。英字は小文字・「、」などの記号は消す・空白は「-」。S6 は見出しの文字を変えない約束。英語の印 `<a name="make-your-own-character-on-your-pc-with-claude-code">` も両方の README にある)。リンクの形は `web/test/place_first_visit.test.mjs` が見る。README と印が合うかは S6 の `work\S6\w9\readme_anchor_check.mjs <木>`(3 本の仮の合わせの木で 56/56)。
- 上の段にボタンが増えると、引き出しが右へ押されて、開いた札が幅 390 で画面の右の外へはみ出した。幅 760 以下では `.drawer { position: static }` にして、札を上の段(.top、position: fixed)の左にそろえる。
- `?perf=1` は K6 の平らな 1 行を `PERF {...}` でコンソールに出す。commit は `VITE_COMMIT` を付けて組み立てた時だけ入り、measure-render.mjs が測った木のコミットで埋める。
