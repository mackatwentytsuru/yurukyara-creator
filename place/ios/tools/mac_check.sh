#!/bin/sh
# 場所スキャンのコードを Mac へ送り、署名なしで組み立てて型を確かめる(PC の Git Bash から)。
#   sh place/ios/tools/mac_check.sh
# 署名つきの組み立てと iPhone への入れ方は mac_install.command(Mac の GUI から)。
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST='~/sample_work/place_ios'
ssh pc3 "mkdir -p $DEST"
(cd "$HERE" && tar -cf - project.yml RoomScan) | ssh pc3 "cd $DEST && tar -xf -"
ssh pc3 "export PATH=/opt/homebrew/bin:\$HOME/.local/bin:\$PATH; cd $DEST && xcodegen generate >/dev/null && xcodebuild -project RoomScan.xcodeproj -scheme RoomScan -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath ./build CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -${1:-25}"
