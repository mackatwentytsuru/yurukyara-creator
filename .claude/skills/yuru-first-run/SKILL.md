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
- 「性格」「はじめての会話」のボタンが #modes に出る。初めての会話は `?onboard=1` で出る(印があっても出る。入口なしですぐ始まる)。
- **初めての訪問は、入口を閉じた後に自動で出る**(11-07 合わせ⑦から。S5 の main.js の `gateClosed` が `api.start()`。決まりは `web/src/stage/firstVisit.js` の `shouldOpenFirstRun`: 印 `yc.onboarded.v1`(終わり = done・あとで = later)が無い時だけ。`?auto=0`・`?onboard=0/1`・led・autostart・headset・perf では出さない)。mountFirstRun の `auto: true` は使っていない。入口には「はじめてなら、このあと「はじめての会話」(7 歩)が始まります。…」(`#gateFirst`)が出る。
- 性格はキャラの id ごとに localStorage `yc.persona.v2.<id>`(settings.js の `STORE_PREFIX`。試験と練習の道具は文字を写さずこれを読む)。頭脳へは `app.persona`(persona.md の後ろに設定の文を足す)で渡る。11-07 S4w6 で v1 → v2(v1 のおまかせが主役に付けた語尾を読まないため。v1 の保存は捨てる)。
- 案内役は主役のノリー(セスジキノボリカンガルーの執事見習い。`MAIN_CHARACTER` = id `norrie`。自分を「ノリ」と呼び、少しカタコト)。舞台に出ていれば character.json の名前を使う。最初の一言は「はじめまして! 執事見習いのノリーデス。…ノリ、がんばりマス!」(案内役が主役の時だけ。ほかの子を guide に渡すと、ふつうに名乗る。主役を替えたら、この 1 文も替える)。

## 受け口(差しかえられる物)
- `creator`(creators.js):
  - 見本の道(`mode: 'sample'`、既定。公開のリンクはいつもこれ): **言葉が見本の子に本当に当たる時だけ**その子を出し、「見本の中に、近い子がいたよ」「見本: ○○(…)。この画面では新しく描かずに…」と言う。当たらない言葉と絵には `make` が null を返し、台本の `_noMatch` が「ごめんね。見本の中に、近い子がいないんだ」(絵は「この画面では、絵から新しい子を作れないんだ」)と正直に言い、PC での作り方(`MAKE_STEPS`。serve_review.py --make → /qr のリンク → /yuru-next)と、選べる道(「ノリーで続きを試す」`use_guide`・「見本の子から選ぶ」`choose_sample` → `s_<id>`・README のリンク・言葉を変える/別の絵にする)を出す。**だまって見本を選ばない**(11-07 S4w7、司令塔の決め D1。前は当たらないとみかん、絵は主役を「できた子」にしていた = CRITux 3・5)。絵は端末の外に送らない。絵の確かめは Claude ができないので、使う人に「どんな絵か」を選んでもらう。
  - README の作り方の節へのリンクは、画面のコードに外の住所を書けない(privacy の試験)ので、頁の `<link rel="help" href="…">`(index.html。S5 の持ち物)を `readGuideUrl()` で読む。無ければリンクは出さず、手順の文だけ。節の名前は `README_SECTION`(S6 の英語の見出しと同じ文字)。1 歩目にも出す(CRITux 1)。
  - **本当の作る道(`mode: 'local'`、11-06 S4w3)**: URL の # に `yc-make=<PC の作る道のサーバー>&yc-key=<合言葉>` があると(PC の `python creator/review/serve_review.py --make --web <会話の画面の元>` の `/qr` の画面のリンク)、1〜3 歩の入力を PC が配る**作る画面**(`/m/`、creator/review/page/make.*)にして、札の中に枠(iframe)で出す。言葉か絵 → PC の `/yuru-next`(yuru_make.py)がゆるキャラチェックと段 0 の絵 → C0 → 枠の中で「この子にする」/「直したい(一言)」(= G1。K3 の request.json)/「やり直す」。台本は枠からの知らせ(postMessage の `sent・progress・checked・chose・drawn・decided・restart・error`。cleanMakeEvent で決めた欄だけ)で歩みと案内役の言葉を進め、OK で 4 歩目へ(枠は閉じる)。できた子は `{id, name, local: true}`。形(3D)はまだ無いので舞台は案内役のまま、絵の名前で話す(段 1〜6 は PC で続けると正直に言う)。
  - 合言葉は # の後ろだけ(サーバーに送られない)。読んだらアドレスの欄から消し、このタブの sessionStorage だけに置く。**# を読むのは、画面そのものがこの PC の中(127.0.0.1・localhost・[::1])で開かれた時だけ**(`pageIsLocal`)。サーバーの場所もこの PC の中だけ(`isLocalBase`)。家の中の住所・*.ts.net・*.local は数えない(11-07 S4w7、CRITsec F4: Tailscale の Funnel でだれでも公開の *.ts.net の名前を持てるので、細工したリンクでよその作る画面を公式の画面の中に出せた)。公開の画面では # を消すだけで、覚えた物も使わない。
  - 「この子にする」の後は、描いた絵を札の上の絵の欄(`.fr-pin`)に小さな枠で出したままにする: 作る画面の `#…&view=pic`(make.js の `picOnly`。絵だけ・ボタンなし・知らせなし。5 秒ごとに新しい回を見る)。文は「3D ができるまでは、ノリーがかわりに舞台に立って、○○の言葉を話します。○○の姿は、上の絵です。」(D5。前は枠ごと消え、絵がどこにも無かった = CRITux 7)。作る画面は会話の画面と同じ暗い色、横に広い枠(PC)では絵を左・ボタンを右に並べる(1280×720 でも「直したい」まで巻かずに見える)。
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
- **できた子(見本)を舞台に出すのは、その場で入れ替える**(11-07 S4w7、D2。前は `?character=<id>&onboard=1` で読み込み直し、「見本の中から…」の説明が消えて作ったように見えた = CRITux 4)。index.js の `putOnStage(id)`: 舞台が読み終わるのを待つ → `character/index.js` を import() して `loadCharacter(characterUrl(id))` → `app.swapCharacter` があればそれ、無ければ自前で入れ替え(位置と向きを写す・scene の出し入れ・`app.character`・`app.dialogue.character`・`data-look`・`frameCharacter`)→ `app.characterId` → 人格の文(`app.readPersona` があれば読む。無ければ空。**S4 のファイルから変数の宛先へ fetch すると privacy の試験が落ちる**ので自分では読まない)。1 つずつ順に(`stageQueue`)。AR・VR の間は替えない。初めて替える前の舞台(主役)を `home` に覚え、戻す時は同じ物を戻す(main.js の見た目の切り替えの控えが合うまま)。主役の persona.md の文も、最初に替える前に覚える(戻した後に人格の文を失わないように)。
  - 見本の子が舞台にいる間は `html.fr-guest` を付けて `#lookSwitch` を隠す(切り替えの控えは主役の物なので、押すと主役に戻る)。
  - 読み込み直しの控え(`save`・`resume`・`snapshot`)は、外から `showCharacter` が false を返す時のために残してある(今の入口は使わない)。
- **終わり・あとで(D4、CRITux 6)**: 札を閉じたら `afterClose`: 舞台を主役に戻す → アドレスから `onboard=1`(と主役でない `?character=`)を `history.replaceState` で消す → `yc:firstrun-closed` を投げる。入口(ゲート)がまだ出ていれば `passGate` が `#startSim`(カメラなしで試す)を 1 回押す。始まるまでは `html.fr-after` で入口を透明にしておく(一瞬出て消えないように。3 秒で外す)。読み込み直しても 7 歩は始まらない。
- **性格の画面(D6、CRITux 11)**: 覚えた設定 → その子の人格の文の性格(`personalityOf`: 「- 性格:」の行を先に、無ければ全体。恥ずかしがり → いたずら → 元気 → おっとりの順。主役は「おっとり」)→ 無ければおっとりの基本(`ownSettings`)で開く。くじ引きで開かない。**口調の列を止めるのは、話し方が人格の文で決まっている子だけ**(`fixesOwnSpeech`: 主役と「## 話し方の例」の節がある子。ボタンは disabled・`.yp-tone-lock` の注。古い保存・おまかせでも own に直す)。作例の「- 話し方: やさしく」だけの子は、使う人が口調を選べる(おまかせは own のまま)。4 歩目も、人格の文に性格があればそれで始める(`persona.initial`)。もう一度ひくは、おまかせ。
- **画面に内部の言葉を出さない(D7、CRITux 13)**: 「C0」「段 0」は出さない。PC の側(review_state.py の `plain_words`・`STAGE_DOING`・`STAGE_NEXT`、yuru_make.py の様子の文)と、会話の画面の受け口(creators.js の `plainWords`。古い PC の側が送っても置きかえる)、確かめる画面(review.js の札の名前は「絵」「形」だけ)。Claude Code への申し送り(`tell`)は開発者向けなので、そのまま。
- /qr の画面の文字は合言葉を伏せる(••••••。リンクの href と QR にだけ入れる。画面の録画や写真に残さない。CRITux 22)。練習の道具は href から読む。
- **見た目(CRITux 14・16)**: スマホの札は、どの歩みも画面の 58%(最低 440px)まで。1 歩目は写真と絵を 2 つ並べる(`[data-actions^="photo pick words"]`)。幅 390 で上の段と札の間に 150px 以上(主役の顔が見える)。PC の札は下の帯の上(`bottom: calc(var(--bottom-h) + 12px)`、高さは `--top-h` と `--bottom-h` の間)。札が開いている間は、PC でも「Claude の考え」を隠す。変数 `--top-h`・`--bottom-h` は main.js(S5)が測る。
- おまかせは種つきの乱数(settings.js の seededRandom)。試験では種を渡して同じ結果にする。
- **7 歩目で鍵を入れない方のボタンは「鍵なしで続ける」**(id `later`)。札の右上の「あとで」(初めての会話ごと閉じる)と同じ名前だと、7 歩目に「あとで」が 2 つ並ぶ(11-06 S4w4、撮影の練習で見つけた)。
- **初めての会話の間は「Claude の考え」(.thought)を隠す**(styles.js、`html.fr-open`。11-07 S4w7 から PC も)。スマホは考えの欄が「性格」「はじめての会話」「覚えていること」に重なり、PC(1280×720)は札が考えの箱に重なっていた。会話は札に出るので要らない。初めての会話の外(ふつうの会話)の重なりは S5 の持ち物(style.css)。
- **`?character=<まだ無い子>&onboard=1` は舞台が空のまま始まる。** 読めなかった理由はゲートに出るが、初めての会話の間はゲートを隠す(fr-open)ので見えない。主役 norrie は 11-07 の開発の線(合わせ④〜5b)に入ったので、`?character=norrie&onboard=1` で開ける(撮影の手順の 6 と同じ)。

## 試験(全部 web/ で。編集ごとのフックの試験は 7〜8 秒。重い画面の試験は YC_BROWSER_TESTS=1 のときだけ)
- `node --test test/onboarding_local.test.mjs` … 画面なし・通信なし、1 秒。手元の場所の確かめ・# の合言葉・枠の住所と知らせの選り分け・知らせで 1〜4 歩
- `YC_BROWSER_TESTS=1 node --test test/onboarding_make_browser.test.mjs` … 画面なしの Chrome、約 11 秒。本物の作る道のサーバー・作る画面・PC の側(yuru_make.py。絵とチェックは試験のふり)で、言葉 → 絵 → 直したい(G1)→ 2 回目 → OK → 性格、と、絵 → 人の絵 → ゆるキャラにしてみる → 絵。試しの頁は小さな本物のサーバーから配る(Playwright の route で渡すと、Chrome が 127.0.0.1 の枠を止めた: ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS)
- `node --test test/onboarding_script.test.mjs test/onboarding_persona.test.mjs` … 画面なし、1 秒。7 歩の通し・絵の分かれ道・古いボタン・2 回押し・鍵の成否・控えからの再開・話し方の変わり方
- `node --test test/onboarding_own_settings.test.mjs` … 画面なし(11-07 S4w7)。本物の persona.md で、主役は「おっとり・この子の話し方・元気さ 2」・口調の列を止める、見本 5 体は話し方の行がある・口調は選べる・性格の読み方
- `node --test test/onboarding_own_speech.test.mjs` … 画面なし、1 秒未満(11-07 S4w6)。主役の本物の persona.md と S3 の greeting.mjs(firstGreeting・exampleReply)で、おまかせ 400 種が全部 own・語尾なし・言い回しのまま、主役の絵の入口の 7 歩(種 1〜30・もう一度ひく 4 回)、v1 の保存を読まない、直す前の再現(種 5 で「ノリーと申しマスぽよ」)
  - 試験が直しを見分けるかは、直す前の 1 ファイルを `git show HEAD:<path> > <path>` で戻して流し(落ちるのを見る)、控えから戻す。index.js を戻すと画面の試験が「語尾「ぽよ」」で、script.js を戻すと「種 1: おまかせ」で落ちた
- `YC_BROWSER_TESTS=1 node --test test/onboarding_browser.test.mjs` … 画面なしの Chrome、約 50 秒(だから編集ごとには流さない。合わせの門と、画面を直した時に流す)。幅 390(文字送りと音を本当に)・400・1280 で 7 歩、絵の入口、「性格」ボタン、**主役の絵の入口(幅 390。試しの画面の種 5 は、直す前なら最初のおまかせで「ぽよ」を選ぶ。4 歩目・性格の画面のおまかせ 5 回・あいさつで語尾なし、覚えた口調 own)**。横のはみ出し 0・押す所 44px 以上・本文 16px 以上・最後の文が見える。`FR_SHOTS_DIR=<フォルダ>` で写真を残す(リポジトリの外に)
- 札で包む時: `machine_lock.py run … -- npm test` は Windows で「ファイルが見つかりません」(npm は npm.cmd)で始まらない。`-- node --test`(YC_BROWSER_TESTS=1 は外で付ける)と `-- node node_modules/vite/bin/vite.js build` にする。全部で 390 件・約 55 秒(11-07)
- `node --test test/onboarding_s3voice.test.mjs` … S3 の声の部品がある線でだけ動く(無ければ飛ばす)。鍵の形・確かめ・覚えない、と、Chrome で鍵なし=レトロ、鍵あり=声(声のサービスへの通信は横取りして外へ出さない)
- 本物の頭脳・本物の声のサービスは試験で呼ばない。
- **本物の画面での通し(撮影の練習、11-06 S4w4)**: リポジトリの外の `<板>\work\S4\shoot_1107\rehearse_main.mjs <リポジトリ> <出力> [舞台のキャラ]`。先に `node node_modules/vite/bin/vite.js build`(dist)。会話のサーバーを空いた番号・鍵なし(仮の頭脳)で自分で起こし、自分の PID だけ止める。WebGL を描くので GPU の Chrome(`gpuGuard.js` の GPU_ARGS。CPU の描画なら止まる)で、機械の GPU の札を取ってから流す(5〜8 分。札の待ちを含む)。中身: PC でタロウとカレー → 番号 → iPhone 幅で番号を入れて続き →「わすれて」、と、iPhone 幅で 7 歩(性格を 1 つ変える・鍵は入れない)。押す所の真ん中に別の物が重なっていないか(elementFromPoint)も見る(44px と横のはみ出しだけでは、重なりを見逃した)。
  - 版 S4w6(11-07): 舞台の既定は主役(defaults.js から読む)。S5 の重なりの直しが開発の線に入ったので、直しの案は差し込まず「覚えていること」が押せることを確かめる。7 歩は 2 通り: 言葉(提灯 → ちょうちんくんへ移る)と、**絵(主役のまま。4 歩目・もう一度ひく 3 回・性格の画面のおまかせ 8 回・元気に変える・あいさつ・話しかけで、語尾が付かず「この子の話し方」のまま)**。絵は協力者の三面図(リポジトリの外の置き場にある時。無ければ 1×1 の白。ブラウザの外へは送らない)。前の版は `rehearse_main_w4.mjs`。
  - 本物の画面では `window.__firstRun`(試しの画面の `window.__fr` とは別)。舞台の読み上げ(S3 の speaker)がある時、キャラの文の音と文字送りは speaker が受け持つ。
  - 版 S4w7(11-07): 見本はその場で入れ替わる(`__app.characterId` が d_lantern になり、頁の読み込み 0 回)・見本の「直したい」の説明・終わると舞台は主役・アドレスに onboard が無い・入口が出ない・読み込み直しても 7 歩なし(`afterClose`・`reloadNoRestart`)、当たらない言葉(m20c: 正直に言う → 見本から選ぶ → あとで)、PC 1280×720 で「送る」と会話の欄が札に隠れない・考えの箱が出ない(m20d)、絵の入口は「ノリーで続きを試す」・絵が札に残る・4 歩目は「おっとり」・口調の列が止まる(m20b)、幅 390 の 1 歩目で上の段と札の間 150px 以上(m20_0)。
  - **頁の読み込みを数えるのは `page.on('load')`**。`framenavigated` は `history.replaceState`(閉じた時に onboard=1 を消す)でも出るので、読み込み直していないのに 1 回と数えた(11-07 S4w7 の 1 回目)。
  - 版 S4w7b(11-07 07:00): 合わせ⑦(S5 の入口と初めての訪問の 7 歩)の後、S4w7 のままでは 8/10 だった(入口のボタンの文字を丸ごと比べた 1 行と、その番号を使う次の場面)。直し 2 つで 10/10: ① 入口の「カメラなしで試す」は役と意味で探す(`page.getByRole('button', { name: /カメラなしで試す/ })` が 1 つ・id が `startSim`・`.btn-main` の頭が「カメラなしで試す」)。下の小さい説明(`.btn-sub`)は端末で変わる(PC「マウスを動かすと、その向きを見ます」・指の端末「画面を指でなぞると、その向きを見ます」)ので比べず、記録に残して手順の紙に写す ② 入口の後は、新しい browser context ごとに 7 歩の札が出る。記憶の場面と性格のボタンの前に、`getByRole('dialog', { name: 'はじめての会話' })` が見えるまで待ち(onboarding の読み込みの後に出る。最大 8 秒)、中の `getByRole('button', { name: 'あとで', exact: true })` を押す。押した後は札が消え、印が `later`。出なければ「出ない」と残す(本人の端末は前に押していれば出ない。失敗ではない)。
  - 本人の撮影の手順の紙(`video_1107\撮影1回目_本人の手順.md`、作ったのは S7)は、練習の結果(result.json の `gate.main`・`gate.sub`・`first_run`・返事の文)から言葉を写して直す。前の版は板の `shoot_1107\撮影1回目_本人の手順_1106控え.md`。4 の撮影(記憶)は「あとで」を押す・6 の撮影(7 歩)は押さない、を紙の頭に書く。

## 確かめていない事
- 本物の iPhone の Safari・Android・Quest のブラウザでの見た目と音(画面なしの Chrome の幅だけ)。本物の Haiku での「性格を変えた後の返事」。iPhone のキーボードが出た時に、札の下のボタンが隠れないか。
- スマホから本当の作る道: 会話の画面が https(Tailscale)だと、作る画面(http)の枠は混ざった中身として止まる見込み。同じ Wi-Fi の http(vite の 5173 と作る道のサーバーの --lan)なら動く見込みだが、試していない。PC の画面では通した。



## 初めての審査員の目での通し(11-07 CRITux。試験が全部通っていても見つかった事)
- 道具: `<板>\work\CRIT\ux\tools\ux_run.mjs <web> <base> <出力> <場面,…>`(場面: first_phone・first_pc・fr_words_phone/pc・fr_nomatch_phone・fr_picture_phone・talk_mem・persona_phone・look_phone/pc・make_local_pc・camera_pc・reload_after_phone)。サーバーは `start_server.mjs`(空いた番号・鍵なし)、作る道は `start_make.mjs`(serve_review.py --make --port 0)。`machine_lock.py run --kind gpu` で包む(1 回 1〜2 分)。写真は `page.screenshot({ scale: 'css' })` で幅 390 のまま撮る(DSF 3 のままだと 1 枚が大きい)。
- 試験(44px・はみ出し・重なり)では見えない、流れの穴を見る: ① 入口(ゲート)が出ている間、上の段の「はじめての会話」は見えているのに押せない(ゲートの板が受ける)。審査員は先に押しがち ② 言葉の入口で見本が舞台の子と違うと `?character=<id>&onboard=1` で読み込み直し、それまでの札の文(「見本の中から…」「見本: …」)が消える ③ 終わった後も URL に onboard=1 が残り、読み込み直すと 7 歩がまた始まる。読み込み直しの後は、ゲートもまた出る ④ 見本に当たらない言葉は samples[0](みかん)になる ⑤ 絵の入口は主役を「できた子」として出す(主役が案内役も兼ねるので「ノリーだよ」と自分を紹介する)⑥ 「性格」は保存が無いとくじ引きの設定で開き、「これにする」で主役の口調を上書きする ⑦ 作る道で決めた子は、舞台に出ない(舞台は案内役のまま)。
- 直した後の確かめ: 上の 7 つを、幅 390 と 1280 で、写真と札の文(`.fr-sheet` の data-step・data-actions・`.fr-log` の最後の 6 行)で見る。字幕は文ごとに入れ替わるので、記憶の見せ場の文は `#tReply`(考えの箱)でも確かめる。

## 11-07 S4w7 の学び(司令塔の決め D1〜D7 と CRITux・CRITsec F4)
- 試験が全部通っていても、初めての人の目では流れが壊れて見えた(CRITux)。直す時は「何を言うか」まで台本の試験に書く(「連れてきたよ」と言わない・「この絵から作るよ」と言わない・主役を「できた子」と紹介しない、など否定の確かめも)。
- 画面のコードの通信の約束(privacy の試験)は、リンク(README)や人格の文の読み込みにも効く。外の住所は頁の `<link rel="help">` から読み、人格の文は main.js(S5)に `app.readPersona` を頼む。試験を書き換えてくぐらない。
- Bash の heredoc で Python に正規表現(`\b`)を渡すと、`\b` が後退の文字(0x08)になってファイルに入った(見えない)。直しの台本は Write の道具でファイルに書いてから流す。入った時は `grep -c $'\x08'` で見つかる。
- 板の頼み: `work\S4\頼み_S5_w7.md`(main.js に `app.swapCharacter`・`app.readPersona`、index.html に `<link rel="help">`、`#startSim` の id はそのまま、`--top-h`・`--bottom-h` はそのまま)。

## 11-07 S4w7b の学び(合わせ⑦の後)
- 試験の見本の住所・名前は、作り物の部品からその場で組み立てる(`ip(192, 168, 1, 20)`・`tsName('home-pc', 'example-tail')`)。本物の機械の名前を書かない。既定の語の一覧(push の点検)は通っても、公開前の語の一覧(参考の門)で当たる。
- 語の点検は 2 つの一覧で、行の番号だけを出す(`termlist.load` と `first_hit` を読む小さな台本。語は画面にも報告にも出さない)。木の全部は `PREPUSH_TERMS=<公開前の語の一覧> python -I tools/prepush_check.py`(当たった語を出すので、出力の「…」の中を伏せる)。当たった行を直す時も、語を打たずに行の形(正規表現)で探して替える。
- 開発の線は、取り込む間にも進む(司令塔がスキルを置いたコミット)。`git merge yurukyara-dev` の後に `git log -1` で実際の先を記録する(頼みの文の sha と違ってよい。早送りなら同じ物の子)。
