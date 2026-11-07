# 記憶の API(契約 K4・版 1・持ち主 S3。11-07 に欄を足した: 公開の受け取りの合言葉・persona・via / 第 8 波: 合鍵は会話の返事で渡す・画面は合鍵を作らない・PASS_SUBS)

端末をまたぐ記憶。アカウントを作らせず、長い乱数の「合鍵」だけで読み書きする。合鍵は **ヘッダー `x-memory-key`** で送る(URL に入れない。サーバーの記録にも書かない)。

| 入口 | 送る物 | 返る物 | 失敗 |
|---|---|---|---|
| `POST /api/memory/new` | なし | `{key, items:[], notice, retentionDays:7, expiresAt}`。**画面の札はもう呼ばない**(11-07 CRITsec F8。道具と試験の口として残す) | 429(作りすぎ。1 分 10 回・1 日 2000 回) |
| `GET /api/memory` | `x-memory-key` | `{items:[{id,kind,text,at}], notice, retentionDays, expiresAt}` | 401(形が違う)・404(無い・7 日たった) |
| `DELETE /api/memory` | `x-memory-key`、本文 `{}` | `{ok, forgotten}`(全部消す。その合鍵の番号も取り消す) | 401 |
| `DELETE /api/memory` | `x-memory-key`、本文 `{id}` | `{ok, removed}`(1 つだけ消す) | 401・404 |
| `POST /api/memory/pair` | `x-memory-key`、合言葉(公開は `x-demo-pass`、手元は `x-app-pass`) | `{code:"123456", expiresAt, ttlSec:600}` | 401・403(合言葉が無い・違う)・404 |
| `POST /api/memory/claim` | 本文 `{code}`。**公開の関数では合言葉 `x-demo-pass` も**(11-07 F9。手元のサーバーは見ない) | `{key, items, notice, ...}` | 400(違う・切れた・使用済み)・403(公開で合言葉が無い・違う)・429(5 回間違えた。10 分止める / 公開で合言葉を 1 分に 5 回間違えた) |
| `POST /api/memory/reflect` | `x-memory-key`、本文 `{text}` | `{added:[...]}` | 401・404 |
| `POST /api/chat` | 今までの本文+`x-memory-key`(任意) | 今までの流れ+`{type:"memory", added}` / `{type:"memory", forgotten, via:"chat"}`(会話の「わすれて」で消した印。画面の札は、この印の時だけ番号と古い知らせを消す)。**合鍵が無い回は、覚える事が出た最初の回にだけ合鍵を作り** `{type:"memory", key, added, notice, retentionDays, expiresAt}` で渡す(手元のサーバーと公開の関数で同じ。作る回数は `/new` と同じ 1 つの接続元で 1 分 10 回、超えたら覚えずに話す。あいさつだけでは作らない。11-07 F8) | — |

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
- 設定は `cfg` を先に、無ければ環境変数: 塩 `MEMORY_PEPPER`、番号の合言葉 `DEMO_PASSPHRASE`(会話と同じ。見出しは `x-demo-pass`、古い `x-app-pass` も受ける。前後の空白は外して比べる)。**合言葉が無い設定では番号を作らない・受け取らない**(403)。
- **番号の受け取り(`claim`)にも合言葉が要る**(11-07 CRITsec F9。審査の人は持っている)。合言葉を持たない人の当て試しは番号を試す所まで届かないので、全体の取り消し(下の `ycm:g:`)を起こせない。同じ接続元が合言葉を **1 分に 5 回** 間違えたら、作る・受け取るとも比べずに 429(`reason: "pass_limited"`。数は `ycm:pf:<接続元>:<分>`)。
- 合言葉を比べる下の道の一覧 `PASS_SUBS`(`handler.mjs` が出す。今は `['pair', 'claim']`、凍らせた配列)。返事で合言葉の当たり外れが分かる道なので、**公開の入口はこの全部を、会話と同じ間違いの数え(`web/api/_lib/gate.mjs` の `checkPassphrase`)に通す**(CRITsec2 N2。受け取りが数えの外だと、全体の止めの間も当て試しが続けられた)。入口の条件は `PASS_SUBS.includes(sub)` にすると、道が増えても漏れない。
- 置き場の中身(`kv.mjs`): 記録 `ycm:r:<sha256(塩:合鍵)>`(7 日の期限。使うたびに延びる)、番号 `ycm:c:<番号のハッシュ>`(10 分。合鍵は「番号と塩」から作った鍵で AES-256-GCM の暗号にして置く)、1 回だけ使える印 `ycm:u:`(INCR の 1 回目だけ通す)、間違いの数 `ycm:f:`・止める印 `ycm:l:`(5 回で 10 分)、全体の間違い `ycm:g:<10 分の枠>`(30 回で世代 `ycm:gen` を上げ、今ある番号を全部取り消す)。**合鍵そのものは、どこにも置かない。**
- 置き場が使えないときは 503(中身は返事に出さない)。console に何も書かない。
- 会話の手伝い `chatMemory(request, text, { store, cfg, now, persona })`: 公開の `/api/chat` が頭脳を呼ぶ前に 1 回呼ぶ。`persona`(人格の文)を渡すと、「わすれて」の返事がその子の言葉になる(人格の「## 覚えている時の言い方」)。合鍵が無ければ何もしない。「わすれて」なら全部消して返事のイベントまで返す(`handled: true`、頭脳は呼ばない)。それ以外は `{ memory, learned, events }` を返すので、`runTurn(body, { memory, learned, ... })` に渡し、`events`(`{type:"memory", added}`)を返事の前に並べる。置き場が使えないときは、記憶なしで話を続ける。
- 仮の頭脳(合言葉なし・上限・頭脳の失敗)も同じ形: `runTurn(body, { onEvent, brain: "mock", paceMs: 0, memory, learned })`。`mockReply` を直接呼ぶ道は人格と記憶を使わない(試験 `web/test/brain_memory_voice.test.mjs` がこの形を通す)。
- 本文の点検は `sanitizePublicChatBody`(`web/server/validate.mjs`。引数 1 つ)を `sanitize` に渡す。履歴の返事は画面が送る形(1 行 1 つの say の JSON・4 行まで・1 文 60 字まで・合わせて 600 字まで)だけ受ける(11-07 CRITsec F7)。Vercel の上では `sanitizeChatBody` も既定でこの決まり(環境変数 `VERCEL`)。
- 試験: `web/test/memory_handler.test.mjs`(17 件。S6 の `handleMemoryRoute` から呼べることも。受け取りの合言葉と間違いの数え)。

## 画面の部品
- **画面は合鍵を作らない**(11-07 CRITsec F8): 開いただけ・全部わすれた後・会話の「わすれて」の後は、合鍵なしのまま(`/api/memory/new` を呼ばない。他人が 1 日の上限を使い切っても、審査の人の記憶は止まらない)。合鍵は、会話で覚える事が出た最初の回の `{type:"memory", key}` か、番号の受け取りで持つ。
- `web/src/ui/memoryKey.js`: `getKey / setKey / clearKey / memoryHeaders / loadMemory / adoptKey / emptyMemory / NOTHING_TO_PAIR / ensureKey / listMemory / forgetItem / forgetAll / pairCode / claimCode(code, {pass})`。
  - `loadMemory()`: 合鍵があれば一覧を読む。無ければ聞かずに空の一覧(`notice` つき)。404・401 なら合鍵を捨てて空(作り直さない)。`adoptKey(key)`: 会話のイベントの合鍵を持つ(形が違えば持たない。もう合鍵を持っていれば上書きしない: 合鍵なしで送った回の返事が、番号で受け取った後に届いても、受け取った合鍵のまま)。
  - `pairCode()` は合鍵が無ければ通信せずに `NOTHING_TO_PAIR`(先に話しかけてね)で断る。`forgetAll()` は合鍵が無ければ通信しない。`ensureKey()` は道具と試しの口(札は呼ばない)。
  - 番号を作る時も受け取る時も、合言葉は札の欄の値か会話の合言葉(`demoPass.js`)を `x-demo-pass` で送る。
- `web/src/ui/memoryPanel.js`: `mountMemoryPanel(parent, {askPass}) → {root, ready, refresh, onChatEvent, resync}`。S5 が `main.js` に 1 行で付ける。会話のイベントを `onChatEvent` に渡すと、`key` があれば持ってから一覧を読み直す。`via:"chat"` の「わすれた」と「全部わすれる」では、**知らせと同じ時に一覧を空にし**、出していた番号と「受け取りました」などの知らせも消す(消す前に始めた読み直しが遅れて届いても描き直さない)。引き出しを開いた時の読み直しは `resync()`(今の `{type:"memory", forgotten:true}` の形でも同じ。番号と知らせは消さない。合鍵が消えていたら捨てて空)。
- 知らせの文は `web/src/conversation/memoryNotice.js` の `MEMORY_NOTICE`(画面とサーバーで同じ。合鍵が無い時も札に出す)。
- `web/src/conversation/brainClient.js` は、合鍵があれば `/api/chat` に付けて送る。

## 試験
- `web/test/memory.test.mjs`(本体)・`web/test/memory_browser.test.mjs`(画面なしの Chrome。開いただけでは合鍵なし → タブ A で覚えた回に合鍵を受け取る → 番号 → タブ B で続き → 1 つ消す → 全部わすれる(知らせの時に一覧は 0 件・合鍵を作り直さない)→ 番号の使い回し不可 → どの画面も `/api/memory/new` を呼ばない → 合鍵が記録に無い。手元のサーバーの「最初に覚えた回に合鍵」と 1 分 10 回の上限も)・`web/test/memory_panel_dom.test.mjs`(偽の DOM と遅い偽の通信で札の順)。仮の頭脳で、本物の API は呼ばない。

## UW3(11-08)の足し
- 覚える種類に age(「年: 7さい」。name と同じく 1 つだけ)。
- 覚えた時のイベントは { type:"memory", added, fresh, kinds }(reflect.mjs の memoryAddedEvent)。画面は fresh: true で新しい札を光らせる。
- 住所・電話・メール・学校の名前・本名を含む言葉は覚えない(safety.mjs の looksPersonal / personalWarn)。
