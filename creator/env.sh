# 道具の場所をまとめる。手元ごとの値は creator/env.local.sh に書く(リポジトリに入れない)。何も書かなければ、PATH の道具を使う。
#   BLENDER         Blender の実行ファイル(5.2 以降)
#   PY              PIL と numpy の入った Python
#   TRIAL_BASE      試験の作業フォルダの親
#   DEEPSEEK_JUDGE  判定 1 つ目の呼び出し(-Dir・-PromptFile・-Out を取る PowerShell のスクリプト)
#   CHROME_PATH     Chrome の実行ファイル(省略すると、入っている Chrome を探す)
# 使い方: ENV_SH="$0"; . "<このファイル>"   → REPO・BLENDER・PY・TRIAL_BASE が決まる
ENV_DIR=$(cd "$(dirname "${ENV_SH:-$0}")" && pwd)
while [ ! -d "$ENV_DIR/creator" ] && [ "$ENV_DIR" != "/" ]; do ENV_DIR=$(dirname "$ENV_DIR"); done
REPO=$ENV_DIR
[ -f "$REPO/creator/env.local.sh" ] && . "$REPO/creator/env.local.sh"
BLENDER=${BLENDER:-blender}
PY=${PY:-python}
TRIAL_BASE=${TRIAL_BASE:-$REPO/_trials}
