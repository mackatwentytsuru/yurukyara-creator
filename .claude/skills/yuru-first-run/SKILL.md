---
name: yuru-first-run
description: 会話の画面の「初めての会話」(最初の設計の決めの 7 歩)と「性格の画面」(最初の設計の決め)を直す・足す・試すときに使う。台本の文・歩みの順・性格の型と口調・仮の頭脳での返事の試し・声の鍵(BYOK)の受け口・スマホ幅の見た目を触るとき、「初めての会話」「はじめての会話」「性格の画面」「おまかせの性格」「口調」「語尾」「元気さ」「返事を試す」「文字送り」「声が出せるようになったよ」と言われたとき。
---

# yuru-first-run: 初めての会話(7 歩)と性格の画面

正: `web/src/ui/onboarding/`(台本と画面)と `web/src/ui/persona/`(性格)。試験: `web/test/onboarding_*`。

## 7 歩(script.js の STEPS。文は台本の正)
1 どんな子を生み出そうか?(写真を撮る・絵を選ぶ・言葉で書く)→ 2 ゆるキャラチェック(絵のときだけ。言葉ならとばす)
→ 3 こんな子ができたよ(この子にする・直したい・やり直す)→ 4 性格(おまかせで始める。「この子、少し○○みたい!」)
→ 5 初めてのあいさつ(頭脳の返事)→ 6 声が無ければ文字送りとレトロ音で話す → 7 鍵を入れると本物の声で「声が出せるようになったよ、ありがとう!」

## 付け方(main.js は S5 だけが書く。S4 のファイルが dev に入った後に 1 行)
```js
import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes') }));
```
- 「性格」「はじめての会話」のボタンが #modes に出る。初めての会話は `?onboard=1` で出る(`auto: true` で初めての端末にも出る。既定は出さない=ほかの試験を邪魔しない)。
- 性格はキャラの id ごとに localStorage `yc.persona.v1.<id>`。頭脳へは `app.persona`(persona.md の後ろに設定の文を足す)で渡る。
- 案内役は主役の猫(id `tegaki_neko`)。舞台に出ていれば character.json の名前を使う。

## 受け口(差しかえられる物)
- `creator`(creators.js): 今は見本の道だけ(`mode: 'sample'`)。言葉に近い見本の子を出し、「見本」と正直に書く。絵は端末の外に送らない。絵の確かめは Claude ができないので、使う人に「どんな絵か」を選んでもらう(そう書いて出す)。手元の PC へ渡す道(`mode: 'local'`、check・make・review)は形だけ決めてある。
- `byok`: 既定 `'auto'` は、舞台の読み上げがあるとき `s3voice.js` を import() で読む(会話の流れ S3 の voiceKey・elevenDirect・voiceKeyForm)。読めない線では鍵は入れられず、7 歩目は「まだつながっていない」と言う。
- 舞台の読み上げに `setVoice` があれば(S3 の speaker.js)、舞台のキャラの文は `speaker.enqueue(text, { onStart, onCrawl })` に任せる(本物の声か、レトロ音と文字送り。口も合う)。無ければ自前の文字送り(voice.js の crawl と矩形波の「ピッ」)。

## 守ること(つまずいて直した事)
- **人格の文に「安全の決まり」「恋人」などを書かない。** 安全の層(server/safety.mjs の sanitizePersona)が上書きの企てとして行ごと消す。見出しの 1 行が消えた(試験で見つけた)。試験は全部の型・口調で `sanitizePersona(block).removed === 0` を確かめる。
- **仮の頭脳は人格を読まない**(返事は決まった文)。だから仮の頭脳の返事だけ、この端末で話し方(口調・語尾・元気さ・長さ・型の一言)をそろえ、必ず「仮の頭脳です」と出す。**安全の決まった返事(meta.safety)は変えない。**
- 画面のコードの通信の約束(web/test/privacy.test.mjs): fetch は `'/api/…'` の文字だけ(変数の宛先は増やさない)。`http(s)://` を書かない。`new Image(`・toBlob・drawImage・getImageData を使わない。選んだ絵は `document.createElement('img')` と `URL.createObjectURL` で、この画面の中だけで見せる。キャラの一覧は fetch できないので、見本の名前は creators.js に書く。
- S3 の `streamChat` は、受け手(onEvent)の中で投げた例外を「読めないイベント」として飲み込む。エラーは覚えておき、streamChat の後で投げる。
- 鍵の欄: 押したらすぐ欄を空にする。文・保存・URL に鍵が残らないことを試験で見る。**試験の偽の部品に本物らしい鍵の文字を埋めない**(画面の HTML 全体を探す試験が、試しの画面のスクリプトの中の文字を拾った)。
- 見た目: 選択肢の欄の高さが変わると会話の欄の見える高さも変わり、最後の文が隠れた → offer の後に必ず一番下までスクロール(試験で「最後の文が見える」を確かめる)。PC は右下の札にして真ん中のキャラを隠さない。スマホは 3 歩目から札を低く(58% / 最低 440px)。入力は 16px(iPhone で拡大しない)。押す所は 44px 以上。性格の画面は「返事」の箱を上に貼りつけ、下の設定を選ぶ間も返事が見える。
- できた子を舞台に出すのは `?character=<id>&onboard=1` で読み込み直す。前に sessionStorage へ小さな控え(絵と絵の住所は入れない)を置き、3 歩目「この子はどうかな?」から続ける。
- おまかせは種つきの乱数(settings.js の seededRandom)。試験では種を渡して同じ結果にする。

## 試験(全部 web/ で)
- `node --test test/onboarding_script.test.mjs test/onboarding_persona.test.mjs` … 画面なし、1 秒。7 歩の通し・絵の分かれ道・古いボタン・2 回押し・鍵の成否・控えからの再開・話し方の変わり方
- `node --test test/onboarding_browser.test.mjs` … 画面なしの Chrome、約 55 秒。幅 390(文字送りと音を本当に)・400・1280 で 7 歩、絵の入口、「性格」ボタン。横のはみ出し 0・押す所 44px 以上・本文 16px 以上・最後の文が見える。`FR_SHOTS_DIR=<フォルダ>` で写真を残す(リポジトリの外に)
- `node --test test/onboarding_s3voice.test.mjs` … S3 の声の部品がある線でだけ動く(無ければ飛ばす)。鍵の形・確かめ・覚えない、と、Chrome で鍵なし=レトロ、鍵あり=声(声のサービスへの通信は横取りして外へ出さない)
- 本物の頭脳・本物の声のサービスは試験で呼ばない。

## 確かめていない事
- 本物の iPhone の Safari・Android・Quest のブラウザでの見た目と音(画面なしの Chrome の幅だけ)。本物の Haiku での「性格を変えた後の返事」。手元の PC へ絵や言葉を渡す道(local)。
