#!/bin/zsh
cd ~/sample_work/place_ios || exit 1
export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH
rm -f ipad_build.done ipad_build.log
{
xcodegen generate
xcodebuild -project RoomScan.xcodeproj -scheme ShootLog -configuration Debug -destination "generic/platform=iOS" -derivedDataPath ./build DEVELOPMENT_TEAM="$(cat team.txt)" -allowProvisioningUpdates build 2>&1 | grep -E "error|BUILD|Provisioning|profile" | head -30
echo "rc=${pipestatus[1]}"
} > ipad_build.log 2>&1
echo done > ipad_build.done
