# 第 12 波の直し: VR の声かけ・スマホの声の失敗・横の端・札の上(2026-11-07 S5w12。V1・Q3・P1・L1・CRITsec3)

(元の文のまま)

- **VR の声かけ**: ヘッドセットでは「見ている人」= Quest の頭で、VR の間ずっと 2.2 m 以内にいる。「近づいたら声をかける」の冷却 90 秒だけだと、居るだけで 90 秒ごとに名乗り直す(実測 3.5 分で 3 回)。直し: ① `talk()` の入口で、どの入口(文字・声・ボタン・近づき・トリガー)の会話でも `presence.greetedAt` と `lastTalkAt` を書く ② VR(`xr.isPresenting && modes.mode === 'vr'`)に入った時だけ `vrGreetPending = true`(1 回で下ろす・入り直せばまた 1 回)③ 声をかける条件に「本人の声を聞いている間(voiceActive・transcribing)でない」「最後の会話から 60 秒」。時計は `performance.now()/1000` にそろえる(XR の rAF の時刻とは基準が違う)。
- **トリガー**: マイクが聞いている間は何も送らない(`onVrSelect` が `listener.listening` なら return)。マイクが使えない時だけ「こんにちは」を送り、板の状態の言葉に「マイクなし(トリガー = こんにちは)」と出す。
- **試しの場所は送らない**: `?place=` が無い時の `SAMPLE_PLACE`(受付・スタッフの部屋)と VR の中は、会話に `place: undefined` を渡す(サーバーの validate は `{}` に直す)。「スタッフさんに聞いてみて」の元だった。
- **声かけの回は前の返事を空にする**: 声かけ(`trigger: 'approach'`)は dialogue が `userSaid` を呼ばないので、`replyParts` が前の回の後ろに足されて板に同じ文が 6 回出た。`talk()` で `ui.userSaid('')` を先に呼ぶ。VR に入る時も板の `user/reply/error` を空にする。
- **「許可する」の知らせは遅らせて出す**: 許可を覚えた端末は 0.4 秒で VR に入るので、押してすぐ出すと一瞬だけ出て消える。`mountModeButtons({ waitDelayMs: 900 })` で、900ms たっても入れない時だけ出す(試験は 0 を渡して従来どおり)。
- **`.gate button` の `display: grid` は `[hidden]` に勝つ**: ヘッドセットで `startSim.hidden = true` にしても「カメラなしで試す」が見えていた(属性だけ見る vr-check は通る)。`.gate button[hidden] { display: none; }` を足す。ほかの `hidden` を使う所も、`display` を書いた規則と同じ詳しさで `[hidden]` の規則を持つ。
- **声で話すが失敗した時は、字幕の上の `#uiNotice` に日本語で**(畳まれた「Claude の考え」の中でなく): `stage/micNotice.js` の `micUnavailableText`(https でない・mediaDevices が無い。押す前に言う)と `micFailureText`(NotAllowed・NotFound・NotReadable・日本語の文はそのまま・それ以外は決まった文。英語の `err.message` は出さない)。どれも「文字ならこのまま話せます」と添える。
- **入口のボタンは HTML で最初から `disabled` + 「読み込んでいます…」**: JS が動くまで(遅い 4G で約 7 秒)押せそうで押せない。`boot()` の最後で `camSub` を戻して有効にする。
- **スマホの文字は 14px 以上**(S5 の style.css は 10〜13px を 14px へ。S4 の styles.js は別)。幅 320 の入力の列が 343px になったのは `.bottom` が `display: grid` で列が中身の幅まで広がるため: `grid-template-columns: minmax(0, 1fr)`。左右の安全域は `max(12px, env(safe-area-inset-left/right))`。低い画面(高さ 500px 未満。横向き・キーボードで縮んだ画面)は上の札の列・注意書き・よくある質問を隠し、字幕は 2 行まで。
- **羽・腕が横の端で切れる(幅 390・430 のちょうちんくん)**: `halfWidth` は箱の真ん中の面での幅。遠近で手前に出た羽の角は画面ではもっと広く写る。`frameCharacter`(全身)の最後に、箱の 8 つの角を画面へ写して左右 1.5% より外に出る時は `wScale` を広げて置き直す(最大 3 回。小さくなるだけなので頭のすき間は広がる)。
- **字幕・札の余白**: 下の帯の上に出る字幕と札の分は、80px 固定でなく画面の高さの 16%(96〜140px)。スマホで「はじめての会話」の札(`.fr-sheet`・下から出る・幅 720 未満)が開いている間は、札の上の端までを下の限りにして、見本の子を札の上に全身で出す(`cardInset()`。札の大きさは ResizeObserver で見る)。タブレット(幅 641〜1180)の開いた「Claude の考え」は画面の高さの 30% まで(長いと子が窓の下へ押されて小さく低くなる)。
- **`*.ts.net` は QR にも Meta へ送るリンクにも出さない**: 機械と tailnet の名前が出る。`isPrivateHost` に `ts.net` を足す(1 行のまま)。撮影で箱を映す時は公開の URL か例の名前で開く。
- **試験の見本の住所は、その場で組み立てる**: 公開前の履歴の書き換えの規則が、書いたままの 192.168.… や `<名前>.tail<16進>.ts.net` を伏せ字に言い換え、試験が落ちる(S6 の patch)。`const ip = (...p) => p.join('.')`。
- **ssh の .ps1 に日本語を書かない**(BOM が無いと cp932 で読まれ、コメントの 2 バイト目が改行を食って `param(...)` が壊れた)。
- **上の段に字や言葉を足すと、行が増えてキャラが小さくなる**(第 12 波の実測): 札の列を 12 → 14px、「VR」→「Quest で開く」にしただけで、幅 390 の上の段が 56px 高くなり、390×664 のキャラの高さが 210 → 177px、頭のすき間が 49 → 34px(決まり 39.8px)に悪化した。字や言葉を変えたら、**必ず幅 390 の `l1_audit.mjs --sizes ph390x664,ph390x844` で行の数とすき間を測る**。直し: 幅 640 までは札の列を 1 行で流し(`flex-wrap: nowrap; overflow-x: auto`)、ボタンの横の余白を 14 → 10px・間を 6px に(`.top .quest-link-btn` のように `.top` を付けて、後ろに書かれた同じ詳しさの規則に負けない)。結果: 上の段が元の高さに戻り、390×844 の立った高さ 306 → 340px。
- **羽(止まった箱の外へ振れる)**: 止まった箱で幅を決めても、ちょうちんくんの羽は話す間に箱の外へ出て 430×932 の両端で切れた(箱の角を画面へ写す確かめは通る)。横に広い子(幅 > 高さの 0.8 倍)は最初から幅を 15% 広く見込み、確かめの余白は片側 5%。本当は羽の振れ幅を読み込みで測って足すのがよい(L1 の直し方の案。12b 以降)。
- **確かめの順**: 木を `git archive HEAD --format=zip` で確認用の別の PCへ送り(`Expand-Archive`・node_modules はジャンクション)、`s5w12_run.py` の段(build・tv・gap_quick・l1・l1s)を `machine_lock.py run --machine <確認用の PC の名前> --kind cpu --procs 4` で包んで流す。L1 の全 84 場面は 13 分、6 つの大きさ(スマホ 4・iPad 2)は 5.6 分。前後の比べは `L1/tools/l1_audit_md.py <フォルダ> <md> before after`(フォルダに l1_before.json = 前の結果を、使う大きさだけに絞って置く)。台本は `work/S5/w12/`・`scratchpad/k12/`(s5w12_run.py・s5w12_remote.sh・s5w12_setup.ps1)。
