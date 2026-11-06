# 記憶の API(契約 K4・版 1・持ち主 S3)

端末をまたぐ記憶。アカウントを作らせず、長い乱数の「合鍵」だけで読み書きする。合鍵は **ヘッダー `x-memory-key`** で送る(URL に入れない。サーバーの記録にも書かない)。

| 入口 | 送る物 | 返る物 | 失敗 |
|---|---|---|---|
| `POST /api/memory/new` | なし | `{key, items:[], notice, retentionDays:7, expiresAt}` | 429(作りすぎ。1 分 10 回・1 日 2000 回) |
| `GET /api/memory` | `x-memory-key` | `{items:[{id,kind,text,at}], notice, retentionDays, expiresAt}` | 401(形が違う)・404(無い・7 日たった) |
| `DELETE /api/memory` | `x-memory-key`、本文 `{}` | `{ok, forgotten}`(全部消す。その合鍵の番号も取り消す) | 401 |
| `DELETE /api/memory` | `x-memory-key`、本文 `{id}` | `{ok, removed}`(1 つだけ消す) | 401・404 |
| `POST /api/memory/pair` | `x-memory-key`、合言葉(公開は `x-demo-pass`、手元は `x-app-pass`) | `{code:"123456", expiresAt, ttlSec:600}` | 401・403(合言葉が無い・違う)・404 |
| `POST /api/memory/claim` | 本文 `{code}` | `{key, items, notice, ...}` | 400(違う・切れた・使用済み)・429(5 回間違えた。10 分止める) |
| `POST /api/memory/reflect` | `x-memory-key`、本文 `{text}` | `{added:[...]}` | 401・404 |
| `POST /api/chat` | 今までの本文+`x-memory-key`(任意) | 今までの流れ+`{type:"memory", added}` / `{type:"memory", forgotten}` | — |

## 番号の決まり
- 6 けたの数字。**10 分で切れる・1 回しか使えない**。新しく出すと前の番号は使えない。「わすれて」で番号も消える。
- 同じ接続元が **5 回間違えたら 10 分止める**(正しい番号でも)。全部の接続元で合わせて 10 分に 30 回間違えたら、今ある番号を全部取り消す(総当たりの守り。記憶の中身は 43 字の合鍵で守る)。
- **合言葉が無いときは作らない**: `APP_PASSPHRASE` があれば、合う時だけ作る。無いときは、この端末だけで待ち受けている時(`HOST` が 127.0.0.1 など)だけ作る。

## 記憶の決まり
- 記憶は **最後に使ってから 7 日** で記録ごと消える。1 つずつの事も、書いてから 7 日で消える。画面に `notice` を出す。
- 覚えるのは決まった形の言葉だけ(名前・好きなもの・前の話)。つらい話・安全の層が受けた話は覚えない(`reflect.mjs`)。
- 会話で「わすれて」(それだけの言葉)と言うと、全部消える。
- サーバーには合鍵を置かない。保存の名前は `sha256(MEMORY_PEPPER + ":" + 合鍵)`。
- 保存先は差し替えられる(`store.mjs` の backend: `get/set/del`)。手元のサーバーの既定はファイル(`MEMORY_DIR`、既定 `web/logs/memory`)で、番号は 1 つの処理の中に持つ。公開の関数は下の `kv.mjs` で、番号も置き場に置く。

## 公開の関数(契約 K5。版 1・11-06 夜)
- `web/server/memory/handler.mjs` の `handleMemory(request, { store, cfg, now })`(標準の Request → Response)。S6 の `web/api/memory.mjs` が読む。`store` は K5 の置き場(`get`・`set(期限)`・`del`・`incr(期限)`、値は文字)。
- 下の道は `?sub=`(`vercel.json` の書き換え)を先に、無ければ道の名前から読む。入口と返事の形は上の表と同じ。合鍵を作るのは接続元ごと 1 分 10 回・全体で 1 日 2000 回まで(429)。
- 設定は `cfg` を先に、無ければ環境変数: 塩 `MEMORY_PEPPER`、番号の合言葉 `DEMO_PASSPHRASE`(会話と同じ。見出しは `x-demo-pass`、古い `x-app-pass` も受ける)。**合言葉が無い設定では番号を作らない**(403)。
- 置き場の中身(`kv.mjs`): 記録 `ycm:r:<sha256(塩:合鍵)>`(7 日の期限。使うたびに延びる)、番号 `ycm:c:<番号のハッシュ>`(10 分。合鍵は「番号と塩」から作った鍵で AES-256-GCM の暗号にして置く)、1 回だけ使える印 `ycm:u:`(INCR の 1 回目だけ通す)、間違いの数 `ycm:f:`・止める印 `ycm:l:`(5 回で 10 分)、全体の間違い `ycm:g:<10 分の枠>`(30 回で世代 `ycm:gen` を上げ、今ある番号を全部取り消す)。**合鍵そのものは、どこにも置かない。**
- 置き場が使えないときは 503(中身は返事に出さない)。console に何も書かない。
- 会話の手伝い `chatMemory(request, text, { store, cfg, now })`: 公開の `/api/chat` が頭脳を呼ぶ前に 1 回呼ぶ。合鍵が無ければ何もしない。「わすれて」なら全部消して返事のイベントまで返す(`handled: true`、頭脳は呼ばない)。それ以外は `{ memory, learned, events }` を返すので、`runTurn(body, { memory, learned, ... })` に渡し、`events`(`{type:"memory", added}`)を返事の前に並べる。置き場が使えないときは、記憶なしで話を続ける。
- 試験: `web/test/memory_handler.test.mjs`(13 件。S6 の `handleMemoryRoute` から呼べることも)。

## 画面の部品
- `web/src/ui/memoryKey.js`: `getKey / setKey / clearKey / memoryHeaders / ensureKey / listMemory / forgetItem / forgetAll / pairCode / claimCode`
- `web/src/ui/memoryPanel.js`: `mountMemoryPanel(parent, {askPass}) → {root, ready, refresh, onChatEvent}`。S5 が `main.js` に 1 行で付ける。会話のイベントを `onChatEvent` に渡すと、一覧を読み直す。
- `web/src/conversation/brainClient.js` は、合鍵があれば `/api/chat` に付けて送る。

## 試験
- `web/test/memory.test.mjs`(本体)・`web/test/memory_browser.test.mjs`(画面なしの Chrome。タブ A → 番号 → タブ B で続き → 1 つ消す → 全部わすれる → 番号の使い回し不可 → 合鍵が記録に無い)。仮の頭脳で、本物の API は呼ばない。
