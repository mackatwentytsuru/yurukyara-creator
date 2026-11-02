#!/usr/bin/env bash
# ゆるキャラのショーの全編を 1 回で作る: 音 → 映像(master)→ 書き出し → 確かめ → 持ち物へ写す。
# 使い方: build_yuru.sh <曲 wav> <歌い出しの秒> <キャラのフォルダ> [持ち物の置き場]
# 環境変数:
#   YURU_REUSE_AUDIO=1  できている timeline.json と yuru_mix.wav を使う
#   YURU_FROM=<コマ>     映像を途中のコマから続ける
#   SHOW_BUILD_ROOT      出力の置き場(既定 work/ue_show/show_build)
#   SHOW_LOCK="python <札の道具>"  重い処理を札で包む命令。空なら札なしで動かす
#   SHOW_WHO             札に書く名前
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${SHOW_BUILD_ROOT:-work/ue_show/show_build}/yuru"
BASH_EXE="${SHOW_BASH:-C:/Program Files/Git/bin/bash.exe}"
LOCK_TOOL="${SHOW_LOCK:-}"
WHO="${SHOW_WHO:-show}"
NAME=yuru

fail() { echo "失敗: $*" >&2; exit 1; }

locked() {
  local kind="$1" minutes="$2" job="$3"
  shift 4
  if [ -z "$LOCK_TOOL" ]; then
    "$@"
  else
    $LOCK_TOOL run --machine pc1 --kind "$kind" --who "$WHO" --job "$job" --minutes "$minutes" --wait 60 --no-table -- "$@"
  fi
}

[ "$#" -ge 3 ] || fail "使い方: build_yuru.sh <曲 wav> <歌い出しの秒> <キャラのフォルダ> [持ち物の置き場]"
SONG="$1"; UNTIL="$2"; CHARS="$3"; DEST="${4:-}"
AUDIO_DIR="$ROOT/audio"
VIDEO_DIR="$ROOT/video"
TIMELINE="$AUDIO_DIR/timeline.json"
MIX="$AUDIO_DIR/yuru_mix.wav"
mkdir -p "$VIDEO_DIR"

if [ "${YURU_REUSE_AUDIO:-0}" != "1" ]; then
  echo "== 音"
  python "$REPO/show/audio/make_yuru_audio.py" --song "$SONG" --until "$UNTIL" --script "$REPO/show/show_script.json" --out "$AUDIO_DIR"
fi
[ -f "$TIMELINE" ] || fail "timeline がありません: $TIMELINE"
[ -f "$MIX" ] || fail "音がありません: $MIX"

echo "== 映像"
RENDER_ARGS=(--timeline "$TIMELINE" --chars-dir "$CHARS" --out "$VIDEO_DIR")
[ -n "${YURU_FROM:-}" ] && RENDER_ARGS+=(--from "$YURU_FROM")
locked gpu 30 "ゆるキャラのショーの全編の映像" -- node "$REPO/show/led_browser/render_yuru.mjs" "${RENDER_ARGS[@]}"

echo "== 書き出し"
locked render 15 "ゆるキャラのショーの書き出し" -- "$BASH_EXE" "$REPO/show/run/encode_led.sh" "$VIDEO_DIR/master.mov" "$MIX" "$VIDEO_DIR" "$NAME"

echo "== 確かめ"
CHECK_STATUS=0
python "$REPO/show/check/check_yuru.py" --video-dir "$VIDEO_DIR" --timeline "$TIMELINE" --cast "$REPO/show/yuru_cast.json" --name "$NAME" || CHECK_STATUS=$?

if [ -n "$DEST" ]; then
  mkdir -p "$DEST"
  cp -f "$VIDEO_DIR/$NAME.mov" "$DEST/7_ゆるキャラ_全編_5680x1240.mov"
  cp -f "$VIDEO_DIR/$NAME.mp4" "$DEST/7_ゆるキャラ_全編_H264.mp4"
  cp -f "$VIDEO_DIR/sheet.jpg" "$DEST/7_ゆるキャラ_確認シート.jpg"
  cp -f "$VIDEO_DIR/check.json" "$DEST/check.json"
  ls -la "$DEST"
fi
echo "できた: $VIDEO_DIR(確かめの終了番号 $CHECK_STATUS)"
exit "$CHECK_STATUS"
