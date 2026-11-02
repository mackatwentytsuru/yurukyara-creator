#!/bin/sh
# ブラウザの絵を、作り手以外の AI 2 つに判定させる。決まりは judge3.py の先頭。
# 使い方: sh judge_browser.sh <絵のフォルダ名> <試験のフォルダ…(例 k_beak/p3_sonnet_medium)>
ENV_SH="$0"; . "$(dirname "$0")/../env.sh"
export TRIAL_BASE DEEPSEEK_JUDGE
python "$(cygpath -m "$REPO/creator/skilltest/judge3.py")" "$@"
