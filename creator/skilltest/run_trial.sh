#!/bin/sh
# スキルだけで 1 体作る試験を、API の枠(クレジット)で回す。
# 使い方: sh run_trial.sh <段の名前 例 opus_xhigh> <モデル> <effort> <入力の絵> [上限ドル]
# - 作業フォルダ: $TRIAL_BASE/<キャラ>/<段の名前>/ (creator/env.sh)
# - 設定フォルダは空(デスクトップの印を消し、鍵は環境変数 CLAUDE_CREDIT_API_KEY から。値は表示しない)
# - 出力: <作業フォルダ>\result.json(JSON: result・total_cost_usd・usage・duration_ms)
STAGE=$1; MODEL=$2; EFFORT=$3; IMAGE=$4; BUDGET=${5:-10}
ENV_SH="$0"; . "$(dirname "$0")/../env.sh"
BASE=$TRIAL_BASE
CHAR=$(basename "$(dirname "$IMAGE")")
WORK=$BASE/$CHAR/$STAGE
mkdir -p "$WORK" "$BASE/empty_cfg"
HERE=$(cd "$(dirname "$0")" && pwd)
W_WIN=$(cygpath -m "$WORK"); I_WIN=$(cygpath -m "$IMAGE"); R_WIN=$(cygpath -m "$REPO"); B_WIN=$(cygpath -m "$BASE")
sed -e "s|{IMAGE}|$I_WIN|g" -e "s|{WORK}|$W_WIN|g" -e "s|{REPO}|$R_WIN|g" -e "s|{BASE}|$B_WIN|g" -e "s|{BLENDER}|$BLENDER|g" -e "s|{PY}|$PY|g" "$HERE/brief_template.md" > "$WORK/brief.md"
cd "$WORK"
START=$(date +%s)
timeout 3300 env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -u CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CONFIG_DIR="$BASE/empty_cfg" ANTHROPIC_API_KEY="$CLAUDE_CREDIT_API_KEY" \
  claude -p "$(cat brief.md)" --model "$MODEL" --effort "$EFFORT" --output-format json --max-budget-usd "$BUDGET" \
  --allowedTools "Read Write Edit Bash Glob Grep" --add-dir "$REPO" --add-dir "$BASE" > result.json 2> stderr.txt
echo "exit=$? seconds=$(( $(date +%s) - START ))" > done.txt
