# Claude Code 中継

アプリの頭脳(会話)と絵を描く道の呼び出し(`POST /v1/messages`)を受けて、使う人自身の Claude Code(`claude -p`)で答える小さな中継です。ふつうは `web` のフォルダで `npm run start:claude-code` が起こします。

- この PC の中(127.0.0.1)だけで待ちます。合図(`x-api-key`)は起こすたびに作る使い捨ての値で、鍵ではありません。
- 受けるのは、アプリが送る形(会話 = 流れる・絵の道 = 絵つき)だけ。道具・MCP・知らない項目・ほかのモデルは断ります。
- `claude` には、道具なし(`--tools ""`)・MCP なし・設定を読まない(`--safe-mode`)で渡します。`ANTHROPIC*`・鍵・トークンの類は子に渡しません。
- 1 回に 1 つだけ動かし、時間の上限があります。1 日の回数の上限(既定 300・`RELAY_DAILY_CAP`)を超えたら断ります。話した内容は記録しません。
- 試験: `node --test web/test/cc_relay.test.mjs web/test/cc_start.test.mjs`(偽の `claude` を使います)。
