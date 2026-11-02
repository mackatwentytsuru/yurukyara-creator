---
name: web-device-testing
description: カメラ・マイク・iPhone の AR 殻・Quest が手元に無くても、web/ の追従・声・位置合わせを確かめる方法。偽のカメラ、偽の殻、画面なしの Chrome の使い方と、つまずいた所。実機の前に通しを確かめるときに使う。
---

# 実機なしで、カメラ・声・AR を確かめる

使うのは、Chrome(`C:/Program Files/Google/Chrome/Application/chrome.exe`)と、`web/node_modules/playwright-core`。サーバーは `npm run build && node server/index.mjs`(8787)。

## 1. どの画面で確かめるか

| 確かめたいこと | 使う物 | 理由 |
|---|---|---|
| 見た目・レイアウト・携帯の幅 | 組み込みのブラウザ枠(`resize_window` の mobile) | 絵がすぐ見える |
| 時間のかかる流れ(声の 10 回、AR の通し) | **手元の Chrome を画面なしで**(`headless: true`)、Playwright | 組み込みの枠は、裏にあると時計(`setTimeout`・`requestAnimationFrame`)が遅くなり、10 回の測定が数倍かかる・途中で止まる |
| カメラ | 偽のカメラ(下) | 組み込みの枠は、カメラを禁止している(`Permission denied`)。画面は「カメラを使えませんでした」を出すので、その分岐の確認にはなる |

画面なしの Chrome の起動の引数: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`(WebGL が動く)。音は `--autoplay-policy=no-user-gesture-required` を足すと、`AudioContext` が `running` になり、`currentTime` も進む(読み上げ・あいづちの再生の確認ができる)。

## 2. 偽のカメラ

引数: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<ファイル>`、コンテキストに `permissions: ['camera', 'microphone']`。

- **パスは Windows の形(`C:/Users/...`)**。`/c/Users/...` だと読まれず、緑の画面(既定の偽の映像)になる。Git Bash では `cygpath -m` で直す。
- **形式は y4m**。mjpeg は読まれなかった(緑のまま)。`ffmpeg -framerate 30 -i f_%04d.png -frames:v 60 -pix_fmt yuv420p out.y4m`。60 コマ・640×480 で約 28MB。
- 映像が届いているかは、ページの中で `video` を canvas に描いて、画像にして見る。緑なら届いていない。
- **アニメ調のキャラの顔は、MediaPipe の顔のランドマークが検出しない**(信頼度を 0.3 に下げても 0 件)。追従の確かめは、`SimSource`(マウス)か `PoseSource`(位置を渡す)で行い、本物の顔での確かめは、実機のカメラに頼る。
- 追従の数字(`window.__app.lastAttention`・`character.debug.headYaw`)は、ページの中から読む。

## 3. 偽の殻(iPhone の AR)

`page.addInitScript` で、ページが読み込まれる前に殻の窓口を定義する:

```js
window.__posted = [];
window.webkit = { messageHandlers: { arhost: { postMessage: (m) => window.__posted.push(m) } } };
```

ページが殻を見つけて AR に入ると、`{type:'ready'}` が `__posted` に入る。そのあと、殻のふりをして送る(約束は `place/web/nativeAR.js`):

- 姿勢: `window.__arhost.onPose(world16, projection16)`(列優先 16 個。カメラのワールド行列と射影行列)
- 床の高さ: `window.__arhost.onFloor(y)`、床のタップ: `window.__arhost.onHit(x, y, z)`

位置合わせの確かめは、「部屋が現実の中で回転 yaw・移動 (tx, tz) に置かれている」と決め、案内された目印(`app.alignFlow.targets`)の部屋の座標を、`x' = x cos + z sin + tx`、`z' = -x sin + z cos + tz`(three の rotation.y と同じ向き)で世界に直して、`onHit` に渡す。回転が復元され、食い違いが 0cm になり、キャラが `worldFromRoom(spawn)` に立てば合格。

## 4. 声の回を機械で流す

聞き取りは使えないので、`dialogue.send({ text, mode: 'voice', t0: performance.now() })` を直接呼び、5 秒おきに 10 回。`app.metrics` に、あいづち(`fillerMs`)と本当の返事(`totalMs`)が別々に入る。この `t0` は送信の時刻なので、**本物の声での「話し終わり」の判定(約 0.45 秒)と、聞き取りの遅れは入らない**。数字に書くときは、その但し書きを付ける。

## 5. 長く動かしたときの安定(デモ当日、何時間も動かす前に)

`scripts/soak-memory.mjs`(外の資料の「20 サイクル以上でメモリ増加を測る」を借りた)。課金が出ないよう、**Claude と ElevenLabs の鍵を外したサーバー**(`env -u ANTHROPIC_API_KEY -u CLAUDE_CREDIT_API_KEY -u ELEVENLABS_API_KEY PORT=8815 node server/index.mjs`。仮の頭脳・字幕のみ)に向けて、60 往復(3 回に 1 回は途中で割り込む)させる。区切りごとに強制の gc のあとの JS ヒープ、DOM の数、three のジオメトリ・テクスチャ・シェーダーの数、履歴の長さ、タイマーの数を出す。

- 結果(2026-11-02、f_led・test_room): ヒープ +0.6MB、DOM・ジオメトリ・テクスチャ・シェーダーは増えない。メモリの漏れは見つからなかった。
- **見つけた不具合**: 履歴が増え続けていた(60 往復で 120 件)。画面が毎回全部を送るため、長い一日の後に本文が読み込みの上限を超えて 413 になり、会話が止まる。サーバーが使うのは直近 12 件だけ。直し: 画面側を直近 24 件で頭打ち(`trimHistory`)。
- **同じ測定で見つけた、もう 1 つの穴**: 直近 12 件で切ると、返事が無かった回があるせいで assistant から始まることがある。Claude の API は先頭が user でないと断る。サーバーの入口で、user から始まるまで捨てるようにした(`sanitizeChatBody`)。仮の頭脳では出ず、本物の頭脳でだけ出る形の不具合なので、試験(`test/history.test.mjs`・`test/validate.test.mjs`)で形を固定した。
- 測っていない物: カメラ追従(MediaPipe)を回し続けたとき・声(AudioContext)の再生を何百回も繰り返したとき・VR/AR の中。実機でしか確かめられない。
- 数字を汚す試し(`/api/metrics` へ送る)は、実測のログ(`logs/latency.jsonl`)に混ざる。先に写しを取るか、画面の中で `fetch` を包んで握りつぶす(`page.route` は使わない。遅れの注入が効かなくなる)。

## 6. 気をつけること

- 画面なしの Chrome も、組み込みの枠も、**実機の代わりではない**。報告には「偽の殻で通した・実機は未確認」と書く。
- サーバーを使う試験が、構文エラーのとき、エラーでなく待ちで止まって見える。ファイルごとに `timeout 30 node --test <ファイル>` で走らせると、止まった物が分かる。
- `Get-NetTCPConnection` でサーバーの PID を調べ、**自分で起動した物だけ**を止める(名前で `node` を止めない)。

## 7. 本物の頭脳と声で、VRM を通して測る(2026-11-03)

`scripts/talk-through.mjs`(画面なしの Chrome。サーバーは鍵つきの試しサーバー。声の文字数を使う)。キャラは `?character=<id>`、VRM は `characters/<id>/model.vrm` に置いて `.gitignore` で外す(リポジトリに入れない)。
- 毎コマの記録(`requestAnimationFrame`): 声の音量(`speaker.analyser`)、口 `aa`、`blink`、頭の骨の向き、`lookLeft/Right`、揺れ物の先の節の回転。ここから、口と声の相関・ずれ、まばたきの回数、割り込みで口が閉じるまでを出す。**fps が低い(8〜13)ので、ずれは 1 コマ単位**。
- **揺れ物は「回転の変化」で測る**(最初の姿との角度)。頭に対する位置で測ると、頭が動いただけで全部の節が同じ数字になる。立ったままの動き(お辞儀・首ふり)ではスカートは動かない。体ごと動かして(`character.object3d.position.x`)確かめる。
- 場所は `test_room` を借り、画面の中で `app.place.name`・`info`・目印の `note` を書き換える。目印の `note` を直し忘れると、返事が元の説明(木の机など)を読み上げる。
- 実測のログを汚さない: ページの `fetch` を包んで `/api/metrics` を握りつぶす。サーバー側の `logs/latency_server.jsonl` は、写しを取って戻す。
- 本物の返事を 1 回だけ記録する: `scripts/once-reply.mjs`(最初の返事をそのまま JSON に書く。選び直さない)。動画に「実際の返事」と書く物の証拠。
