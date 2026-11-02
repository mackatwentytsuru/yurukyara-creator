#!/bin/sh
# ステージを組み直してから撮る。  使い方: build_then_render.sh <シーケンス名>...
HERE="$(dirname "$0")"
sh "$HERE/ue_py.sh" "$HERE/../ue/build_stage.py" work/ue_show/logs/build.log || exit $?
sh "$HERE/render_cut.sh" "$@"
