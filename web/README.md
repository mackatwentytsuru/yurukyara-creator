# web/ — 会話(ブラウザで動く本体)

キャラが、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声と表情と体の動きで答える。

## 動かす

```bash
cd web
npm install                 # wasm と顔のモデルを public/mediapipe に取ります(リポジトリには入れません)
cp .env.example .env        # 開発用の設定。鍵は書かず、環境変数に設定します
npm run build
npm run server              # http://localhost:8787
```

| 環境変数 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | 会話の頭脳(`claude-haiku-5-5`)。無いと、同じ形で返す仮の頭脳になります |
| `ELEVENLABS_API_KEY` | 読み上げ。無いと、字幕と口パクだけになります |
| `ELEVEN_DAILY_CHAR_CAP` | 読み上げの文字数の 1 日の上限(既定 3000) |
| `TLS_CERT` / `TLS_KEY` | 証明書の場所。あれば HTTPS で配ります(iPhone のカメラとマイクは HTTPS が要ります) |
| `DEV_VRM_PATH` | 開発中の試しにだけ使う VRM のパス(`characters/_test/model.vrm` として配る。記録しません) |

開発中は `npm run dev`(5173)と `npm run server`(8787)を並べます。

## 画面の呼び出しの引数

`?char=<character.json の URL>` `?place=<place.json の URL>` `?view=full`(全身)`?gain=2`(視線の振れ)`?hfov=65`(カメラの画角)`?auto=0`(近づいた人への声かけをしない)

## 作り

```
src/character/    キャラの共通の呼び方(lookAt・setExpression・setMouth・play・update)。vrm と rig
src/tracking/     カメラで顔を見つける(端末の中だけ)・誰を見るか・座標への変換
src/conversation/ 会話の 1 ターン・読み上げ(先読み・口パク)・聞き取り・サーバーとの通信
src/ui/           「Claude の考え」の窓・字幕・注意書き
server/           Haiku の流し読み・読み上げの中継(文字数の上限)・静的配信
```

Claude は、1 行に 1 つの JSON で、まず `thought`(見えた様子・用件・段階)を返し、続けて読み上げる 1 文ごとに `say`(言葉・表情・動き・視線の先)を返します。画面は、`say` が届くたびに読み上げを始め、その文が話し始める瞬間に、表情・動き・視線・字幕を合わせます。

## 人の位置の入力(差し替え口)

キャラの目と首は、`src/tracking/sources/` の「入力」が返す人の位置の先を向きます。入力は `getPeople(nowMs)` で、
`[{ id?, position:[x,y,z], gaze?, speaking?, mouth? }]` を返します(座標は place.json と同じ。ワールド、m、y が上、右手系。詳しくは `sources/index.js`)。

| 入力 | 使う場面 |
|---|---|
| `MediapipeSource` | 画面(screen)。端末のカメラ。既定 |
| `SimSource` | カメラなしの試し。マウスの位置が人の位置 |
| `PoseSource` | AR(iPhone の殻アプリ)・VR(Quest)。外から位置を受け取る。`?source=pose` で始める |

`PoseSource` へは、ページの `window.conversation` から渡します。

```js
conversation.setViewer([x, y, z]);                       // 見ている人の頭のワールド座標。null で「いなくなった」
conversation.setPeople([{ id: 'a', position: [x, y, z], speaking: true }]);  // 複数人
```

1.5 秒、更新が無ければ「いなくなった」とみなします。

## 見せ方(画面・AR・VR)

切りかえの入口は場所の柱の `place/web/modes.js`(`createPresentation`)です。`web/` は次をつないでいます。

- 画面: 既定。入力は MediaPipe かマウス。
- AR(iPhone の殻アプリ): ページが殻の中だと分かると、すぐ AR に入ります。殻の姿勢が `PoseSource` に届き(カメラは使わない)、キャラは見ている方向の 1.6m 先の床に立ち、床をタップするとそこへ移ります。撮った部屋は隠します(AR の世界と重ならないため)。
- AR / VR(Quest): 「AR で見る」「VR で見る」のボタンが出ます。入ると入力は頭の位置になり、MediaPipe のカメラは止めます。VR では撮った部屋の中に、spawn の位置で立ちます。
- 画面に戻ると、入力・カメラの構図・キャラの位置を元に戻します。

iPhone の殻から開く HTTPS(同じネットワークに公開するときだけ。費用の上限は付いています):

```bash
cd web && npm run build
HOST=0.0.0.0 PORT=8443 TLS_CERT=../place/.certs/192.168.x.x.crt TLS_KEY=../place/.certs/192.168.x.x.key   ANTHROPIC_API_KEY=… ELEVENLABS_API_KEY=… node server/index.mjs
# 殻が開く URL: https://<この PC の IP>:8443/?source=pose&place=<id>
```

## 確かめる

```bash
npm test                    # 試験(追従・誰を見るか・座標・Haiku の読み取り・プライバシー)
npm run measure -- 10       # 返事までの時間(頭脳と声)を 10 回測る
```

測り方と縮め方は `.claude/skills/conversation-latency/SKILL.md`。経過は `docs/devlog_会話.md`。

## カメラとマイクについて

- カメラの映像は、この端末の中で人の位置・大きさ・口の開きを調べるだけに使います。保存も、送信もしません(`test/privacy.test.mjs` で、コードの形でも守っています)。
- 声の聞き取りは、いまはブラウザ内蔵の聞き取り(Chrome は Google、Safari は Apple のサービス)で、音がそのサービスへ送られます。画面にも出しています。
- サーバーが記録するのは、返事の時間の数字(`logs/latency.jsonl`)と読み上げの文字数だけです。
