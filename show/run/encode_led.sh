#!/usr/bin/env bash
# 使い方: encode_led.sh <master の映像> <音 wav か none> <出力フォルダ> <名前>
# 作るもの(出力フォルダの中):
#   <名前>.mov          HEVC 10bit(hevc_nvenc) + PCM 24bit 48kHz ステレオ
#   <名前>.mp4          H.264(libx264 crf16、yuv420p) + AAC 320k
#   <名前>_preview.mp4  1420x310、音つき
# 作ったあと ffprobe で形式・コマ数・音と映像の長さの差を確かめ、違えば 0 以外で止まる。
# hevc_nvenc が使えないときは止まる(別のエンコーダへは落とさない)。
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "使い方: $0 <master の映像> <音 wav か none> <出力フォルダ> <名前>" >&2
  exit 64
fi
MASTER="$1"; AUDIO="$2"; OUTDIR="$3"; NAME="$4"
MOV="$OUTDIR/$NAME.mov"; MP4="$OUTDIR/$NAME.mp4"; PREV="$OUTDIR/${NAME}_preview.mp4"
MAX_AV_DIFF=0.034   # 秒(2 コマ)

fail() { echo "失敗: $*" >&2; exit 1; }

[ -f "$MASTER" ] || fail "master の映像がない: $MASTER"
[ "$AUDIO" = "none" ] || [ -f "$AUDIO" ] || fail "音のファイルがない: $AUDIO"
mkdir -p "$OUTDIR"

ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_nvenc \
  || fail "hevc_nvenc が使えない。別のエンコーダへは落とさず止める"

probe() { ffprobe -v error "$@"; }
DUR=$(probe -show_entries format=duration -of csv=p=0 "$MASTER")
[ -n "$DUR" ] && [ "$DUR" != "N/A" ] || fail "master の長さが読めない"
MASTER_FRAMES=$(probe -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$MASTER")
echo "master: ${DUR}s ${MASTER_FRAMES} コマ"

# 音の入力。none のときは同じ長さの無音を作る。長さは映像に合わせて切る/足す
if [ "$AUDIO" = "none" ]; then
  AIN=(-f lavfi -i "anullsrc=r=48000:cl=stereo")
else
  AIN=(-i "$AUDIO")
fi
AFILT="aresample=48000,aformat=channel_layouts=stereo,apad"
COLOR=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)

echo "== HEVC 10bit + PCM 24bit"
ffmpeg -y -hide_banner -loglevel error -i "$MASTER" "${AIN[@]}" \
  -map 0:v:0 -map 1:a:0 -t "$DUR" -af "$AFILT" \
  -c:v hevc_nvenc -preset p7 -tune hq -rc vbr -cq 16 -b:v 0 -maxrate 250M -bufsize 500M \
  -profile:v main10 -pix_fmt p010le -tag:v hvc1 -r 60 "${COLOR[@]}" \
  -c:a pcm_s24le -ar 48000 -ac 2 -map_metadata -1 "$MOV" \
  || fail "HEVC の書き出し(hevc_nvenc)"

echo "== H.264 mp4"
ffmpeg -y -hide_banner -loglevel error -i "$MASTER" "${AIN[@]}" \
  -map 0:v:0 -map 1:a:0 -t "$DUR" -af "$AFILT" \
  -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p -r 60 "${COLOR[@]}" \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -map_metadata -1 -movflags +faststart "$MP4" \
  || fail "H.264 の書き出し"

echo "== preview 1420x310"
ffmpeg -y -hide_banner -loglevel error -i "$MASTER" "${AIN[@]}" \
  -map 0:v:0 -map 1:a:0 -t "$DUR" -af "$AFILT" \
  -vf "scale=1420:310:flags=lanczos,format=yuv420p" \
  -c:v libx264 -crf 22 -preset medium -r 60 "${COLOR[@]}" \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -map_metadata -1 -movflags +faststart "$PREV" \
  || fail "プレビューの書き出し"

echo "== ffprobe で確認"
check_v() {  # <ファイル> <期待する 'codec,profile,w,h,pix_fmt,fps'>
  local got
  got=$(probe -select_streams v:0 -show_entries stream=codec_name,profile,width,height,pix_fmt,r_frame_rate -of csv=p=0 "$1")
  [ "$got" = "$2" ] || fail "$1 の映像形式が違う: 得た [$got] 期待 [$2]"
  local fr
  fr=$(probe -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$1")
  [ "$fr" = "$MASTER_FRAMES" ] || fail "$1 のコマ数が違う: 得た $fr 期待 $MASTER_FRAMES"
  echo "  OK 映像 $1 [$got] ${fr} コマ"
}
check_a() {  # <ファイル> <期待する 'codec,rate,ch'>
  local got
  got=$(probe -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of csv=p=0 "$1")
  [ "$got" = "$2" ] || fail "$1 の音の形式が違う: 得た [$got] 期待 [$2]"
  local vd ad
  vd=$(probe -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$1")
  ad=$(probe -select_streams a:0 -show_entries stream=duration -of csv=p=0 "$1")
  awk -v v="$vd" -v a="$ad" -v m="$MAX_AV_DIFF" 'BEGIN{d=v-a; if(d<0)d=-d; exit !(d<=m)}' \
    || fail "$1 の音と映像の長さの差が大きい: 映像 $vd 音 $ad"
  echo "  OK 音 $1 [$got] 映像 ${vd}s 音 ${ad}s"
}
check_v "$MOV"  "hevc,Main 10,5680,1240,yuv420p10le,60/1"
check_a "$MOV"  "pcm_s24le,48000,2"
check_v "$MP4"  "h264,High,5680,1240,yuv420p,60/1"
check_a "$MP4"  "aac,48000,2"
check_v "$PREV" "h264,High,1420,310,yuv420p,60/1"
check_a "$PREV" "aac,48000,2"
echo "完了: $MOV"
