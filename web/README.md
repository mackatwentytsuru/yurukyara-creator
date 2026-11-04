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

`?character=<id か character.json の URL>`(`f_led` のように id だけでもよい。`?char=` も同じ) `?place=<place.json の URL>` `?view=full`(全身)`?gain=2`(視線の振れ)`?hfov=65`(カメラの画角)`?auto=0`(近づいた人への声かけをしない)

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
| `BridgeSource` | 入口の LED。床のカメラの視線の橋(`kiosk/tools/eye_camera/gaze_bridge.py`)の向きを、サーバーの `/api/gaze/now` から読む。`?source=bridge` で始める |

`PoseSource` へは、ページの `window.conversation` から渡します。

```js
conversation.setViewer([x, y, z]);                       // 見ている人の頭のワールド座標。null で「いなくなった」
conversation.setPeople([{ id: 'a', position: [x, y, z], speaking: true }]);  // 複数人
```

1.5 秒、更新が無ければ「いなくなった」とみなします。

## キャラの種類

- `type: "vrm"`: 人型。表情・口・視線(目が先・首が後)・手続きの動き(うなずき・お辞儀・手を振る・指さし ほか)。
- `type: "rig"`: 人型でないキャラ。キャラの柱の `creator/viewer/rigRuntime.js`(`loadRigCharacter`)で読み、顔の絵の表(表情 × 口の開き)・体の向き・動きのファイル(`motions/*.glb`)で動く。呼び方は VRM と同じ(`CharacterBase`)。Claude に選ばせる「動き」の一覧は、そのキャラにある動きのファイルだけを渡す(`motionChoices`)。全身を見せる(`?view=full` が既定)。
- 身長合わせの大きさは、中身(モデルのシーン)に掛け、`object3d` の座標はいつもメートルのまま。場所に立たせる・視線を計算するときに、単位が狂わない。

## 見せ方(画面・AR・VR)

切りかえの入口は場所の柱の `place/web/modes.js`(`createPresentation`)です。`web/` は次をつないでいます。

- 画面: 既定。入力は MediaPipe かマウス。
- AR(iPhone の殻アプリ): ページが殻の中だと分かると、すぐ AR に入ります。殻の姿勢が `PoseSource` に届き(カメラは使わない)、キャラは見ている方向の 1.6m 先の床に立ち、床をタップするとそこへ移ります。撮った部屋は隠します(AR の世界と重ならないため)。
- VR(Quest 3)の話す手順は、下の「Quest 3 で話す」にまとめました。
- AR / VR(Quest): 「AR で見る」「VR で見る」のボタンが出ます。入ると入力は頭の位置になり、MediaPipe のカメラは止めます。VR では撮った部屋の中に、spawn の位置で立ちます。
- 画面に戻ると、入力・カメラの構図・キャラの位置を元に戻します。
- **AR の位置合わせ**: 殻の中で撮った部屋(`?place=`)があると、「『入口』の真下の床をタップしてください(1/2)」と案内が出ます(場所の柱の `alignFlow`)。2 か所タップすると、撮った部屋が現実の部屋に重なり、キャラは部屋の立ち位置に立ち、撮った部屋は見えない遮蔽物になります。食い違いが 15cm を超えると、やり直しになります。**重なるまでは、部屋の目印を Claude に渡しません**(現実と合わないため)。重なったあとは、位置合わせを織りこんだ距離と向きを渡します。

iPhone の殻から開く HTTPS(同じネットワークに公開するときだけ。費用の上限は付いています):

```bash
cd web && npm run build
HOST=0.0.0.0 PORT=8443 TLS_CERT=../place/.certs/192.168.x.x.crt TLS_KEY=../place/.certs/192.168.x.x.key   ANTHROPIC_API_KEY=… ELEVENLABS_API_KEY=… node server/index.mjs
# 殻が開く URL: https://<この PC の IP>:8443/?source=pose&place=<id>
```

## Quest 3 で話す(ブラウザだけ。アプリのビルドは要らない)

Quest のブラウザで開いて、「はじめる」でマイクを許可し、「VR で見る」を押します。同じ `?character=<id>` で、GLB のキャラ(`rig`)も VRM も動きます。

- **聞き取り**: Quest のブラウザには聞き取りの機能が無い報告があるので、声の区間をサーバーへ送って文字にします(`/api/stt`、faster-whisper。`pip install faster-whisper`)。音は文字にしたら消します。鍵は要りません。設定は `STT_MODEL`(既定 small)・`STT_DEVICE`(cpu)・`STT_THREADS`(4)・`STT_ENGINE=off`(使わない)。`base` は同じ録音の 5 区間とも「19時」が崩れたので、既定は small のまま(2026-11-04)。 PC が混んでいるときの CPU は字まで 40 秒を超えて使えなかったので、NVIDIA の GPU があれば `STT_DEVICE=cuda` を付ける(字まで中央値 0.3 秒。読み込みの最初の 1 回は除く)。
- **聞き取りの遅れを測る**: `node web/scripts/stt-latency.mjs --port <番号> --mic 声.wav --out <フォルダ> --word <正しい言葉>`。声の区間が閉じた時刻を起点に、字が返るまで・返事の最初の文・最初の音・あいづちの音を、ページの中の時刻で出す。
- **立ち位置**: キャラの正面 1.6m に立ちます。キャラは場所が決めた位置のままで、見ている人の原点をずらします(`src/vrStage.js`)。体で歩くか、スティックで歩きます。撮った部屋が無いときは、空と床を出します。
- **文字**: ページの文字は VR の中で見えないので、状態・話した言葉・返事を、キャラの横の板に出します(`src/ui/vrPanel.js`)。トリガーで「こんにちは」と話しかけられます(マイクが使えないときの確かめに)。
- **キャラの声を拾わない**: キャラが話している間は聞きません(割り込みは `?bargein=1`)。スピーカーがマイクの近くにあるためです。

USB でつなぐとき(証明書も Wi-Fi の設定も要らない。Quest から見て localhost になる):

```bash
cd web && npm run build
PORT=8799 SHOP_DATA_FILE=../creator/setup/shop_empty.json ANTHROPIC_API_KEY=… ELEVENLABS_API_KEY=… node server/index.mjs
node scripts/quest-usb.mjs --port 8799 --character <id>   # 「USB デバッグを許可」を待って、道を張り、Quest のブラウザで開く
```

同じ Wi-Fi でつなぐときは、上の「iPhone の殻から開く HTTPS」と同じ起動で、`https://<この PC の IP>:8443/?character=<id>` を開きます(証明書の警告は「詳細設定 → 進む」)。

実機なしの確かめ(Meta の IWER という WebXR の偽物と、偽のマイクで、入る・立ち位置・床・大きさ・視線・歩く・スティック・トリガー・声・口・出る、を測る):

```bash
node scripts/vr-check.mjs --port 8799 --character <id> --out <フォルダ> [--mic 声.wav --mic-word 声に入っている言葉]
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

## 入口の LED(縦長)で動かす

床のカメラ(別の機械でもよい)→ 視線の橋 → UDP → このサーバー → 縦長のページのキャラの目と首。カメラの絵はこのサーバーにもページにも来ない(向きの数字だけ)。

```bash
cd web
GAZE_UDP_PORT=5331 node server/index.mjs        # 視線の受け口(UDP 5331)。カメラの機械が別なら GAZE_UDP_HOST=0.0.0.0
# ブラウザを縦長の全画面で(LED の比 236:300 など):
#   http://127.0.0.1:8787/?character=sample_vrm&source=bridge&autostart=1&interview=1&auto=0&led=1
python kiosk/tools/ue_link/video_gaze.py play --file rec.mp4 --port 5331     # 録画で試す(本物のカメラなら run_eye の結果を視線の橋で)
```

| 引数 | 意味 |
|---|---|
| `?source=bridge` | 床のカメラの向きで追う(この端末のカメラは使わない) |
| `?autostart=1` | ゲートを飛ばして始める(LED の前で人がボタンを押さない) |
| `?interview=1` | インタビューの型(返事 2 文まで・台本にしない) |
| `?led=1` | 顔にかぶる「Claude の考え」と、操作の帯を隠す(字幕と注意書きは残す) |

**キャラの差し替え**は `?character=<id>` の 1 か所(人型の VRM ができたら `characters/<id>/` に置いて id を替える)。

**校正**(床の 5〜6 点): スマホで `/kiosk/aim.html` を開き、矢印でキャラの向きを「自分を見ている」と感じる所に合わせて「この向きで記録」→「点を保存」→ `python kiosk/tools/eye_camera/gaze_calib.py --points gaze_points.json --geometry <いまの幾何> --out <新しい幾何>`。記録には、視線の橋を画素つき(`GazeBridge(with_pixels=True)`、`video_gaze.py play --with-pixels`)で動かす。API: `POST /api/gaze/aim {az, el}` か `{off:true}`・`POST /api/gaze/mark`・`POST /api/gaze/unmark`・`GET /api/gaze/points`・`GET /api/gaze`(状態)。
