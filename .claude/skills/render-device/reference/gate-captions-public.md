# 入口(ゲート)と初めての訪問(2026-11-07 第 7 波。点検 CRITux 2・10・15・24)

(元の文のまま。入口から声のサーバーの有無まで)

- 入口のカードは「ゆるキャラクリエイター」(title も)・案内役(主役なら「案内するのは主役のノリー。協力者が手で描いた、セスジキノボリカンガルーの執事見習いです」、ほかの子ならその子の名前)・本当の約束(声が使える時だけ「声と文字で答えます」、それ以外は「文字で答えます。声は、声の鍵があるときだけ出ます」。決めるのは `/api/status` の `tts.available` を読んだ後の `fillGate()`)。公開の URL には読み上げの関数が無いので、声は使う人の鍵(7 歩目)だけ。
- **案内役の 1 行は、キャラを読んだすぐ後に書いてから見せる(S5w9。M8b 4)**: boot で `app.character = character; app.characterId = id;` と同じ流れ(await を挟まない)で `fillGuide()` を呼び、主役でない子ならその子の名前を textContent で書いて、`<html>` に `guide-ready` を付ける。それまでは `html:not(.guide-ready) .gate-guide { visibility: hidden }`(場所は空けたまま。JS が来る前も効く)。前は状態(/api/status)を読んだ後の fillGate で書いていたので、`?character=mikan` を遅い端末(内蔵 GPU の PC・CPU 6 倍遅いまね)で開くと HTML の初めの文「案内するのは主役のノリー…」が先に見え、練習の道具も読み急いだ。**道具は textContent で読むので、見えない間も文は残る。見え方は visibility まで見る。**
- **入口が開いている間は、上の段と「Claude の考え」を隠す**: `<html class="gate-up">`(JS の前から効く)と `html.gate-up:not(.fr-open) .top, … #thought { visibility: hidden }`。visibility なので高さの測り(--top-h・topGuard)は変わらない。外すのは `gateClosed()` だけ(#startSim・#startCam が通った時)。S4 の 7 歩が入口を消して出ている間(`html.fr-open`)は出す。前は入口の板の裏で 9 個が見えるのに押せなかった。
- **初めての訪問なら、入口を閉じた直後に 7 歩**: `web/src/stage/firstVisit.js` の `shouldOpenFirstRun({ params, storage: localStorage, doneKey, headset })`。印 `yc.onboarded.v1`(S4 が「終えた」「あとで」で書く)が無ければ出す。出さない: `?onboard=0`・`?onboard=1`(読み込んだ時に出ている)・**`?auto=0`(確かめの道具が付ける。web_talk_check・talk-through・measure-render・layout_check は付けているので変わらない)**・LED・自動で始める・ヘッドセット・`?perf=1`。覚える所が使えないブラウザは初めてとみなす。S4 の startOnboarding は 2 回目を何もしないので、S4 が自前で出しても重ならない。
- ボタンの言葉: 何をするか(大)+どう動くか(小、`.btn-sub`)。カメラは「カメラを使って始める」(マイクを言わない。マイクは「声で話す」の時だけ、と下の注に書く)。カメラなしは「カメラなしで試す」のまま(**web_talk_check.mjs などが `getByText('カメラなしで試す')` で押すので、この言葉は残す**)+スマホ「画面を指でなぞると、その向きを見ます」/PC「マウスを動かすと、その向きを見ます」(`matchMedia('(pointer: coarse)')`)。下の注と上の札も同じ言葉。
- **指でなぞる向きを本当に効かせるには、舞台に `touch-action: none`**。無いと、Chrome のタッチ(CDP の `Input.dispatchTouchEvent` の touchStart → touchMove)で SimSource の faces が 0 のまま(直す前 0 → 直した後 1)。
- 上の札の言葉(CRITux 18): 「人 0」→「見えている人 0 人」、カメラの道「GPU 60fps」→「オン」、カメラなし「マウスで試し中」→「なし」(tracking/ の info の言葉は持ち主が無いので、main.js の updateChips で言い換える)。考えの下は「返事が始まるまで 0.3 秒(仮の頭脳なので、参考の値)・目安は 1.2 秒以内」(後ろの一言は第 11 波から仮の頭脳の回だけ。下の第 11 波の節)。札の文字を長くすると幅 390 で 3 行になりキャラが小さくなるので、短い言葉にする(2 行のまま)。

## 字幕に返事の全部を残す(CRITux 12)と「表情と動き」の言葉(CRITux 9)
- 会話の側(S3 の Dialogue)の呼び方は変えずに、panel.js の `createCaptionFlow()`(DOM を触らない。試験 `web/test/place_caption_flow.test.mjs`)で決める: `say(文)` の後の `caption('' か 文の頭)` は返事の続き(前の文を小さく `.cap-prev`、今の文を `.cap-now`)、`caption(null, ms)` は話し終わり → 返事の全部を `.settled` で次の会話まで残す(前は 1.2 秒で消え、最後の 1 文しか読めなかった)、`caption(null)`(取り消し=次の会話の始まり)と使う人の言葉は片づけ。**返事の続きかどうかは「今の文の頭と同じか」で見分ける**(聞き返しの知らせは別の文なので、返事に混ぜない)。
- 字幕は `max-height: 34vh; overflow-y: auto; line-break: strict`(小さい「ョ」で行を始めない)。幅 390 で 3 文(62 字)は約 100px で、ノリーの足の下に収まった。
- 「表情と動き」は `actWords(ev)`: 「うれしい・おじぎ・あなたを見る」。K2 の 7 つの表情・動き 13(rig の sad・idle・talk を含む)・視線(person・away・landmark:<名前>)。知らない名前も中の名前を出さず「この子の表情」「この子の動き」。

## 考えの窓(CRITux 21)
- スマホで「Claude の考え」を開くと、窓が顔と見た目の切り替えに重なり、切り替えが押せなかった。直し方: ① TOP_GUARD に `#thought:not(.collapsed)` を足し、`#thought` を ResizeObserver で見て置き直す(開いている間はキャラを窓の下へ。開いた窓の高さはスマホで決め打ちにして、返事のたびにキャラが動かないようにする)。② スマホで開いた窓の高さは `calc(45dvh − 上の端 − --top-h − 20px)`(vh の行の後に dvh の行)。**framing.js の上の段の上限(画面の 45%)と同じ所で止めないと、上限で切られて頭が窓の下に入る**。③ 重なり順: `.top` z-index 5 > `.thought` 4。**切り替えは .top(position: fixed)の子なので、切り替えだけに z-index を付けても効かない(.top が重なりの箱を作る)。親の .top に付ける。** 開いた見出しの右は `body:has(#lookSwitch:not([hidden]))` で 172px 空ける。
- 結果(幅 390、GPU の Chrome): 直す前 窓の下の端 314・頭 219(重なる)・切り替え 3D/2D とも押せない → 直した後 窓の下の端 368・頭 395・切り替え押せて替わる(3D・2D とも)。キャラは開いている間だけ小さくなる(高さ 384 → 223px)。

## ?character= と ?place= は公開では id だけ(CRITsec F5)
- `web/src/character/urlSpec.js`: `pickSpec(値, { allowPath })`。id(`^[a-z0-9_]{1,32}$`)はいつでも読む。パス・URL はこのページをこの PC の中(localhost・127.0.0.1・[::1]・*.localhost)で開いた時だけ(`isLoopbackPage`。家の中の番号や tailnet の名前は誰でも持てるので「公開」と同じ)。読まなかった時は入口の `#gateStatus` に知らせ(書かれた値は写さない)、主役と試しの場所を出す。main.js は `?character=`(`?char=`)と `?place=` の両方をこれに通す。
- **公開の URL のまねは、Chrome を `--host-resolver-rules=MAP judge.test 127.0.0.1` で別に起こし、`http://judge.test:<port>/?character=<別の場所の URL>` を開く**(ページの名前が 127.0.0.1 でなくなる)。直す前は、外の place.json を取りに行って CORS で落ち、画面ごと「キャラを読み込めませんでした: Failed to fetch」。直した後は、外への通信 0・知らせ 2 行・ノリーが出る。`?character=yokoso`(id)は公開でも読める。

## 第 7 波の確かめの道具
- `node work\S5\tools\w7_check.mjs <web> <port> <出力> [--only gate,thought,reply,act,public,touch]`: 入口(390・PC。初めての訪問 → 7 歩 → あとで → 読み込み直して 2 回目)・考えの窓(390 × 3D・2D。開いた時の重なりと切り替え)・字幕(話し終わって 2.6 秒後に全部の文が出ているか)・表情と動き(英字が無いか)・公開の URL のまね・指でなぞる。直す前と後を同じ道具で撮り、json を比べる(この道具は合否を出さない)。GPU の札の中で。
- 新しい試験は、直す前の木の写し(`git worktree add --detach <写し> <前のコミット>`、新しい部品と試験だけ写す)で流して落ちるのを見る(第 7 波: 24 件中 6 件が落ちた)。写しは `git worktree remove --force` で消す。

## 声のサーバーの有無を読み上げに渡す(CRITux 25 の公開の側。2026-11-07 S5w7b)
- main.js の `refreshStatus()` は、`/api/status` を読んだ後(読めなかった時も)に `speaker.setServerVoice(Boolean(app.status?.tts?.available))` を呼ぶ(起動の 1 回と 15 秒ごと)。公開の URL(`/api/status` も `/api/tts` も無い)と声の鍵の無いサーバーでは、読み上げは初めから文字送りと「ピッ」で話し、`/api/tts` を 1 回も聞かない(console に 404 が出ない)。声の鍵のあるサーバーは今までどおり。読めなかった後にまた読めたら、この知らせで止めた分だけ戻す(429 などサーバーが答えた理由は残す。speaker.js の決まり)。
- 試験: 動きは S3 の `web/test/voice_server_off.test.mjs`、main.js の形は `web/test/place_server_voice.test.mjs`(直す前の main.js では 1 件落ちる)。画面では、鍵なしのサーバーで初めての訪問の 7 歩を 6 秒話させても `/api/tts` 0 回(下の first_visit_check が数える)。
