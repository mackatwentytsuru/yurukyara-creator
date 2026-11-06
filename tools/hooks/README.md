# フック(登録は本人の OK 済み。`.claude/settings.json` への登録は合わせ係が置く)

Claude Code のフックとして使う見張りです。中身と試験はここにあります。

| フック | いつ | 何を止めるか |
|---|---|---|
| `stage-gate.mjs` | 人が `/yc-<N>-…` と打った時(UserPromptSubmit)。段のスキルを Claude が呼ぶ時(PreToolUse の Skill)にも使えるが、`tool_input` の項目の名前を確かめるまでは登録しない | 前の段の記録 `creator/work/<id>/review/<N-1>.json` の `decision` が `ok` か `auto` でない時(契約 K3 の `can-start` と同じ決まり)。毎回止める。人が無人の通しと決めた時だけ `YC_AUTOPILOT=1` で飛ばす |
| `check-secrets.mjs` | `git commit` の直前と、Write・Edit・MultiEdit の直前 | 鍵らしい文字列・`.env`・鍵や証明書のファイル・VRM・入れない語(`PREPUSH_TERMS` か `tools/prepush_terms.local.txt`)。Write・Edit・MultiEdit は、**書く先がリポジトリ(`CLAUDE_PROJECT_DIR`)の中の時だけ**見る。外(作業の板・メモなど)は記録に入らないので見ない。今の `.claude/hooks/check-secrets.mjs`(commit の直前だけ)を広げた版 |

- 「中」の決め方: 相対のパスはフックの入力の `cwd`(無ければリポジトリの根)から見る。大文字と小文字・区切りの違いは区別しない(Windows)。字面の場所と、つなぎ(junction)やリンクを解いた本当の場所の、どちらかが中なら中。書く先が分からない時も中(迷う時は見張る側に倒す)。`..` で外へ出る道や、名前の頭が同じ隣のフォルダ(`<根>-x`)は外。
- 語の一覧の形(Python の `tools/terms.py` と同じ): 1 行 1 つ、`#` は注。既定は大文字と小文字を区別しない文字そのもの。`cs:` は区別する文字そのもの、`re:` は区別する正規表現、`rei:` は区別しない正規表現。正規表現として読めない行があれば、一覧を直すまで中のファイルを止める。
- 止めた時は、理由を出して終了コード 2。止めた事を `creator/work/_hooks/blocked.jsonl` に 1 行ずつ残す(契約 K6。`tools/metrics.py --hook-log` で数える)。
- 試験: `node --test tools/hooks/test/hooks.test.mjs`(26 件)。わざと壊す試験: `node tools/hooks/test/mutation.mjs`(19 通りに壊して、全部で試験が落ちる事を確かめる)。

## 登録する形(`.claude/settings.json` の全体。合わせ係が命令で置く)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/hooks/check-secrets.mjs\"", "timeout": 30 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/hooks/stage-gate.mjs\"", "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/run-web-tests.mjs\"", "timeout": 90 }
        ]
      }
    ]
  }
}
```

- 今の `check-secrets` の登録(Bash だけ、`.claude/hooks/check-secrets.mjs`)は、この形に置き換える。古いファイルは `web/scripts/guard-check.mjs` が読んでいるので、すぐには消さない。`run-web-tests` はそのまま。
- `stage-gate` は今は UserPromptSubmit だけ。PreToolUse の Skill に足すのは、段のスキルを Claude が呼ぶ時の `tool_input` の項目の名前(`skill`・`args`。違う時のために `name` も読む)を 1 回確かめてから。
- 登録した後に 1 回ずつ確かめる: ① リポジトリの中に鍵の形の文字列を書こうとして止まる ② 板(リポジトリの外)には書ける ③ OK の無い段を `/yc-<N>-…` で打って止まる。
