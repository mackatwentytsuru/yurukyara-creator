#!/usr/bin/env bash
# VRM のキャラの版を 1 回で全部作る。VRM を差し替えるときも、これを動かすだけでよい。
# 使い方: build_vrm_show.sh <.vrm のパス> <版の名前> [音の版=版の名前]
# 作る物: <版>/video(全編)、<版>/video_nochar(背景が同じなら描き直さない)、black(無ければ)、sample_<版>/video(10 秒の見本)。
# SHOW_NOCHAR_FROM=<版> があれば、同じ timeline のときに限り、その版のキャラなしを写して使う。
# SHOW_DELIVER_DIR があれば、できた物を「<版>_」を頭に付けて、そこへ写す。
set -euo pipefail

[ "$#" -ge 2 ] || { echo "使い方: $0 <.vrm> <版の名前> [音の版]" >&2; exit 64; }
VRM="$1"; VERSION="$2"; AUDIO_VERSION="${3:-$VERSION}"
[ -f "$VRM" ] || { echo "VRM がありません: $VRM" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${SHOW_BUILD_ROOT:-work/ue_show/show_build}"
BUILD="$REPO/show/run/build_show.sh"
TIMELINE="$ROOT/$AUDIO_VERSION/audio/timeline.json"
export SHOW_REUSE_AUDIO=1 SHOW_AUDIO_VERSION="$AUDIO_VERSION"

NOW="$(node "$REPO/show/led_browser/render_show.mjs" --print-background-fingerprint --timeline "$TIMELINE")"
STATS="$ROOT/$VERSION/video_nochar/render_stats.json"
USED=""
[ -f "$STATS" ] && USED="$(python -c "import json,sys; print(json.load(open(sys.argv[1])).get('background_sha256',''))" "$STATS")"

# キャラありとキャラなしは並べて動かす。確かめの不合格があっても、もう片方は止めない
FAILED=0
echo "== キャラありの全編"
SHOW_CHARACTER_FILE="$VRM" bash "$BUILD" unused "" "" f_led "${SHOW_STRETCH:-1.48}" "$VERSION" > "$ROOT/${VERSION}_character.log" 2>&1 &
PID_CHARACTER=$!
PID_NOCHAR=""
if [ -n "${SHOW_NOCHAR_FROM:-}" ]; then
  SOURCE="$ROOT/$SHOW_NOCHAR_FROM/video_nochar"
  python "$REPO/show/check/same_timeline.py" "$TIMELINE" "$SOURCE/render_stats.json"
  mkdir -p "$ROOT/$VERSION/video_nochar"
  cp -f "$SOURCE/show.mov" "$SOURCE/show.mp4" "$SOURCE/render_stats.json" "$SOURCE/check.json" "$ROOT/$VERSION/video_nochar/"
  echo "キャラなしは $SHOW_NOCHAR_FROM のものを使います"
elif [ "$NOW" = "$USED" ] && [ -f "$ROOT/$VERSION/video_nochar/show.mov" ]; then
  echo "背景は同じなので、キャラなしはそのまま使います"
else
  echo "== キャラなしの全編"
  bash "$BUILD" --no-character unused "" "" f_led "${SHOW_STRETCH:-1.48}" "$VERSION" > "$ROOT/${VERSION}_nochar.log" 2>&1 &
  PID_NOCHAR=$!
fi
wait "$PID_CHARACTER" || { FAILED=1; echo "キャラありに不合格: $ROOT/${VERSION}_character.log"; }
if [ -n "$PID_NOCHAR" ]; then
  wait "$PID_NOCHAR" || { FAILED=1; echo "キャラなしに不合格: $ROOT/${VERSION}_nochar.log"; }
fi

echo "== 黒の 10 秒"
[ -f "$ROOT/black/black_10s.mov" ] || bash "$BUILD" --black

echo "== 再生機の試しの 10 秒"
SHOW_AUDIO_VERSION="$AUDIO_VERSION" SHOW_CHARACTER_FILE="$VRM" bash "$BUILD" --sample "$VERSION" || FAILED=1

if [ -n "${SHOW_DELIVER_DIR:-}" ]; then
  echo "== 持ち物へ"
  bash "$BUILD" --package "$SHOW_DELIVER_DIR" "$VERSION" "${VERSION}_"
fi
echo "できた: $VERSION(不合格 $FAILED)"
exit "$FAILED"
