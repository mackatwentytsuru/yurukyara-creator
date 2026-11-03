#!/bin/sh
# ブラウザの絵を、作り手以外の目で判定する。決まりと判定役の設定は creator/pipeline/j01_judge.py。
# 使い方: sh judge_browser.sh <絵のフォルダ名> <試験のフォルダ…(例 k_beak/p3_sonnet_medium)>
ENV_SH="$0"; . "$(dirname "$0")/../env.sh"
export TRIAL_BASE
"$PY" "$(cygpath -m "$REPO/creator/skilltest/judge3.py")" "$@"
