#!/bin/sh
# ブラウザの絵(judgeB*/browser_cmp.png)を、DeepSeek と GLM の 2 つで判定する。
# 使い方: sh judge_browser.sh <judge フォルダ名(例 judgeB3)> <試験のフォルダ…(例 h_ear/p1_sonnet_medium)>
# DeepSeek は並べて動かせる。GLM は並べると空が返ることがあるので 1 件ずつ。出力: <フォルダ>/out.txt(DeepSeek)、out_glm.txt(GLM)
D=$1; shift
S=work/creator_work/skilltest; SW=work/creator_work/skilltest
for p in "$@"; do J=$S/$p/$D; ( cd ~; timeout 600 powershell -NoProfile -File oc_web.ps1 -Dir $J -PromptFile $J/brief.md -Out $J/out.txt >/dev/null 2>&1 ) & done; wait
for p in "$@"; do JW=$SW/$p/$D; timeout 600 powershell -NoProfile -File "$(dirname "$0")/glm_judge.ps1" -Dir $JW -PromptFile $JW/brief.md -Out $JW/out_glm.txt >/dev/null 2>&1; done
for p in "$@"; do echo "=== $p"; for j in out out_glm; do echo "[$j]"; grep -E "^\**(A|B|C)[\.\*． :：]" $S/$p/$D/$j.txt | cut -c1-90; done; done
