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

- 見出し: `content-type: application/json`。合言葉は **`x-demo-pass` の見出し**で送る(URL に入れない)。記憶の合鍵は `x-memory-key`(あれば)。
- 本文: 手元のサーバーと同じ形。`web/api/chat.mjs` は公開の決まりの点検 `sanitizePublicChatBody`(`web/server/validate.mjs`)をはっきり渡す(環境変数 `VERCEL` の有り無しに頼らない)。公開では `useShop` を必ず `false` にする。
- 順番:
  1. 本文の点検
  2. **頭脳を選ぶ**(合言葉・回数。下の「上限」)。記憶の置き場を使う前に見る(当て試しも置き場の使いすぎも、先に数える)。
  3. **記憶**(`_lib/memoryChat.mjs`。頭脳を呼ぶ前に 1 回): 置き場を使う回は、先に `/api/memory` と同じ接続元ごとの 1 分の数え(会話の上限の 3 倍)を通す。超えた回は記憶なしで話す(会話は止めない)。
     合鍵があれば S3 の `chatMemory`。「わすれて」だけの言葉なら全部消して、頭脳を呼ばずに、**その子の人格の文の言い方**で答える(`brain: "none"`。本文の `character.persona` を渡す。手元のサーバーと同じ)。ほかは覚えた事を返事の頭に `{type:"memory", added}` で並べ、覚えていることを頭脳へ渡す。
     合鍵がまだ無い人は、**覚える事(名前・好きなもの)が出た最初の回にだけ**合鍵を作り、`{type:"memory", key, added, notice, retentionDays, expiresAt}` で渡す(開いただけ・あいさつだけでは作らない。接続元ごと 1 分 10 回まで)。
  4. 本物の頭脳も仮の頭脳も `runTurn`(仮は `{ brain: 'mock', paceMs: 0 }`)。安全の決まった返事・人格の言葉(あいさつ・話し方の例・あいづち)・覚えていることが、どちらでも同じ道を通る。
- 返事(いつも 200。本文が悪い時だけ 400・413、POST 以外は 405):

```json
{ "brain": "real|fallback|none", "fallback": false, "reason": "", "notice": "", "events": [{ "type": "say", "text": "…" }], "ms": 0 }
```

- `events` は手元のサーバーが流す物と同じ形(`memory`・`meta`・`thought`・`say`・`handoff`)を、順に並べた物。
- 仮の頭脳になる理由(`reason`)と、画面に出す一言(`notice`、「おためしモードです(…)」): `no-key`(鍵なし)・`no-passphrase-set`(合言葉が決まっていない)・`weak-passphrase`(合言葉の設定が 16 字未満)・`passphrase`(無い・違う)・`passphrase-wait`(間違いが続いたので、しばらく比べない)・`per-minute`・`daily-cap`・`counter-unavailable`(数えられない時は止める方へ)・`brain-error`。**どれでも断らずに、仮の頭脳で話し続ける。**

### /api/memory

- `vercel.json` の書き換えで、`/api/memory/<下の道>` は `/api/memory?sub=<下の道>` に集まる。下の道は `''`・`new`・`pair`・`claim`・`reflect` だけ。**それ以外は置き場を使う前に 404**。
- S3 は `web/server/memory/handler.mjs` から `handleMemory(request, { store, cfg, now })` を出す。S6 は `cfg` に `maxBodyBytes` と前後を落とした合言葉を渡す。
- `pair`(番号づくり)と `claim`(番号の受け取り)は合言葉を比べるので、S3 の入口へ渡す前に、**会話と同じ当て試しの数え**を通す(無い・違う 403 `no_pass`・止めた接続元 429 `wait`)。受け取りの間違いも、会話と番号づくりの間違いと同じ数えに入る。
- `store` は `_lib/store.mjs` の置き場で、呼び方は `get(key)`・`set(key, value, { ttlSeconds })`・`del(key)`・`incr(key, { ttlSeconds })` の 4 つ。値は文字(JSON は自分で文字にする)。
- 接続元ごとの 1 分の上限(会話の 3 倍)を超えたら 429。置き場につながらなければ 503。

## 上限(お金を使いすぎない・当て試しを止める)

1. Anthropic の画面の、額の上限(本人が決めて入れる。いちばん強い守り)。
2. 本物の頭脳の回数: 1 日の全体(`DEMO_DAILY_CAP`、既定 300)と、接続元ごと 1 分(`DEMO_PER_MINUTE`、既定 10)。数は Upstash に置く。
3. **合言葉**: 16 字より短い設定では本物の頭脳を使わない。前後の空白・改行は両側で落とす。会話・番号づくり・番号の受け取りの 3 つの道で、同じ数えを使う。数えて止めるのは**間違えた回と間違えた接続元だけ**:
   - 接続元ごと: 10 分に 5 回間違えたら、その接続元は 15 分比べない(その間は正しい合言葉でも仮の頭脳・番号は 429。当たり外れを返さない)。
   - 全体: 10 分に 100 回の間違いで「強め」を 10 分(間違いが続く間は延びる)。強めの間は、1 回間違えた接続元をすぐ 15 分止める。
   - **正しい合言葉は、全体の間違いの数では止めない**(合言葉を知らない人が、全員の本物の頭脳と番号を止められないように)。合言葉を送らない回は数えない。
   - 強さの本体は合言葉の長さ(本番は 20 字以上の乱数)。数えは当て試しを遅くするための物。
4. **Vercel の上で Upstash が無い時**(Vercel が入れる `VERCEL` などの環境変数で見分ける)は、関数の中のメモリに落とさない。本物の頭脳は `counter-unavailable`、記憶は 503(台ごとに 0 から数え直すと上限が守れないため)。手元の PC と試験は前と同じく関数の中のメモリ。
5. 1 回の返事の長さ(`max_tokens` は頭脳の側で 700)と、入力の文字数(`sanitizeChatBody` の上限)。本文は 32KB まで。
6. **記憶の置き場**: `/api/memory` と `/api/chat` の記憶は、置き場を使う前に同じ接続元ごとの 1 分の数え(既定 30 回)を通す。超えたら `/api/memory` は 429、会話は記憶なしで話す。超えた回の置き場の命令は、数えの 1 つだけ(形だけ合う合鍵で何度送っても増えない)。
- 接続元は、見出しの値をそのまま保存せず、ハッシュの頭 16 字だけを数に使う。

## 画面の守り(Content-Security-Policy)

`vercel.json` で全部の道に付ける。外へ通信してよいのは、自分の鍵の声のサービス(`https://api.elevenlabs.io`)だけ。台本は自分のサイトの物だけで、wasm(顔の追従・meshopt)は許し、eval と埋め込みの台本は許さない。枠は `frame-src 'none'`・`frame-ancestors 'none'`。外の URL の `?character=`・`?place=` も読めない。
- 中身の試験: `node --test api/_test/csp.test.mjs`。
- ブラウザの試し(GPU の Chrome。手元で Vercel の形をまねる `_test/vercel_local.mjs`。本物の鍵は使わない): `npx vite build` の後に、GPU の札を取って `node api/_test/csp_browser_check.mjs <出力のフォルダ>`。3D・2D・カメラ(MediaPipe)・自分の鍵の声・記憶の札が違反 0 件で動き、外の URL のキャラと外の枠が止まる事を見る。**画面のコードを変えた合わせの後に 1 回流す**(手元のサーバーには CSP が無いので、ほかの流れの試験では気づけない)。

## 環境変数(Vercel の画面で本人が入れる。リポジトリには書かない)

**鍵と合言葉は Production だけに入れる**(Preview の配りは、合わせのたびの開発の線を動かすので、本物の鍵で動かさない)。

| 名前 | 中身 |
|---|---|
| `ANTHROPIC_API_KEY` | この用途だけの鍵(Upstash をつないで Redeploy した後に入れる) |
| `DEMO_PASSPHRASE` | 審査の人に渡す合言葉(**20 字以上の乱数**。16 字未満では本物の頭脳を使わない) |
| `DEMO_DAILY_CAP`・`DEMO_PER_MINUTE` | 回数の上限(省けば既定) |
| `MEMORY_PEPPER` | 記憶の合鍵をハッシュにする時の塩(長い乱数。S3 が使う) |
| `KV_REST_API_URL`・`KV_REST_API_TOKEN` | Vercel の画面から Upstash をつなぐと自動で入る(`UPSTASH_REDIS_REST_URL`・`_TOKEN` でもよい) |

## 部品(npm)

公開の関数は、新しい部品を足していない(Node の標準の `fetch`・`crypto`・`Request`/`Response` だけ)。部品を足したい流れは、S6 の札に書く。

## 配り方(Vercel)

- プロジェクトの Root Directory は `web`。設定は `web/vercel.json`(組み立ては `npm ci` → `npm run build`、出力は `dist`、関数は `api/*.mjs` で 30 秒まで)。
- 画面のコードは `web/` の外(`creator/viewer/`・`characters/`)も読む。Vercel の「Include source files outside of the Root Directory in the Build Step」を切らない(2020 年 8 月 27 日より後に作ったプロジェクトは最初から入っている。Vercel の説明による)。
- Vercel は `dist` だけを配る。手元のサーバーのように `characters/` を直接は配らないので、`web/vite.config.js` が組み立ての時に `characters/<id>/` の決まった種類のファイルを `dist/characters/<id>/` へ写す(`_` で始まる試しのキャラ・隠しファイル・VRM・説明の文は写さない)。
- 順番: 取り込む → `DEMO_PASSPHRASE`・`MEMORY_PEPPER`・上限を **Production** に入れて Deploy(この時は鍵なし = 仮の頭脳だけ)→ Upstash をつなぐ → **Redeploy** → `ANTHROPIC_API_KEY` を **Production** に入れる → **Redeploy**。環境変数は次の配りからだけ効く(Vercel の説明による)。Upstash より先に鍵を入れない。
- 古い配りの URL は、Deployment Protection の Standard Protection(本番の名前以外を守る)で守る。フォークからの PR の配りの守り(既定で入)は切らない。

## 確かめた事・確かめていない事

- 確かめた(11/7 S6w8、2 回目の点検 CRITsec2 の直し): `node --test api/_test/api.test.mjs` 28 件(N1: 20 か所 × 5 回の間違いの後も、正しい合言葉の会話・番号づくり・受け取りが通り、間違えた接続元は止まったまま・強めの間は 1 回で止める / N2: 受け取りの間違いが会話と同じ数えに入る / N3: 合言葉と回数を記憶の置き場より先に見る・記憶の置き場は接続元ごとの数えで止まる / 公開の「わすれて」がノリーの言い方 / 公開の点検をはっきり渡す)。直しを 1 つずつ外すと、8 か所とも少なくとも 1 件落ちる。点検役の再現の台本を直しの後の木で流すと、全体の止めの間も審査の人は `real`・番号づくり 200、受け取りの間違いが全体の数えに入り(100 → 140)、「わすれて」500 回の置き場の命令は 2000 → 620。
- 確かめた(11/7 S6w7): `node --test api/_test/api.test.mjs` 21 件(仮の頭脳が人格で話す・安全の決まった返事・記憶 → 番号 → 別の端末 → わすれて・合鍵は最初に覚える時・合言葉の間違いの数え・短い合言葉・前後の空白・Upstash 無しの Vercel)。直しを 1 つずつ外すと、どれも少なくとも 1 件落ちる(10 か所)。`api/_test/csp.test.mjs` 5 件。
- 確かめた(11/7 S6w7、RTX 5090 の Chrome): `csp_browser_check.mjs` で 3D のノリー(仮の頭脳が「はじめまして! ノリーと申しマス。」)・2D・カメラ(MediaPipe の wasm とモデル 200)・自分の鍵の声(声のサービスへの通信が止まらない。偽の鍵と偽の無音)・記憶の札(3 件)が違反 0 件、外の URL のキャラ(connect-src)と外の枠(frame-src)は止まり、外への通信 0。わざと `'wasm-unsafe-eval'` と声のサービスを外した CSP では 6 つとも NG。
- 確かめた(11/6 21:33): `node --test api/_test/build_characters.test.mjs` 2 件。`npx vite build` で `dist/characters/` に作例が入り、試しのキャラと VRM は入らない。
- 確かめていない: Vercel の上で動くか・関数の時間(本物の頭脳の待ちを含む)・Upstash へのつなぎ・Vercel が `VERCEL` の環境変数を関数に入れているか(入らないと、Upstash 無しの守りが効かない。本番で 1 回 `reason` を見る)。鍵が入った後に 1 回だけ流して測る。
