---
name: yuru-first-run
description: 会話の画面の「初めての会話」(最初の設計の決めの 7 歩)と「性格の画面」(最初の設計の決め)を直す・足す・試すときに使う。台本の文・歩みの順・性格の型と口調・仮の頭脳での返事の試し・声の鍵(BYOK)の受け口・スマホ幅の見た目を触るとき、「初めての会話」「はじめての会話」「性格の画面」「おまかせの性格」「口調」「語尾」「この子の話し方」「主役に語尾が付く」「元気さ」「返事を試す」「文字送り」「声が出せるようになったよ」と言われたとき。
---

# yuru-first-run: 初めての会話(7 歩)と性格の画面

正: `web/src/ui/onboarding/`(台本と画面)と `web/src/ui/persona/`(性格)。試験: `web/test/onboarding_*`。

## 7 歩(script.js の STEPS。文は台本の正)
1 どんな子を生み出そうか?(写真を撮る・絵を選ぶ・言葉で書く)→ 2 ゆるキャラチェック(絵のときだけ。言葉ならとばす)
→ 3 こんな子ができたよ(この子にする・直したい・やり直す)→ 4 性格(おまかせで始める。「この子、少し○○みたい!」)
→ 5 初めてのあいさつ(頭脳の返事)→ 6 声が無ければ文字送りとレトロ音で話す → 7 鍵を入れると本物の声で「声が出せるようになったよ、ありがとう!」

## 付け方(main.js は S5 だけが書く。今の 1 行)
```js
import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }));
```
- 主役(案内役)の決まり `MAIN_CHARACTER`(id と表示の名前)は `web/src/character/defaults.js`(S5。three を読まない)の 1 か所だけ。index.js・script.js はそこから import し、**S4 のファイルに id や名前を写さない**(11-06 S4w4 で写しを消した。試験 `web/test/onboarding_main_character.test.mjs` が、写しが無いこと・案内役を渡さない時は主役になることを見張る)。
- 「性格」「はじめての会話」のボタンが #modes に出る。初めての会話は `?onboard=1` で出る(`auto: true` で初めての端末にも出る。既定は出さない=ほかの試験を邪魔しない)。
- 性格はキャラの id ごとに localStorage `yc.persona.v2.<id>`(settings.js の `STORE_PREFIX`。試験と練習の道具は文字を写さずこれを読む)。頭脳へは `app.persona`(persona.md の後ろに設定の文を足す)で渡る。11-07 S4w6 で v1 → v2(v1 のおまかせが主役に付けた語尾を読まないため。v1 の保存は捨てる)。
- 案内役は主役のノリー(セスジキノボリカンガルーの執事見習い。`MAIN_CHARACTER` = id `norrie`。自分を「ノリ」と呼び、少しカタコト)。舞台に出ていれば character.json の名前を使う。最初の一言は「はじめまして! 執事見習いのノリーデス。…ノリ、がんばりマス!」(案内役が主役の時だけ。ほかの子を guide に渡すと、ふつうに名乗る。主役を替えたら、この 1 文も替える)。

## 受け口(差しかえられる物)
- `creator`(creators.js):
  - 見本の道(`mode: 'sample'`、既定): 言葉に近い見本の子を出し、「見本」と正直に書く。絵は端末の外に送らない。絵の確かめは Claude ができないので、使う人に「どんな絵か」を選んでもらう。絵の入口の主役は、主役が舞台に出せる時だけ(index.js が舞台のキャラで答える。通信はしない)。
  - **本当の作る道(`mode: 'local'`、11-06 S4w3)**: URL の # に `yc-make=<PC の作る道のサーバー>&yc-key=<合言葉>` があると(PC の `python creator/review/serve_review.py --make --web <会話の画面の元>` の `/qr` の画面のリンク)、1〜3 歩の入力を PC が配る**作る画面**(`/m/`、creator/review/page/make.*)にして、札の中に枠(iframe)で出す。言葉か絵 → PC の `/yuru-next`(yuru_make.py)がゆるキャラチェックと段 0 の絵 → C0 → 枠の中で「この子にする」/「直したい(一言)」(= G1。K3 の request.json)/「やり直す」。台本は枠からの知らせ(postMessage の `sent・progress・checked・chose・drawn・decided・restart・error`。cleanMakeEvent で決めた欄だけ)で歩みと案内役の言葉を進め、OK で 4 歩目へ(枠は閉じる)。できた子は `{id, name, local: true}`。形(3D)はまだ無いので舞台は案内役のまま、絵の名前で話す(段 1〜6 は PC で続けると正直に言う)。
  - 合言葉は # の後ろだけ(サーバーに送られない)。読んだらアドレスの欄から消し、このタブの sessionStorage だけに置く。サーバーの場所は手元(127.0.0.1・localhost・家の中の住所・*.ts.net・*.local)だけ(isLocalBase)。よその場所の # は使わない。
- `byok`: 既定 `'auto'` は、舞台の読み上げがあるとき `s3voice.js` を import() で読む(会話の流れ S3 の voiceKey・elevenDirect・voiceKeyForm)。読めない線では鍵は入れられず、7 歩目は「まだつながっていない」と言う。
- 舞台の読み上げに `setVoice` があれば(S3 の speaker.js)、舞台のキャラの文は `speaker.enqueue(text, { onStart, onCrawl })` に任せる(本物の声か、レトロ音と文字送り。口も合う)。無ければ自前の文字送り(voice.js の crawl と矩形波の「ピッ」)。

## 守ること(つまずいて直した事)
- **人格の文に「安全の決まり」「恋人」などを書かない。** 安全の層(server/safety.mjs の sanitizePersona)が上書きの企てとして行ごと消す。見出しの 1 行が消えた(試験で見つけた)。試験は全部の型・口調で `sanitizePersona(block).removed === 0` を確かめる。
- **仮の頭脳の返事は決まった文**(人格の文に「## 初めてのあいさつ」「## 話し方の例」「## あいづち」があればその文。S3 の server/greeting.mjs)。だから仮の頭脳の返事だけ、この端末で話し方(口調・語尾・元気さ・長さ・型の一言)をそろえ、必ず「仮の頭脳です」と出す。**安全の決まった返事(meta.safety)は変えない。**
- **おまかせは、話し方の決まった子に語尾も口調も足さない(11-07 S4w6)。** 11-07 03:09 の無人の録画で、おまかせ(4 回に 1 回「独特の語尾」)が主役に「ぽよ」を選び、手本の文が「ノリーと申しマスぽよ」になった(S7 の頼み)。フレンドリー・ていねいも、本物の頭脳には「上の人格の文と違うときは、こちらを使う」と渡るので、主役のカタコト(〜マス・〜デス)を消す。直し:
  - 口調に `own`(「この子の話し方」)を足した(TONE_ORDER の先頭。スマホは 2 つずつ 2 段 `.yp-tones`)。own の時: 仮の頭脳の文は言い回しも語尾も変えず、型の一言(extra。フレンドリーかていねいの文)も足さない。変わるのは型の一言目(えっとね、など)・文の終わりの記号・文の数だけ。Claude に渡す文は「上の人格の文に書いてある話し方のまま。一人称・文の終わり・言い回しを変えない。」
  - 決め方は settings.js の `definesOwnSpeech(persona)`(行の頭が 話し方・口調・語尾・一人称・口ぐせ、か「## 話し方の例」。画面が足した「# 性格と話し方」の節より後ろは数えない)と `ownSpeechFor(id, {persona, mainId})`(主役は人格の文がまだ届いていない時・404 の時も「決まっている」)。index.js の `randomFor(id)` が、舞台の子なら persona.md の文(`basePersona ?? app.persona`)で決め、おまかせの 3 か所(4 歩目・もう一度ひく・性格の画面のおまかせ)と、保存が無い時の初めの設定に使う。台本(script.js)は `persona.random(this.character)` で今の子を渡す。
  - `randomSettings(rnd, { ownSpeech: true })` は口調のほかは同じ並び(乱数を同じ数だけ引く)。型・元気さ・長さのおまかせは残る。手元で描いたばかりの子(人格の文なし)は今までどおり語尾も選ぶ。使う人が画面で「独特の語尾」を選ぶのは止めない(おまかせだけの決まり)。
  - 作例 5 体(みかん・ようこそくん・ロボくん・ちょうちんくん・パネルくん)も persona.md に「話し方:」があるので own になる。試しの画面(app: null)では人格の文が無いので、主役だけが own(主役の id で決まる)。
- 画面のコードの通信の約束(web/test/privacy.test.mjs): fetch は `'/api/…'` の文字だけ(変数の宛先は増やさない)。`http(s)://` を書かない。`new Image(`・toBlob・toDataURL・createImageBitmap・drawImage・getImageData を使わない。選んだ絵は `document.createElement('img')` と `URL.createObjectURL` で、この画面の中だけで見せる。キャラの一覧は fetch できないので、見本の名前は creators.js に書く。
  - **絵を PC へ渡す道は、この約束のまま作った(S4w3)**: 1 回目は会話の画面のコードで絵を縮めて PC のサーバーへ fetch したら、この試験が 4 本落ちた(toDataURL・createImageBitmap・drawImage・変数の宛先)。試験を書き換えたり言い換えでくぐったりせず、絵と通信を PC が配る作る画面(枠)の中へ移した。会話の画面は枠の住所を作って知らせを受けるだけ。
- S3 の `streamChat` は、受け手(onEvent)の中で投げた例外を「読めないイベント」として飲み込む。エラーは覚えておき、streamChat の後で投げる。
- 鍵の欄: 押したらすぐ欄を空にする。文・保存・URL に鍵が残らないことを試験で見る。**試験の偽の部品に本物らしい鍵の文字を埋めない**(画面の HTML 全体を探す試験が、試しの画面のスクリプトの中の文字を拾った)。
- 見た目: 選択肢の欄の高さが変わると会話の欄の見える高さも変わり、最後の文が隠れた → offer の後に必ず一番下までスクロール(試験で「最後の文が見える」を確かめる)。PC は右下の札にして真ん中のキャラを隠さない。スマホは 3 歩目から札を低く(58% / 最低 440px)。入力は 16px(iPhone で拡大しない)。押す所は 44px 以上。性格の画面は「返事」の箱を上に貼りつけ、下の設定を選ぶ間も返事が見える。
- できた子を舞台に出すのは `?character=<id>&onboard=1` で読み込み直す。前に sessionStorage へ小さな控え(絵と絵の住所は入れない)を置き、3 歩目「この子はどうかな?」から続ける。
- おまかせは種つきの乱数(settings.js の seededRandom)。試験では種を渡して同じ結果にする。
- **7 歩目で鍵を入れない方のボタンは「鍵なしで続ける」**(id `later`)。札の右上の「あとで」(初めての会話ごと閉じる)と同じ名前だと、7 歩目に「あとで」が 2 つ並ぶ(11-06 S4w4、撮影の練習で見つけた)。
- **スマホ(幅 719 まで)では、初めての会話の間だけ「Claude の考え」(.thought)を隠す**(styles.js、`html.fr-open`)。上の段の札(頭脳・声・カメラ・人・あいづち)が 2 行になると、考えの欄が「性格」「はじめての会話」「覚えていること」に重なり、押せず見た目も崩れた。会話は札に出るので要らない。PC はそのまま。初めての会話の外(ふつうの会話)の重なりは S5 の持ち物(style.css)。
- **`?character=<まだ無い子>&onboard=1` は舞台が空のまま始まる。** 読めなかった理由はゲートに出るが、初めての会話の間はゲートを隠す(fr-open)ので見えない。主役 norrie は 11-07 の開発の線(合わせ④〜5b)に入ったので、`?character=norrie&onboard=1` で開ける(撮影の手順の 6 と同じ)。

## 試験(全部 web/ で。編集ごとのフックの試験は 7〜8 秒。重い画面の試験は YC_BROWSER_TESTS=1 のときだけ)
- `node --test test/onboarding_local.test.mjs` … 画面なし・通信なし、1 秒。手元の場所の確かめ・# の合言葉・枠の住所と知らせの選り分け・知らせで 1〜4 歩
- `YC_BROWSER_TESTS=1 node --test test/onboarding_make_browser.test.mjs` … 画面なしの Chrome、約 11 秒。本物の作る道のサーバー・作る画面・PC の側(yuru_make.py。絵とチェックは試験のふり)で、言葉 → 絵 → 直したい(G1)→ 2 回目 → OK → 性格、と、絵 → 人の絵 → ゆるキャラにしてみる → 絵。試しの頁は小さな本物のサーバーから配る(Playwright の route で渡すと、Chrome が 127.0.0.1 の枠を止めた: ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS)
- `node --test test/onboarding_script.test.mjs test/onboarding_persona.test.mjs` … 画面なし、1 秒。7 歩の通し・絵の分かれ道・古いボタン・2 回押し・鍵の成否・控えからの再開・話し方の変わり方
- `node --test test/onboarding_own_speech.test.mjs` … 画面なし、1 秒未満(11-07 S4w6)。主役の本物の persona.md と S3 の greeting.mjs(firstGreeting・exampleReply)で、おまかせ 400 種が全部 own・語尾なし・言い回しのまま、主役の絵の入口の 7 歩(種 1〜30・もう一度ひく 4 回)、v1 の保存を読まない、直す前の再現(種 5 で「ノリーと申しマスぽよ」)
  - 試験が直しを見分けるかは、直す前の 1 ファイルを `git show HEAD:<path> > <path>` で戻して流し(落ちるのを見る)、控えから戻す。index.js を戻すと画面の試験が「語尾「ぽよ」」で、script.js を戻すと「種 1: おまかせ」で落ちた
- `YC_BROWSER_TESTS=1 node --test test/onboarding_browser.test.mjs` … 画面なしの Chrome、約 50 秒(だから編集ごとには流さない。合わせの門と、画面を直した時に流す)。幅 390(文字送りと音を本当に)・400・1280 で 7 歩、絵の入口、「性格」ボタン、**主役の絵の入口(幅 390。試しの画面の種 5 は、直す前なら最初のおまかせで「ぽよ」を選ぶ。4 歩目・性格の画面のおまかせ 5 回・あいさつで語尾なし、覚えた口調 own)**。横のはみ出し 0・押す所 44px 以上・本文 16px 以上・最後の文が見える。`FR_SHOTS_DIR=<フォルダ>` で写真を残す(リポジトリの外に)
- 札で包む時: `machine_lock.py run … -- npm test` は Windows で「ファイルが見つかりません」(npm は npm.cmd)で始まらない。`-- node --test`(YC_BROWSER_TESTS=1 は外で付ける)と `-- node node_modules/vite/bin/vite.js build` にする。全部で 390 件・約 55 秒(11-07)
- `node --test test/onboarding_s3voice.test.mjs` … S3 の声の部品がある線でだけ動く(無ければ飛ばす)。鍵の形・確かめ・覚えない、と、Chrome で鍵なし=レトロ、鍵あり=声(声のサービスへの通信は横取りして外へ出さない)
- 本物の頭脳・本物の声のサービスは試験で呼ばない。
- **本物の画面での通し(撮影の練習、11-06 S4w4)**: リポジトリの外の `<板>\work\S4\shoot_1107\rehearse_main.mjs <リポジトリ> <出力> [舞台のキャラ]`。先に `node node_modules/vite/bin/vite.js build`(dist)。会話のサーバーを空いた番号・鍵なし(仮の頭脳)で自分で起こし、自分の PID だけ止める。WebGL を描くので GPU の Chrome(`gpuGuard.js` の GPU_ARGS。CPU の描画なら止まる)で、機械の GPU の札を取ってから流す(5〜8 分。札の待ちを含む)。中身: PC でタロウとカレー → 番号 → iPhone 幅で番号を入れて続き →「わすれて」、と、iPhone 幅で 7 歩(性格を 1 つ変える・鍵は入れない)。押す所の真ん中に別の物が重なっていないか(elementFromPoint)も見る(44px と横のはみ出しだけでは、重なりを見逃した)。
  - 版 S4w6(11-07): 舞台の既定は主役(defaults.js から読む)。S5 の重なりの直しが開発の線に入ったので、直しの案は差し込まず「覚えていること」が押せることを確かめる。7 歩は 2 通り: 言葉(提灯 → ちょうちんくんへ移る)と、**絵(主役のまま。4 歩目・もう一度ひく 3 回・性格の画面のおまかせ 8 回・元気に変える・あいさつ・話しかけで、語尾が付かず「この子の話し方」のまま)**。絵は協力者の三面図(リポジトリの外の置き場にある時。無ければ 1×1 の白。ブラウザの外へは送らない)。前の版は `rehearse_main_w4.mjs`。
  - 本物の画面では `window.__firstRun`(試しの画面の `window.__fr` とは別)。舞台の読み上げ(S3 の speaker)がある時、キャラの文の音と文字送りは speaker が受け持つ。

## 確かめていない事
- 本物の iPhone の Safari・Android・Quest のブラウザでの見た目と音(画面なしの Chrome の幅だけ)。本物の Haiku での「性格を変えた後の返事」。iPhone のキーボードが出た時に、札の下のボタンが隠れないか。
- スマホから本当の作る道: 会話の画面が https(Tailscale)だと、作る画面(http)の枠は混ざった中身として止まる見込み。同じ Wi-Fi の http(vite の 5173 と作る道のサーバーの --lan)なら動く見込みだが、試していない。PC の画面では通した。



## 初めての審査員の目での通し(11-07 CRITux。試験が全部通っていても見つかった事)
- 道具: `<板>\work\CRIT\ux\tools\ux_run.mjs <web> <base> <出力> <場面,…>`(場面: first_phone・first_pc・fr_words_phone/pc・fr_nomatch_phone・fr_picture_phone・talk_mem・persona_phone・look_phone/pc・make_local_pc・camera_pc・reload_after_phone)。サーバーは `start_server.mjs`(空いた番号・鍵なし)、作る道は `start_make.mjs`(serve_review.py --make --port 0)。`machine_lock.py run --kind gpu` で包む(1 回 1〜2 分)。写真は `page.screenshot({ scale: 'css' })` で幅 390 のまま撮る(DSF 3 のままだと 1 枚が大きい)。
- 試験(44px・はみ出し・重なり)では見えない、流れの穴を見る: ① 入口(ゲート)が出ている間、上の段の「はじめての会話」は見えているのに押せない(ゲートの板が受ける)。審査員は先に押しがち ② 言葉の入口で見本が舞台の子と違うと `?character=<id>&onboard=1` で読み込み直し、それまでの札の文(「見本の中から…」「見本: …」)が消える ③ 終わった後も URL に onboard=1 が残り、読み込み直すと 7 歩がまた始まる。読み込み直しの後は、ゲートもまた出る ④ 見本に当たらない言葉は samples[0](みかん)になる ⑤ 絵の入口は主役を「できた子」として出す(主役が案内役も兼ねるので「ノリーだよ」と自分を紹介する)⑥ 「性格」は保存が無いとくじ引きの設定で開き、「これにする」で主役の口調を上書きする ⑦ 作る道で決めた子は、舞台に出ない(舞台は案内役のまま)。
- 直した後の確かめ: 上の 7 つを、幅 390 と 1280 で、写真と札の文(`.fr-sheet` の data-step・data-actions・`.fr-log` の最後の 6 行)で見る。字幕は文ごとに入れ替わるので、記憶の見せ場の文は `#tReply`(考えの箱)でも確かめる。
