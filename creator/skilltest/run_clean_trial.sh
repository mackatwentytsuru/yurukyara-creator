#!/bin/sh
# 使う人と同じ状態で試す: コミット済みの物だけを新しく写し、手元の設定なしで、Claude Code に「この絵を話すキャラにして」とだけ頼む。
# 使い方: sh run_clean_trial.sh <段の名前> <モデル> <effort> <入力の絵> [上限ドル]
# - 作業フォルダ: $TRIAL_BASE/<絵のフォルダ名>/<段の名前>/ 。写しは その下の repo/
# - 途中の様子は log.jsonl(1 行 1 出来事。早回しの素材と、人の手の数を数えるのに使う)。終わりは result.json・done.txt
# - 判定役は既定(新しい文脈の Claude)。頼みの文に答えは書かない。聞けないので、既定で進めて報告するように頼む
STAGE=$1; MODEL=$2; EFFORT=$3; IMAGE=$4; BUDGET=${5:-10}
ENV_SH="$0"; . "$(dirname "$0")/../env.sh"
CHAR=$(basename "$(dirname "$IMAGE")")
WORK=$TRIAL_BASE/$CHAR/$STAGE
[ -e "$WORK/repo" ] && { echo "もうあります: $WORK/repo"; exit 2; }
mkdir -p "$WORK" "$TRIAL_BASE/empty_cfg"
git clone -q "$REPO" "$WORK/repo" || exit 2
I_WIN=$(cygpath -m "$IMAGE")
PROMPT="この絵を、おうちで家族と話すキャラにしてください。絵: $I_WIN 。絵の権利は私が持っています。途中で質問には答えられないので、聞きたいことは既定で決めて進め、最後の報告に書いてください。id は ${CHAR}_trial にしてください。"
echo "$PROMPT" > "$WORK/prompt.txt"
# 鍵は環境変数の名前で選ぶ。値は表示も記録もしない
KEY_VAR=${TRIAL_KEY_VAR:-CLAUDE_CREDIT_API_KEY}
TRIAL_KEY=$(printenv "$KEY_VAR")
[ -n "$TRIAL_KEY" ] || TRIAL_KEY=$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('$KEY_VAR','User')" | tr -d '\r')
[ -n "$TRIAL_KEY" ] || { echo "鍵がない: $KEY_VAR"; exit 2; }
cd "$WORK/repo" || exit 2
START=$(date +%s)
# 手元の道具の設定を受け継がない(本当に doctor が見つけられるかを試す)
timeout 3300 env -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -u CLAUDE_CODE_OAUTH_TOKEN \
  -u BLENDER -u PY -u TRIAL_BASE -u CHROME_PATH -u ELEVENLABS_API_KEY \
  CLAUDE_CONFIG_DIR="$TRIAL_BASE/empty_cfg" ANTHROPIC_API_KEY="$TRIAL_KEY" \
  claude -p "$PROMPT" --model "$MODEL" --effort "$EFFORT" --output-format stream-json --verbose --max-budget-usd "$BUDGET" \
  --allowedTools "Read Write Edit Bash Glob Grep Skill" > "$WORK/log.jsonl" 2> "$WORK/stderr.txt"
RC=$?
grep '"type":"result"' "$WORK/log.jsonl" | tail -1 > "$WORK/result.json"
echo "exit=$RC seconds=$(( $(date +%s) - START ))" > "$WORK/done.txt"
