#!/usr/bin/env bash
# 踊りの案を 1 つ選んで、LED の絵と同じ動きのキャラを UE の 2 つのプロジェクトへ入れる。何度でも流せる。
# 使い方: sample_into_ue.sh <並べ方の json> [名前]
# 環境変数: VRM、TIMELINE、WORK(作業フォルダ)、CLIPS(移した動きのフォルダ)、SING(make_sing_curves.py の出力。任意)
set -eu
PLAN="$1"
NAME="${2:-sample_show}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHOW="$(cd "$HERE/.." && pwd -W)"
TRACK="$WORK/track_$NAME"
LOCK_TOOL="machine_lock.py"
LIVE_ROOT="work/ue_show/HackShow_live"
SHOW_ROOT="work/ue_show/HackShow"
UE_CMD="C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
COMMON="-unattended -nosplash -nullrhi -ddc=InstalledNoZenLocalFallback -LocalDataCachePath=work/ue_show/DDC"

ue_job() {
  python "$LOCK_TOOL" run --machine pc1 --kind ue --who "ハッカソン|キャラクターショー" --job "$1" --minutes 10 --wait 15 -- "$UE_CMD" "$2" -run=pythonscript "-script=$3" $COMMON "-abslog=$4" || true
}

mkdir -p "$WORK"
python "$SHOW/motion/assemble_track.py" --plan "$PLAN" --clips "$CLIPS" --timeline "$TIMELINE" --vrm "$VRM" ${SING:+--sing "$SING"} --out "$TRACK"
node "$SHOW/led_browser/render_show.mjs" --timeline "$TIMELINE" --character-file "$VRM" --stretch 1.48 --no-zoom --dance-track "$TRACK" --pose-out "$WORK/pose_$NAME" --out "$WORK/_page"
python "$SHOW/ue/make_motion_glb.py" "$VRM" "$WORK/pose_$NAME" "$WORK/$NAME.glb"
export GLB_SOURCE="$WORK/$NAME.glb" GLB_NAME="$NAME" GLB_REPORT="$WORK/import_$NAME.txt" LIVE_CHARACTER="$NAME" LIVE_REPORT="$WORK/build_live_$NAME.txt"
rm -f "$GLB_REPORT" "$LIVE_REPORT"
ue_job "踊りのキャラを UE へ s:2bfec9e0" "$SHOW_ROOT/HackShow.uproject" "$SHOW/ue/import_motion_glb.py" "$WORK/import_$NAME.log"
grep -q IMPORT_OK "$GLB_REPORT"
mkdir -p "$LIVE_ROOT/Content/Show/Character"
rm -rf "$LIVE_ROOT/Content/Show/Character/$NAME"
cp -r "$SHOW_ROOT/Content/Show/Character/$NAME" "$LIVE_ROOT/Content/Show/Character/"
ue_job "リアルタイムのレベルへ s:2bfec9e0" "$LIVE_ROOT/HackShow.uproject" "$SHOW/live/build_live.py" "$WORK/build_live_$NAME.log"
grep -q BUILD_OK "$LIVE_REPORT"
echo "できた: $NAME"
