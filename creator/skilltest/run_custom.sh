#!/bin/sh
# brief を自分で用意した試験を、API の枠で回す。
# 使い方: sh run_custom.sh <作業フォルダ(絶対パス)> <brief.md> <モデル> <effort> [上限ドル]
WORK=$1; BRIEF=$2; MODEL=$3; EFFORT=$4; BUDGET=${5:-10}
ENV_SH="$0"; . "$(dirname "$0")/../env.sh"
BASE=$TRIAL_BASE
mkdir -p "$WORK" "$BASE/empty_cfg"
cp "$BRIEF" "$WORK/brief.md"
cd "$WORK"
START=$(date +%s)
timeout 3300 env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -u CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CONFIG_DIR="$BASE/empty_cfg" ANTHROPIC_API_KEY="$CLAUDE_CREDIT_API_KEY" \
  claude -p "$(cat brief.md)" --model "$MODEL" --effort "$EFFORT" --output-format json --max-budget-usd "$BUDGET" \
  --allowedTools "Read Write Edit Bash Glob Grep" --add-dir "$REPO" --add-dir "$WORK" ${EXTRA_DIRS:+--add-dir "$EXTRA_DIRS"} > result.json 2> stderr.txt
echo "exit=$? seconds=$(( $(date +%s) - START ))" > done.txt
