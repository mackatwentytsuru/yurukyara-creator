# フック(まだ登録していない。登録は本人の OK の後)

Claude Code のフックとして使う見張りです。中身と試験はここにあり、`.claude/settings.json` にはまだ書いていません。

| フック | いつ | 何を止めるか |
|---|---|---|
| `stage-gate.mjs` | 段のスキル(`yc-<N>-…`)を呼ぶ前・人が `/yc-<N>-…` と打った時 | 前の段の記録 `creator/work/<id>/review/<N-1>.json` の `decision` が `ok` か `auto` でない時(契約 K3 の `can-start` と同じ決まり)。毎回止める。人が無人の通しと決めた時だけ `YC_AUTOPILOT=1` で飛ばす |
| `check-secrets.mjs` | `git commit` の直前と、Write・Edit・MultiEdit の直前 | 鍵らしい文字列・`.env`・鍵や証明書のファイル・VRM・入れない語(`PREPUSH_TERMS` か `tools/prepush_terms.local.txt`)。今の `.claude/hooks/check-secrets.mjs`(commit の直前だけ)を広げた版 |

- 止めた時は、理由を出して終了コード 2。止めた事を `creator/work/_hooks/blocked.jsonl` に 1 行ずつ残す(契約 K6。`tools/metrics.py --hook-log` で数える)。
- 試験: `node --test tools/hooks/test/hooks.test.mjs`(17 件)。わざと壊す試験: `node tools/hooks/test/mutation.mjs`(13 通りに壊して、全部で試験が落ちる事を確かめる)。

## 登録の案(本人の OK が出たら、`.claude/settings.json` をこの形にする)

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/hooks/check-secrets.mjs\"", "timeout": 30 }] },
      { "matcher": "Skill", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/hooks/stage-gate.mjs\"", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/hooks/stage-gate.mjs\"", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/run-web-tests.mjs\"", "timeout": 90 }] }
    ]
  }
}
```

- 今の `check-secrets` の登録(Bash だけ)は、この案に置き換える。`run-web-tests` はそのまま(合わせの前だけにする案は別に聞く)。
- 確かめていない事: 段のスキルを Claude が呼ぶ時の `tool_input` の項目の名前(`skill`・`args` を読む。違う時のために `name` も見る)。登録した後に 1 回、わざと OK の無い段を呼んで止まるかを見る。
