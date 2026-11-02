#!/bin/sh
# シミュレーターの 3 カットを撮る。
# 使い方: render_sim.sh <映像 mp4> <音 wav> <出力フォルダ> [--range 始め秒 終わり秒] [--cams 1 2 3]
exec python "$(dirname "$0")/render_sim.py" "$@"
