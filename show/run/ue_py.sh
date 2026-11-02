#!/bin/sh
# 画面なしの UE で Python を 1 本動かす。  使い方: ue_py.sh <py のパス> <ログのパス>
UE_CMD="C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
PROJECT="work/ue_show/HackShow/HackShow.uproject"
mkdir -p "$(dirname "$2")"
timeout 1800 "$UE_CMD" "$PROJECT" -run=pythonscript -script="$1" -unattended -nosplash -nullrhi \
  -ddc=InstalledNoZenLocalFallback -LocalDataCachePath=work/ue_show/DDC -abslog="$2"
code=$?
echo "ue_py exit code $code"
exit $code
