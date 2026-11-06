# 公開の関数(契約 K5 版 1。持ち主 S6)

審査の人が試すリンクの裏側です。関数は 2 つだけです。手元の開発のサーバー(`web/server/index.mjs`)とは別で、声の読み上げ・聞き取り・数字の集計は公開では動かしません(聞き取りはブラウザの中だけ)。

| 道 | 中身 | 持ち主 |
|---|---|---|
| `POST /api/chat` | 1 回の会話。返事は流さず、まとめて 1 回で返す | 入口 S6・頭脳 S3(`web/server/brain.mjs`) |
| `/api/memory`、`/api/memory/<下の道>` | 記憶(合鍵・番号・一覧・わすれて) | 入口 S6・中身 S3(契約 K4、`web/server/memory/`) |

## 形(標準の Request → Response)

- 中身は `_lib/*.mjs` の関数で、標準の `Request` を受けて `Response` を返す。`chat.mjs`・`memory.mjs` は、それに本物の部品をつなぐだけ。試験は `_test/` が `_lib` を直接呼ぶ(`cd web && node --test`)。
- `_` で始まるフォルダは Vercel の関数にならない見込み(Vercel の説明による。実際の配備ではまだ確かめていない)。

### POST /api/chat

- 見出し: `content-type: application/json`。合言葉は **`x-demo-pass` の見出し**で送る(URL に入れない)。画面の入力欄で受け、ブラウザの中だけに持つ。
- 本文: 手元のサーバーと同じ形(`web/server/validate.mjs` の `sanitizeChatBody` が点検する)。公開では `useShop` を必ず `false` にする。
- 返事(いつも 200。本文が悪い時だけ 400・413、POST 以外は 405):

```json
{ "brain": "real|fallback", "fallback": false, "reason": "", "notice": "", "events": [{ "type": "say", "text": "…" }], "ms": 0 }
```

- `events` は手元のサーバーが流す物と同じ形(`meta`・`thought`・`say`・`handoff`)を、順に並べた物。
- 仮の頭脳になる理由(`reason`)と、画面に出す一言(`notice`、「仮の頭脳です(…)」): `no-key`(鍵なし)・`no-passphrase-set`(合言葉が決まっていない)・`passphrase`(無い・違う)・`per-minute`・`daily-cap`・`counter-unavailable`(数えられない時は止める方へ)・`brain-error`。**どれでも断らずに、仮の頭脳で話し続ける。**

### /api/memory

- `vercel.json` の書き換えで、`/api/memory/<下の道>` は `/api/memory?sub=<下の道>` に集まる。S3 は `web/server/memory/handler.mjs` から `handleMemory(request, { store, cfg, now })` を出す。`request.url` の `sub`(無ければ道の名前)で `new`・`pair`・`claim`・`reflect` などを分ける。
- `store` は `_lib/store.mjs` の置き場で、呼び方は `get(key)`・`set(key, value, { ttlSeconds })`・`del(key)`・`incr(key, { ttlSeconds })` の 4 つ。値は文字(JSON は自分で文字にする)。
- S3 の入口がまだ無い間は 501 を返す。接続元ごとの 1 分の上限(会話の 3 倍)を超えたら 429。

## 上限(お金を使いすぎない)

1. Anthropic の画面の、額の上限(本人が決めて入れる。いちばん強い守り)。
2. 本物の頭脳の回数: 1 日の全体(`DEMO_DAILY_CAP`、既定 300)と、接続元ごと 1 分(`DEMO_PER_MINUTE`、既定 10)。数は Upstash に置く(つないでいなければ関数の中のメモリ。呼び出しの間で消えることがあるので、その時は守りが弱い)。
3. 1 回の返事の長さ(`max_tokens` は頭脳の側で 700)と、入力の文字数(`sanitizeChatBody` の上限)。本文は 32KB まで。
- 接続元は、見出しの値をそのまま保存せず、ハッシュの頭 16 字だけを数に使う。

## 環境変数(Vercel の画面で本人が入れる。リポジトリには書かない)

| 名前 | 中身 |
|---|---|
| `ANTHROPIC_API_KEY` | この用途だけの鍵 |
| `DEMO_PASSPHRASE` | 審査の人に渡す合言葉 |
| `DEMO_DAILY_CAP`・`DEMO_PER_MINUTE` | 回数の上限(省けば既定) |
| `MEMORY_PEPPER` | 記憶の合鍵をハッシュにする時の塩(S3 が使う) |
| `KV_REST_API_URL`・`KV_REST_API_TOKEN` | Vercel の画面から Upstash をつなぐと自動で入る(`UPSTASH_REDIS_REST_URL`・`_TOKEN` でもよい) |

## 部品(npm)

公開の関数は、新しい部品を足していない(Node の標準の `fetch`・`crypto`・`Request`/`Response` だけ)。部品を足したい流れは、S6 の札に書く。

## 配り方(Vercel)

- プロジェクトの Root Directory は `web`。設定は `web/vercel.json`(組み立ては `npm ci` → `npm run build`、出力は `dist`、関数は `api/*.mjs` で 30 秒まで)。
- 画面のコードは `web/` の外(`creator/viewer/`・`characters/`)も読む。Vercel の「Include source files outside of the Root Directory in the Build Step」を切らない(2020 年 8 月 27 日より後に作ったプロジェクトは最初から入っている。Vercel の説明による)。
- Vercel は `dist` だけを配る。手元のサーバーのように `characters/` を直接は配らないので、`web/vite.config.js` が組み立ての時に `characters/<id>/` の決まった種類のファイルを `dist/characters/<id>/` へ写す(`_` で始まる試しのキャラ・隠しファイル・VRM・説明の文は写さない)。
- 環境変数は配りの前に入れる。変えた値は、次の配り(Redeploy)からだけ効く(Vercel の説明による)。
- 古い配りの URL は、Deployment Protection の Standard Protection(本番の名前以外を守る)で守る。

## 確かめた事・確かめていない事

- 確かめた: `node --test api/_test/api.test.mjs` 11 件(わざと壊すと落ちる事も)。手元の PC で `chat.mjs` の `POST` を鍵なしで 5 回呼び、仮の頭脳で 2 文返った(読み込み 10ms、呼び出し 0〜17ms。Vercel の上の時間ではない)。
- 確かめた(11/6 21:33。組み立ての出力の時刻): `node --test api/_test/build_characters.test.mjs` 2 件。`npx vite build` で `dist/characters/` に作例 5 体の 50 ファイルが入り、試しのキャラと VRM は入らない。
- 確かめていない: Vercel の上で動くか・関数の時間(本物の頭脳の待ちを含む)・Upstash へのつなぎ。鍵が入った後に 1 回だけ流して測る。
