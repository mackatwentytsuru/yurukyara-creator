#!/bin/sh
# 場所スキャンと ARステージのコードを Mac へ送り、署名なしで組み立てて型を確かめる(PC の Git Bash から)。
#   sh place/ios/tools/mac_check.sh [RoomScan|ARStage] [出力の行数]
# 署名つきの組み立てと iPhone への入れ方は mac_install.command(Mac の GUI から)。
set -e
SCHEME="${1:-RoomScan}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST='~/sample_work/place_ios'
ssh pc3 "mkdir -p $DEST"
(cd "$HERE" && tar -cf - project.yml RoomScan ARStage) | ssh pc3 "cd $DEST && tar -xf -"
ssh pc3 "export PATH=/opt/homebrew/bin:\$HOME/.local/bin:\$PATH; cd $DEST && xcodegen generate >/dev/null && xcodebuild -project RoomScan.xcodeproj -scheme $SCHEME -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath ./build CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E 'error:|warning: .*(deprecated|unused)|BUILD' | head -${2:-30}"
