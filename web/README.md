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
