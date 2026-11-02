#!/bin/sh
# 1 カットを Movie Render Queue で撮る。  使い方: render_cut.sh <シーケンス名> [シーケンス名...]
export MSYS_NO_PATHCONV=1  # Git Bash が /Game/... を Windows のパスに書きかえないように
UE_CMD="C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
PROJECT="work/ue_show/HackShow/HackShow.uproject"
RENDER="work/ue_show/render"
LOGS="work/ue_show/logs"
status=0
for name in "$@"; do
  mkdir -p "$RENDER/$name" "$LOGS"
  start=$(date +%s)
  timeout 1800 "$UE_CMD" "$PROJECT" /Game/Show/L_Stage -game \
    -LevelSequence="/Game/Show/Seq/$name.$name" \
    -MoviePipelineConfig="/Game/Show/RenderConfig/Cfg_Still.Cfg_Still" \
    -windowed -resx=640 -resy=360 -log -Unattended \
    -ddc=InstalledNoZenLocalFallback -LocalDataCachePath=work/ue_show/DDC \
    -abslog="$LOGS/render_$name.log"
  code=$?
  end=$(date +%s)
  echo "$name exit=$code seconds=$((end - start))" | tee -a "$LOGS/render_times.txt"
  [ "$code" -eq 0 ] || status=$code
done
exit $status
