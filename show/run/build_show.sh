#!/usr/bin/env bash
# ショーの全編を 1 回で作る: 音 → 映像(master)→ 書き出し → プレビュー → 確認シート。
# 使い方:
#   build_show.sh <曲 wav か temp> [始まりの秒] [長さ] [キャラ id] [stretch] [版の名前]
#   build_show.sh --no-character <上と同じ引数>   キャラだけ描かない版(同じコマ数・同じ背景・同じ音)。出力は <版>/video_nochar
#   build_show.sh --sample [版の名前]    song の盛り上がりの 10 秒だけの短い見本(再生機の試し用、同じ形式)
#   build_show.sh --black [版の名前]     同じ形式の真っ黒+無音の 10 秒
#   build_show.sh --package <置き場> [版の名前] [名前の頭]   できた物を決まった名前で置き場へ写す
# 環境変数:
#   SHOW_REUSE_AUDIO=1   できている timeline.json と show_mix.wav を使い、音を作り直さない
#   SHOW_AUDIO_VERSION=<版>  音をほかの版のフォルダから使う
#   SHOW_CHARACTER_FILE=<.vrm>  キャラをファイルで渡す
#   SHOW_FROM=<コマ>      映像を途中のコマから続ける
#   SHOW_DANCE_TRACK=<頭>  assemble_track.py の 1 本で踊らせ、サビの寄りを外す
#   SHOW_PLATE=<png>      LED の中の会場の絵。show_stage.json のとおりに等身大・左右のモニター・出る戻るの光を描く
#   SHOW_BUILD_ROOT      出力の置き場(既定 work/ue_show/show_build)
#   SHOW_LOCK="python <札の道具>"  重い処理を札で包む命令。空なら札なしで動かす
#   SHOW_WHO             札に書く名前
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="${SHOW_BUILD_ROOT:-work/ue_show/show_build}"
BASH_EXE="${SHOW_BASH:-C:/Program Files/Git/bin/bash.exe}"
LOCK_TOOL="${SHOW_LOCK-python machine_lock.py}"
WHO="${SHOW_WHO:-show}"
SAMPLE_SEC=10
PREVIEW_NAME=preview.mp4

fail() { echo "失敗: $*" >&2; exit 1; }

# 札で包んで動かす: locked <種類> <分> <内容> -- <命令...>
locked() {
  local kind="$1" minutes="$2" job="$3"
  shift 4
  if [ -z "$LOCK_TOOL" ]; then
    "$@"
  else
    $LOCK_TOOL run --machine pc1 --kind "$kind" --who "$WHO" --job "$job" --minutes "$minutes" --wait 30 --no-table -- "$@"
  fi
}

NO_CHARACTER=0
if [ "${1:-}" = "--no-character" ]; then
  NO_CHARACTER=1
  shift
fi

# できた物を決まった名前で写す(映像の名前は、置き場の決まりに合わせる)
package() {
  local dest="$1" version="$2" prefix="$3"
  mkdir -p "$dest"
  local pair
  for pair in "video|2_全編_キャラあり_5680x1240" "video_nochar|3_全編_キャラなし_5680x1240"; do
    local dir="$ROOT/$version/${pair%%|*}" name="${pair##*|}"
    [ -f "$dir/show.mov" ] || fail "ありません: $dir/show.mov"
    cp -f "$dir/show.mov" "$dest/${prefix}${name}.mov"
    cp -f "$dir/show.mp4" "$dest/${prefix}${name}_H264.mp4"
  done
  [ -f "$ROOT/black/black_10s.mov" ] || fail "黒の 10 秒がありません"
  cp -f "$ROOT/black/black_10s.mov" "$dest/${prefix}4_黒_10秒.mov"
  [ -f "$ROOT/sample_$version/video/show_sample.mov" ] || fail "見本がありません"
  cp -f "$ROOT/sample_$version/video/show_sample.mov" "$dest/${prefix}5_再生機の試し_10秒.mov"
  ls -la "$dest"
}

if [ "${1:-}" = "--package" ]; then
  [ "$#" -ge 2 ] || fail "使い方: build_show.sh --package <置き場> [版の名前] [名前の頭]"
  package "$2" "${3:-temp}" "${4:-}"
  exit 0
fi

if [ "${1:-}" = "--black" ]; then
  OUT="$ROOT/black"
  mkdir -p "$OUT"
  # 納品と同じ形式。黒は limited range の黒として書く
  locked render 5 "ショーの黒の 10 秒" -- ffmpeg -y -v error -f lavfi -i "color=c=black:s=5680x1240:r=60:d=10" -f lavfi -i "anullsrc=r=48000:cl=stereo" -t 10     -vf "format=yuv420p10le" -c:v hevc_nvenc -preset p7 -tune hq -rc vbr -cq 16 -b:v 0 -maxrate 250M -bufsize 500M -profile:v main10 -pix_fmt p010le -tag:v hvc1 -r 60     -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a pcm_s24le -ar 48000 -ac 2 -map_metadata -1 "$OUT/black_10s.mov"
  python "$REPO/show/check/check_black.py" "$OUT/black_10s.mov"
  exit 0
fi

MODE=full
if [ "${1:-}" = "--sample" ]; then
  MODE=sample
  VERSION="${2:-temp}"
  SONG=""
  CHARACTER=f_led
  STRETCH=1.48
else
  [ "$#" -ge 1 ] || fail "使い方: build_show.sh <曲 wav か temp> [始まりの秒] [長さ] [キャラ id] [stretch] [版の名前]"
  SONG="$1"
  SONG_START="${2:-}"
  SONG_LEN="${3:-}"
  CHARACTER="${4:-f_led}"
  STRETCH="${5:-1.48}"
  if [ -n "${6:-}" ]; then
    VERSION="$6"
  elif [ "$SONG" = "temp" ]; then
    VERSION=temp
  else
    VERSION="$(basename "${SONG%.*}")"
  fi
fi

AUDIO_DIR="$ROOT/${SHOW_AUDIO_VERSION:-$VERSION}/audio"
TIMELINE="$AUDIO_DIR/timeline.json"
MIX="$AUDIO_DIR/show_mix.wav"

if [ "$MODE" = "full" ] && [ "${SHOW_REUSE_AUDIO:-0}" != "1" ]; then
  echo "== 音"
  ARGS=(--script "$REPO/show/show_script.json" --song "$SONG" --out "$AUDIO_DIR")
  [ -n "$SONG_START" ] && ARGS+=(--song-start "$SONG_START")
  [ -n "$SONG_LEN" ] && ARGS+=(--song-len "$SONG_LEN")
  locked gpu 20 "ショーの音 $VERSION" -- python "$REPO/show/audio/make_show_audio.py" "${ARGS[@]}"
fi
[ -f "$TIMELINE" ] || fail "timeline がありません: $TIMELINE"
[ -f "$MIX" ] || fail "音がありません: $MIX"

if [ "$MODE" = "sample" ]; then
  VIDEO_DIR="$ROOT/sample_$VERSION/video"
  mkdir -p "$VIDEO_DIR"
  echo "== 見本の映像($SAMPLE_SEC 秒)"
  locked gpu 10 "ショーの見本の映像" -- node "$REPO/show/led_browser/render_show.mjs" --timeline "$TIMELINE" --character "$CHARACTER" --stretch "$STRETCH" --out "$VIDEO_DIR" --section song --seconds "$SAMPLE_SEC" --loud ${SHOW_CHARACTER_FILE:+--character-file "$SHOW_CHARACTER_FILE"} ${SHOW_DANCE_TRACK:+--dance-track "$SHOW_DANCE_TRACK" --no-zoom} ${SHOW_PLATE:+--plate "$SHOW_PLATE"}
  FROM_FRAME="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['from'])" "$VIDEO_DIR/render_stats.json")"
  START_SEC="$(python -c "import sys; print(int(sys.argv[1]) / 60)" "$FROM_FRAME")"
  ffmpeg -y -v error -ss "$START_SEC" -t "$SAMPLE_SEC" -i "$MIX" -c:a pcm_s24le "$VIDEO_DIR/sample_audio.wav"
  AUDIO_IN="$VIDEO_DIR/sample_audio.wav"
  NAME=show_sample
  CHECK_ARGS=(--sample)
else
  VIDEO_DIR="$ROOT/$VERSION/video"
  [ "$NO_CHARACTER" = "1" ] && VIDEO_DIR="$ROOT/$VERSION/video_nochar"
  mkdir -p "$VIDEO_DIR"
  echo "== 映像"
  RENDER_ARGS=(--timeline "$TIMELINE" --character "$CHARACTER" --stretch "$STRETCH" --out "$VIDEO_DIR")
  [ -n "${SHOW_FROM:-}" ] && RENDER_ARGS+=(--from "$SHOW_FROM")
  [ "$NO_CHARACTER" = "1" ] && RENDER_ARGS+=(--no-character)
  [ -n "${SHOW_CHARACTER_FILE:-}" ] && [ "$NO_CHARACTER" != "1" ] && RENDER_ARGS+=(--character-file "$SHOW_CHARACTER_FILE")
  if [ -n "${SHOW_PLATE:-}" ]; then
    # LED の中の会場: キャラなしの版でも、左右のモニターにはキャラが映る
    RENDER_ARGS+=(--plate "$SHOW_PLATE" --dance-track "$SHOW_DANCE_TRACK")
    [ "$NO_CHARACTER" = "1" ] && RENDER_ARGS+=(--character-file "$SHOW_CHARACTER_FILE")
  elif [ -n "${SHOW_DANCE_TRACK:-}" ] && [ "$NO_CHARACTER" != "1" ]; then
    RENDER_ARGS+=(--dance-track "$SHOW_DANCE_TRACK" --no-zoom)
  fi
  # キャラなしは GPU をほとんど使わない(1 コマ約 20 ms)ので、書き出しの札で並べて動かせる
  RENDER_KIND=gpu
  [ "$NO_CHARACTER" = "1" ] && RENDER_KIND=render
  locked "$RENDER_KIND" 40 "ショーの全編の映像 $VERSION" -- node "$REPO/show/led_browser/render_show.mjs" "${RENDER_ARGS[@]}"
  AUDIO_IN="$MIX"
  NAME=show
  CHECK_ARGS=()
  [ "$NO_CHARACTER" = "1" ] && CHECK_ARGS+=(--no-character)
fi

echo "== 書き出し"
locked render 30 "ショーの書き出し $VERSION" -- "$BASH_EXE" "$REPO/show/run/encode_led.sh" "$VIDEO_DIR/master.mov" "$AUDIO_IN" "$VIDEO_DIR" "$NAME"
mv -f "$VIDEO_DIR/${NAME}_preview.mp4" "$VIDEO_DIR/$PREVIEW_NAME"

echo "== 確かめ"
python "$REPO/show/check/check_show.py" --video-dir "$VIDEO_DIR" --timeline "$TIMELINE" --name "$NAME" "${CHECK_ARGS[@]}"
echo "できた: $VIDEO_DIR"
